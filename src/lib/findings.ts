import { v4 as uuid } from "uuid";
import { appendAuditLog } from "@/lib/audit";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import type { SessionData } from "@/lib/session";
import type { Database, Finding, FindingStatus, FindingTransfer, Branch, ReportingPeriod } from "@/types";

/**
 * A transfer moves the finding forward, it doesn't create a new one
 * (master.txt §8). The outstanding balance at the moment of transfer
 * becomes the FindingTransfer row's permanent record; `finding.periodId`
 * itself moves to the destination period, which is the entire mechanism
 * behind "no double-counting" - every performance query filters by
 * `Finding.periodId`, and a finding only ever has one live value of it, so
 * the source period's queries stop seeing it and the destination period's
 * queries start seeing it, automatically, with no separate bookkeeping.
 */
export function transferFinding(
  db: Database,
  finding: Finding,
  opts: { toPeriodId: string; reason: string; userId: string; userName: string; method?: "MANUAL" | "AUTOMATIC" }
): void {
  const fromPeriodId = finding.periodId;
  const outstandingCases = finding.caseCount - finding.rectifiedCases;
  const outstandingAmount = finding.amount - finding.rectifiedAmount;

  db.findingTransfers.push({
    id: uuid(),
    findingId: finding.id,
    fromPeriodId,
    toPeriodId: opts.toPeriodId,
    casesTransferred: outstandingCases,
    amountTransferred: outstandingAmount,
    // Document_3 §15: snapshotted at this specific hop, not read live off
    // the finding by a later reader - see the type's own doc comment.
    originalCaseCount: finding.caseCount,
    originalAmount: finding.amount,
    caseAgeAtTransferDays: caseAgeDays(finding),
    reason: opts.reason,
    createdBy: opts.userId,
    createdByName: opts.userName,
    createdAt: new Date().toISOString(),
    method: opts.method ?? "MANUAL",
  });

  finding.periodId = opts.toPeriodId;
  transitionFinding(db, finding, {
    toStatus: "TRANSFERRED",
    action: "TRANSFER",
    userId: opts.userId,
    userName: opts.userName,
    reason: opts.reason,
  });
}

// TRANSFERABLE_STATUSES lives on the manual transfer route and this
// module both - duplicated rather than imported to avoid a route->lib
// import for one array, but kept in lockstep: RECTIFICATION_RETURNED is
// deliberately excluded from both (a pending correction request shouldn't
// silently move to a new period out from under the return).
const AUTO_TRANSFERABLE_STATUSES = ["SENT_TO_BRANCH_MANAGER", "PARTIALLY_RECTIFIED", "TRANSFERRED"];

/**
 * The Admin-configurable half of "Configurable Automatic Transfer": when
 * Settings.autoTransferOnLock is on, locking a period sweeps every still-
 * outstanding finding in it into the next OPEN period (earliest year/
 * month after the one being locked), tagged `method: "AUTOMATIC"` in its
 * FindingTransfer row. A finding already transferred manually earlier
 * that period is naturally excluded - it's no longer in
 * `db.findings.filter(f => f.periodId === period.id)` by the time this
 * runs, since transferring moves `periodId` immediately. Called from
 * inside the same updateDb() transaction that sets the period LOCKED, by
 * the reporting-periods PATCH route.
 */
export function autoTransferOnLock(
  db: Database,
  lockedPeriod: ReportingPeriod,
  opts: { userId: string; userName: string }
): { transferredCount: number; skippedNoDestination: boolean } {
  if (!db.settings.autoTransferOnLock) return { transferredCount: 0, skippedNoDestination: false };

  const destination = db.reportingPeriods
    .filter((p) => p.status === "OPEN" && (p.year > lockedPeriod.year || (p.year === lockedPeriod.year && p.month > lockedPeriod.month)))
    .sort((a, b) => a.year - b.year || a.month - b.month)[0];
  if (!destination) return { transferredCount: 0, skippedNoDestination: true };

  const outstanding = db.findings.filter((f) => f.periodId === lockedPeriod.id && AUTO_TRANSFERABLE_STATUSES.includes(f.status));
  for (const f of outstanding) {
    transferFinding(db, f, {
      toPeriodId: destination.id,
      reason: `Automatic transfer - ${lockedPeriod.code} locked with this finding still outstanding.`,
      userId: opts.userId,
      userName: opts.userName,
      method: "AUTOMATIC",
    });
  }
  return { transferredCount: outstanding.length, skippedNoDestination: false };
}

