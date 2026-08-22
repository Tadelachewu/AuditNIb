import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";

const updateSchema = z.object({
  status: z.enum(["OPEN", "LOCKED"]),
  reason: z.string().min(5, "A reason of at least 5 characters is required"),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("reporting-periods.lock");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { status, reason } = parsed.data;

  const db = readDb();
  const existing = db.reportingPeriods.find((p) => p.id === id);
  if (!existing) return NextResponse.json({ error: "Reporting period not found" }, { status: 404 });
  if (existing.status === status) {
    return NextResponse.json({ error: `Period is already ${status.toLowerCase()}` }, { status: 409 });
  }

  const now = new Date().toISOString();
  const updated = updateDb((current) => {
    const p = current.reportingPeriods.find((x) => x.id === id)!;
    p.status = status;
    p.lockedBy = status === "LOCKED" ? auth.session.userId! : null;
    p.lockedAt = status === "LOCKED" ? now : null;
    p.lockReason = reason;
    p.updatedAt = now;
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: status === "LOCKED" ? "LOCK" : "UNLOCK",
      entityType: "ReportingPeriod",
      entityId: p.id,
      oldValue: { status: existing.status },
      newValue: { status },
      reason,
    });
    return p;
  });

  return NextResponse.json({ reportingPeriod: updated });
}
