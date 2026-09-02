import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { notifyUsers, usersWithFindingsPermission } from "@/lib/notifications";
import { autoTransferOnLock } from "@/lib/findings";

const updateSchema = z
  .object({
    // Optional - omitted entirely for a flag-only update (see below) that
    // leaves an already-LOCKED period's status untouched and just flips
    // draftsAllowedWhileLocked, without a pointless unlock/relock cycle.
    status: z.enum(["OPEN", "LOCKED"]).optional(),
    reason: z.string().min(5, "A reason of at least 5 characters is required"),
    // Only meaningful while LOCKED - whether DRAFT findings can still be
    // created/edited against this period. Optional so a status-changing
    // call that doesn't want to touch it can omit it and leave whatever
    // value the period already has.
    draftsAllowedWhileLocked: z.boolean().optional(),
    // The locking user's explicit, per-lock answer to "transfer this
    // period's outstanding cases to the next open period?" - see
    // autoTransferOnLock()'s doc comment. Only meaningful on a genuine
    // OPEN->LOCKED transition; ignored otherwise (unlock, flag-only edit).
    transferOverdueCases: z.boolean().optional(),
  })
  .refine((v) => v.status !== undefined || v.draftsAllowedWhileLocked !== undefined, {
    message: "Nothing to update",
  });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("reporting-periods.lock");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { status, reason, draftsAllowedWhileLocked, transferOverdueCases } = parsed.data;

  const db = readDb();
  const existing = db.reportingPeriods.find((p) => p.id === id);
  if (!existing) return NextResponse.json({ error: "Reporting period not found" }, { status: 404 });
  if (status !== undefined && existing.status === status && draftsAllowedWhileLocked === undefined) {
    return NextResponse.json({ error: `Period is already ${status.toLowerCase()}` }, { status: 409 });
  }
  // A true status transition, vs. a flag-only touch-up on an already-LOCKED
  // period (status provided but unchanged, or omitted entirely).
  const isStatusChange = status !== undefined && status !== existing.status;

  const now = new Date().toISOString();
  const updated = updateDb((current) => {
    const p = current.reportingPeriods.find((x) => x.id === id)!;
    if (isStatusChange) {
      p.status = status!;
      p.lockedBy = status === "LOCKED" ? auth.session.userId! : null;
      p.lockedAt = status === "LOCKED" ? now : null;
      p.lockReason = reason;
    }
    if (draftsAllowedWhileLocked !== undefined) p.draftsAllowedWhileLocked = draftsAllowedWhileLocked;
    p.updatedAt = now;
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: isStatusChange ? (status === "LOCKED" ? "LOCK" : "UNLOCK") : "UPDATE",
      entityType: "ReportingPeriod",
      entityId: p.id,
      oldValue: { status: existing.status, draftsAllowedWhileLocked: existing.draftsAllowedWhileLocked },
      newValue: { status: p.status, draftsAllowedWhileLocked: p.draftsAllowedWhileLocked },
      reason,
    });

    // Configurable Automatic Transfer: only ever runs on a genuine LOCKED
    // transition (never a flag-only touch-up), only when the locking user
    // explicitly said yes to the Lock dialog's transfer prompt (which
    // itself only appears when the Admin has the feature enabled in
    // Settings), and only sweeps findings still genuinely in this period -
    // anything already manually transferred out is naturally excluded
    // (see autoTransferOnLock()'s own doc comment).
    if (isStatusChange && status === "LOCKED" && transferOverdueCases) {
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
    // or unlocked. Not fired for a flag-only touch-up - status hasn't
    // actually changed, so there's nothing new for them to act on.
    if (isStatusChange) {
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
    }

    return p;
  });

  return NextResponse.json({ reportingPeriod: updated });
}