/**
 * The reporting period immediately before the given one (by year/month),
 * regardless of its OPEN/LOCKED status - used for period-over-period
 * comparison (e.g. a branch's "Highest Improvement" callout on the Branch
 * Performance table: this period's performance minus the previous
 * period's). Returns undefined if this is the earliest period on record.
 */
export function findPreviousPeriod(db: Database, period: ReportingPeriod): ReportingPeriod | undefined {
  return [...db.reportingPeriods]
    .filter((p) => p.year < period.year || (p.year === period.year && p.month < period.month))
    .sort((a, b) => b.year - a.year || b.month - a.month)[0];
}

/** Days since the finding was originally registered - unaffected by any transfer, since transferFinding() never touches createdAt (master.txt §8: "track case age from original finding date"). */
export function caseAgeDays(finding: Finding): number {
  return Math.floor((Date.now() - new Date(finding.createdAt).getTime()) / 86_400_000);
}

/**
 * "How stale is the outstanding backlog?" - a real, calculable metric
 * (mean caseAgeDays() across whatever's passed in) that no dashboard
 * surfaced before, despite Document_3 §15 already tracking case age at
 * every transfer hop. Callers pass in whichever outstanding-findings set
 * is already in scope (bank-wide, one district, one branch) rather than
 * this function re-deriving "outstanding" itself. Returns null on an
 * empty set rather than a misleading 0.
 */
export function averageCaseAgeDays(findings: Finding[]): number | null {
  if (findings.length === 0) return null;
  return Math.round(findings.reduce((sum, f) => sum + caseAgeDays(f), 0) / findings.length);
}

/**
 * Dashboards report two different units side by side: "findings" (the
 * record - one per registered irregularity) and "cases" (Finding.caseCount/
 * rectifiedCases - the individual items a finding can bundle, per
 * Document_3 §12/§34's "a finding containing three cases should not be
 * permanently treated as one indivisible record"). A finding with
 * caseCount 5 and 2 rectified counts as 1 finding but 5/2 cases - the two
 * numbers diverge exactly when itemization matters, so both are shown
 * rather than picking one.
 */
export function findingCaseTotals(findings: Finding[]): {
  totalFindings: number;
  totalCases: number;
  rectifiedFindings: number;
  rectifiedCases: number;
} {
  return {
    totalFindings: findings.length,
    totalCases: findings.reduce((sum, f) => sum + f.caseCount, 0),
    rectifiedFindings: findings.filter((f) => f.status === "RECTIFIED" || f.status === "CLOSED").length,
    rectifiedCases: findings.reduce((sum, f) => sum + f.rectifiedCases, 0),
  };
}

/**
 * Same findings-vs-cases split for transfers. `casesTransferred` on each
 * FindingTransfer row is the outstanding balance actually carried forward
 * (see transferFinding() above) - summing it gives the real case count
 * moved, distinct from `transferredFindings` (how many finding records had
 * at least one transfer), which is what dashboards previously showed under
 * a "Transferred Cases" label despite counting records, not cases.
 */
export function transferTotals(transfers: FindingTransfer[]): {
  transferredFindings: number;
  transferredCases: number;
  transferredAmount: number;
} {
  return {
    transferredFindings: new Set(transfers.map((t) => t.findingId)).size,
    transferredCases: transfers.reduce((sum, t) => sum + t.casesTransferred, 0),
    transferredAmount: transfers.reduce((sum, t) => sum + t.amountTransferred, 0),
  };
}

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
/**
 * `registeredByBankScope` (the *submitting* user's current session.orgScope
 * === "BANK", not who originally created the finding - a returned finding
 * resubmitted later by a branch-scoped user correctly falls back to the
 * normal chain) routes a bank-wide (HO/Admin)-registered finding past
 * DISTRICT_REVIEW/HO_REVIEW entirely - there's no natural "district" to
 * review a finding HO itself registered. Instead: Settings.hoApproval.required
 * decides whether it needs the single admin-configured approval step
 * (PENDING_BANK_APPROVAL - see bank-approval/route.ts) or goes straight to
 * the Branch Manager, same destination the normal chain would eventually
 * reach anyway.
 */
