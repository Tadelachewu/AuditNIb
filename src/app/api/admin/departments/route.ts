import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { zCode, zEntityName } from "@/lib/inputRules";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { resolveOrgScope } from "@/lib/org";
import { withApiHandler } from "@/lib/api/handler";
import { listPageJson } from "@/lib/serverList";

async function handleGET(request: Request) {
  const auth = await requirePermission("departments.view");
  if (!auth.ok) return auth.response;
  const db = await readDb();
  // Alphabetical by name - same convention as /api/admin/branches/districts,
  // and every picker across the app that lists departments reads from here.
  const departments = [...db.departments].sort((a, b) => a.name.localeCompare(b.name));

  // ?page=... -> one page of the Departments table (searched / filtered / sorted on the server).
  const districtName = (id?: string | null) => db.districts.find((d) => d.id === id)?.name ?? "—";
  const branchName = (id?: string | null) => db.branches.find((b) => b.id === id)?.name ?? "—";
  const paged = listPageJson(request, "departments", departments, {
    fields: {
      code: (d) => d.code,
      name: (d) => d.name,
      scope: (d) =>
        d.orgScope === "BANK" ? "Bank-wide" : d.orgScope === "BRANCH" ? `Branch: ${branchName(d.branchId)}` : `District: ${districtName(d.districtId)}`,
      level: (d) => d.orgScope,
      status: (d) => (d.active ? "Active" : "Inactive"),
    },
    exact: ["level", "status"],
  });
  if (paged) return NextResponse.json(paged);

  return NextResponse.json({ departments });
}

const createSchema = z.object({
  code: zCode(),
  name: zEntityName(),
  orgScope: z.enum(["BANK", "DISTRICT", "BRANCH"]),
  districtId: z.string().optional(),
  branchId: z.string().optional(),
});

async function handlePOST(request: Request) {
  const auth = await requirePermission("departments.create");
  if (!auth.ok) return auth.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const db = await readDb();
  if (db.departments.some((d) => d.code.toLowerCase() === parsed.data.code.toLowerCase())) {
    return NextResponse.json({ error: "A department with that code already exists" }, { status: 409 });
  }

  const scope = resolveOrgScope(db, parsed.data);
  if (scope.error) return NextResponse.json({ error: scope.error }, { status: 400 });

  const now = new Date().toISOString();
  const department = {
    id: uuid(),
    code: parsed.data.code,
    name: parsed.data.name,
    active: true,
    orgScope: parsed.data.orgScope,
    districtId: scope.districtId,
    branchId: scope.branchId,
    createdAt: now,
    updatedAt: now,
  };

  await updateDb((current) => {
    current.departments.push(department);
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "CREATE",
      entityType: "Department",
      entityId: department.id,
      newValue: department,
    });
  });

  return NextResponse.json({ department }, { status: 201 });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const GET = withApiHandler(handleGET);
export const POST = withApiHandler(handlePOST);
