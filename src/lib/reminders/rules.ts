import { awaitingBranchRectification } from "@/lib/findings";
import type { Database, Finding, Settings } from "@/types";
import { DEFAULT_DAYS, DEFAULT_SEND_AT, type ReminderConfig } from "./types";

/**
 * Pure rules of the scheduled rectification reminder
 * (docs/rectification-reminders.md): when a run is due, which findings are
 * overdue, and what counts as progress. No storage, no side effects. All
 * dates are the server's local time.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar date, "YYYY-MM-DD". */
export function localDateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole local calendar days from `fromMs` to `toMs` (yesterday 23:59 -> today 00:01 is 1). */
export function calendarDaysBetween(fromMs: number, toMs: number): number {
  const day = (ms: number) => {
    const d = new Date(ms);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  };
  return Math.round((day(toMs) - day(fromMs)) / 86_400_000);
}

/** "HH:mm" -> minutes since midnight; null when it isn't a valid time. */
export function parseSendAt(sendAt: string | undefined): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(sendAt ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** The stored settings with defaults filled in (older installs have only enabled / thresholdDays). */
export function resolveConfig(settings: Settings["rectificationReminders"] | undefined): ReminderConfig {
  const days = Array.isArray(settings?.days) ? [...new Set(settings.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [...DEFAULT_DAYS];
  return {
    enabled: Boolean(settings?.enabled),
    thresholdDays: Math.max(1, Math.floor(settings?.thresholdDays ?? 7)),
    sendAt: parseSendAt(settings?.sendAt) !== null ? settings!.sendAt! : DEFAULT_SEND_AT,
    days,
  };
}

/**
 * The scheduled run is due: switched on, today is a ticked weekday, the send
 * time has passed and today's run hasn't been done. A run missed earlier in
 * the day (server down at the send time) is still due until midnight; a
 * missed DAY is not replayed.
 */
export function isRunDue(config: ReminderConfig, ranToday: boolean, now: number): boolean {
  if (!config.enabled || ranToday) return false;
  const d = new Date(now);
  if (!config.days.includes(d.getDay())) return false;
  const sendAt = parseSendAt(config.sendAt) ?? 0;
  return d.getHours() * 60 + d.getMinutes() >= sendAt;
}

/** When the next scheduled run becomes due, or null (switched off / no weekday ticked). */
export function nextRunAt(config: ReminderConfig, ranToday: boolean, now: number): number | null {
  if (!config.enabled || config.days.length === 0) return null;
  const sendAt = parseSendAt(config.sendAt) ?? 0;
  const start = new Date(now);
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset, Math.floor(sendAt / 60), sendAt % 60, 0, 0);
    if (!config.days.includes(day.getDay())) continue;
    if (offset === 0 && ranToday) continue;
    // Today, past the send time and not yet run: it is due now.
    if (offset === 0 && day.getTime() <= now) return now;
    return day.getTime();
  }
  return null;
}

/**
 * Steps that put work in the branch's hands or show the branch working -
 * the "days without progress" count restarts from the latest of them. A
 * comment, an evidence upload, the district verifying, a partial close or an
 * approved adjustment is NOT branch progress and doesn't restart it.
 */
export const PROGRESS_ACTIONS: ReadonlySet<string> = new Set([
  "QUEUE_BRANCH_MANAGER", // approved and sent to the branch
  "RECTIFY", // the branch recorded a rectification
  "RESUBMIT_RECTIFICATION", // the branch resubmitted a returned one
  "RETURN_RECTIFICATION", // sent back to the branch for correction
  "REVERSE", // closure undone - back with the branch
  "TRANSFER", // carried into another period (manual or automatic)
  "TRANSFER_RESET_PENDING",
  "IMPORT_APPROVE", // imported straight to the branch
  "IMPORT_RECTIFY",
  "IMPORT_TRANSFER",
]);

/** Latest progress step per finding (ms) - built once per run instead of scanning the history per finding. */
export function lastProgressByFinding(db: Pick<Database, "findingTransitions">): Map<string, number> {
  const latest = new Map<string, number>();
  for (const t of db.findingTransitions) {
    if (!PROGRESS_ACTIONS.has(t.action)) continue;
    const at = new Date(t.createdAt).getTime();
    if (at > (latest.get(t.findingId) ?? 0)) latest.set(t.findingId, at);
  }
  return latest;
}

export interface OverdueFinding {
  finding: Finding;
  /** Calendar days since the last progress. */
  days: number;
}

/**
 * Findings to remind now: waiting for the branch to rectify, no progress for
 * `thresholdDays` calendar days, and not reminded within that many days.
 * Calendar days, not hours, so a daily run at the same time of day never
 * skips a finding by a few seconds.
 */
export function overdueFindings(db: Pick<Database, "findings" | "findingTransitions">, config: ReminderConfig, now: number): OverdueFinding[] {
  const progress = lastProgressByFinding(db);
  const out: OverdueFinding[] = [];
  for (const f of db.findings) {
    if (!awaitingBranchRectification(f)) continue;
    // No recorded step (older data): count from when it was last changed.
    const since = progress.get(f.id) ?? new Date(f.updatedAt).getTime();
    const days = calendarDaysBetween(since, now);
    if (days < config.thresholdDays) continue;
    if (f.lastReminderAt && calendarDaysBetween(new Date(f.lastReminderAt).getTime(), now) < config.thresholdDays) continue;
    out.push({ finding: f, days });
  }
  return out;
}
