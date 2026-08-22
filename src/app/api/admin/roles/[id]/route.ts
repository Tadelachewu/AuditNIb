import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { isValidPermissionKey, ALL_PERMISSION_KEYS } from "@/lib/permissions/registry";

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

  // The ADMIN role always has every permission and is always active - both
  // are what makes it safe to assume "an Administrator can always fix
  // access," including undoing a permissions mistake made on any other
  // role. Without this guard, an admin could accidentally strip their own
  // role's access and lock every administrator out of the console.
  if (existing.code === "ADMIN") {
    if (input.permissions && input.permissions.length !== ALL_PERMISSION_KEYS.length) {
      return NextResponse.json({ error: "The Administrator role must always hold every permission" }, { status: 409 });
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
