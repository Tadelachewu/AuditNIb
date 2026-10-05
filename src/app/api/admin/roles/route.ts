import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { zEntityName, zRoleCode, zText } from "@/lib/inputRules";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { PAGE_REGISTRY, isValidPermissionKey } from "@/lib/permissions/registry";
import { withApiHandler } from "@/lib/api/handler";
import { listPageJson } from "@/lib/serverList";

async function handleGET(request: Request) {
  const auth = await requirePermission("roles.view");
  if (!auth.ok) return auth.response;
  const db = await readDb();
  // ADMIN's permissions display exactly as stored, same as any other role -
  // it can be narrowed (see PATCH .../roles/[id]), so showing anything else
  // here would mask what's actually granted. Alphabetical by name - same
  // convention as every other reference-data list in the app (districts,
  // branches, sources, ...), and the Users page's own role picker reads
  // from this same endpoint.
  const roles = [...db.roles].sort((a, b) => a.name.localeCompare(b.name));
  // The registry travels with the list so the UI can render the full
  // page x action matrix without a second round trip.
  // ?page=... -> one page of the Roles list (the Users page's role picker asks for all of them).
  const paged = listPageJson(request, "roles", roles, { fields: { name: (r) => r.name, code: (r) => r.code } });
  if (paged) return NextResponse.json({ ...paged, registry: PAGE_REGISTRY });
  return NextResponse.json({ roles, registry: PAGE_REGISTRY });
}

const createSchema = z.object({
  code: zRoleCode(),
  name: zEntityName(),
  description: zText("Description", 500).optional(),
  orgScope: z.enum(["BANK", "DISTRICT", "BRANCH"]),
  branchSingleton: z.boolean().default(false),
  permissions: z.array(z.string()).default([]),
});

// New roles are always custom (isSystem: false) - the 7 seeded roles are
// the only isSystem ones and are never created through this endpoint.
async function handlePOST(request: Request) {
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

  const db = await readDb();
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

  await updateDb((current) => {
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

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const GET = withApiHandler(handleGET);
export const POST = withApiHandler(handlePOST);
