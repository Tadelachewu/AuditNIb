import { matchesListValue } from "@/lib/dashboardFilters";
import { AUTO_TRANSFERABLE_STATUSES } from "@/lib/findings";
import { isFindingInScope } from "@/lib/findings-scope";
import { currentPeriod } from "@/lib/periods";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import type { SessionData } from "@/lib/session";
import type { Database, Finding, FindingCase } from "@/types";
import {
  OPEN_ADJUSTMENT_STATUSES,
  type AdjustmentConfig,
  type AdjustmentReviewStep,
  type AdjustmentStatus,
  type CaseAmountChange,
  type FindingAdjustment,
} from "./types";

/**
 * Pure rules of revolving-finding adjustments (docs/revolving-findings.md):
 * eligibility, validation of the change, routing and who may act. No
 * storage and no side effects. Rule numbers (R1...) refer to that document.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const has = (session: SessionData, action: string) => hasPermission(session.permissions, permissionKey("findings", action));

/** R1: the finding's operation area is listed (case- and space-insensitive). */
export function isRevolvingArea(config: Pick<AdjustmentConfig, "revolvingOperationAreas">, operationArea: string): boolean {
  return config.revolvingOperationAreas.some((area) => area.trim() && matchesListValue(area, operationArea));
}

/** R2: with the branch and not fully closed. */
export function isOutstanding(f: Finding): boolean {
  return AUTO_TRANSFERABLE_STATUSES.includes(f.status) && (f.closedCases < f.caseCount || f.closedAmount < f.amount);
}

/** The finding's open adjustment (draft, in review or returned) - at most one (R14). */
export function openAdjustmentOf(db: Pick<Database, "findingAdjustments">, findingId: string): FindingAdjustment | undefined {
  return (db.findingAdjustments ?? []).find((a) => a.findingId === findingId && OPEN_ADJUSTMENT_STATUSES.includes(a.status));
}

export function caseRowsOf(db: Pick<Database, "findingCases">, findingId: string): FindingCase[] {
  return db.findingCases.filter((c) => c.findingId === findingId).sort((a, b) => a.seq - b.seq);
}

/** R8: may this user request adjustments on this finding (permission, scope, same registrant level)? */
export function requesterProblem(session: SessionData, f: Finding): string | null {
  if (!has(session, "create") || !has(session, "submit")) return "Only users who can register and submit findings can adjust them";
  if (!isFindingInScope(session, f)) return "This finding is outside your organizational scope";
  const bankFinding = Boolean(f.registeredByBankScope);
  if (bankFinding && session.orgScope !== "BANK") return "This finding was registered bank-wide - only bank-wide users can adjust it";
  if (!bankFinding && session.orgScope === "BANK") return "This finding was registered by its branch / district - only branch or district users can adjust it";
  return null;
}

/**
 * Why a NEW adjustment can't be started on this finding (null = it can):
 * R1, R2 (current period, outstanding), R8, R14. Submitting also needs the
 * submission window (submitProblem()).
 */
export function eligibilityProblem(db: Database, config: AdjustmentConfig, session: SessionData, f: Finding, now = Date.now()): string | null {
  if (!isRevolvingArea(config, f.operationArea)) return `Adjustments aren't enabled for the operation area "${f.operationArea || "(none)"}" (Settings -> Revolving Findings)`;
  const current = currentPeriod(db.reportingPeriods, now);
  if (!current || f.periodId !== current.id) {
    return `Only findings in the current period${current ? ` (${current.code})` : ""} can be adjusted - transfer it there first`;
  }
  if (!isOutstanding(f)) return "Only an outstanding finding (with the branch, not fully closed) can be adjusted";
  const requester = requesterProblem(session, f);
  if (requester) return requester;
  if (openAdjustmentOf(db, f.id)) return "This finding already has an adjustment in progress - finish or withdraw it first";
  return null;
}

