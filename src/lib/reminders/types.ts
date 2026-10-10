/**
 * Rectification reminders on a schedule (docs/rectification-reminders.md) -
 * types and constants. Client-safe.
 */

export type ReminderTrigger = "scheduler" | "in-app" | "manual";

/** Settings -> Rectification Reminders, with the defaults filled in. */
export interface ReminderConfig {
  enabled: boolean;
  /** Remind after this many days without rectification progress. */
  thresholdDays: number;
  /** Server-local time of day the daily run is due, "HH:mm". */
  sendAt: string;
  /** Weekdays it runs on: 0 = Sunday ... 6 = Saturday. */
  days: number[];
}

export const DEFAULT_SEND_AT = "08:00";
/** Monday to Friday. */
export const DEFAULT_DAYS: readonly number[] = [1, 2, 3, 4, 5];
export const DAY_LABELS: readonly string[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface ReminderRun {
  /** The scheduled run of a day has that day as its id (so it can't run twice); a manual run has its own. */
  id: string;
  /** Local date, YYYY-MM-DD. */
  runDate: string;
  ranAt: string;
  triggeredBy: ReminderTrigger;
  remindedFindings: number;
  notifiedUsers: number;
  findingReferences: string[];
}

export interface ReminderResult {
  ran: boolean;
  /** Why it didn't run, when it didn't. */
  skipped?: "not-installed" | "disabled" | "not-due" | "already-ran" | "busy" | "throttled";
  run?: ReminderRun;
}

/** GET /api/admin/reminders, and the `reminders` part of the scheduler's status. */
export interface ReminderStatus {
  installed: boolean;
  config: ReminderConfig;
  /** The scheduled run of today has been done. */
  ranToday: boolean;
  /** Today's run is due and not done yet: it runs on the scheduler's next call. */
  dueNow: boolean;
  /** When the next scheduled run is due (ISO), or null when switched off / no day is ticked. */
  nextRunAt: string | null;
  /** Findings that would be reminded if it ran now. */
  overdueNow: number;
  runs: ReminderRun[];
}
