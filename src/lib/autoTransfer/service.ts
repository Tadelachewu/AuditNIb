import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { transferFinding } from "@/lib/findings";
import { notifyUsers, usersWithFindingsPermission } from "@/lib/notifications";
import { redis } from "@/lib/redisClient";
import { logger } from "@/lib/logger";
import { formatDateTime } from "@/lib/format";
import type { Database, ReportingPeriod } from "@/types";
import { dueSweeps, planSweep, sweepDueAt } from "./rules";
import { prismaAutoTransferStore, type AutoTransferStore } from "./store";
import { SYSTEM_ACTOR, type AutoTransferConfig, type AutoTransferRun, type AutoTransferTrigger } from "./types";

/**
 * Runs the automatic transfer when a period's sweep is due. The app has no
 * background scheduler, so this is called lazily (from the notification
 * poll every signed-in browser makes, throttled to once per CHECK_INTERVAL_MS
 * per server) and can also be called by a server cron through
 * POST /api/system/auto-transfer for exact timing. Safe to call any number of
 * times: a period is only ever swept once, and a lock stops two servers or
 * two requests from sweeping at the same moment.
 */

export const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const LOCK_KEY = "auto-transfer:lock";
const LOCK_MS = 2 * 60 * 1000;

export interface SweepResult {
  runs: AutoTransferRun[];
}

/**
 * Sweeps the given periods inside one database update (`db` is the mutable
 * model from updateDb()). Oldest first, so several missed months cascade:
 * findings moved into a period that is itself due are carried on with it.
 * Notifies the transfer-permission holders and each affected branch once
 * per period (never once per finding).
 */
export function sweepPeriods(
  db: Database,
  periodIds: string[],
  config: AutoTransferConfig,
  now: number,
  previousRuns: ReadonlyMap<string, AutoTransferRun> = new Map(),
  trigger: AutoTransferTrigger = "in-app"
): SweepResult {
  const runs: AutoTransferRun[] = [];
  const ranAt = new Date(now).toISOString();
  const periods = periodIds
    .map((id) => db.reportingPeriods.find((p) => p.id === id))
    .filter((p): p is ReportingPeriod => Boolean(p))
    .sort((a, b) => a.year - b.year || a.month - b.month);

  for (const period of periods) {
    const { destination, toMove, kept } = planSweep(db, period, config);

    if (!destination) {
      // Wait for the next period to be created; tell the admins once.
      if (previousRuns.get(period.id)?.status !== "WAITING_NO_NEXT") {
        const recipients = usersWithFindingsPermission(db, "transfer");
        notifyUsers(db, recipients, {
          type: "AUTO_TRANSFERRED",
          title: `${period.code} ended - create the next period`,
          message: `${toMove.length} outstanding finding(s) in ${period.code} will be carried over automatically as soon as the next reporting period is created.`,
          entityType: "ReportingPeriod",
          entityId: period.id,
        });
      }
      runs.push({ periodId: period.id, status: "WAITING_NO_NEXT", toPeriodId: null, movedCount: 0, keptCount: kept.length, movedReferences: [], keptReferences: kept.map((f) => f.reference), ranAt, triggeredBy: trigger });
      continue;
    }

    const endedAt = formatDateTime(new Date(sweepDueAt(period, { delayHours: 0 })).toISOString());
    for (const f of toMove) {
      transferFinding(db, f, {
        toPeriodId: destination.id,
        reason: `Automatic transfer at the end of ${period.code} (ended ${endedAt}).`,
        userId: SYSTEM_ACTOR.userId,
        userName: SYSTEM_ACTOR.userName,
        method: "AUTOMATIC",
      });
    }

    const run: AutoTransferRun = {
      periodId: period.id,
      status: "DONE",
      toPeriodId: destination.id,
      movedCount: toMove.length,
      keptCount: kept.length,
      movedReferences: toMove.map((f) => f.reference),
      keptReferences: kept.map((f) => f.reference),
      ranAt,
      triggeredBy: trigger,
    };
    runs.push(run);

    appendAuditLog(db, {
      userId: SYSTEM_ACTOR.userId,
      userName: SYSTEM_ACTOR.userName,
      action: "PERIOD_AUTO_TRANSFER",
      entityType: "ReportingPeriod",
      entityId: period.id,
      newValue: { from: period.code, to: destination.code, moved: run.movedReferences, kept: run.keptReferences, excludedOperationAreas: config.excludedOperationAreas, triggeredBy: trigger },
      reason: `Automatic transfer at the end of ${period.code} (started by ${trigger === "scheduler" ? "the scheduler" : "the in-app check"})`,
    });

    if (toMove.length > 0 || kept.length > 0) {
      notifyUsers(db, usersWithFindingsPermission(db, "transfer"), {
        type: "AUTO_TRANSFERRED",
        title: `${period.code} ended: ${toMove.length} finding(s) moved to ${destination.code}`,
        message:
          `${toMove.length} outstanding finding(s) were carried into ${destination.code} automatically.` +
          (kept.length > 0 ? ` ${kept.length} kept in ${period.code} (excluded operation areas) - transfer them manually if needed.` : ""),
        entityType: "ReportingPeriod",
        entityId: destination.id,
      });
    }
    const byBranch = new Map<string, number>();
    for (const f of toMove) byBranch.set(f.branchId, (byBranch.get(f.branchId) ?? 0) + 1);
    for (const [branchId, count] of byBranch) {
      notifyUsers(db, usersWithFindingsPermission(db, "rectify", { branchId }), {
        type: "AUTO_TRANSFERRED",
        title: `${count} finding(s) carried into ${destination.code}`,
        message: `${period.code} ended with ${count} of your findings still outstanding; they were carried into ${destination.code} for rectification.`,
        entityType: "Branch",
        entityId: branchId,
      });
    }
  }
  return { runs };
}