/** R10: submitting needs the current period open for submission (not locked, inside the submission window). */
export function submitProblem(db: Database, periodId: string, now = Date.now()): string | null {
  const period = db.reportingPeriods.find((p) => p.id === periodId);
  if (!period) return "Reporting period not found";
  if (period.status === "LOCKED") return `${period.code} is locked - save the adjustment as a draft and submit once it's open`;
  if (now < new Date(period.submissionStartsAt).getTime() || now > new Date(period.submissionEndsAt).getTime()) {
    return `${period.code}'s submission window isn't open - save the adjustment as a draft and submit while it's open`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The change itself

export interface AdjustmentInput {
  addedCases: number;
  /** Non-itemized findings: the amount change (+/-). Ignored for itemized findings. */
  amountChange?: number;
  /** Itemized findings: amounts of the added cases (one per added case). */
  newCaseAmounts?: number[];
  /** Itemized findings: new amounts for existing outstanding cases. */
  caseAmountChanges?: { caseId: string; to: number }[];
  reason: string;
}

export interface ResolvedChange {
  addedCases: number;
  amountChange: number;
  newCaseAmounts: number[];
  caseAmountChanges: CaseAmountChange[];
  /** The finding's figures after it is applied. */
  newCaseCount: number;
  newAmount: number;
}

/**
 * R3, R5, R6, R7: validates a change against the finding AS IT IS NOW and
 * resolves it (itemized: the amount change is derived from the cases).
 * Returns the resolved change, or the problem.
 */
export function resolveChange(db: Database, f: Finding, input: AdjustmentInput): { ok: true; change: ResolvedChange } | { ok: false; problem: string } {
  const fail = (problem: string) => ({ ok: false as const, problem });
  if (!Number.isInteger(input.addedCases) || input.addedCases < 0) return fail("Cases can only be added (a whole number of 0 or more)");
  if ((input.reason ?? "").trim().length < 5) return fail("A reason of at least 5 characters is required");

  const rows = caseRowsOf(db, f.id);
  const itemized = rows.length > 0;
  let amountChange: number;
  let newCaseAmounts: number[] = [];
  let caseAmountChanges: CaseAmountChange[] = [];

  if (itemized) {
    newCaseAmounts = (input.newCaseAmounts ?? []).map(round2);
    if (newCaseAmounts.length !== input.addedCases) return fail("Enter an amount for each added case");
    if (newCaseAmounts.some((a) => !(a > 0))) return fail("Each added case needs an amount greater than 0");
    const byId = new Map(rows.map((c) => [c.id, c]));
    const seen = new Set<string>();
    for (const ch of input.caseAmountChanges ?? []) {
      const row = byId.get(ch.caseId);
      if (!row) return fail("A changed case doesn't belong to this finding");
      if (seen.has(row.id)) return fail(`Case ${row.seq} is changed twice`);
      seen.add(row.id);
      if (row.status !== "OUTSTANDING") return fail(`Case ${row.seq} is already rectified - only outstanding cases can change`);
      const to = round2(ch.to);
      if (!(to > 0)) return fail(`Case ${row.seq} needs an amount greater than 0`);
      if (to !== row.amount) caseAmountChanges.push({ caseId: row.id, seq: row.seq, from: row.amount, to });
    }
    caseAmountChanges = caseAmountChanges.sort((a, b) => a.seq - b.seq);
    amountChange = round2(newCaseAmounts.reduce((s, a) => s + a, 0) + caseAmountChanges.reduce((s, c) => s + (c.to - c.from), 0));
  } else {
    amountChange = round2(Number(input.amountChange ?? 0));
    if (!Number.isFinite(amountChange)) return fail("The amount change must be a number");
  }

  if (input.addedCases === 0 && amountChange === 0) return fail("Nothing to change - add cases and/or change the amount");

  const newCaseCount = f.caseCount + input.addedCases;
  const newAmount = round2(f.amount + amountChange);
  // R5: never below what's rectified (awaiting close or closed). As in the
  // rectify route, unrectified cases and an unrectified amount go together:
  // while a case is unrectified some amount must stay unrectified, and an
  // amount can't be left over with no case to carry it.
  const rectifiedFloor = round2(Math.max(f.rectifiedAmount, f.closedAmount));
  const rectifiedCases = Math.max(f.rectifiedCases, f.closedCases);
  if (newAmount < rectifiedFloor) return fail(`The amount can't go below what's already rectified (${rectifiedFloor})`);
  const openCases = newCaseCount - rectifiedCases;
  const openAmount = round2(newAmount - rectifiedFloor);
  if (openCases > 0 && !(openAmount > 0)) return fail("While cases are outstanding, the outstanding amount must stay above zero");
  if (openCases <= 0 && openAmount > 0) return fail("Every case is already rectified - add a case to carry the extra amount");
  return { ok: true, change: { addedCases: input.addedCases, amountChange, newCaseAmounts, caseAmountChanges, newCaseCount, newAmount } };
}

// ---------------------------------------------------------------------------
// Routing and who acts (R11, R12)

/** Where a submitted adjustment goes first - the same path as a registration from that requester. */
export function firstStep(db: Pick<Database, "settings">, requesterScope: FindingAdjustment["requesterScope"]): AdjustmentStatus {
  if (requesterScope === "BANK") return db.settings.hoApproval.required ? "PENDING_BANK_APPROVAL" : "APPROVED";
  return "DISTRICT_REVIEW";
}

/** After an approval at `step`. */
export function nextStep(step: AdjustmentReviewStep): AdjustmentStatus {
  return step === "DISTRICT_REVIEW" ? "HO_REVIEW" : "APPROVED";
}

export function isReviewStep(status: AdjustmentStatus): status is AdjustmentReviewStep {
  return status === "DISTRICT_REVIEW" || status === "HO_REVIEW" || status === "PENDING_BANK_APPROVAL";
}

/** Why this user can't decide this adjustment at its current step (null = they can). */
export function reviewerProblem(db: Database, session: SessionData, adj: FindingAdjustment, f: Finding): string | null {
  if (!isReviewStep(adj.status)) return "This adjustment isn't awaiting a review";
  if (adj.requestedBy === session.userId) return "You can't review an adjustment you requested";
  if (!isFindingInScope(session, f)) return "This finding is outside your organizational scope";
  if (adj.status === "DISTRICT_REVIEW" && !has(session, "district-review")) return "Only a District reviewer can decide at this step";
  if (adj.status === "HO_REVIEW" && !has(session, "ho-review")) return "Only an HO reviewer can decide at this step";
  if (adj.status === "PENDING_BANK_APPROVAL") {
    if (!has(session, "bank-approval") || !db.settings.hoApproval.approverUserIds.includes(session.userId ?? "")) {
      return "Only an assigned bank-wide approver can decide at this step";
    }
  }
  return null;
}

/**
 * R13: the requester may still edit / withdraw it - a draft, a returned one,
 * or one in its first review step before any reviewer acted.
 */
export function isEditableByRequester(adj: FindingAdjustment): boolean {
  if (adj.status === "DRAFT" || adj.status === "RETURNED") return true;
  if (adj.status !== "DISTRICT_REVIEW" && adj.status !== "PENDING_BANK_APPROVAL") return false;
  const last = adj.decisions[adj.decisions.length - 1];
  return !last || last.decision === "SUBMIT" || last.decision === "EDIT";
}

/** Status of a Rectified / Partially Rectified finding after its figures changed. */
export function rectificationStatusAfter(f: Pick<Finding, "status" | "rectifiedCases" | "rectifiedAmount">, newCaseCount: number, newAmount: number): Finding["status"] {
  if (f.status !== "RECTIFIED" && f.status !== "PARTIALLY_RECTIFIED") return f.status;
  return f.rectifiedCases >= newCaseCount && f.rectifiedAmount >= newAmount ? "RECTIFIED" : "PARTIALLY_RECTIFIED";
}
