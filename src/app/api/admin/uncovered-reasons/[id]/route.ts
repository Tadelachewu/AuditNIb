import { NextResponse } from "next/server";
import { z } from "zod";
import { requireToggleOrEditPermission, requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const auth = await requireToggleOrEditPermission("uncovered-reasons", parsed.data, "active");
  if (!auth.ok) return auth.response;

  const db = readDb();
  const existing = db.uncoveredReasons.find((r) => r.id === id);
  if (!existing) return NextResponse.json({ error: "Reason not found" }, { status: 404 });
  const before = { name: existing.name, active: existing.active };

  const updated = updateDb((current) => {
    const r = current.uncoveredReasons.find((x) => x.id === id)!;
    if (parsed.data.name !== undefined) r.name = parsed.data.name;
    if (parsed.data.active !== undefined) r.active = parsed.data.active;
    r.updatedAt = new Date().toISOString();
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "UPDATE",
      entityType: "UncoveredReason",
      entityId: r.id,
      oldValue: before,
      newValue: { name: r.name, active: r.active },
    });
    return r;
  });

  return NextResponse.json({ reason: updated });
}

// Blocked with 409 if any BranchCoverageNote still references this reason
// (BranchCoverageNote.reasonId is a plain id with no referential-integrity
// checking of its own) - same convention as Sources' DELETE handler.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("uncovered-reasons.delete");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = readDb();
  const existing = db.uncoveredReasons.find((r) => r.id === id);
  if (!existing) return NextResponse.json({ error: "Reason not found" }, { status: 404 });

  const noteCount = db.branchCoverageNotes.filter((n) => n.reasonId === id).length;
  if (noteCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${noteCount} recorded coverage note(s) reference this reason.` },
      { status: 409 }
    );
  }

  updateDb((current) => {
    current.uncoveredReasons = current.uncoveredReasons.filter((r) => r.id !== id);
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "DELETE",
      entityType: "UncoveredReason",
      entityId: id,
      oldValue: existing,
    });
  });

  return NextResponse.json({ ok: true });
}
