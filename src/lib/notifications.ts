import { v4 as uuid } from "uuid";
import { permissionKey } from "@/lib/permissions/registry";
import type { Database } from "@/types";

export interface NotifyOptions {
  type: string;
  title: string;
  message: string;
  entityType: string;
  entityId: string;
}

/**
 * master.txt §12: "Notifications for submit, approve, reject, return,
 * assignment, rectification, transfer and period events." In-app only
 * (see PHASE7.md) - no Outlook/SMTP integration exists, matching
 * master.txt §24 listing that architecture as still undecided.
 */
export function notifyUsers(db: Database, recipientUserIds: string[], opts: NotifyOptions): void {
  const now = new Date().toISOString();
  for (const recipientUserId of new Set(recipientUserIds)) {
    db.notifications.unshift({
      id: uuid(),
      recipientUserId,
      type: opts.type,
      title: opts.title,
      message: opts.message,
      entityType: opts.entityType,
      entityId: opts.entityId,
      readAt: null,
      createdAt: now,
    });
  }
}

/**
 * Every ACTIVE user whose role holds findings.<action>, narrowed to a
 * district/branch for DISTRICT/BRANCH-scoped roles - but never narrowed
 * for BANK-scoped roles (HO Controller, etc.), since a bank-wide reviewer
 * should be notified regardless of which district a finding is in. Mirrors
 * queueStatusesForSession()'s permission-driven approach rather than
 * hard-coding which role codes should be notified.
 */
export function usersWithFindingsPermission(
  db: Database,
  action: string | string[],
  scope: { districtId?: string; branchId?: string } = {}
): string[] {
  // Accepts several actions so a caller can notify "whoever can act on
  // this next" without double-notifying someone who holds more than one
  // of them (e.g. verify-rectification split from return-rectification -
  // a role holding both should still get exactly one notification).
  const keys = new Set((Array.isArray(action) ? action : [action]).map((a) => permissionKey("findings", a)));
  const eligibleRoles = new Map(
    db.roles.filter((r) => r.status === "ACTIVE" && r.permissions.some((p) => keys.has(p))).map((r) => [r.code, r])
  );

  return db.users
    .filter((u) => u.status === "ACTIVE" && eligibleRoles.has(u.role))
    .filter((u) => {
      const role = eligibleRoles.get(u.role)!;
      if (role.orgScope === "DISTRICT") return !scope.districtId || u.districtId === scope.districtId;
      if (role.orgScope === "BRANCH") return !scope.branchId || u.branchId === scope.branchId;
      return true; // BANK-scoped roles are never narrowed
    })
    .map((u) => u.id);
}

export function notifyFindingsPermissionHolders(
  db: Database,
  action: string | string[],
  scope: { districtId?: string; branchId?: string },
  opts: NotifyOptions
): void {
  const recipients = usersWithFindingsPermission(db, action, scope);
  if (recipients.length > 0) notifyUsers(db, recipients, opts);
}

// Findings a "rectification reminder" can ever apply to - anything still
// awaiting the Branch Manager/Controller's action. Deliberately excludes
// RECTIFICATION_RETURNED's own separate return-for-correction reason
// notification from double-firing the same day (both can still land on
// the same finding over time, just not from the same check).
const REMINDABLE_STATUSES = ["SENT_TO_BRANCH_MANAGER", "PARTIALLY_RECTIFIED", "TRANSFERRED", "RECTIFICATION_RETURNED"];

// How often the scan itself is allowed to run at all, regardless of the
// Admin's configured per-finding threshold - protects against re-scanning
// every finding in the database on every 30-second notification poll from
// every logged-in user (see checkRectificationReminders()'s call site).
// Exported so the route can cheaply decide "is a scan even due" from a
// plain readDb() before paying for updateDb()'s write.
export const REMINDER_SCAN_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * Document_3 §30's "Rectification Reminder - System -> Branch Manager": a
 * time-based nudge, not a reaction to a user action like every other
 * notification in this file. This app has no cron/scheduler
 * infrastructure at all, so instead of a real background job, this is
 * checked lazily - called from GET /api/notifications, which the
 * NotificationBell already polls every 30 seconds from every logged-in
 * user. `Settings.rectificationReminders.lastCheckedAt` throttles the
 * actual scan to once per REMINDER_SCAN_COOLDOWN_MS regardless of how
 * many pollers hit it in that window, and each finding's own
 * `lastReminderAt` stops it being re-reminded inside the same
 * `thresholdDays` window once it's already been flagged.
 *
 * Returns whether it actually ran (so the caller only pays for a
 * updateDb() write when there was something to do).
 */
export function checkRectificationReminders(db: Database): boolean {
  const settings = db.settings.rectificationReminders;
  if (!settings.enabled) return false;

  const now = Date.now();
  if (settings.lastCheckedAt && now - new Date(settings.lastCheckedAt).getTime() < REMINDER_SCAN_COOLDOWN_MS) {
    return false;
  }
  db.settings.rectificationReminders.lastCheckedAt = new Date().toISOString();

  const thresholdMs = settings.thresholdDays * 86_400_000;
  for (const f of db.findings) {
    if (!REMINDABLE_STATUSES.includes(f.status)) continue;
    const sinceUpdate = now - new Date(f.updatedAt).getTime();
    if (sinceUpdate < thresholdMs) continue;
    const sinceLastReminder = f.lastReminderAt ? now - new Date(f.lastReminderAt).getTime() : Infinity;
    if (sinceLastReminder < thresholdMs) continue;

    const recipients = usersWithFindingsPermission(db, "rectify", { branchId: f.branchId });
    if (recipients.length > 0) {
      const days = Math.floor(sinceUpdate / 86_400_000);
      notifyUsers(db, recipients, {
        type: "RECTIFICATION_REMINDER",
        title: `${f.reference} awaiting rectification`,
        message: `Still awaiting rectification after ${days} day${days === 1 ? "" : "s"} - a reminder to act.`,
        entityType: "Finding",
        entityId: f.id,
      });
    }
    f.lastReminderAt = new Date().toISOString();
  }
  return true;
}
