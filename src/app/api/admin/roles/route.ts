import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { PAGE_REGISTRY, ALL_PERMISSION_KEYS, isValidPermissionKey } from "@/lib/permissions/registry";

export async function GET() {
  const auth = await requirePermission("roles.view");
  if (!auth.ok) return auth.response;
  const db = readDb();
  // ADMIN always displays as holding every current permission, same as it
  // resolves at login (see src/app/api/auth/login/route.ts) - never the
  // possibly-stale snapshot stored on the record.
  const roles = db.roles.map((r) => (r.code === "ADMIN" ? { ...r, permissions: ALL_PERMISSION_KEYS } : r));
  // The registry travels with the list so the UI can render the full
  // page x action matrix without a second round trip.
  return NextResponse.json({ roles, registry: PAGE_REGISTRY });
}

const createSchema = z.object({
  code: z
    .string()
    .min(2, "Code is required")
    .regex(/^[A-Z][A-Z0-9_]*$/, "Code must be UPPER_SNAKE_CASE, starting with a letter"),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  orgScope: z.enum(["BANK", "DISTRICT", "BRANCH"]),
  branchSingleton: z.boolean().default(false),
  permissions: z.array(z.string()).default([]),
});

// New roles are always custom (isSystem: false) - the 7 seeded roles are
// the only isSystem ones and are never created through this endpoint.
export async function POST(request: Request) {
  const auth = await requirePermission("roles.manage");
  if (!auth.ok) return auth.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const input = parsed.data;

  const invalidKey = input.permissions.find((key) => !isValidPermissionKey(key));
  if (invalidKey) {
    return NextResponse.json({ error: `"${invalidKey}" is not a known permission` }, { status: 400 });
  }

  const db = readDb();
  if (db.roles.some((r) => r.code === input.code)) {
    return NextResponse.json({ error: "A role with that code already exists" }, { status: 409 });
  }

  const now = new Date().toISOString();
  const role = {
    id: uuid(),
    code: input.code,
    name: input.name,
    description: input.description,
    orgScope: input.orgScope,
    branchSingleton: input.orgScope === "BRANCH" ? input.branchSingleton : false,
    isSystem: false,
    permissions: input.permissions,
    status: "ACTIVE" as const,
    createdAt: now,
    updatedAt: now,
  };

  updateDb((current) => {
    current.roles.push(role);
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "CREATE",
      entityType: "RoleDefinition",
      entityId: role.id,
      newValue: role,
    });
  });

  return NextResponse.json({ role }, { status: 201 });
}
