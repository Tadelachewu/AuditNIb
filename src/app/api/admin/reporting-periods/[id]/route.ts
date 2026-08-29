import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { notifyUsers, usersWithFindingsPermission } from "@/lib/notifications";
import { autoTransferOnLock } from "@/lib/findings";

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

    // Configurable Automatic Transfer: only ever runs on the LOCKED
    // transition, only when the Admin has it enabled (Settings), and only
    // sweeps findings still genuinely in this period - anything already
    // manually transferred out is naturally excluded (see
    // autoTransferOnLock()'s own doc comment).
    if (status === "LOCKED") {
      const { transferredCount } = autoTransferOnLock(current, p, {
        userId: auth.session.userId!,
        userName: auth.session.name!,
      });
      if (transferredCount > 0) {
        appendAuditLog(current, {
          userId: auth.session.userId!,
          userName: auth.session.name!,
          action: "AUTO_TRANSFER",
          entityType: "ReportingPeriod",
          entityId: p.id,
          newValue: { transferredCount },
        });
      }
    }

    // master.txt §12: "period events" is one of the listed notification
    // triggers - district and HO controllers bank-wide need to know a
    // period just locked (their outstanding findings now need Transfer)
    // or unlocked.
    const recipients = new Set([
      ...usersWithFindingsPermission(current, "district-review"),
      ...usersWithFindingsPermission(current, "rectify"),
    ]);
    notifyUsers(current, [...recipients], {
      type: status === "LOCKED" ? "PERIOD_LOCKED" : "PERIOD_UNLOCKED",
      title: `${p.code} ${status === "LOCKED" ? "locked" : "unlocked"}`,
      message: reason,
      entityType: "ReportingPeriod",
      entityId: p.id,
    });

    return p;
  });

  return NextResponse.json({ reportingPeriod: updated });
}