export function submitFinding(
  db: Database,
  finding: Finding,
  userId: string,
  userName: string,
  opts?: { registeredByBankScope?: boolean }
): void {
  transitionFinding(db, finding, { toStatus: "SUBMITTED", action: "SUBMIT", userId, userName });

  if (opts?.registeredByBankScope) {
    if (db.settings.hoApproval.required) {
      transitionFinding(db, finding, { toStatus: "PENDING_BANK_APPROVAL", action: "QUEUE_BANK_APPROVAL", userId, userName });
    } else {
      transitionFinding(db, finding, { toStatus: "SENT_TO_BRANCH_MANAGER", action: "QUEUE_BRANCH_MANAGER", userId, userName });
    }
    return;
  }

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

/**
 * master.txt §13: "Locked periods prevent unauthorized reportable
 * changes." Applies to every write against an *existing* finding
 * (edit, delete, submit, district/HO review, rectify, close) - not just
 * new-finding creation, which src/app/api/findings/route.ts checks
 * separately since there's no existing finding yet to read a periodId
 * from. No "exceptional correction" override is built (master.txt §13
 * calls that out as needing to be "explicit and authorized" - left for
 * a future phase; for now a locked period is a hard stop for everyone).
 */
export function assertPeriodWritable(db: Database, periodId: string): string | null {
  const period = db.reportingPeriods.find((p) => p.id === periodId);
  if (!period) return "Reporting period not found";
  if (period.status === "LOCKED") return `${period.code} is locked and cannot accept changes`;
  return null;
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
 *
 * Returns a predicate rather than a flat status list because "needs
 * closing" is no longer a single status: a controller can verify-and-close
 * a rectified-but-unclosed portion while the finding is still
 * PARTIALLY_RECTIFIED/RECTIFIED/TRANSFERRED overall (see close/route.ts).
 */
export function queueStatusesForSession(session: SessionData): (finding: Finding) => boolean {
  const has = (action: string) => hasPermission(session.permissions, permissionKey("findings", action));
  const matchers: ((f: Finding) => boolean)[] = [];
  if (has("edit") || has("submit")) matchers.push((f) => f.status === "DRAFT" || f.status === "RETURNED");
  if (has("district-review")) matchers.push((f) => f.status === "DISTRICT_REVIEW");
  if (has("ho-review")) matchers.push((f) => f.status === "HO_REVIEW");
  if (has("rectify"))
    matchers.push(
      (f) =>
        f.status === "SENT_TO_BRANCH_MANAGER" || f.status === "PARTIALLY_RECTIFIED" || f.status === "RECTIFICATION_RETURNED"
    );
  // District's gate on a recorded rectification, before it's HO's turn -
  // "has something rectified that hasn't been district-verified yet." Either
  // permission alone still means there's a decision this session can make
  // on it (approve, or send back), so both queue the same findings.
  if (has("verify-rectification") || has("return-rectification"))
    matchers.push(
      (f) =>
        f.status !== "RECTIFICATION_RETURNED" &&
        f.status !== "CLOSED" &&
        (f.rectifiedCases > f.districtVerifiedCases || f.rectifiedAmount > f.districtVerifiedAmount)
    );
  if (has("close"))
    matchers.push((f) => {
      // Bounded by what's actually district-verified, not just rectified -
      // mirrors close/route.ts's own closable-amount calculation, so this
      // queue never promises something close/route.ts would then reject.
      const verifiedCases = Math.min(f.rectifiedCases, f.districtVerifiedCases);
      const verifiedAmount = Math.min(f.rectifiedAmount, f.districtVerifiedAmount);
      return f.status !== "CLOSED" && (verifiedCases > f.closedCases || verifiedAmount > f.closedAmount);
    });
  return (f) => matchers.some((matches) => matches(f));
}

export interface PerformanceScope {
  branchId?: string;
  districtId?: string;
  periodId?: string;
}

/**
 * How many of a finding's cases were actually eligible during `periodId`,
 * walking its transfer chain (each hop's `casesTransferred` is exactly what
 * was outstanding - and therefore eligible - the moment it arrived in the
 * next period). Returns null if the finding was never resident in that
 * period at all. This is what lets a period keep its own eligible total
 * even after the finding transfers away, instead of losing it the moment
 * `finding.periodId` moves on (master.txt §8: "do not double-count the same
 * continuing case in old and new periods" - each hop's cases belong to
 * exactly one period's eligible total, never two).
 */
function findingCasesEligibleInPeriod(db: Database, finding: Finding, periodId: string): number | null {
  const transfers = [...db.findingTransfers]
    .filter((t) => t.findingId === finding.id)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  if (transfers.length === 0) {
    return finding.periodId === periodId ? finding.caseCount : null;
  }
  if (transfers[0].fromPeriodId === periodId) return finding.caseCount;
  const hop = transfers.find((t) => t.toPeriodId === periodId);
  return hop ? hop.casesTransferred : null;
}

/**
 * The raw numerator/denominator behind computePerformance()'s formula -
 * factored out so a caller that needs to sum eligible/rectified counts
 * across several periods (a cumulative multi-period ranking, say) can add
 * up real counts first and divide once at the end, rather than only ever
 * getting back a single period's ratio. Same eligibility/crediting rules
 * as computePerformance() (see its own doc comment): generalized to
 * whatever categories/sources the active ScoringRule currently includes,
 * never hard-coded to "Other Case". Returns null under the same conditions
 * computePerformance() would return null for (no active rule, no eligible
 * cases in scope).
 */
export function computeEligibleCaseCounts(db: Database, scope: PerformanceScope): { totalCases: number; rectifiedCases: number } | null {
  const rule = db.scoringRules.find((r) => r.active);
  if (!rule) return null;

  const candidates = db.findings.filter(
    (f) =>
      rule.categories.includes(f.categoryId) &&
      rule.sources.includes(f.sourceId) &&
      f.status !== "REJECTED" &&
      (!scope.branchId || f.branchId === scope.branchId) &&
      (!scope.districtId || f.districtId === scope.districtId)
  );

  if (!scope.periodId) {
    const totalCases = candidates.reduce((sum, f) => sum + f.caseCount, 0);
    if (totalCases === 0) return null;
    const rectifiedCases = candidates.reduce((sum, f) => sum + f.rectifiedCases, 0);
    return { totalCases, rectifiedCases };
  }

  let totalCases = 0;
  let rectifiedCases = 0;
  for (const f of candidates) {
    const eligibleCases = findingCasesEligibleInPeriod(db, f, scope.periodId);
    if (eligibleCases === null) continue;
    totalCases += eligibleCases;
    rectifiedCases += db.rectifications
      .filter((r) => r.findingId === f.id && r.periodId === scope.periodId)
      .reduce((sum, r) => sum + r.rectifiedCases, 0);
  }
  if (totalCases === 0) return null;
  return { totalCases, rectifiedCases };
}

/**
 * The active ScoringRule's own formula (plan doc §3.8): "Rectified
 * eligible Other Cases ÷ Total eligible Other Cases × 100", generalized to
 * whatever categories/sources that rule currently includes rather than
 * hard-coding "Other Case". Returns null when there's no active rule or no
 * eligible cases yet (an honest "not computable," not a fabricated 0%).
 *
 * When scoped to a period, each finding's rectified credit comes from its
 * RectificationEntry ledger rows stamped with that periodId - not the
 * finding's lifetime `rectifiedCases` - so a case rectified before a
 * transfer stays credited to the period it actually happened in, and a
 * destination period only gets credit for work done after the case arrived
 * (see findingCasesEligibleInPeriod() above for the matching denominator).
 */
export function computePerformance(db: Database, scope: PerformanceScope): number | null {
  const counts = computeEligibleCaseCounts(db, scope);
  if (!counts) return null;
  return (counts.rectifiedCases / counts.totalCases) * 100;
}
