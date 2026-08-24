import { v4 as uuid } from "uuid";
import { appendAuditLog } from "@/lib/audit";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import type { SessionData } from "@/lib/session";
import type { Database, Finding, FindingStatus, Branch, ReportingPeriod } from "@/types";

/**
 * The one place a Finding's status actually changes. Mirrors
 * src/lib/audit.ts's appendAuditLog pattern: updates the finding, pushes a
 * FindingTransition row (the finding's own history - see
 * GET /api/findings/[id]), and appends the standard AuditLogEntry
 * (entityType "Finding") so the bank-wide audit log also has it - matching
 * the BRD's "Full transition history stored (who, when, from-state,
 * to-state, reason)" requirement (plan doc §3.4).
 */
export function transitionFinding(
  db: Database,
  finding: Finding,
  opts: { toStatus: FindingStatus; action: string; userId: string; userName: string; reason?: string }
): void {
  const fromStatus = finding.status;
  const now = new Date().toISOString();

  finding.status = opts.toStatus;
  finding.updatedAt = now;

  db.findingTransitions.unshift({
    id: uuid(),
    findingId: finding.id,
    fromStatus,
    toStatus: opts.toStatus,
    action: opts.action,
    userId: opts.userId,
    userName: opts.userName,
    reason: opts.reason,
    createdAt: now,
  });

  appendAuditLog(db, {
    userId: opts.userId,
    userName: opts.userName,
    action: opts.action,
    entityType: "Finding",
    entityId: finding.id,
    oldValue: { status: fromStatus },
    newValue: { status: opts.toStatus },
    reason: opts.reason,
  });
}

// Each of these performs one user-triggered transition immediately
// followed by its automatic pass-through (see the state machine notes in
// PHASE6.md) - two FindingTransition rows and two AuditLogEntry rows per
// call, both within the same request/updateDb(), so the history stays
// complete without requiring a separate "claim" action nowhere described
// in the BRD.
export function submitFinding(db: Database, finding: Finding, userId: string, userName: string): void {
  transitionFinding(db, finding, { toStatus: "SUBMITTED", action: "SUBMIT", userId, userName });
  transitionFinding(db, finding, { toStatus: "DISTRICT_REVIEW", action: "QUEUE_DISTRICT_REVIEW", userId, userName });
}

export function districtApproveFinding(db: Database, finding: Finding, userId: string, userName: string): void {
  transitionFinding(db, finding, { toStatus: "DISTRICT_APPROVED", action: "DISTRICT_APPROVE", userId, userName });
  transitionFinding(db, finding, { toStatus: "HO_REVIEW", action: "QUEUE_HO_REVIEW", userId, userName });
}

export function hoApproveFinding(db: Database, finding: Finding, userId: string, userName: string): void {
  transitionFinding(db, finding, { toStatus: "HO_APPROVED", action: "HO_APPROVE", userId, userName });
  transitionFinding(db, finding, {
    toStatus: "SENT_TO_BRANCH_MANAGER",
    action: "QUEUE_BRANCH_MANAGER",
    userId,
    userName,
  });
}

/** "<branchCode>-<periodCode>-<seq>", sequence counted per branch+period. */
export function nextFindingReference(db: Database, branch: Branch, period: ReportingPeriod): string {
  const prefix = `${branch.code}-${period.code}`;
  const seq = db.findings.filter((f) => f.reference.startsWith(`${prefix}-`)).length + 1;
  return `${prefix}-${String(seq).padStart(3, "0")}`;
}

/**
 * "Relevant work queue" (plan doc §3.3/§3.4), computed generically from
 * which findings.* permissions the session holds rather than a hard-coded
 * role check - so a custom role picks up the right queue automatically the
 * same way custom roles already pick up the right dashboard/org-scope
 * behavior elsewhere in the app.
 */
export function queueStatusesForSession(session: SessionData): FindingStatus[] {
  const has = (action: string) => hasPermission(session.permissions, permissionKey("findings", action));
  const statuses: FindingStatus[] = [];
  if (has("edit") || has("submit")) statuses.push("DRAFT", "RETURNED");
  if (has("district-review")) statuses.push("DISTRICT_REVIEW");
  if (has("ho-review")) statuses.push("HO_REVIEW");
  if (has("rectify")) statuses.push("SENT_TO_BRANCH_MANAGER", "PARTIALLY_RECTIFIED");
  if (has("close")) statuses.push("RECTIFIED");
  return statuses;
}

export interface PerformanceScope {
  branchId?: string;
  districtId?: string;
  periodId?: string;
}

/**
 * The active ScoringRule's own formula (plan doc §3.8): "Rectified
 * eligible Other Cases ÷ Total eligible Other Cases × 100", generalized to
 * whatever categories/sources that rule currently includes rather than
 * hard-coding "Other Case". Returns null when there's no active rule or no
 * eligible cases yet (an honest "not computable," not a fabricated 0%).
 */
export function computePerformance(db: Database, scope: PerformanceScope): number | null {
  const rule = db.scoringRules.find((r) => r.active);
  if (!rule) return null;

  const eligible = db.findings.filter(
    (f) =>
      rule.categories.includes(f.categoryId) &&
      rule.sources.includes(f.sourceId) &&
      f.status !== "REJECTED" &&
      (!scope.branchId || f.branchId === scope.branchId) &&
      (!scope.districtId || f.districtId === scope.districtId) &&
      (!scope.periodId || f.periodId === scope.periodId)
  );

  const totalCases = eligible.reduce((sum, f) => sum + f.caseCount, 0);
  if (totalCases === 0) return null;
  const rectifiedCases = eligible.reduce((sum, f) => sum + f.rectifiedCases, 0);
  return (rectifiedCases / totalCases) * 100;
}
