import { v4 as uuid } from "uuid";
import { appendAuditLog } from "@/lib/audit";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import type { SessionData } from "@/lib/session";
import { REQUIRABLE_FINDING_FIELDS, HO_APPROVED_OR_LATER_STATUSES } from "@/types";
import type {
  Database,
  Finding,
  FindingStatus,
  FindingTransfer,
  Branch,
  ReportingPeriod,
  RequirableFindingField,
} from "@/types";

/**
 * A transfer moves the finding forward, it doesn't create a new one
 * (master.txt §8). The outstanding balance at the moment of transfer
 * becomes the FindingTransfer row's permanent record; `finding.periodId`
 * itself moves to the destination period, which is the entire mechanism
 * behind "no double-counting" - every performance query filters by
 * `Finding.periodId`, and a finding only ever has one live value of it, so
 * the source period's queries stop seeing it and the destination period's
 * queries start seeing it, automatically, with no separate bookkeeping.
 *
 * "Outstanding" here means caseCount/amount minus closedCases/closedAmount,
 * not rectifiedCases/rectifiedAmount - a case the branch has self-reported
 * as rectified (and District may have even verified) but HO hasn't
 * formally closed yet is NOT done; leaving it out of the transferred
 * total would silently understate what's actually still open (the
 * FindingTransfer row would claim "nothing was left owing" while a real,
 * unclosed case sits there) and orphan it from ever being counted as
 * outstanding again post-transfer. Only a formally CLOSED case is truly
 * finished and excluded from what moves forward.
 */
export function transferFinding(
  db: Database,
  finding: Finding,
  opts: {
    toPeriodId: string;
    reason: string;
    userId: string;
    userName: string;
    method?: "MANUAL" | "AUTOMATIC";
    // Overrides the FindingTransition/audit-log action string, default
    // "TRANSFER" - lets a historical-import backfill (src/lib/import.ts)
    // stamp "IMPORT_TRANSFER" instead, same "clearly marked as a
    // historical import, not a live decision" reasoning as that file's own
    // IMPORT_SUBMIT/IMPORT_APPROVE/IMPORT_RECTIFY/IMPORT_CLOSE actions,
    // while still going through this exact same real transfer mechanism.
    action?: string;
  }
): void {
  const fromPeriodId = finding.periodId;
  const outstandingCases = finding.caseCount - finding.closedCases;
  const outstandingAmount = finding.amount - finding.closedAmount;

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

  // Anything rectified but not yet formally closed - waiting for district
  // verification, verified but not closed, or returned for correction - is
  // NOT carried over half-done: every transferred case goes back to the
  // branch to rectify again in the new period. Only closed work stays (it
  // belongs to the period it was closed in). The old rectification records
  // stay as history of the period they were made in.
  const pending = {
    rectifiedCases: finding.rectifiedCases - finding.closedCases,
    rectifiedAmount: finding.rectifiedAmount - finding.closedAmount,
    districtVerifiedCases: finding.districtVerifiedCases - finding.closedCases,
    districtVerifiedAmount: finding.districtVerifiedAmount - finding.closedAmount,
  };
  if (pending.rectifiedCases > 0 || pending.rectifiedAmount > 0 || pending.districtVerifiedCases > 0 || pending.districtVerifiedAmount > 0) {
    finding.rectifiedCases = finding.closedCases;
    finding.rectifiedAmount = finding.closedAmount;
    finding.districtVerifiedCases = Math.min(finding.districtVerifiedCases, finding.closedCases);
    finding.districtVerifiedAmount = Math.min(finding.districtVerifiedAmount, finding.closedAmount);
    // Itemized cases: the earliest-rectified ones covered by closures stay
    // Rectified; the rest are outstanding again.
    const stillClosed = new Set(
      db.findingCases
        .filter((c) => c.findingId === finding.id && c.status === "RECTIFIED")
        .sort((a, b) => (a.rectifiedAt ?? "").localeCompare(b.rectifiedAt ?? "") || a.seq - b.seq)
        .slice(0, finding.closedCases)
        .map((c) => c.id)
    );
    for (const c of db.findingCases) {
      if (c.findingId !== finding.id || c.status !== "RECTIFIED" || stillClosed.has(c.id)) continue;
      c.status = "OUTSTANDING";
      c.rectificationId = undefined;
      c.rectifiedAt = undefined;
      c.rectifiedBy = undefined;
      c.rectifiedByName = undefined;
    }
    appendAuditLog(db, {
      userId: opts.userId,
      userName: opts.userName,
      action: "TRANSFER_RESET_PENDING",
      entityType: "Finding",
      entityId: finding.id,
      oldValue: pending,
      newValue: { rectifiedCases: finding.rectifiedCases, districtVerifiedCases: finding.districtVerifiedCases, closedCases: finding.closedCases },
      reason: "Rectification not yet closed was reset by the transfer - the branch rectifies it again in the new period.",
    });
  }

  finding.periodId = opts.toPeriodId;
  transitionFinding(db, finding, {
    toStatus: "TRANSFERRED",
    action: opts.action ?? "TRANSFER",
    userId: opts.userId,
    userName: opts.userName,
    reason: opts.reason,
  });
}

