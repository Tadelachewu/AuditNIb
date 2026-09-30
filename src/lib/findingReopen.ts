import { appendAuditLog } from "@/lib/audit";
import { transitionFinding } from "@/lib/findings";
import type { Database, Finding, FindingStatus } from "@/types";

/**
 * Reopen = reverse the CLOSURE of a closed or partially closed finding
 * (including a transferred finding part of which was closed before it
 * moved). Permission: Findings › Reopen Closed / Partially Closed Findings.
 *
 *   - every closure record is removed and closed cases / amount go to 0,
 *     so the closure no longer counts in performance or reports (in
 *     whichever period it was credited)
 *   - status is REVERSED: a fully CLOSED finding returns to the status it
 *     had just before it was closed (from its own history - e.g. Rectified,
 *     Partially Rectified, Transferred); a partially closed one keeps its
 *     current status (e.g. Transferred)
 *   - rectifications and district verifications are kept - only the
 *     closure is undone, so the closer can review and close again
 *
 * History is kept: the workflow trail gets a REOPEN step (when the status
 * changes) and the audit log records the reason plus a snapshot of every
 * removed closure and the previous figures.
 */
export function canReopen(f: Finding): boolean {
  return f.status === "CLOSED" || f.closedCases > 0 || f.closedAmount > 0;
}

/** The status a closed finding had just before its (latest) closure. */
export function statusBeforeClosure(db: Database, finding: Finding): FindingStatus {
  if (finding.status !== "CLOSED") return finding.status;
  const closing = db.findingTransitions
    .filter((t) => t.findingId === finding.id && t.toStatus === "CLOSED")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const from = closing?.fromStatus as FindingStatus | undefined;
  return from && from !== "CLOSED" ? from : "RECTIFIED";
}

/** Periods whose figures the reversal changes (where the closures were credited). */
export function periodsAffectedByReopen(db: Database, finding: Finding): string[] {
  return [...new Set([finding.periodId, ...db.findingClosures.filter((c) => c.findingId === finding.id).map((c) => c.periodId)])];
}

export function reopenFinding(db: Database, finding: Finding, actor: { userId: string; userName: string }, reason: string): { fromStatus: FindingStatus; toStatus: FindingStatus } {
  const closures = db.findingClosures.filter((c) => c.findingId === finding.id);
  const fromStatus = finding.status;
  const toStatus = statusBeforeClosure(db, finding);
  const before = { status: fromStatus, closedCases: finding.closedCases, closedAmount: finding.closedAmount, closures };

  db.findingClosures = db.findingClosures.filter((c) => c.findingId !== finding.id);
  finding.closedCases = 0;
  finding.closedAmount = 0;

  if (toStatus !== fromStatus) {
    transitionFinding(db, finding, { toStatus, action: "REOPEN", userId: actor.userId, userName: actor.userName, reason });
  } else {
    finding.updatedAt = new Date().toISOString();
  }
  appendAuditLog(db, {
    userId: actor.userId,
    userName: actor.userName,
    action: "REOPEN_CLOSURE_REVERSED",
    entityType: "Finding",
    entityId: finding.id,
    oldValue: before,
    newValue: { status: toStatus, closedCases: 0, closedAmount: 0 },
    reason,
  });
  return { fromStatus, toStatus };
}
