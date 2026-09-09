import fs from "node:fs";
import { evidenceStoragePath } from "@/lib/evidence";
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
// else in the codebase. Both this module and the API route independently
// gate on isDevResetEnabled() (NODE_ENV !== "production"), so the feature
// is inert wherever NODE_ENV=production is actually set, whether or not
// these files have been deleted yet. To remove it entirely before a
// production release, delete these three files - nothing else references
// any of them:
//   - src/lib/devResetRegisteredData.ts (this file)
//   - src/app/api/admin/dev-reset/route.ts
//   - src/app/(app)/dev-reset/page.tsx
// =============================================================================

export function isDevResetEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
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
 *   scoringAdjustments, branchCoverageNotes, evidence, comments.
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
    scoringAdjustments: db.scoringAdjustments.length,
    branchCoverageNotes: db.branchCoverageNotes.length,
    evidence: db.evidence.length,
    comments: db.comments.length,
  };

  // Delete the physical files backing every evidence row about to be
  // dropped - otherwise they'd become permanently orphaned on disk
  // (evidence.ts's own doc comment: data/uploads/ holds nothing else).
  let evidenceFilesDeleted = 0;
  for (const e of db.evidence) {
    try {
      fs.unlinkSync(evidenceStoragePath(e.storagePath));
      evidenceFilesDeleted++;
    } catch {
      // Already missing, or a filesystem permissions issue - not fatal to
      // the reset itself, the database record is being dropped regardless.
    }
  }

  db.findings = [];
  db.findingTransitions = [];
  db.rectifications = [];
  db.findingTransfers = [];
  db.findingClosures = [];
  db.findingCases = [];
  db.importBatches = [];
  db.scoringAdjustments = [];
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
