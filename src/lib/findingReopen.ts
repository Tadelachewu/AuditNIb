import { appendAuditLog } from "@/lib/audit";
import { transitionFinding } from "@/lib/findings";
import type { Database, Finding, FindingStatus } from "@/types";

/**
 * Reopen = reverse a closed or partially closed finding (including a
 * transferred finding part of which was closed before it moved) back to
 * its original "sent to the branch" state, with status REVERSED.
 * Permission: Findings › Reopen Closed / Partially Closed Findings.
 *
 *   - status -> REVERSED: the same state as SENT_TO_BRANCH_MANAGER (the
 *     workflow treats them alike - the branch must rectify it again), but
 *     labelled so everyone can see it was reversed
 *   - rectified / district-verified / closed cases & amounts -> 0
 *   - rectification and closure records removed, so they no longer count
 *     in performance or reports (in whichever period they were credited);
 *     itemized cases back to OUTSTANDING
 *   - transfers are kept (movement history)
 *
 * History is kept: the workflow trail gets a REOPEN step (old status ->
 * REVERSED) with the reason, and the audit log records a snapshot of every
 * removed rectification / closure and the previous figures.
 */
export const REVERSED_STATUS: FindingStatus = "REVERSED";

export function canReopen(f: Finding): boolean {
  return f.status === "CLOSED" || f.closedCases > 0 || f.closedAmount > 0;
}

/** Periods whose figures the reversal changes (where rectifications / closures were credited). */
export function periodsAffectedByReopen(db: Database, finding: Finding): string[] {
  return [
    ...new Set([
      finding.periodId,
      ...db.findingClosures.filter((c) => c.findingId === finding.id).map((c) => c.periodId),
      ...db.rectifications.filter((r) => r.findingId === finding.id).map((r) => r.periodId),
    ]),
  ];
}

export function reopenFinding(db: Database, finding: Finding, actor: { userId: string; userName: string }, reason: string): { fromStatus: FindingStatus; toStatus: FindingStatus } {
  const rectifications = db.rectifications.filter((r) => r.findingId === finding.id);
  const closures = db.findingClosures.filter((c) => c.findingId === finding.id);
  const fromStatus = finding.status;
  const before = {
    status: fromStatus,
    rectifiedCases: finding.rectifiedCases,
    rectifiedAmount: finding.rectifiedAmount,
    districtVerifiedCases: finding.districtVerifiedCases,
    districtVerifiedAmount: finding.districtVerifiedAmount,
    closedCases: finding.closedCases,
    closedAmount: finding.closedAmount,
    rectifications,
    closures,
  };

  db.rectifications = db.rectifications.filter((r) => r.findingId !== finding.id);
  db.findingClosures = db.findingClosures.filter((c) => c.findingId !== finding.id);
  for (const c of db.findingCases) {
    if (c.findingId !== finding.id) continue;
    c.status = "OUTSTANDING";
    c.rectificationId = undefined;
    c.rectifiedAt = undefined;
    c.rectifiedBy = undefined;
    c.rectifiedByName = undefined;
  }
  finding.rectifiedCases = 0;
  finding.rectifiedAmount = 0;
  finding.districtVerifiedCases = 0;
  finding.districtVerifiedAmount = 0;
  finding.closedCases = 0;
  finding.closedAmount = 0;
  finding.lastReminderAt = undefined;

  transitionFinding(db, finding, { toStatus: REVERSED_STATUS, action: "REOPEN", userId: actor.userId, userName: actor.userName, reason });
  appendAuditLog(db, {
    userId: actor.userId,
    userName: actor.userName,
    action: "REOPEN_REVERSED",
    entityType: "Finding",
    entityId: finding.id,
    oldValue: before,
    newValue: { status: REVERSED_STATUS, rectifiedCases: 0, districtVerifiedCases: 0, closedCases: 0 },
    reason,
  });
  return { fromStatus, toStatus: REVERSED_STATUS };
}
