import { appendAuditLog } from "@/lib/audit";
import { transitionFinding } from "@/lib/findings";
import type { Database, Finding, FindingStatus } from "@/types";

/**
 * Reverse = undo what was closed in the finding's CURRENT period and send
 * it back to the branch, status REVERSED (shown as "Sent to Branch
 * Manager/R"). Permission: findings.reopen (labelled "Reverse Closed /
 * Partially Closed Findings"). Period locks don't block it.
 *
 * Only one period is reversed - the one the finding is in now:
 *   - a finding that never moved is reversed in its own (originally
 *     reported) period;
 *   - a transferred finding is reversed in the period it was transferred
 *     into. What was closed in the previous period(s) stays closed there,
 *     and their transfers stay, so previous periods' figures never change.
 *
 * In the current period:
 *   - its closures and rectification records are removed (they no longer
 *     count in that period's performance, dashboards or reports);
 *   - every case the period holds is outstanding again: rectified /
 *     district-verified / closed go back to what previous periods closed;
 *   - itemized cases not covered by a previous period's closure go back to
 *     OUTSTANDING.
 *
 * History is kept: the workflow trail gets a REVERSE step (old status ->
 * REVERSED) with the reason, and the audit log a FINDING_REVERSED entry
 * with a snapshot of what was removed and the previous figures.
 */
export const REVERSED_STATUS: FindingStatus = "REVERSED";

/** What was closed in the finding's current period - what a reversal undoes. */
export function closedInCurrentPeriod(db: Database, finding: Finding): { cases: number; amount: number } {
  const closures = db.findingClosures.filter((c) => c.findingId === finding.id && c.periodId === finding.periodId);
  return {
    cases: closures.reduce((sum, c) => sum + c.closedCases, 0),
    amount: closures.reduce((sum, c) => sum + c.closedAmount, 0),
  };
}

/** Reversible only when something was closed in the current period. */
export function canReverse(db: Database, finding: Finding): boolean {
  const closed = closedInCurrentPeriod(db, finding);
  return closed.cases > 0 || closed.amount > 0;
}

export function reverseFinding(
  db: Database,
  finding: Finding,
  actor: { userId: string; userName: string },
  reason: string
): { fromStatus: FindingStatus; toStatus: FindingStatus } {
  const periodId = finding.periodId;
  const isThisFinding = (x: { findingId: string }) => x.findingId === finding.id;
  const removedClosures = db.findingClosures.filter((c) => isThisFinding(c) && c.periodId === periodId);
  const removedRectifications = db.rectifications.filter((r) => isThisFinding(r) && r.periodId === periodId);
  const keptClosures = db.findingClosures.filter((c) => isThisFinding(c) && c.periodId !== periodId);
  const keptCases = keptClosures.reduce((sum, c) => sum + c.closedCases, 0);
  const keptAmount = keptClosures.reduce((sum, c) => sum + c.closedAmount, 0);

  const fromStatus = finding.status;
  const before = {
    status: fromStatus,
    periodId,
    rectifiedCases: finding.rectifiedCases,
    rectifiedAmount: finding.rectifiedAmount,
    districtVerifiedCases: finding.districtVerifiedCases,
    districtVerifiedAmount: finding.districtVerifiedAmount,
    closedCases: finding.closedCases,
    closedAmount: finding.closedAmount,
    removedRectifications,
    removedClosures,
  };

  db.findingClosures = db.findingClosures.filter((c) => !removedClosures.includes(c));
  db.rectifications = db.rectifications.filter((r) => !removedRectifications.includes(r));

  // Itemized cases: the ones a previous period closed stay RECTIFIED (the
  // earliest-rectified first, matching closure order); every other case is
  // outstanding again in this period.
  const keptEntryIds = new Set(db.rectifications.filter(isThisFinding).map((r) => r.id));
  const stillClosed = new Set(
    db.findingCases
      .filter((c) => isThisFinding(c) && c.status === "RECTIFIED" && c.rectificationId && keptEntryIds.has(c.rectificationId))
      .sort((a, b) => (a.rectifiedAt ?? "").localeCompare(b.rectifiedAt ?? "") || a.seq - b.seq)
      .slice(0, keptCases)
      .map((c) => c.id)
  );
  for (const c of db.findingCases) {
    if (!isThisFinding(c) || stillClosed.has(c.id)) continue;
    c.status = "OUTSTANDING";
    c.rectificationId = undefined;
    c.rectifiedAt = undefined;
    c.rectifiedBy = undefined;
    c.rectifiedByName = undefined;
  }

  // Everything this period holds is outstanding again; only what previous
  // periods closed still counts as rectified / verified / closed.
  finding.rectifiedCases = keptCases;
  finding.rectifiedAmount = keptAmount;
  finding.districtVerifiedCases = keptCases;
  finding.districtVerifiedAmount = keptAmount;
  finding.closedCases = keptCases;
  finding.closedAmount = keptAmount;
  finding.lastReminderAt = undefined;

  transitionFinding(db, finding, { toStatus: REVERSED_STATUS, action: "REVERSE", userId: actor.userId, userName: actor.userName, reason });
  appendAuditLog(db, {
    userId: actor.userId,
    userName: actor.userName,
    action: "FINDING_REVERSED",
    entityType: "Finding",
    entityId: finding.id,
    oldValue: before,
    newValue: { status: REVERSED_STATUS, periodId, rectifiedCases: keptCases, districtVerifiedCases: keptCases, closedCases: keptCases },
    reason,
  });
  return { fromStatus, toStatus: REVERSED_STATUS };
}
