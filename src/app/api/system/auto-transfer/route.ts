import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/handler";
import { readDb } from "@/lib/db";
import { dueSweeps, prismaAutoTransferStore, runAutoTransferIfDue, sweepDueAt } from "@/lib/autoTransfer";
import { clientIp, isRateLimited, recordAttempt } from "@/lib/rateLimit";
import { getReminderStatus, runRemindersIfDue } from "@/lib/reminders";

/**
 * For a scheduler (cron, Windows Task Scheduler, systemd, Kubernetes...) -
 * the one call that runs every time-based job:
 *   POST - runs what is due now: the automatic transfer (period end) and
 *          the daily rectification reminders (src/lib/reminders). Each job
 *          decides for itself whether it is due; a failure in one never
 *          stops the other. The response keeps the automatic transfer's
 *          { ran, runs } and adds { reminders }.
 *   GET  - READ-ONLY readiness check: is the feature installed and on, what
 *          is due, when the next period becomes due, and the reminders'
 *          status. Never moves or sends anything.
 * Without a scheduler it still runs lazily within minutes (see
 * runAutoTransferIfDue()). Protected by a shared secret, not a user session:
 * header `x-auto-transfer-secret: $AUTO_TRANSFER_CRON_SECRET` (no Origin
 * header needed - src/proxy.ts exempts /api/system/*). Disabled (404) when
 * AUTO_TRANSFER_CRON_SECRET isn't set. 10 wrong secrets in 15 minutes from
 * one address block it for 15 minutes (429).
 */
const WRONG_SECRET_LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };

function secretMatches(given: string | null): boolean {
  const expected = process.env.AUTO_TRANSFER_CRON_SECRET?.trim();
  if (!expected || expected.length < 16 || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** null = allowed; otherwise the response to send (404 / 429 / 403). */
async function checkCaller(request: Request): Promise<NextResponse | null> {
  if (!process.env.AUTO_TRANSFER_CRON_SECRET?.trim()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const key = `auto-transfer-secret:${clientIp(request)}`;
  const limited = await isRateLimited(key, WRONG_SECRET_LIMIT);
  if (limited.limited) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
  }
  if (!secretMatches(request.headers.get("x-auto-transfer-secret"))) {
    await recordAttempt(key, WRONG_SECRET_LIMIT);
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

async function handlePOST(request: Request) {
  const refused = await checkCaller(request);
  if (refused) return refused;
  const result = await runAutoTransferIfDue({ force: true, trigger: "scheduler" });
  // After the transfer, so a finding just carried forward counts from today.
  const reminders = await runRemindersIfDue({ trigger: "scheduler" });
  return NextResponse.json({
    ...result,
    reminders: { ran: reminders.ran, skipped: reminders.skipped ?? null, findings: reminders.run?.remindedFindings ?? 0, users: reminders.run?.notifiedUsers ?? 0 },
  });
}

async function handleGET(request: Request) {
  const refused = await checkCaller(request);
  if (refused) return refused;

  const r = await getReminderStatus();
  const reminders = {
    installed: r.installed,
    enabled: r.config.enabled,
    sendAt: r.config.sendAt,
    days: r.config.days,
    thresholdDays: r.config.thresholdDays,
    ranToday: r.ranToday,
    dueNow: r.dueNow,
    nextRunAt: r.nextRunAt,
    overdueNow: r.overdueNow,
    lastRun: r.runs[0] ? { at: r.runs[0].ranAt, findings: r.runs[0].remindedFindings, users: r.runs[0].notifiedUsers, triggeredBy: r.runs[0].triggeredBy } : null,
  };

  const config = await prismaAutoTransferStore.getConfig();
  if (!config) return NextResponse.json({ ready: false, installed: false, reason: "Automatic transfer tables are missing - apply its migration (docs/auto-transfer.md).", reminders });
  const [runs, db] = await Promise.all([prismaAutoTransferStore.listRuns(), readDb()]);
  const now = Date.now();
  const runByPeriod = new Map(runs.map((r) => [r.periodId, r]));
  const dueNow = dueSweeps(db.reportingPeriods, runs, config, now).map((p) => p.code);
  const upcoming = db.reportingPeriods
    .filter((p) => !runByPeriod.has(p.id) && sweepDueAt(p, config) > now)
    .sort((a, b) => sweepDueAt(a, config) - sweepDueAt(b, config))[0];
  const last = [...runs].filter((r) => r.status === "DONE").sort((a, b) => b.ranAt.localeCompare(a.ranAt))[0];
  const codeOf = (id: string | null) => db.reportingPeriods.find((p) => p.id === id)?.code ?? id;

  return NextResponse.json({
    ready: config.enabled,
    installed: true,
    enabled: config.enabled,
    excludedOperationAreas: config.excludedOperationAreas,
    delayHours: config.delayHours,
    dueNow,
    nextDue: upcoming ? { period: upcoming.code, at: new Date(sweepDueAt(upcoming, config)).toISOString() } : null,
    waitingForNextPeriod: runs.filter((r) => r.status === "WAITING_NO_NEXT").map((r) => codeOf(r.periodId)),
    lastRun: last ? { period: codeOf(last.periodId), to: codeOf(last.toPeriodId), at: last.ranAt, moved: last.movedCount, kept: last.keptCount, triggeredBy: last.triggeredBy } : null,
    reminders,
  });
}

export const GET = withApiHandler(handleGET);
export const POST = withApiHandler(handlePOST);