// TRANSFERABLE_STATUSES lives on the manual transfer route, this module,
// and findings/[id]/page.tsx's own UI gate - duplicated three times rather
// than imported, but kept in lockstep: everything short of CLOSED is
// transferable now, by explicit instruction - a period being locked should
// be able to sweep out *every* finding still open in some way, not just
// the ones with a nonzero rectified/unrectified split. RECTIFIED was
// previously excluded on the reasoning that a fully-rectified finding has
// nothing left to move - true only once it's also fully CLOSED
// (transferFinding()'s own outstandingCases/Amount is closedCases/Amount-
// based, not rectifiedCases/Amount-based, precisely so a RECTIFIED-but-
// not-yet-closed finding still carries its real unclosed balance forward
// instead of a false zero). A genuinely zero-balance transfer (fully
// closed already) is still harmless, not broken: it still moves the
// finding's period forward and its FindingTransfer row honestly records
// "nothing was left owing," rather than leaving a rectified-but-not-yet-
// closed finding stranded in a period that's about to lock. RECTIFICATION_
// RETURNED was previously excluded so a pending correction couldn't
// silently move to a new period out from under the return - now included
// on the same "sweep everything not-closed" reasoning; the return itself
// (and its reason) travels with the finding across the transfer just like
// any other in-flight state does.
const AUTO_TRANSFERABLE_STATUSES = ["SENT_TO_BRANCH_MANAGER", "REVERSED", "PARTIALLY_RECTIFIED", "RECTIFIED", "RECTIFICATION_RETURNED", "TRANSFERRED"];

// Shared by outstandingTransferPreview() and autoTransferOnLock() so the
// count a locking user is shown in the confirmation prompt can never drift
// from what actually gets transferred a moment later.
function findAutoTransferDestination(db: Database, lockedPeriod: ReportingPeriod): ReportingPeriod | undefined {
  return db.reportingPeriods
    .filter((p) => p.status === "OPEN" && (p.year > lockedPeriod.year || (p.year === lockedPeriod.year && p.month > lockedPeriod.month)))
    .sort((a, b) => a.year - b.year || a.month - b.month)[0];
}
function outstandingTransferableFindings(db: Database, period: ReportingPeriod) {
  return db.findings.filter((f) => f.periodId === period.id && AUTO_TRANSFERABLE_STATUSES.includes(f.status));
}

/**
 * What the Lock dialog shows the locking user *before* they decide whether
 * to transfer - how many outstanding cases are sitting in this period and
 * which period they'd land in, so "ask his permission" (see
 * autoTransferOnLock()'s doc comment) is a real, informed choice rather
 * than a blind checkbox.
 */
export function outstandingTransferPreview(
  db: Database,
  period: ReportingPeriod
): { count: number; destinationCode: string | null } {
  const destination = findAutoTransferDestination(db, period);
  return { count: outstandingTransferableFindings(db, period).length, destinationCode: destination?.code ?? null };
}

