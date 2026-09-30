import { deleteStoredFile } from "@/lib/fileStorage";
import type { Database } from "@/types";

// =============================================================================
// DEV-ONLY TOOL - NOT FOR PRODUCTION.
//
// Wipes every piece of "registered data" (findings and everything generated
// from them - transitions, rectifications, transfers, closures, itemized
// cases, import batches, scoring adjustments, coverage notes, evidence,
// comments, and Finding-related notifications/audit log entries) while
// leaving every piece of admin configuration (users, roles, districts,
// branches, sources, departments, categories, uncovered-branch reasons,
// scoring rules, reporting period *records*, permissionRegistrySyncedKeys,
// settings) completely untouched. Exists so a demo/staging/UAT database can
// be reset to a clean slate between test runs without hand-editing
// data/db.json every time.
//
// Deliberately isolated: this file is imported by exactly one API route
// (src/app/api/admin/dev-reset/route.ts) and, indirectly through it, one
// page (src/app/(app)/dev-reset/page.tsx - deliberately NOT under
// /admin/<x>, since proxy.ts's blanket per-page permission gate would
// silently redirect everyone, Admin included, away from an unregistered
// page code before this ever ran; see that page's own doc comment).
// Nothing else in the app imports this file or links to that page - it's
// not wired into src/lib/nav.ts's sidebar, so it leaves no trace anywhere
// else in the codebase. The API route gates on isDevResetEnabled() (only
// APP_ENV=development - see below and docs/reset-data.md), so the feature
// is inert on any server not explicitly marked as a development
// environment, whether or not these files have been deleted yet. To remove it entirely before a
// production release, delete these three files - nothing else references
// any of them:
//   - src/lib/devResetRegisteredData.ts (this file)
//   - src/app/api/admin/dev-reset/route.ts
//   - src/app/(app)/dev-reset/page.tsx
// =============================================================================

/** The one switch for this tool - see docs/reset-data.md. */
export const DEV_RESET_ENV_VAR = "APP_ENV";

/**
 * Enabled only when APP_ENV=development (case-insensitive) in the server's
 * environment/.env - and for nothing else. Deliberately NOT tied to
 * NODE_ENV / how the app was started: `next dev` vs `next build`+`next
 * start` is a build detail (Next forces NODE_ENV=production for a build),
 * not a statement about whether this deployment's data is disposable - a
 * built UAT server may legitimately need resets, and a dev server pointed
 * at real data must not have them. Unset, empty or any other value
 * (e.g. "production") means disabled, so a server nobody configured is
 * safe by default. Read at request time, so changing it only needs a
 * restart, never a rebuild.
 */
export function isDevResetEnabled(): boolean {
  return (process.env[DEV_RESET_ENV_VAR] ?? "").trim().toLowerCase() === "development";
}

export interface DevResetSummary {
  clearedCollections: Record<string, number>;
  findingRelatedNotificationsRemoved: number;
  findingRelatedAuditLogsRemoved: number;
  reportingPeriodsUnlocked: string[];
  evidenceFilesDeleted: number;
}

/**
 * Mutates `db` in place - call from inside updateDb(), same as every other
 * write in this app. Scope, precisely:
 *
 *   CLEARED ENTIRELY: findings, findingTransitions, rectifications,
 *   findingTransfers, findingClosures, findingCases, importBatches,
 *   branchCoverageNotes, evidence, comments.
 *
 *   FILTERED, NOT CLEARED: notifications and auditLogs keep every entry
 *   NOT about a Finding (a role/settings/user/etc. change stays fully
 *   intact) and drop only entityType === "Finding" entries, since those
 *   necessarily reference findings that no longer exist.
 *
 *   RESET, NOT CLEARED: a LOCKED reportingPeriod goes back to OPEN and has
 *   its lock fields cleared - its lock almost always exists because of the
 *   now-deleted findings that justified it. The period record itself
 *   (id/year/month/code/date range) is admin config and is never removed.
 *
 *   NEVER TOUCHED: users, roles, districts, branches, sources, departments,
 *   categories, uncoveredReasons, scoringRules,
 *   permissionRegistrySyncedKeys, settings.
 */
export function resetRegisteredData(db: Database): DevResetSummary {
  const clearedCollections: Record<string, number> = {
    findings: db.findings.length,
    findingTransitions: db.findingTransitions.length,
    rectifications: db.rectifications.length,
    findingTransfers: db.findingTransfers.length,
    findingClosures: db.findingClosures.length,
    findingCases: db.findingCases.length,
    importBatches: db.importBatches.length,
    branchCoverageNotes: db.branchCoverageNotes.length,
    evidence: db.evidence.length,
    comments: db.comments.length,
  };

  // Delete the stored files behind every evidence row and import batch
  // about to be dropped - otherwise they'd be permanently orphaned in the
  // storage folder (src/lib/fileStorage.ts). A missing file, or a
  // filesystem error, isn't fatal to the reset - the records go regardless.
  let evidenceFilesDeleted = 0;
  for (const e of db.evidence) {
    if (deleteStoredFile("evidence", e.storagePath)) evidenceFilesDeleted++;
  }
  for (const b of db.importBatches) {
    if (b.storedFile) deleteStoredFile("imports", b.storedFile);
  }

  db.findings = [];
  db.findingTransitions = [];
  db.rectifications = [];
  db.findingTransfers = [];
  db.findingClosures = [];
  db.findingCases = [];
  db.importBatches = [];
  db.branchCoverageNotes = [];
  db.evidence = [];
  db.comments = [];

  const notificationsBefore = db.notifications.length;
  db.notifications = db.notifications.filter((n) => n.entityType !== "Finding");
  const findingRelatedNotificationsRemoved = notificationsBefore - db.notifications.length;

  const auditLogsBefore = db.auditLogs.length;
  db.auditLogs = db.auditLogs.filter((a) => a.entityType !== "Finding");
  const findingRelatedAuditLogsRemoved = auditLogsBefore - db.auditLogs.length;

  const reportingPeriodsUnlocked: string[] = [];
  const now = new Date().toISOString();
  for (const p of db.reportingPeriods) {
    if (p.status === "LOCKED") {
      p.status = "OPEN";
      p.lockedBy = null;
      p.lockedAt = null;
      p.lockReason = null;
      p.updatedAt = now;
      reportingPeriodsUnlocked.push(p.code);
    }
  }

  return {
    clearedCollections,
    findingRelatedNotificationsRemoved,
    findingRelatedAuditLogsRemoved,
    reportingPeriodsUnlocked,
    evidenceFilesDeleted,
  };
}
