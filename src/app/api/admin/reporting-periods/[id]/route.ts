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
    // Narrowing the submission window (see ReportingPeriod.submissionStartsAt's
    // own doc comment) is independent of lock/unlock and independent of
    // startsAt/endsAt below - both provided together or neither.
    submissionStartsAt: z.string().min(1).optional(),
    submissionEndsAt: z.string().min(1).optional(),
    // Editing the period's own overall range - only safe while nothing
    // references it yet (checked below, since a period with even one
    // finding has its reference-number sequence, dedupe keys, and every
    // period-scoped stat already keyed off the current dates). Requiring
    // submissionStartsAt/submissionEndsAt in the same request (see the
    // refine below) means the combined range is always validated
    // together, never left in a state where the submission window no
    // longer fits inside the just-changed period range.
    startsAt: z.string().min(1).optional(),
    endsAt: z.string().min(1).optional(),
  })
  .refine(
    (v) => v.status !== undefined || v.draftsAllowedWhileLocked !== undefined || v.submissionStartsAt !== undefined || v.startsAt !== undefined,
    { message: "Nothing to update" }
  )
  .refine((v) => (v.submissionStartsAt === undefined) === (v.submissionEndsAt === undefined), {
    message: "Submission window start and end must be provided together",
    path: ["submissionEndsAt"],
  })
  .refine(
    (v) => v.submissionStartsAt === undefined || new Date(v.submissionEndsAt!).getTime() > new Date(v.submissionStartsAt).getTime(),
    { message: "Submission window end must be after its start", path: ["submissionEndsAt"] }
  )
  .refine((v) => (v.startsAt === undefined) === (v.endsAt === undefined), {
    message: "Start and end date/time must be provided together",
    path: ["endsAt"],
  })
  .refine((v) => v.startsAt === undefined || new Date(v.endsAt!).getTime() > new Date(v.startsAt).getTime(), {
    message: "End date/time must be after the start date/time",
    path: ["endsAt"],
  })
  .refine((v) => v.startsAt === undefined || v.submissionStartsAt !== undefined, {
    message: "Editing the period's own date range also requires the submission window (even if left unchanged), so the two are always validated together",
    path: ["submissionStartsAt"],
  });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("reporting-periods.lock");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { status, reason, draftsAllowedWhileLocked, transferOverdueCases, submissionStartsAt, submissionEndsAt, startsAt, endsAt } =
    parsed.data;

  const db = await readDb();
  const existing = db.reportingPeriods.find((p) => p.id === id);
  if (!existing) return NextResponse.json({ error: "Reporting period not found" }, { status: 404 });
  if (
    status !== undefined &&
    existing.status === status &&
    draftsAllowedWhileLocked === undefined &&
    submissionStartsAt === undefined &&
    startsAt === undefined
  ) {
    return NextResponse.json({ error: `Period is already ${status.toLowerCase()}` }, { status: 409 });
  }

  // Editing the period's own date range is only safe while nothing
  // references it yet - a period with even one finding already has its
  // reference-number sequence, dedupe keys (src/lib/import.ts), and every
  // period-scoped stat keyed off the current dates/code.
  let year = existing.year;
  let month = existing.month;
  let code = existing.code;
  if (startsAt !== undefined) {
    const findingCount = db.findings.filter((f) => f.periodId === id).length;
    if (findingCount > 0) {
      return NextResponse.json(
        { error: `Can't change ${existing.code}'s date range - ${findingCount} finding(s) already reference it` },
        { status: 409 }
      );
    }
    const start = new Date(startsAt);
    if (Number.isNaN(start.getTime())) return NextResponse.json({ error: "Invalid start date/time" }, { status: 400 });
    year = start.getFullYear();
    month = start.getMonth() + 1;
    code = `${year}-${String(month).padStart(2, "0")}`;
    if (db.reportingPeriods.some((p) => p.id !== id && p.code === code)) {
      return NextResponse.json({ error: "That reporting period already exists" }, { status: 409 });
    }
  }

  // The submission window is bound-checked against whatever the period's
  // own range will actually be after this request - the just-submitted
  // startsAt/endsAt when those are being changed too, otherwise the
  // existing ones.
  const effectiveStartsAt = startsAt ?? existing.startsAt;
  const effectiveEndsAt = endsAt ?? existing.endsAt;
  if (submissionStartsAt !== undefined) {
    if (new Date(submissionStartsAt).getTime() < new Date(effectiveStartsAt).getTime()) {
      return NextResponse.json({ error: "Submission window can't start before the period itself does" }, { status: 400 });
    }
    if (new Date(submissionEndsAt!).getTime() > new Date(effectiveEndsAt).getTime()) {
      return NextResponse.json({ error: "Submission window can't end after the period itself does" }, { status: 400 });
    }
  }
  // A true status transition, vs. a flag-only touch-up on an already-LOCKED
  // period (status provided but unchanged, or omitted entirely).
  const isStatusChange = status !== undefined && status !== existing.status;

  const now = new Date().toISOString();
  const updated = await updateDb((current) => {
    const p = current.reportingPeriods.find((x) => x.id === id)!;
    if (isStatusChange) {
      p.status = status!;
      p.lockedBy = status === "LOCKED" ? auth.session.userId! : null;
      p.lockedAt = status === "LOCKED" ? now : null;
      p.lockReason = reason;
    }
    if (draftsAllowedWhileLocked !== undefined) p.draftsAllowedWhileLocked = draftsAllowedWhileLocked;
    if (startsAt !== undefined) {
      p.year = year;
      p.month = month;
      p.code = code;
      p.startsAt = new Date(startsAt).toISOString();
      p.endsAt = new Date(endsAt!).toISOString();
    }
    if (submissionStartsAt !== undefined) {
      p.submissionStartsAt = new Date(submissionStartsAt).toISOString();
      p.submissionEndsAt = new Date(submissionEndsAt!).toISOString();
    }
    p.updatedAt = now;
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: isStatusChange ? (status === "LOCKED" ? "LOCK" : "UNLOCK") : "UPDATE",
      entityType: "ReportingPeriod",
      entityId: p.id,
      oldValue: {
        status: existing.status,
        draftsAllowedWhileLocked: existing.draftsAllowedWhileLocked,
        code: existing.code,
        startsAt: existing.startsAt,
        endsAt: existing.endsAt,
        submissionStartsAt: existing.submissionStartsAt,
        submissionEndsAt: existing.submissionEndsAt,
      },
      newValue: {
        status: p.status,
        draftsAllowedWhileLocked: p.draftsAllowedWhileLocked,
        code: p.code,
        startsAt: p.startsAt,
        endsAt: p.endsAt,
        submissionStartsAt: p.submissionStartsAt,
        submissionEndsAt: p.submissionEndsAt,
      },
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
