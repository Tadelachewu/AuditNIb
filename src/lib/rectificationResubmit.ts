import type { Finding, FindingCase, FindingStatus, FindingTransition, RectificationEntry } from "@/types";

/**
 * Resubmitting a returned rectification (RECTIFICATION_RETURNED) - all of
 * it, or only part: what the manager resubmits goes back to verification,
 * the rest goes back to OUTSTANDING for the branch to work again. Closed
 * cases / amount can't be undone, so they are always kept. Used by the
 * resubmit route and the finding page's "Sent Back for Correction" card.
 */

type Figures = Pick<Finding, "caseCount" | "amount" | "rectifiedCases" | "rectifiedAmount" | "closedCases" | "closedAmount" | "districtVerifiedCases" | "districtVerifiedAmount">;

/**
 * Itemized findings: the rectified cases, oldest rectification first; the
 * first `closedCases` of them are closed (locked) - closures count cases in
 * rectification order - the rest may be kept or released.
 */
export function rectifiedCaseRows(cases: FindingCase[], closedCases: number): { locked: FindingCase[]; open: FindingCase[] } {
  const rectified = cases
    .filter((c) => c.status === "RECTIFIED")
    .sort((a, b) => (a.rectifiedAt ?? "").localeCompare(b.rectifiedAt ?? "") || a.seq - b.seq);
  const n = Math.max(0, Math.min(closedCases, rectified.length));
  return { locked: rectified.slice(0, n), open: rectified.slice(n) };
}

export type ResubmitChoice =
  | { kind: "all" }
  /** Itemized: the rectified (not closed) cases to resubmit. */
  | { kind: "cases"; keepCaseIds: string[] }
  /** Not itemized: how many cases / how much amount to resubmit (closed included). */
  | { kind: "totals"; keepCases: number; keepAmount: number };

