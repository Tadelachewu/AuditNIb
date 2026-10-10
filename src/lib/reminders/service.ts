import { v4 as uuid } from "uuid";
import { readDb, updateDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { notifyUsers, usersWithFindingsPermission } from "@/lib/notifications";
import { redis } from "@/lib/redisClient";
import type { Database } from "@/types";
import { isRunDue, localDateKey, nextRunAt, overdueFindings, resolveConfig } from "./rules";
import { prismaReminderStore, type ReminderStore } from "./store";
import type { ReminderConfig, ReminderResult, ReminderRun, ReminderStatus, ReminderTrigger } from "./types";

/**
 * The scheduled rectification reminder (docs/rectification-reminders.md).
 *
 * Once a day, at the configured time on the ticked weekdays, every finding
 * that has waited too long for the branch gets a reminder (bell + email
 * through the email queue). It is started by the scheduler
 * (POST /api/system/auto-transfer runs every job) and, as a backup, by the
 * notification poll of signed-in users. A lock and the day's run record make
 * sure a day is run once, however many servers or callers there are.
 */

const LOCK_KEY = "reminders:lock";
const LOCK_MS = 2 * 60 * 1000;
/** The in-app backup looks at most this often per server. */
export const REMINDER_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** A short-lived lock so only one server / request runs at a time (Redis, else this process only). */
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

export interface ReminderDeps {
  store: ReminderStore;
  readDb: () => Promise<Database>;
  /** Must commit `alsoWrite` in the same transaction as the mutator's changes. */
  updateDb: <T>(mutator: (db: Database) => T, opts?: { alsoWrite?: (tx: unknown, result: T) => Promise<void> }) => Promise<T>;
  lock: { acquire: () => Promise<boolean>; release: () => Promise<void> };
  now: () => number;
}

const defaultDeps: ReminderDeps = {
  store: prismaReminderStore,
  readDb,
  updateDb,
  lock: { acquire: acquireLock, release: releaseLock },
  now: Date.now,
};

/**
 * Reminds every overdue finding on the given Database model (call inside
 * updateDb): a notification per recipient - whose email is queued with it -
 * and `lastReminderAt` on the finding. Returns the run's figures.
 */
export function remindOverdue(db: Database, config: ReminderConfig, now: number): Pick<ReminderRun, "remindedFindings" | "notifiedUsers" | "findingReferences"> {
  const stamp = new Date(now).toISOString();
  const references: string[] = [];
  const notified = new Set<string>();
  for (const { finding: f, days } of overdueFindings(db, config, now)) {
    const recipients = usersWithFindingsPermission(db, "rectify", { branchId: f.branchId });
    if (recipients.length > 0) {
      notifyUsers(db, recipients, {
        type: "RECTIFICATION_REMINDER",
        title: `${f.reference} awaiting rectification`,
        message: `Still awaiting rectification after ${days} day${days === 1 ? "" : "s"} - a reminder to act.`,
        entityType: "Finding",
        entityId: f.id,
      });
      for (const r of recipients) notified.add(r);
    }
    // Stamped even with nobody to notify, so it isn't rescanned as "new" every day.
    f.lastReminderAt = stamp;
    references.push(f.reference);
  }
  return { remindedFindings: references.length, notifiedUsers: notified.size, findingReferences: references };
}

class AlreadyRanError extends Error {}

let lastCheckAt = 0;

/**
 * Runs today's reminders if they are due. `trigger`:
 *   scheduler  the OS scheduler's call - checks every time
 *   in-app     the backup from the notification poll - throttled per server
 *   manual     an admin's "Run now" - ignores the time of day, the weekday
 *              and whether today already ran (a finding reminded within the
 *              threshold is still skipped)
 * Never throws.
 */
export async function runRemindersIfDue(opts: { trigger?: ReminderTrigger; deps?: Partial<ReminderDeps> } = {}): Promise<ReminderResult> {
  const deps = { ...defaultDeps, ...opts.deps };
  const trigger = opts.trigger ?? "in-app";
  const now = deps.now();
  if (trigger === "in-app") {
    if (now - lastCheckAt < REMINDER_CHECK_INTERVAL_MS) return { ran: false, skipped: "throttled" };
    lastCheckAt = now;
  }
  try {
    if (!(await deps.store.isInstalled())) return { ran: false, skipped: "not-installed" };
    const today = localDateKey(now);
    const manual = trigger === "manual";

    const peek = await deps.readDb();
    const config = resolveConfig(peek.settings.rectificationReminders);
    if (!config.enabled) return { ran: false, skipped: "disabled" };
    if (!manual) {
      if (await deps.store.ranOn(today)) return { ran: false, skipped: "already-ran" };
      if (!isRunDue(config, false, now)) return { ran: false, skipped: "not-due" };
    }

    if (!(await deps.lock.acquire())) return { ran: false, skipped: "busy" };
    try {
      // Another server may have run it while we waited for the lock.
      if (!manual && (await deps.store.ranOn(today))) return { ran: false, skipped: "already-ran" };
      const run = await deps.updateDb(
        (db): ReminderRun => {
          const fresh = resolveConfig(db.settings.rectificationReminders);
          return { id: manual ? `${today}-manual-${uuid()}` : today, runDate: today, ranAt: new Date(now).toISOString(), triggeredBy: trigger, ...remindOverdue(db, fresh, now) };
        },
        // The run record commits with the notifications. For the scheduled run
        // its id is the date: a second run of the same day is refused here and
        // the whole run rolls back, even without the lock.
        {
          alsoWrite: async (tx, result) => {
            if (!(await deps.store.saveRun(result, tx))) throw new AlreadyRanError();
          },
        }
      );
      logger.info({ event: "reminders.ran", trigger, runDate: run.runDate, findings: run.remindedFindings, users: run.notifiedUsers }, "Rectification reminders sent");
      return { ran: true, run };
    } finally {
      await deps.lock.release();
    }
  } catch (err) {
    // Another caller did today's run at the same moment: nothing of ours was saved.
    if (err instanceof AlreadyRanError) return { ran: false, skipped: "already-ran" };
    logger.error({ err, event: "reminders.failed", trigger }, "Rectification reminder run failed");
    return { ran: false };
  }
}

/** Status for Settings and for the scheduler's readiness check. Read-only. */
export async function getReminderStatus(deps: Partial<ReminderDeps> = {}): Promise<ReminderStatus> {
  const d = { ...defaultDeps, ...deps };
  const now = d.now();
  const db = await d.readDb();
  const config = resolveConfig(db.settings.rectificationReminders);
  const installed = await d.store.isInstalled();
  const [ranToday, runs] = installed ? await Promise.all([d.store.ranOn(localDateKey(now)), d.store.listRuns(10)]) : [false, [] as ReminderRun[]];
  const next = installed ? nextRunAt(config, ranToday, now) : null;
  return {
    installed,
    config,
    ranToday,
    dueNow: installed && isRunDue(config, ranToday, now),
    nextRunAt: next === null ? null : new Date(next).toISOString(),
    overdueNow: config.enabled ? overdueFindings(db, config, now).length : 0,
    runs,
  };
}

/** Dev Reset: forget every run, in the reset's own transaction. */
export async function forgetReminderRuns(tx: unknown, store: ReminderStore = prismaReminderStore): Promise<void> {
  if (await store.isInstalled()) await store.deleteAll(tx);
}

/** For tests: forget the in-app throttle. */
export function resetReminderThrottle(): void {
  lastCheckAt = 0;
  localLock = false;
}
