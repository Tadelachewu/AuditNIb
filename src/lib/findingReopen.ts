import { appendAuditLog } from "@/lib/audit";
import { transitionFinding } from "@/lib/findings";
import type { Database, Finding } from "@/types";

/**
 * Reopen a CLOSED or partially closed finding: it goes back to a fresh
 * "Sent to Branch Manager" state, as if nothing had been rectified yet.
 * Permission: Findings › Reopen Closed Findings.
 *
 *   - status              -> SENT_TO_BRANCH_MANAGER (a REOPEN transition)
 *   - rectified / district-verified / closed cases & amounts -> 0
 *   - rectification and closure ledger entries removed, so they no longer
 *     count in performance or reports; itemized cases back to OUTSTANDING
 *
 * History is kept: the full workflow trail (FindingTransition) stays, and
 * the audit log records the reason plus a snapshot of every removed
 * rectification / closure and the previous figures. Transfers are kept
 * (they are movement history).
 */
export function canReopen(f: Finding): boolean {
  return f.status === "CLOSED" || f.closedCases > 0 || f.closedAmount > 0;
}

export function reopenFinding(db: Database, finding: Finding, actor: { userId: string; userName: string }, reason: string): void {
  const rectifications = db.rectifications.filter((r) => r.findingId === finding.id);
  const closures = db.findingClosures.filter((c) => c.findingId === finding.id);
  const before = {
    status: finding.status,
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

  transitionFinding(db, finding, { toStatus: "SENT_TO_BRANCH_MANAGER", action: "REOPEN", userId: actor.userId, userName: actor.userName, reason });
  appendAuditLog(db, {
    userId: actor.userId,
    userName: actor.userName,
    action: "REOPEN_RESET",
    entityType: "Finding",
    entityId: finding.id,
    oldValue: before,
    newValue: { status: "SENT_TO_BRANCH_MANAGER", rectifiedCases: 0, closedCases: 0 },
    reason,
  });
}
