import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { isValidPermissionKey, permissionKey } from "@/lib/permissions/registry";

const ROLES_MANAGE_KEY = permissionKey("roles", "manage");

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  permissions: z.array(z.string()).optional(),
  branchSingleton: z.boolean().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

// A role's `code` and `orgScope` are never editable here, on any role:
// existing users reference the code directly (User.role), and org.ts's
// scoping logic assumes a role's orgScope is stable once users are assigned
// against it. Changing what a role *means* structurally is a delete-and-
// recreate, not an edit; only its name/description/permissions/status can
// change in place.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("roles.manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const input = parsed.data;

  if (input.permissions) {
    const invalidKey = input.permissions.find((key) => !isValidPermissionKey(key));
    if (invalidKey) {
      return NextResponse.json({ error: `"${invalidKey}" is not a known permission` }, { status: 400 });
    }
  }

  const db = readDb();
  const existing = db.roles.find((r) => r.id === id);
  if (!existing) return NextResponse.json({ error: "Role not found" }, { status: 404 });

  // The ADMIN role's permissions can be narrowed like any other role's -
  // that's an explicit choice, not the default: doing so is how an
  // organization can, for example, require a second Administrator to grant
  // Roles & Permissions access rather than every Admin having it
  // implicitly. The one line that can't be crossed is roles.manage itself:
  // without it, nobody could ever open this screen again to undo a mistake,
  // and Admin is always active (see below) so there'd be no other route
  // back in. Every other permission is fair game to remove.
  if (existing.code === "ADMIN") {
    if (input.permissions && !input.permissions.includes(ROLES_MANAGE_KEY)) {
      return NextResponse.json(
        { error: "The Administrator role must always keep \"Roles & Permissions: Manage\" - removing it would lock every admin out of this screen for good" },
        { status: 409 }
      );
    }
    if (input.status === "INACTIVE") {
      return NextResponse.json({ error: "The Administrator role cannot be deactivated" }, { status: 409 });
    }
  }

  if (existing.orgScope !== "BRANCH" && input.branchSingleton) {
    return NextResponse.json({ error: "branchSingleton only applies to branch-scoped roles" }, { status: 400 });
  }

  const before = {
    name: existing.name,
    description: existing.description,
    permissions: existing.permissions,
    branchSingleton: existing.branchSingleton,
    status: existing.status,
  };

  const updated = updateDb((current) => {
    const r = current.roles.find((x) => x.id === id)!;
    if (input.name !== undefined) r.name = input.name;
    if (input.description !== undefined) r.description = input.description;
    if (input.permissions !== undefined) r.permissions = input.permissions;
    if (input.branchSingleton !== undefined) r.branchSingleton = input.branchSingleton;
    if (input.status !== undefined) r.status = input.status;
    r.updatedAt = new Date().toISOString();

    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "UPDATE",
      entityType: "RoleDefinition",
      entityId: r.id,
      oldValue: before,
      newValue: {
        name: r.name,
        description: r.description,
        permissions: r.permissions,
        branchSingleton: r.branchSingleton,
        status: r.status,
      },
    });

    return r;
  });

  return NextResponse.json({ role: updated });
}

// Custom (non-system) roles only - the 7 seeded roles are load-bearing
// (login, org.ts's BRANCH_MANAGER/BRANCH_CONTROLLER singleton lookups, the
// ADMIN lockout guard above all assume they exist) and can never be
// deleted, only deactivated. Also blocked with 409 if any user - active or
// not - still references this role's code, so User.role can never dangle.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("roles.manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = readDb();
  const existing = db.roles.find((r) => r.id === id);
  if (!existing) return NextResponse.json({ error: "Role not found" }, { status: 404 });

  if (existing.isSystem) {
    return NextResponse.json({ error: "Built-in roles can be deactivated but not deleted" }, { status: 409 });
  }

  const userCount = db.users.filter((u) => u.role === existing.code).length;
  if (userCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${userCount} user(s) still hold this role. Reassign or remove them first.` },
      { status: 409 }
    );
  }

  updateDb((current) => {
    current.roles = current.roles.filter((r) => r.id !== id);
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "DELETE",
      entityType: "RoleDefinition",
      entityId: id,
      oldValue: existing,
    });
  });

  return NextResponse.json({ ok: true });
}
