import { addCurrency, type CurrencyTotals } from "@/lib/currency";
import type { SessionData } from "@/lib/session";
import type { Database, Finding } from "@/types";
import { reviewerProblem } from "./rules";
import type { AdjustmentReviewStep } from "./types";

/**
 * Dashboard figures of revolving-finding adjustments (docs/revolving-findings.md §4):
 *  - pending: adjustments in review now (any period - "what needs a decision");
 *  - awaitingYou: of those, the ones THIS user must act on - at a review step
 *    they can decide (never their own, same check as the review API), plus
 *    their own returned ones to correct;
 *  - diff: approved adjustments reported in the period (the period they were
 *    submitted in - R16), or in every period when `periodId` is undefined.
 * Over the dashboard's own findings (already narrowed to its org scope and filters).
 */

export interface AdjustmentDashboardTotals {
  pending: {
    count: number;
    addedCases: number;
    amountChange: CurrencyTotals;
    byStep: Record<AdjustmentReviewStep, number>;
  };
  awaitingYou: { review: number; returned: number; total: number };
  diff: {
    count: number;
    addedCases: number;
    amountChange: CurrencyTotals;
    increase: CurrencyTotals;
    decrease: CurrencyTotals;
  };
}

const IN_REVIEW: readonly string[] = ["DISTRICT_REVIEW", "HO_REVIEW", "PENDING_BANK_APPROVAL"];

export function adjustmentDashboardTotals(db: Database, findings: Finding[], periodId: string | undefined, session?: SessionData): AdjustmentDashboardTotals {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const totals: AdjustmentDashboardTotals = {
    pending: { count: 0, addedCases: 0, amountChange: {}, byStep: { DISTRICT_REVIEW: 0, HO_REVIEW: 0, PENDING_BANK_APPROVAL: 0 } },
    awaitingYou: { review: 0, returned: 0, total: 0 },
    diff: { count: 0, addedCases: 0, amountChange: {}, increase: {}, decrease: {} },
  };
  for (const a of db.findingAdjustments ?? []) {
    const f = byId.get(a.findingId);
    if (!f) continue;
    if (IN_REVIEW.includes(a.status)) {
      totals.pending.count += 1;
      totals.pending.addedCases += a.addedCases;
      addCurrency(totals.pending.amountChange, f.currency, a.amountChange);
      totals.pending.byStep[a.status as AdjustmentReviewStep] += 1;
      if (session && reviewerProblem(db, session, a, f) === null) totals.awaitingYou.review += 1;
    } else if (a.status === "RETURNED") {
      if (session && a.requestedBy === session.userId) totals.awaitingYou.returned += 1;
    } else if (a.status === "APPROVED" && (periodId === undefined || a.periodId === periodId)) {
      totals.diff.count += 1;
      totals.diff.addedCases += a.addedCases;
      addCurrency(totals.diff.amountChange, f.currency, a.amountChange);
      if (a.amountChange > 0) addCurrency(totals.diff.increase, f.currency, a.amountChange);
      if (a.amountChange < 0) addCurrency(totals.diff.decrease, f.currency, a.amountChange);
    }
  }
  totals.awaitingYou.total = totals.awaitingYou.review + totals.awaitingYou.returned;
  return totals;
}
