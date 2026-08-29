import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { resolveOrgScope } from "@/lib/org";

export async function GET() {
  const auth = await requirePermission("departments.view");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ departments: readDb().departments });
}

const createSchema = z.object({
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
  orgScope: z.enum(["BANK", "DISTRICT", "BRANCH"]),
  districtId: z.string().optional(),
  branchId: z.string().optional(),
});

export async function POST(request: Request) {
  const auth = await requirePermission("departments.create");
  if (!auth.ok) return auth.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const db = readDb();
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

  updateDb((current) => {
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