/**
 * The Admin-configurable half of "Configurable Automatic Transfer":
 * Settings.autoTransferOnLock is the bank-wide "is this allowed at all"
 * switch (see /admin/settings' Case Transfer card), but locking a period
 * no longer transfers silently just because that switch is on - the
 * locking user is asked at lock time (the reporting-periods PATCH route's
 * `transferOverdueCases` flag, surfaced as a checkbox in the Lock dialog)
 * and this only runs when they said yes. When it does run, it sweeps
 * every still-outstanding finding in the period into the next OPEN period
 * (earliest year/month after the one being locked), tagged
 * `method: "AUTOMATIC"` in its FindingTransfer row - "automatic" meaning
 * the bulk-sweep mechanism, as opposed to a one-off manual Transfer,  not
 * that it ran without anyone asking. A finding already transferred
 * manually earlier that period is naturally excluded - it's no longer in
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

  const destination = findAutoTransferDestination(db, lockedPeriod);
  if (!destination) return { transferredCount: 0, skippedNoDestination: true };

  const outstanding = outstandingTransferableFindings(db, lockedPeriod);
  for (const f of outstanding) {
    transferFinding(db, f, {
      toPeriodId: destination.id,
      reason: `Automatic transfer - ${lockedPeriod.code} locked with this finding still outstanding, transfer confirmed by the locking user.`,
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

// A finding isn't "official" for dashboard-counting purposes until it's
// been through HO's sign-off - DRAFT/SUBMITTED/DISTRICT_REVIEW/
// DISTRICT_APPROVED/HO_REVIEW/PENDING_BANK_APPROVAL are all still in
// flight, and REJECTED/RETURNED never made it past district review, so
// none of those should inflate "Total Findings." HO_APPROVED itself is a
// momentary pass-through status (transitionFinding() moves straight
// through it to SENT_TO_BRANCH_MANAGER within one call - see
// hoApproveFinding()) so it's included here for completeness but is
// rarely a finding's *resting* status. RECTIFICATION_RETURNED is included
// because the underlying finding already cleared HO approval - only its
// rectification submission was bounced back for correction, not the
// finding itself. A bank-registered finding that skips district/HO review
// entirely lands straight on SENT_TO_BRANCH_MANAGER (see submitFinding()'s
// registeredByBankScope branch), which is itself the bank's own approval,
// so it's correctly included too.
// HO_APPROVED_OR_LATER_STATUSES lives in src/types/index.ts, not here - see
// that constant's own doc comment for why (FilterBar.tsx, a client
// component, needs it via src/lib/dashboardFilters.ts without pulling in
// this file's server-only dependency chain).
const HO_APPROVED_OR_LATER = new Set<FindingStatus>(HO_APPROVED_OR_LATER_STATUSES);

/** Whether a finding has cleared HO approval (or later) - see HO_APPROVED_OR_LATER's own doc comment. */
export function isHoApproved(f: Finding): boolean {
  return HO_APPROVED_OR_LATER.has(f.status);
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
 *
 * Both totals are scoped to HO-approved-or-later findings only (see
 * isHoApproved()) - a still-in-flight draft or a district-level reject
 * shouldn't inflate "Total Findings." "Rectified" is scoped further still:
 * counted only once formally CLOSED (Finding.closedCases/status===CLOSED),
 * not merely self-reported RECTIFIED - a controller's sign-off is what
 * makes a rectification official for dashboard purposes, same reasoning
 * as the HO-approval gate above.
 */
export function findingCaseTotals(findings: Finding[]): {
  totalFindings: number;
  totalCases: number;
  reportedCases: number;
  rectifiedFindings: number;
  rectifiedCases: number;
} {
  const approved = findings.filter(isHoApproved);
  const totalCases = approved.reduce((sum, f) => sum + f.caseCount, 0);
  return {
    totalFindings: approved.length,
    totalCases,
    // Across all periods nothing is moved in or out, so reported = total.
    reportedCases: totalCases,
    rectifiedFindings: approved.filter((f) => f.status === "CLOSED").length,
    rectifiedCases: approved.reduce((sum, f) => sum + f.closedCases, 0),
  };
}

/**
 * findingCaseTotals(), scoped to one specific reporting period via
 * residency (findingsResidentInPeriod()) instead of a raw
 * `f.periodId === periodId` filter - every dashboard's "Total Findings /
 * Total Cases / Rectified" StatCards used that raw filter until this
 * existed, which silently drops a finding's slice of a period the moment
 * it transfers away (see findingsResidentInPeriod()'s own doc comment).
 * `candidates` should already have every *other* scope/filter applied
 * (branch/district/date-range/dashboard filters) but NOT the period
 * filter - same division of labor as findingsResidentInPeriod() itself.
 *
 * The counting rule this produces, worked through both transfer shapes:
 *   - Full transfer (nothing rectified before it left): this period's
 *     totalCases is 0 for that finding (nothing stayed), all of it lands
 *     in totalCases wherever it arrived instead - never both, never
 *     neither.
 *   - Partial transfer (some cases rectified before the rest moved on):
 *     this period's totalCases is exactly the cases that *didn't*
 *     transfer (caseCount - casesTransferred), and rectifiedCases counts
 *     whatever of those was actually formally closed here - the
 *     transferred remainder shows up in totalCases wherever it went, not
 *     here.
 * `totalFindings` still counts the finding once for every period it was
 * ever resident in (a partially-rectified-then-transferred finding is
 * "kept" in both its origin and destination period's Total Findings, each
 * for the portion of work that genuinely happened there) - it is not a
 * global per-finding count, the same way Total Cases isn't either.
 * `rectifiedFindings` ("Rectified Findings - formally closed") counts a
 * finding only in its *final* period, and only once the whole finding is
 * formally CLOSED. A finding that transferred out of this period never
 * counts here, even when every case it left behind was closed: e.g. 2
 * cases in 10/2026, 1 closed there, 1 transferred to 11/2026 - it is not a
 * closed finding in 10/2026 (it isn't closed, it moved on), and counts as
 * one in 11/2026 once the transferred case is closed there. So a finding
 * is counted as closed exactly once, in the period it was finished in.
 * The closed *case* in 10/2026 still counts in that period's rectifiedCases
 * (and Performance %) - that case genuinely was closed there.
 */
/** The period a finding was originally registered in (before any transfer). */
export function originPeriodId(db: Database, finding: Finding): string {
  const first = db.findingTransfers
    .filter((t) => t.findingId === finding.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  return first ? first.fromPeriodId : finding.periodId;
}

export function findingCaseTotalsInPeriod(
  db: Database,
  periodId: string,
  candidates: Finding[]
): { totalFindings: number; totalCases: number; reportedCases: number; rectifiedFindings: number; rectifiedCases: number } {
  const approved = candidates.filter(isHoApproved);
  const resident = findingsResidentInPeriod(db, periodId, approved);
  return {
    totalFindings: resident.length,
    totalCases: resident.reduce((sum, r) => sum + r.slice.eligibleCases, 0),
    // "Reported Cases": the full case count of findings originally
    // registered in this period - never changed by transfers in or out
    // (Total Cases is this period's share after transfers).
    reportedCases: approved.filter((f) => originPeriodId(db, f) === periodId).reduce((sum, f) => sum + f.caseCount, 0),
    rectifiedFindings: resident.filter((r) => r.slice.isCurrentPeriod && r.finding.status === "CLOSED").length,
    rectifiedCases: resident.reduce((sum, r) => sum + r.slice.closedCases, 0),
  };
}

/**
 * "Transferred Findings / Transferred Cases" on the dashboards: what is
 * CURRENTLY out of the period, not every transfer event ever made from it.
 * `transfers` = the transfers to consider (already narrowed to the caller's
 * scope); `periodId` = the period shown, or undefined for "All periods".
 *
 * - One period: a finding counts if it left that period and is not back in
 *   it now; its cases / amount are what it carried on its LAST departure
 *   from there. A finding moved Sep -> Oct -> Sep counts 0 for Sep.
 * - All periods: a finding counts once if it is not in its original period
 *   now, with what its latest transfer carried - a finding moved back and
 *   forth is never counted twice.
 *
 * The full transfer log (Reports -> Transfers, the finding's history) still
 * lists every move.
 */
export function transferTotals(
  db: Database,
  transfers: FindingTransfer[],
  periodId: string | undefined
): {
  transferredFindings: number;
  transferredCases: number;
  transferredAmount: number;
} {
  const byFinding = new Map<string, FindingTransfer[]>();
  for (const t of transfers) byFinding.set(t.findingId, [...(byFinding.get(t.findingId) ?? []), t]);
  const currentPeriod = new Map(db.findings.map((f) => [f.id, f.periodId]));

  let transferredFindings = 0;
  let transferredCases = 0;
  let transferredAmount = 0;
  for (const [findingId, list] of byFinding) {
    const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const nowIn = currentPeriod.get(findingId);
    let last: FindingTransfer | undefined;
    if (periodId) {
      const departures = sorted.filter((t) => t.fromPeriodId === periodId);
      if (departures.length === 0 || nowIn === periodId) continue;
      last = departures[departures.length - 1];
    } else {
      if (nowIn === sorted[0].fromPeriodId) continue; // back in its original period
      last = sorted[sorted.length - 1];
    }
    transferredFindings += 1;
    transferredCases += last.casesTransferred;
    transferredAmount += last.amountTransferred;
  }
  return { transferredFindings, transferredCases, transferredAmount };
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
  // Persisted, not just this call's own routing decision - read much later
  // by return-rectification/route.ts to decide who can return a
  // rectification for correction (see Finding.registeredByBankScope's own
  // doc comment). Re-set on every call, matching this same function's own
  // "not who originally created the finding" doc comment just below - a
  // returned finding resubmitted later by a branch-scoped user correctly
  // flips this back to false.
  finding.registeredByBankScope = Boolean(opts?.registeredByBankScope);

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
 * A locked period only blocks SUBMISSION (the submit route, and create-
 * and-submit in src/app/api/findings/route.ts). Every other action - review,
 * bank approval, rectify, resubmit/return rectification, verify, close,
 * transfer (in or out), reverse, edit, delete, comments, evidence - works
 * the same in a locked period. See docs/locked-periods.md.
 *
 * Drafting in a locked period - registering a draft, saving changes to a
 * draft or returned finding, deleting a draft, moving one into the period -
 * follows the period's "Drafts allowed / blocked" setting
 * (draftsAllowedWhileLocked): those callers pass "DRAFT" as
 * `editingFindingStatus`.
 */
export function assertPeriodWritable(db: Database, periodId: string, editingFindingStatus?: FindingStatus): string | null {
  const period = db.reportingPeriods.find((p) => p.id === periodId);
  if (!period) return "Reporting period not found";
  if (period.status === "LOCKED") {
    if (editingFindingStatus === "DRAFT") {
      return period.draftsAllowedWhileLocked
        ? null
        : `${period.code} is locked and drafts are blocked for it - an administrator can allow drafts (Reporting Periods) or unlock it`;
    }
    return `${period.code} is locked and cannot accept changes`;
  }
  return null;
}

/**
 * A period's own submissionStartsAt/submissionEndsAt (set when it's
 * created, admin-narrowable afterward - see the admin reporting-periods
 * route and the type's own doc comment) is the actual window a finding is
 * meant to be submitted within - narrower than, and independent of, both
 * the period's overall startsAt/endsAt *and* its OPEN/LOCKED status. A
 * period left OPEN past its submission window (nobody has locked it yet,
 * or the admin deliberately set submissions to close early within a
 * longer reporting period) shouldn't silently keep accepting new
 * submissions just because nobody flipped the status - so this adds a
 * stricter rule on top of "OPEN," gating only the act of submitting
 * (moving a finding past DRAFT, the same scope assertPeriodWritable's own
 * "submit never passes editingFindingStatus" case already covers).
 * Saving/editing a DRAFT is untouched by this function entirely - it
 * stays possible whenever assertPeriodWritable already allows it,
 * regardless of today's date relative to the window. LOCKED periods are
 * also untouched here - assertPeriodWritable (or the create route's own
 * LOCKED check) already fully blocks those; this function only ever
 * tightens the OPEN case.
 */
export function assertPeriodOpenForSubmission(db: Database, periodId: string): string | null {
  const period = db.reportingPeriods.find((p) => p.id === periodId);
  if (!period) return "Reporting period not found";
  if (period.status !== "OPEN") return null;
  const now = Date.now();
  if (now < new Date(period.submissionStartsAt).getTime() || now > new Date(period.submissionEndsAt).getTime()) {
    return `${period.code}'s submission window has closed - save this as a draft instead, or submit once a period's submission window covering today's date is open`;
  }
  return null;
}

/**
 * Enforces Settings.requiredFindingFields against whichever of
 * REQUIRABLE_FINDING_FIELDS the caller passes in - shared by the create
 * and edit routes so there's exactly one place this decision is made.
 * `values[key] === undefined` means two different things depending on the
 * caller: a brand-new finding (create) genuinely never supplied that
 * field, so it's treated the same as blank; an in-place edit (PATCH) that
 * simply didn't include the key at all is "leave this field unchanged,"
 * not "clear it" - `skipUnset` tells this function which case it's in.
 * An explicitly-sent empty string always counts as blank either way.
 */
export function assertRequiredFindingFieldsPresent(
  db: Database,
  values: Partial<Record<RequirableFindingField, string | undefined>>,
  opts?: { skipUnset?: boolean }
): string | null {
  for (const { key, label } of REQUIRABLE_FINDING_FIELDS) {
    if (!db.settings.requiredFindingFields[key]) continue;
    const value = values[key];
    if (value === undefined && opts?.skipUnset) continue;
    if (!value || !value.trim()) return `${label} is required`;
  }
  return null;
}

/**
 * "<branchCode>-<periodCode>-<seq>" — one sequence per (branch, period).
 *
 * Design notes (see REFERENCE_ID.md for the full spec):
 *   - Takes the LOWEST free number, so a gap left by a deleted draft is
 *     filled (00001, 00003 exist -> 00002), never a number in use (the
 *     `finding.reference` UNIQUE constraint). Removed findings free their number.
 *   - 5-digit zero-padded suffix: 00001 .. 99999 per branch/period combo.
 *     At an extreme 1000 findings/month per branch this covers ~8 years;
 *     at the NIB's realistic rate (~50/month) it covers ~165 years per
 *     reporting period.  After 99999 the pad naturally grows (the value
 *     is still a valid, sortable, unique string) rather than wrapping.
 *   - Suffix regex anchored to the end so a branch code that coincidentally
 *     contains a "-NNNNN" suffix (e.g. a legacy code) doesn't poison the
 *     numbering.
 */
export function nextFindingReference(db: Database, branch: Branch, period: ReportingPeriod): string {
  const prefix = `${branch.code}-${period.code}`;
  const anchor = `${prefix}-`;
  const taken = new Set<number>();
  // Only numbers held by existing findings are taken. A finding that's gone -
  // deleted by hand (draft, returned, rejected) or removed by reversing an
  // import - frees its number: the next new finding in that branch and
  // period takes it (lowest free number, below). The audit log keeps the
  // removed finding's number and details either way.
  for (const ref of db.findings.map((f) => f.reference)) {
    if (!ref.startsWith(anchor)) continue;
    const suffix = ref.slice(anchor.length);
    const n = parseInt(suffix, 10);
    if (Number.isFinite(n)) taken.add(n);
  }
  let seq = 1;
  while (taken.has(seq)) seq++;
  const width = 5;
  const padded = String(seq).padStart(width, "0");
  return `${anchor}${padded}`;
}

/**
 * Why Head Office (findings.ho-return-rectification alone) can't return this
 * finding's rectification for correction yet - or null when it can. HO acts
 * only AFTER the District Controller, on what District has verified:
 *   - nothing may still be waiting for district verification (every case /
 *     amount the branch recorded is district-verified) - otherwise HO would
 *     be jumping ahead of District on that part;
 *   - and some district-verified rectification must not be closed yet -
 *     that is what HO is returning.
 * Shared by return-rectification/route.ts and the finding page's button.
 */
export function hoReturnBlockedReason(f: Finding): string | null {
  const awaitingDistrict = f.rectifiedCases > f.districtVerifiedCases || f.rectifiedAmount > f.districtVerifiedAmount;
  if (awaitingDistrict) {
    return "Head Office can't return this finding for correction while part of its rectification is still awaiting District verification. Wait for the District Controller to verify it (or return it themselves).";
  }
  const verifiedNotClosed = f.districtVerifiedCases > f.closedCases || f.districtVerifiedAmount > f.closedAmount;
  if (!verifiedNotClosed) {
    return "Head Office can return a rectification only after the District Controller has verified it - there is no District-verified rectification awaiting closure.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Return-for-correction gating helpers (used by return-rectification/route.ts
// on top of the plain RETURNABLE_STATUSES check that route already does):
//
//   1. Separation of duties, scoped to *this* rectification: whoever already
//      verified or closed the currently-outstanding rectification can't also
//      be the one to return it - one person shouldn't be able to sign off on
//      a rectification and then flip to "actually it's wrong" as the same
//      identity. Return is only ever a decision about the rectification
//      itself, so it's blocked by DISTRICT_VERIFY_RECTIFICATION/CLOSE/
//      PARTIAL_CLOSE - never by DISTRICT_APPROVE/HO_APPROVE/BANK_APPROVE,
//      which are the *finding's own* review-stage approvals, an earlier and
//      unrelated decision. Those already block their own stage's Return via
//      each review route's own createdBy self-check plus the DISTRICT_REVIEW/
//      HO_REVIEW status gate - they must never also block *this* gate, or
//      the District Controller who approved a finding at District Review
//      (routinely the same person who later verifies its rectification)
//      would be locked out of returning that rectification entirely, even
//      though they've never touched it. A *different* person holding the
//      same permission still can, same as before.
//   2. Post-transfer: once a finding is sitting at TRANSFERRED, returning it
//      is blocked until the branch has recorded new rectification *after*
//      that transfer - otherwise "return" would just be re-litigating the
//      outstanding balance the transfer already carried forward untouched,
//      with nothing new on record to actually be wrong.
// ---------------------------------------------------------------------------

/**
 * Checked against db.auditLogs, not db.findingTransitions -
 * DISTRICT_VERIFY_RECTIFICATION and PARTIAL_CLOSE never go through
 * transitionFinding() (neither changes finding.status), so they only ever
 * land in the audit log, never the transition history. CLOSE does go
 * through transitionFinding(), which itself calls appendAuditLog() with the
 * same action string - so all three are reliably found here, in one place,
 * regardless of which path recorded them.
 *
 * "Scoped to *this* rectification" (see this section's own doc comment)
 * means exactly that - only a verify/close action recorded *after* the
 * finding's most recent RectificationEntry counts, since that's the entry
 * currently awaiting a District/HO decision. An older verify/close, from
 * before that entry existed, was about a *different*, already-resolved
 * round and must never block returning this new one - without this bound,
 * a District Controller who verified (or closed) an earlier round on a
 * finding would be permanently locked out of ever returning any later
 * round on that same finding, which is exactly what happens the moment a
 * finding transfers and comes back for a second round of rectification
 * (same district, routinely the same one Controller, verifying work that
 * has nothing to do with what they verified before the transfer).
 */
export function userPerformedApprovalOrVerifyAction(db: Database, findingId: string, userId: string): boolean {
  const actions = new Set(["DISTRICT_VERIFY_RECTIFICATION", "CLOSE", "PARTIAL_CLOSE"]);
  const rectifications = db.rectifications.filter((r) => r.findingId === findingId);
  const latestRectificationAt = rectifications.length > 0 ? Math.max(...rectifications.map((r) => new Date(r.createdAt).getTime())) : 0;
  return db.auditLogs.some(
    (a) =>
      a.entityType === "Finding" &&
      a.entityId === findingId &&
      a.userId === userId &&
      actions.has(a.action) &&
      new Date(a.timestamp).getTime() > latestRectificationAt
  );
}

/** True if the finding has never been transferred, or has a RectificationEntry recorded strictly after its most recent transfer. */
export function hasRectificationAfterLastTransfer(db: Database, finding: Finding): boolean {
  const transfers = db.findingTransfers.filter((t) => t.findingId === finding.id);
  if (transfers.length === 0) return true;
  const latestTransferAt = Math.max(...transfers.map((t) => new Date(t.createdAt).getTime()));
  return db.rectifications.some((r) => r.findingId === finding.id && new Date(r.createdAt).getTime() > latestTransferAt);
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
 *
 * Takes `db` (not just `session`) for one reason: PENDING_BANK_APPROVAL
 * isn't gated by a findings.* permission at all - it's a specific
 * per-person assignment (Settings.hoApproval.approverUserIds, see
 * bank-approval/route.ts's own doc comment), so it can't be decided by the
 * has() helper below and is checked directly against the session's userId
 * instead. Without this, an assigned approver's own bank-registered
 * findings awaiting their sign-off never showed up in any work queue.
 */
/**
 * Waiting for the branch to record rectification - what puts a finding in a
 * Branch Manager's queue: sent to / reversed back to the branch, partly
 * rectified, returned for correction, or TRANSFERRED into a new period with
 * cases still to rectify there (a transfer sends every unclosed case back to
 * the branch - see transferFinding()).
 */
export function awaitingBranchRectification(f: Finding): boolean {
  if (["SENT_TO_BRANCH_MANAGER", "REVERSED", "PARTIALLY_RECTIFIED", "RECTIFICATION_RETURNED"].includes(f.status)) return true;
  return f.status === "TRANSFERRED" && (f.rectifiedCases < f.caseCount || f.rectifiedAmount < f.amount);
}

export function queueStatusesForSession(session: SessionData, db: Database): (finding: Finding) => boolean {
  const has = (action: string) => hasPermission(session.permissions, permissionKey("findings", action));
  const matchers: ((f: Finding) => boolean)[] = [];
  if (has("edit") || has("submit")) matchers.push((f) => f.status === "DRAFT" || f.status === "RETURNED");
  if (has("district-review")) matchers.push((f) => f.status === "DISTRICT_REVIEW");
  if (has("ho-review")) matchers.push((f) => f.status === "HO_REVIEW");
  if (session.userId && db.settings.hoApproval.approverUserIds.includes(session.userId)) {
    matchers.push((f) => f.status === "PENDING_BANK_APPROVAL");
  }
  if (has("rectify")) matchers.push(awaitingBranchRectification);
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
  // Never in the queue: rejected findings (final - nothing left to do), and
  // "waiting to be transferred to the next period" is not a queue item of its
  // own (transfer is done from the Reporting Periods lock / the finding page).
  // A finding the branch must still rectify stays in the branch's queue
  // whatever its period.
  return (f) => f.status !== "REJECTED" && matchers.some((matches) => matches(f));
}

/**
 * A finding that should be carried into another period: it still has cases
 * that aren't formally closed, and its current reporting period has ended
 * or is locked. What puts it in the queue of anyone who can transfer (by
 * default the HO Controller).
 */
export function needsTransfer(db: Database, f: Finding, now: number = Date.now()): boolean {
  if (!AUTO_TRANSFERABLE_STATUSES.includes(f.status)) return false;
  if (f.closedCases >= f.caseCount && f.closedAmount >= f.amount) return false;
  const period = db.reportingPeriods.find((p) => p.id === f.periodId);
  if (!period) return false;
  return period.status === "LOCKED" || new Date(period.endsAt).getTime() < now;
}

/**
 * The period a finding was originally reported in: where its first transfer
 * left from, or its current period if it never moved. Reports that must not
 * be affected by transfers (Category Detail by District, Monthly Summary)
 * count every finding here, whole.
 */
export function originalPeriodId(db: Database, f: Finding): string {
  let first: FindingTransfer | undefined;
  for (const t of db.findingTransfers) {
    if (t.findingId === f.id && (!first || t.createdAt < first.createdAt)) first = t;
  }
  return first ? first.fromPeriodId : f.periodId;
}

export interface PerformanceScope {
  branchId?: string;
  districtId?: string;
  periodId?: string;
  // Narrows to one source on top of the active ScoringRule's own source
  // gate (rule.sources) - CaseBasedPerformance/SourcePerformanceSummary's
  // per-source breakdown use this rather than hand-rolling their own
  // candidate filter, so the transfer-case-segmentation fix in
  // findingCasesEligibleInPeriod() applies there too, not just to the
  // headline Performance % figure.
  sourceId?: string;
  // Narrows to multiple source IDs on top of the active ScoringRule's own
  // source gate (rule.sources). When both this AND sourceId are set,
  // sourceIds takes precedence (broader, never narrower than either
  // alone). Used by report template functions' per-template source
  // filters (Settings.reportTemplateSources).
  sourceIds?: string[];
}

/**
 * A finding's residency in one specific period, walking its transfer chain:
 * how many cases/how much amount actually belonged there (see
 * findingCasesEligibleInPeriod()'s doc comment for why "eligible" means
 * "never double-counted"), and - the piece that also drives
 * findingsResidentInPeriod() below - which FindingTransfer row (if any)
 * carried it out of this period. `exitTransfer` is null exactly when the
 * finding is still resident here today (`finding.periodId === periodId`);
 * non-null means this period is now historical for this finding, and
 * `exitTransfer.toPeriodId` is where it went. Returns null if the finding
 * was never resident in this period at all.
 */
function findingResidencyInPeriod(
  db: Database,
  finding: Finding,
  periodId: string
): { eligibleCases: number; eligibleAmount: number; exitTransfer: FindingTransfer | null } | null {
  const transfers = [...db.findingTransfers]
    .filter((t) => t.findingId === finding.id)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  if (transfers.length === 0) {
    return finding.periodId === periodId ? { eligibleCases: finding.caseCount, eligibleAmount: finding.amount, exitTransfer: null } : null;
  }
  // The finding's stays, in order: the origin (arrived with the full
  // caseCount/amount), then one per transfer (arrived with what that hop
  // carried). Each stay is credited what arrived minus what the NEXT
  // transfer carried onward - only the portion that never moved on belongs
  // there (a transferred case must never count as "eligible but never
  // rectified" in the period it left, in either direction). A period can
  // hold several stays when a finding comes back to a period it left
  // (e.g. 2026-09 -> 2026-10 -> 2026-09); they are summed, so every case
  // is counted in exactly one period and period totals add up to the
  // finding's caseCount. exitTransfer is the transfer that ended this
  // period's LAST stay (null = the finding is still here).
  const stays = [
    { periodId: transfers[0].fromPeriodId, cases: finding.caseCount, amount: finding.amount },
    ...transfers.map((t) => ({ periodId: t.toPeriodId, cases: t.casesTransferred, amount: t.amountTransferred })),
  ];
  let eligibleCases = 0;
  let eligibleAmount = 0;
  let lastStay = -1;
  stays.forEach((stay, i) => {
    if (stay.periodId !== periodId) return;
    const leaving = transfers[i];
    eligibleCases += stay.cases - (leaving?.casesTransferred ?? 0);
    eligibleAmount += stay.amount - (leaving?.amountTransferred ?? 0);
    lastStay = i;
  });
  if (lastStay === -1) return null;
  return { eligibleCases, eligibleAmount, exitTransfer: transfers[lastStay] ?? null };
}

/** Thin wrapper over findingResidencyInPeriod() for the one existing caller (computeEligibleCaseCounts) that only ever needed the case count. */
function findingCasesEligibleInPeriod(db: Database, finding: Finding, periodId: string): number | null {
  return findingResidencyInPeriod(db, finding, periodId)?.eligibleCases ?? null;
}

/**
 * Sum of this finding's FindingClosure rows stamped to `periodId`. A case
 * only becomes "rectified" for performance purposes once it's formally
 * CLOSED - not merely self-reported by the Branch Manager, and not merely
 * district-verified either (verification is District's own gate before
 * HO can close it, one step short of closure itself, not a substitute for
 * it). Unlike verification, closure already has its own real ledger with
 * its own periodId stamped per event (FindingClosure.periodId, snapshotted
 * at the moment of closure, same convention as RectificationEntry) - so
 * this is a plain filter-and-sum, no FIFO reconstruction needed the way
 * verification requires.
 */
function closedInPeriod(db: Database, finding: Finding, periodId: string): { cases: number; amount: number } {
  const closures = db.findingClosures.filter((c) => c.findingId === finding.id && c.periodId === periodId);
  return {
    cases: closures.reduce((sum, c) => sum + c.closedCases, 0),
    amount: closures.reduce((sum, c) => sum + c.closedAmount, 0),
  };
}

/**
 * One finding's own slice of one period - what browsing/reporting/exporting
 * *that period* should show for this finding, instead of its live/current
 * aggregate fields. `isCurrentPeriod` false means this period is now
 * historical for this finding (it has since transferred onward to
 * `transferredOutToCode`) - callers should render that entry read-only, not
 * offer the live workflow actions a current-period row would.
 */
export interface FindingPeriodSlice {
  eligibleCases: number;
  eligibleAmount: number;
  closedCases: number;
  closedAmount: number;
  isCurrentPeriod: boolean;
  transferredOutToCode: string | null;
}

function findingSliceInPeriod(db: Database, finding: Finding, periodId: string): FindingPeriodSlice | null {
  const residency = findingResidencyInPeriod(db, finding, periodId);
  if (residency === null) return null;
  const closed = closedInPeriod(db, finding, periodId);
  const destination = residency.exitTransfer ? db.reportingPeriods.find((p) => p.id === residency.exitTransfer!.toPeriodId) : undefined;
  return {
    eligibleCases: residency.eligibleCases,
    eligibleAmount: residency.eligibleAmount,
    closedCases: closed.cases,
    closedAmount: closed.amount,
    isCurrentPeriod: residency.exitTransfer === null,
    transferredOutToCode: destination?.code ?? null,
  };
}

/**
 * Every finding from `candidates` that was ever resident in `periodId` -
 * its current residents (`f.periodId === periodId`, the old behavior)
 * PLUS any finding that has since transferred away, each paired with its
 * own slice of that period (see FindingPeriodSlice). This is what makes a
 * period's finding list/report/export match what computePerformance()
 * already credits it with (master.txt §8: "do not double-count" means
 * "attribute to exactly one period", not "stop showing once it moves on") -
 * without it, a finding that was partially rectified in period A and then
 * transferred to B simply vanishes from A's records the moment it moves,
 * even though real work genuinely happened there.
 *
 * `candidates` should already have every *other* filter applied
 * (district/branch/category/date range/etc.) - this only adds the period
 * test on top, same division of labor as the plain `f.periodId === periodId`
 * filter it replaces.
 */
export function findingsResidentInPeriod(
  db: Database,
  periodId: string,
  candidates: Finding[]
): Array<{ finding: Finding; slice: FindingPeriodSlice }> {
  const out: Array<{ finding: Finding; slice: FindingPeriodSlice }> = [];
  for (const f of candidates) {
    const slice = findingSliceInPeriod(db, f, periodId);
    if (slice) out.push({ finding: f, slice });
  }
  return out;
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
 *
 * Candidates are gated by isHoApproved(), same as findingCaseTotals() -
 * a finding still sitting in DISTRICT_REVIEW/HO_REVIEW/etc. isn't official
 * yet, so it can't be part of the eligible denominator either. Before this
 * gate existed, a branch/district's Performance % would drop the moment a
 * new finding was merely *registered*, before anyone even reviewed it -
 * isHoApproved() already excludes REJECTED, so that check is folded in.
 *
 * The numerator is CLOSED cases/amount, never the Branch Manager's raw
 * self-reported rectifiedCases/rectifiedAmount, and never merely
 * district-*verified* either: a case only counts as rectified once it's
 * formally closed - verification is District's own gate on the way there,
 * one step short of closure, not a substitute for it. Same reasoning as
 * findingCaseTotals()'s own closed-only gate for Total/Rectified Findings -
 * this is that exact same "unless it is closed, never count as rectified"
 * rule, just applied to the eligible-case basis Performance % itself
 * divides. A rectification the manager recorded, even one District has
 * already verified, is still not something the scoring formula can credit
 * until HO (or whoever holds findings.close) has actually closed it -
 * crediting it earlier would let performance improve before the case is
 * truly, finally resolved.
 */
export function computeEligibleCaseCounts(db: Database, scope: PerformanceScope): { totalCases: number; rectifiedCases: number } | null {
  const rule = db.scoringRules.find((r) => r.active);
  if (!rule) return null;

  const candidates = db.findings.filter(
    (f) =>
      rule.categories.includes(f.categoryId) &&
      rule.sources.includes(f.sourceId) &&
      isHoApproved(f) &&
      (!scope.branchId || f.branchId === scope.branchId) &&
      (!scope.districtId || f.districtId === scope.districtId) &&
      (!scope.sourceIds
        ? !scope.sourceId || f.sourceId === scope.sourceId
        : scope.sourceIds.length === 0 || scope.sourceIds.includes(f.sourceId))
  );

  if (!scope.periodId) {
    const totalCases = candidates.reduce((sum, f) => sum + f.caseCount, 0);
    if (totalCases === 0) return null;
    const rectifiedCases = candidates.reduce((sum, f) => sum + f.closedCases, 0);
    return { totalCases, rectifiedCases };
  }

  let totalCases = 0;
  let rectifiedCases = 0;
  for (const f of candidates) {
    const eligibleCases = findingCasesEligibleInPeriod(db, f, scope.periodId);
    if (eligibleCases === null) continue;
    totalCases += eligibleCases;
    rectifiedCases += closedInPeriod(db, f, scope.periodId).cases;
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
 * FindingClosure ledger rows stamped with that periodId (see
 * closedInPeriod()) - not the finding's lifetime `rectifiedCases`
 * (self-reported), `districtVerifiedCases` (verified but not yet closed),
 * or a lifetime `closedCases` total not attributed to any one period - so
 * a case closed before a transfer stays credited to the period it
 * actually happened in, and a destination period only gets credit for
 * work done (and closed) after the case arrived (see
 * findingCasesEligibleInPeriod() above for the matching denominator).
 */
export function computePerformance(db: Database, scope: PerformanceScope): number | null {
  const counts = computeEligibleCaseCounts(db, scope);
  if (!counts) return null;
  return (counts.rectifiedCases / counts.totalCases) * 100;
}