// ---------------------------------------------------------------------------

/** A short-lived lock so only one server / request sweeps at a time (Redis, else this process only). */
let localLock = false;
async function acquireLock(): Promise<boolean> {
  try {
    return (await redis.set(LOCK_KEY, "1", "PX", LOCK_MS, "NX")) === "OK";
  } catch {
    if (localLock) return false;
    localLock = true;
    return true;
  }
}
async function releaseLock(): Promise<void> {
  localLock = false;
  try {
    await redis.del(LOCK_KEY);
  } catch {
    // Expires by itself.
  }
}

export interface AutoTransferDeps {
  store: AutoTransferStore;
  readDb: () => Promise<Database>;
  /** Must commit `alsoWrite` in the same transaction as the mutator's changes. */
  updateDb: <T>(mutator: (db: Database) => T, opts?: { alsoWrite?: (tx: unknown, result: T) => Promise<void> }) => Promise<T>;
  lock: { acquire: () => Promise<boolean>; release: () => Promise<void> };
}

const defaultDeps: AutoTransferDeps = {
  store: prismaAutoTransferStore,
  readDb,
  updateDb,
  lock: { acquire: acquireLock, release: releaseLock },
};

let lastCheckAt = 0;

/**
 * Sweeps every period that is due. `force` skips the per-server throttle
 * (the cron endpoint). Never throws: a failure is logged and retried on the
 * next call.
 */
export async function runAutoTransferIfDue(
  opts: { now?: number; force?: boolean; trigger?: AutoTransferTrigger; deps?: Partial<AutoTransferDeps> } = {}
): Promise<{ ran: boolean; runs: AutoTransferRun[] }> {
  const trigger = opts.trigger ?? "in-app";
  const now = opts.now ?? Date.now();
  if (!opts.force && now - lastCheckAt < CHECK_INTERVAL_MS) return { ran: false, runs: [] };
  lastCheckAt = now;
  const deps = { ...defaultDeps, ...opts.deps };

  try {
    const config = await deps.store.getConfig();
    if (!config?.enabled) return { ran: false, runs: [] };
    const previous = await deps.store.listRuns();
    const peek = await deps.readDb();
    const due = dueSweeps(peek.reportingPeriods, previous, config, now);
    if (due.length === 0) return { ran: false, runs: [] };

    if (!(await deps.lock.acquire())) return { ran: false, runs: [] };
    try {
      // Re-read inside the lock: another server may have just swept.
      const fresh = await deps.store.listRuns();
      const stillDue = dueSweeps(peek.reportingPeriods, fresh, config, now).map((p) => p.id);
      if (stillDue.length === 0) return { ran: false, runs: [] };
      const previousByPeriod = new Map(fresh.map((r) => [r.periodId, r]));
      // The moved findings and the "period done" record commit together: a
      // failure rolls back both, so a period is never moved without being
      // recorded (which could sweep it twice) or recorded without moving.
      const { runs } = await deps.updateDb((db) => sweepPeriods(db, stillDue, config, now, previousByPeriod, trigger), {
        alsoWrite: (tx, result) => deps.store.saveRuns(result.runs, tx),
      });
      logger.info({ event: "auto_transfer.ran", trigger, runs: runs.map((r) => ({ periodId: r.periodId, status: r.status, moved: r.movedCount, kept: r.keptCount })) }, "Automatic transfer ran");
      return { ran: true, runs };
    } finally {
      await deps.lock.release();
    }
  } catch (err) {
    logger.error({ err, event: "auto_transfer.failed" }, "Automatic transfer failed - it will retry on the next check");
    return { ran: false, runs: [] };
  }
}

/**
 * A period's dates changed (Reporting Periods -> Edit). If it was already
 * handled but now ends LATER than now, it is re-armed - its run is forgotten
 * - so it is swept again when it really ends. Called after the period is
 * saved; never throws (a failure is logged and the period keeps its record).
 */
export async function rearmIfRescheduled(
  period: Pick<ReportingPeriod, "id" | "code" | "endsAt" | "submissionEndsAt">,
  opts: { now?: number; store?: AutoTransferStore } = {}
): Promise<boolean> {
  const store = opts.store ?? prismaAutoTransferStore;
  try {
    const config = await store.getConfig();
    if (!config) return false;
    const run = (await store.listRuns()).find((r) => r.periodId === period.id);
    if (!run || sweepDueAt(period, config) <= (opts.now ?? Date.now())) return false;
    await store.deleteRuns([period.id]);
    logger.info({ event: "auto_transfer.rearmed", periodId: period.id, period: period.code, previousStatus: run.status }, "Period rescheduled to end later - automatic transfer re-armed");
    return true;
  } catch (err) {
    logger.error({ err, event: "auto_transfer.rearm_failed", periodId: period.id }, "Could not re-arm the automatic transfer for a rescheduled period");
    return false;
  }
}

/**
 * Dev Reset (all registered data wiped): forget every run, inside the reset's
 * own transaction (`tx` from updateDb's alsoWrite), so each period is
 * handled afresh when it ends. Periods that have already ended are swept on
 * the next check - with nothing in them, they're simply marked Done.
 */
export function forgetAllRuns(tx: unknown, store: AutoTransferStore = prismaAutoTransferStore): Promise<void> {
  return store.deleteRuns("all", tx);
}

/** Test hook: forget the per-server throttle. */
export function resetAutoTransferThrottle(): void {
  lastCheckAt = 0;
}
