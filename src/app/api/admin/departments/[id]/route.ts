import { NextResponse } from "next/server";
import { z } from "zod";
import { requireToggleOrEditPermission, requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { resolveOrgScope } from "@/lib/org";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
  orgScope: z.enum(["BANK", "DISTRICT", "BRANCH"]).optional(),
  districtId: z.string().optional(),
  branchId: z.string().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const auth = await requireToggleOrEditPermission("departments", parsed.data, "active");
  if (!auth.ok) return auth.response;

  const db = readDb();
  const existing = db.departments.find((d) => d.id === id);
  if (!existing) return NextResponse.json({ error: "Department not found" }, { status: 404 });
  const before = { name: existing.name, active: existing.active, orgScope: existing.orgScope, districtId: existing.districtId, branchId: existing.branchId };

  // Changing scope re-resolves district/branch the same way creation does -
  // e.g. switching BRANCH -> DISTRICT drops the now-irrelevant branchId.
  let scope: { districtId: string | null; branchId: string | null } | null = null;
  if (parsed.data.orgScope !== undefined) {
    const resolved = resolveOrgScope(db, {
      orgScope: parsed.data.orgScope,
      districtId: parsed.data.districtId ?? existing.districtId,
      branchId: parsed.data.branchId ?? existing.branchId,
    });
    if (resolved.error) return NextResponse.json({ error: resolved.error }, { status: 400 });
    scope = resolved;
  }

  const updated = updateDb((current) => {
    const d = current.departments.find((x) => x.id === id)!;
    if (parsed.data.name !== undefined) d.name = parsed.data.name;
    if (parsed.data.active !== undefined) d.active = parsed.data.active;
    if (parsed.data.orgScope !== undefined && scope) {
      d.orgScope = parsed.data.orgScope;
      d.districtId = scope.districtId;
      d.branchId = scope.branchId;
    }
    d.updatedAt = new Date().toISOString();
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "UPDATE",
      entityType: "Department",
      entityId: d.id,
      oldValue: before,
      newValue: { name: d.name, active: d.active, orgScope: d.orgScope, districtId: d.districtId, branchId: d.branchId },
    });
    return d;
  });

  return NextResponse.json({ department: updated });
}

// Blocked with 409 if any finding still references this department, same
// reasoning as the Sources DELETE handler.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("departments.delete");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = readDb();
  const existing = db.departments.find((d) => d.id === id);
  if (!existing) return NextResponse.json({ error: "Department not found" }, { status: 404 });

  const findingCount = db.findings.filter((f) => f.departmentId === id).length;
  if (findingCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${findingCount} finding(s) reference this department.` },
      { status: 409 }
    );
  }

  updateDb((current) => {
    current.departments = current.departments.filter((d) => d.id !== id);
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "DELETE",
      entityType: "Department",
      entityId: id,
      oldValue: existing,
    });
  });

  return NextResponse.json({ ok: true });
}
