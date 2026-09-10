import { v4 as uuid } from "uuid";
import { appendAuditLog } from "@/lib/audit";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import type { SessionData } from "@/lib/session";
import { REQUIRABLE_FINDING_FIELDS } from "@/types";
import type { Database, Finding, FindingStatus, FindingTransfer, Branch, ReportingPeriod, RequirableFindingField } from "@/types";

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
// zero outstanding balance left to move (transferFinding()'s own
// outstandingCases/Amount would compute to 0) - still true, but a
// zero-balance transfer is harmless, not broken: it still moves the
// finding's period forward and its FindingTransfer row honestly records
// "nothing was left owing," rather than leaving a rectified-but-not-yet-
// closed finding stranded in a period that's about to lock. RECTIFICATION_
// RETURNED was previously excluded so a pending correction couldn't
// silently move to a new period out from under the return - now included
// on the same "sweep everything not-closed" reasoning; the return itself
// (and its reason) travels with the finding across the transfer just like
// any other in-flight state does.
const AUTO_TRANSFERABLE_STATUSES = ["SENT_TO_BRANCH_MANAGER", "PARTIALLY_RECTIFIED", "RECTIFIED", "RECTIFICATION_RETURNED", "TRANSFERRED"];

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
const HO_APPROVED_OR_LATER = new Set<FindingStatus>([
  "SENT_TO_BRANCH_MANAGER",
  "PARTIALLY_RECTIFIED",
  "RECTIFICATION_RETURNED",
  "RECTIFIED",
  "CLOSED",
  "TRANSFERRED",
]);

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
  rectifiedFindings: number;
  rectifiedCases: number;
} {
  const approved = findings.filter(isHoApproved);
  return {
    totalFindings: approved.length,
    totalCases: approved.reduce((sum, f) => sum + f.caseCount, 0),
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
 * `rectifiedFindings` counts a finding as rectified *for this period* only
 * once every case attributable to this period has actually been closed
 * (slice.closedCases >= slice.eligibleCases, with at least one eligible
 * case) - a finding that transferred out with only some cases closed here
 * isn't "rectified" for this period's own tally, even if it's fully
 * closed today somewhere downstream.
 */
export function findingCaseTotalsInPeriod(
  db: Database,
  periodId: string,
  candidates: Finding[]
): { totalFindings: number; totalCases: number; rectifiedFindings: number; rectifiedCases: number } {
  const resident = findingsResidentInPeriod(db, periodId, candidates.filter(isHoApproved));
  return {
    totalFindings: resident.length,
    totalCases: resident.reduce((sum, r) => sum + r.slice.eligibleCases, 0),
    rectifiedFindings: resident.filter((r) => r.slice.eligibleCases > 0 && r.slice.closedCases >= r.slice.eligibleCases).length,
    rectifiedCases: resident.reduce((sum, r) => sum + r.slice.closedCases, 0),
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
 * a future phase; for now a locked period is a hard stop for everyone) -
 * with one narrow, explicit exception: `editingFindingStatus` lets a
 * caller that's about to edit/delete a finding still sitting in DRAFT pass
 * that status through, and if the period's own draftsAllowedWhileLocked
 * flag is set, the block is lifted for that DRAFT write only. Submitting
 * (moving past DRAFT) never passes this param, so it's never exempted -
 * a draft can be worked on in a locked-but-draftable period, but can't
 * progress until the period is genuinely OPEN.
 */
export function assertPeriodWritable(db: Database, periodId: string, editingFindingStatus?: FindingStatus): string | null {
  const period = db.reportingPeriods.find((p) => p.id === periodId);
  if (!period) return "Reporting period not found";
  if (period.status === "LOCKED") {
    if (editingFindingStatus === "DRAFT" && period.draftsAllowedWhileLocked) return null;
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

/** "<branchCode>-<periodCode>-<seq>", sequence counted per branch+period. */
export function nextFindingReference(db: Database, branch: Branch, period: ReportingPeriod): string {
  const prefix = `${branch.code}-${period.code}`;
  const seq = db.findings.filter((f) => f.reference.startsWith(`${prefix}-`)).length + 1;
  return `${prefix}-${String(seq).padStart(3, "0")}`;
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
export function queueStatusesForSession(session: SessionData, db: Database): (finding: Finding) => boolean {
  const has = (action: string) => hasPermission(session.permissions, permissionKey("findings", action));
  const matchers: ((f: Finding) => boolean)[] = [];
  if (has("edit") || has("submit")) matchers.push((f) => f.status === "DRAFT" || f.status === "RETURNED");
  if (has("district-review")) matchers.push((f) => f.status === "DISTRICT_REVIEW");
  if (has("ho-review")) matchers.push((f) => f.status === "HO_REVIEW");
  if (session.userId && db.settings.hoApproval.approverUserIds.includes(session.userId)) {
    matchers.push((f) => f.status === "PENDING_BANK_APPROVAL");
  }
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
  // Narrows to one source on top of the active ScoringRule's own source
  // gate (rule.sources) - CaseBasedPerformance/SourcePerformanceSummary's
  // per-source breakdown use this rather than hand-rolling their own
  // candidate filter, so the transfer-case-segmentation fix in
  // findingCasesEligibleInPeriod() applies there too, not just to the
  // headline Performance % figure.
  sourceId?: string;
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
  if (transfers[0].fromPeriodId === periodId) {
    // Only the portion that never transferred out belongs to the origin
    // period - casesTransferred/amountTransferred (see transferFinding())
    // is exactly what was still outstanding, and therefore carried
    // forward, at that moment. Crediting the origin period the *full*
    // caseCount/amount here (the previous behavior) would count a
    // transferred case as "eligible but never rectified" against the
    // period it left - i.e. a case transfer would drag down that period's
    // performance for something that isn't a rectification failure there.
    // Performance must never be moved by a transferred case, in either
    // direction, in the period it left.
    return {
      eligibleCases: finding.caseCount - transfers[0].casesTransferred,
      eligibleAmount: finding.amount - transfers[0].amountTransferred,
      exitTransfer: transfers[0],
    };
  }
  const hopIndex = transfers.findIndex((t) => t.toPeriodId === periodId);
  if (hopIndex === -1) return null;
  // Same reasoning for an intermediate hop (a finding transferred more than
  // once): this period is only credited what arrived minus whatever moved
  // on again via the *next* transfer, never the finding's full caseCount/amount.
  const arrivedHop = transfers[hopIndex];
  const nextTransfer = transfers[hopIndex + 1];
  return {
    eligibleCases: arrivedHop.casesTransferred - (nextTransfer?.casesTransferred ?? 0),
    eligibleAmount: arrivedHop.amountTransferred - (nextTransfer?.amountTransferred ?? 0),
    exitTransfer: nextTransfer ?? null,
  };
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
      (!scope.sourceId || f.sourceId === scope.sourceId)
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