export interface ResubmitPlan {
  rectifiedCases: number;
  rectifiedAmount: number;
  districtVerifiedCases: number;
  districtVerifiedAmount: number;
  /** Itemized: case rows that go back to OUTSTANDING. */
  releaseCaseIds: string[];
  status: FindingStatus;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Rectified cases / amount returned for correction and not resubmitted yet
 * (findings.returned_cases / returned_amount - still counted as rectified).
 */
export function returnedPart(f: Pick<Finding, "returnedCases" | "returnedAmount">): { cases: number; amount: number } {
  return { cases: Math.max(f.returnedCases ?? 0, 0), amount: Math.max(f.returnedAmount ?? 0, 0) };
}

/** Something returned for correction and not resubmitted yet (any status). */
export function hasReturned(f: Pick<Finding, "status" | "returnedCases" | "returnedAmount">): boolean {
  const r = returnedPart(f);
  return f.status === "RECTIFICATION_RETURNED" || r.cases > 0 || r.amount > 0;
}

type AwaitingFigures = Pick<Finding, "rectifiedCases" | "rectifiedAmount" | "districtVerifiedCases" | "districtVerifiedAmount" | "returnedCases" | "returnedAmount">;

/** What awaits District: rectified, not returned (that waits for resubmission), not yet verified. */
export function awaitingDistrict(f: AwaitingFigures): { cases: number; amount: number } {
  const r = returnedPart(f);
  return {
    cases: Math.max(f.rectifiedCases - r.cases - f.districtVerifiedCases, 0),
    amount: Math.max(round2(f.rectifiedAmount - r.amount - f.districtVerifiedAmount), 0),
  };
}

/** Anything awaiting District (awaitingDistrict()). */
export function isAwaitingDistrict(f: AwaitingFigures): boolean {
  const a = awaitingDistrict(f);
  return a.cases > 0 || a.amount > 0;
}

/**
 * The status the rectification figures call for: returned while a returned
 * part waits for the manager to resubmit it; otherwise rectified /
 * partially rectified / nothing yet.
 */
export function rectificationStatus(f: Pick<Finding, "caseCount" | "amount" | "rectifiedCases" | "rectifiedAmount" | "returnedCases" | "returnedAmount">): FindingStatus {
  const r = returnedPart(f);
  if (r.cases > 0 || r.amount > 0) return "RECTIFICATION_RETURNED";
  if (f.rectifiedCases >= f.caseCount && f.rectifiedAmount >= f.amount) return "RECTIFIED";
  if (f.rectifiedCases === 0 && f.rectifiedAmount === 0) return "SENT_TO_BRANCH_MANAGER";
  return "PARTIALLY_RECTIFIED";
}

/**
 * Returns part of a rectification for correction (changes `f` and `cases`).
 * "district": what awaited District (rectified, not yet verified).
 * "all": everything not closed, and its verification is cleared.
 * Itemized: the rectified cases after the kept ones (rectification order)
 * are marked returned, and the returned amount is theirs.
 */
export function applyReturn(f: Finding, cases: FindingCase[], mode: "district" | "all"): void {
  if (mode === "all") {
    f.districtVerifiedCases = Math.min(f.districtVerifiedCases, f.closedCases);
    f.districtVerifiedAmount = Math.min(f.districtVerifiedAmount, f.closedAmount);
  }
  const keepCases = Math.max(mode === "all" ? f.closedCases : f.districtVerifiedCases, 0);
  const keepAmount = Math.max(mode === "all" ? f.closedAmount : f.districtVerifiedAmount, 0);
  if (cases.length > 0) {
    const rectified = cases
      .filter((c) => c.status === "RECTIFIED")
      .sort((a, b) => (a.rectifiedAt ?? "").localeCompare(b.rectifiedAt ?? "") || a.seq - b.seq);
    const returned = rectified.slice(Math.min(keepCases, rectified.length));
    for (const c of rectified) c.returned = returned.includes(c);
    f.returnedCases = returned.length;
    f.returnedAmount = round2(returned.reduce((s, c) => s + c.amount, 0));
    return;
  }
  f.returnedCases = Math.max(f.rectifiedCases - keepCases, 0);
  f.returnedAmount = Math.max(round2(f.rectifiedAmount - keepAmount), 0);
}

/**
 * What the branch recorded after the latest return (rectifications newer than
 * the last RETURN_RECTIFICATION) - new work, so it is always resubmitted.
 */
export function recordedSinceReturn(
  findingId: string,
  transitions: FindingTransition[],
  rectifications: RectificationEntry[],
  _cases: FindingCase[] = []
): { cases: number; amount: number; caseIds: string[] } {
  const lastReturn = transitions
    .filter((t) => t.findingId === findingId && t.action === "RETURN_RECTIFICATION")
    .reduce<string>((latest, t) => (t.createdAt > latest ? t.createdAt : latest), "");
  if (!lastReturn) return { cases: 0, amount: 0, caseIds: [] };
  const since = rectifications.filter((r) => r.findingId === findingId && r.createdAt > lastReturn);
  return {
    cases: since.reduce((s, r) => s + r.rectifiedCases, 0),
    amount: round2(since.reduce((s, r) => s + r.rectifiedAmount, 0)),
    caseIds: since.flatMap((r) => r.caseIds ?? []),
  };
}

/** The finding's figures after resubmitting `choice`, or the problem with it. */
export function planResubmit(
  f: Figures,
  cases: FindingCase[],
  choice: ResubmitChoice,
  /** Recorded since the return (recordedSinceReturn()): always resubmitted. */
  since: { cases: number; amount: number; caseIds: string[] } = { cases: 0, amount: 0, caseIds: [] }
): { ok: true; plan: ResubmitPlan } | { ok: false; problem: string } {
  let rectifiedCases = f.rectifiedCases;
  let rectifiedAmount = f.rectifiedAmount;
  let releaseCaseIds: string[] = [];

  if (choice.kind === "cases") {
    if (cases.length === 0) return { ok: false, problem: "This finding isn't itemized - give the number of cases and the amount instead" };
    const { open } = rectifiedCaseRows(cases, f.closedCases);
    const openIds = new Set(open.map((c) => c.id));
    const keep = new Set(choice.keepCaseIds);
    if ([...keep].some((id) => !openIds.has(id))) return { ok: false, problem: "Only rectified cases that aren't closed can be chosen" };
    const recordedNew = new Set(since.caseIds);
    const released = open.filter((c) => !keep.has(c.id) && !recordedNew.has(c.id));
    releaseCaseIds = released.map((c) => c.id);
    rectifiedCases = f.rectifiedCases - released.length;
    rectifiedAmount = round2(f.rectifiedAmount - released.reduce((s, c) => s + c.amount, 0));
  } else if (choice.kind === "totals") {
    if (cases.length > 0) return { ok: false, problem: "This finding is itemized - choose the cases to resubmit" };
    const { keepCases, keepAmount } = choice;
    const minCases = Math.min(f.closedCases + since.cases, f.rectifiedCases);
    const minAmount = Math.min(round2(f.closedAmount + since.amount), round2(f.rectifiedAmount));
    if (!Number.isInteger(keepCases) || keepCases < minCases || keepCases > f.rectifiedCases) {
      return { ok: false, problem: `Cases to resubmit must be between ${minCases} (closed or recorded since the return) and ${f.rectifiedCases}` };
    }
    if (!Number.isFinite(keepAmount) || round2(keepAmount) < minAmount || round2(keepAmount) > round2(f.rectifiedAmount)) {
      return { ok: false, problem: `The amount to resubmit must be between ${minAmount} (closed or recorded since the return) and ${f.rectifiedAmount}` };
    }
    rectifiedCases = keepCases;
    rectifiedAmount = round2(keepAmount);
  }

  // Verification never exceeds what's still rectified.
  const districtVerifiedCases = Math.min(f.districtVerifiedCases, rectifiedCases);
  const districtVerifiedAmount = Math.min(f.districtVerifiedAmount, rectifiedAmount);
  const status: FindingStatus =
    rectifiedCases >= f.caseCount && rectifiedAmount >= f.amount
      ? "RECTIFIED"
      : rectifiedCases === 0 && rectifiedAmount === 0
        ? "SENT_TO_BRANCH_MANAGER"
        : "PARTIALLY_RECTIFIED";
  return { ok: true, plan: { rectifiedCases, rectifiedAmount, districtVerifiedCases, districtVerifiedAmount, releaseCaseIds, status } };
}
