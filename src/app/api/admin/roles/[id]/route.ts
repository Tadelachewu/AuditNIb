import { NextResponse } from "next/server";
import { lockoutError } from "@/lib/permissions/lockout";
import { z } from "zod";
import { zEntityName, zText } from "@/lib/inputRules";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { isValidPermissionKey, permissionKey } from "@/lib/permissions/registry";
import { withApiHandler } from "@/lib/api/handler";

const ROLES_MANAGE_KEY = permissionKey("roles", "manage");

const updateSchema = z.object({
  name: zEntityName().optional(),
  description: zText("Description", 500).optional(),
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
async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const db = await readDb();
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

  // Any role (not just Administrator): refuse a deactivation or permission
  // removal that leaves nobody active able to undo it.
  if (input.status !== undefined || input.permissions !== undefined) {
    const lockout = lockoutError(db, {
      roles: db.roles.map((r) => (r.id === existing.id ? { ...r, status: input.status ?? r.status, permissions: input.permissions ?? r.permissions } : r)),
    });
    if (lockout) return NextResponse.json({ error: lockout, code: "LOCKOUT_PREVENTED" }, { status: 409 });
  }

  if (existing.orgScope !== "BRANCH" && input.branchSingleton) {
    return NextResponse.json({ error: "branchSingleton only applies to branch-scoped roles" }, { status: 400 });
  }

  // Switching "at most one active user per branch" on: refuse while any branch
  // already has more than one active holder of this role, naming them, so
  // the rule never starts out broken.
  if (input.branchSingleton && !existing.branchSingleton) {
    const byBranch = new Map<string, string[]>();
    for (const u of db.users) {
      if (u.role !== existing.code || u.status !== "ACTIVE" || !u.branchId) continue;
      byBranch.set(u.branchId, [...(byBranch.get(u.branchId) ?? []), u.name]);
    }
    const clashes = [...byBranch.entries()].filter(([, names]) => names.length > 1);
    if (clashes.length > 0) {
      const list = clashes
        .slice(0, 3)
        .map(([branchId, names]) => `${db.branches.find((b) => b.id === branchId)?.name ?? "a branch"} (${names.join(", ")})`)
        .join("; ");
      return NextResponse.json(
        {
          error: `Can't limit ${existing.name} to one active user per branch: ${clashes.length} branch(es) already have more than one - ${list}${clashes.length > 3 ? "; ..." : ""}. Deactivate or reassign the extra users first.`,
        },
        { status: 409 }
      );
    }
  }

  const before = {
    name: existing.name,
    description: existing.description,
    permissions: existing.permissions,
    branchSingleton: existing.branchSingleton,
    status: existing.status,
  };

  const updated = await updateDb((current) => {
    const r = current.roles.find((x) => x.id === id)!;
    if (input.name !== undefined) r.name = input.name;
    if (input.description !== undefined) r.description = input.description;
    if (input.permissions !== undefined) r.permissions = input.permissions;
    if (input.branchSingleton !== undefined) r.branchSingleton = input.branchSingleton;
    if (input.status !== undefined) r.status = input.status;
    r.updatedAt = new Date().toISOString();
    // Deactivating a role signs out everyone holding it right away (their
    // session cookie still carries the role's permissions until then);
    // login already refuses a deactivated role.
    if (input.status === "INACTIVE" && existing.status === "ACTIVE") {
      for (const u of current.users) if (u.role === r.code) u.sessionVersion = (u.sessionVersion ?? 1) + 1;
    }

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
async function handleDELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("roles.manage");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = await readDb();
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

  await updateDb((current) => {
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

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const PATCH = withApiHandler(handlePATCH);
export const DELETE = withApiHandler(handleDELETE);
