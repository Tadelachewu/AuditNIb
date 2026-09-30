import { formatCurrency } from "@/lib/format";
import { findingsResidentInPeriod } from "@/lib/findings";
import type { Database, Finding } from "@/types";

/** Amounts kept per currency - never added across currencies (there are no exchange rates). */
export type CurrencyTotals = Record<string, number>;

export function addCurrency(totals: CurrencyTotals, currency: string, value: number): CurrencyTotals {
  const key = currency || "—";
  totals[key] = (totals[key] ?? 0) + value;
  return totals;
}

export function mergeCurrencyTotals(list: CurrencyTotals[]): CurrencyTotals {
  const out: CurrencyTotals = {};
  for (const t of list) for (const [c, v] of Object.entries(t)) addCurrency(out, c, v);
  return out;
}

/** "ETB 45,000 · USD 500" ("--" when empty). */
export function formatCurrencyTotals(totals: CurrencyTotals): string {
  return formatTotals(new Map(Object.entries(totals)));
}

/** Currency codes present, sorted - e.g. for one CSV column per currency. */
export function currenciesIn(list: CurrencyTotals[]): string[] {
  return [...new Set(list.flatMap((t) => Object.keys(t)))].sort((a, b) => a.localeCompare(b, "en-US"));
}

function formatTotals(totals: Map<string, number>): string {
  if (totals.size === 0) return "--";
  return [...totals.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "en-US"))
    .map(([currency, total]) => `${currency} ${formatCurrency(total)}`)
    .join(" · ");
}

/**
 * Sums a numeric Finding field grouped by currency, formatted for display
 * on a dashboard StatCard. Findings can legitimately be in different
 * currencies (ETB, USD, EUR, GBP - see Settings), so a raw cross-currency
 * sum would be meaningless; this groups instead, e.g. "ETB 45,000 · USD 500".
 */
export function sumAmountByCurrency(findings: Finding[], field: "amount" | "rectifiedAmount" | "closedAmount"): string {
  const totals = new Map<string, number>();
  for (const f of findings) {
    const value = field === "amount" ? f.amount : field === "closedAmount" ? f.closedAmount : f.rectifiedAmount;
    totals.set(f.currency, (totals.get(f.currency) ?? 0) + value);
  }
  return formatTotals(totals);
}

/** Same grouping, but for outstanding = amount - rectifiedAmount per finding. */
export function sumOutstandingByCurrency(findings: Finding[]): string {
  const totals = new Map<string, number>();
  for (const f of findings) {
    totals.set(f.currency, (totals.get(f.currency) ?? 0) + (f.amount - f.rectifiedAmount));
  }
  return formatTotals(totals);
}

/**
 * Period-residency-aware counterpart to sumAmountByCurrency()/
 * sumOutstandingByCurrency() - a finding that was partially rectified in
 * this period and then transferred must have its Total/Resolved/
 * Outstanding Amount split between the period it left and the period it
 * arrived in, not attributed wholesale to just one of them (see
 * findingsResidentInPeriod()'s own doc comment in src/lib/findings.ts).
 * `candidates` should already have every other scope/filter applied, same
 * convention as findingsResidentInPeriod() itself.
 *
 * "eligible" = this period's own slice of the finding's total amount
 * (Total Amount); "closed" = however much of that slice has actually been
 * formally closed (Resolved Amount) - never the self-reported
 * rectifiedAmount, same "unless it's closed, it never counts" rule
 * findingCaseTotalsInPeriod() and computeEligibleCaseCounts() both apply.
 * Outstanding is derived from these two (eligible minus closed) by the
 * caller, same as every other Outstanding figure this session's fix
 * touched, rather than the live amount-minus-self-reported-rectified basis
 * sumOutstandingByCurrency() uses when there's no period to scope by.
 */
export function sumAmountByCurrencyInPeriod(db: Database, periodId: string, candidates: Finding[], field: "eligible" | "closed"): string {
  const totals = new Map<string, number>();
  for (const { finding, slice } of findingsResidentInPeriod(db, periodId, candidates)) {
    const value = field === "eligible" ? slice.eligibleAmount : slice.closedAmount;
    totals.set(finding.currency, (totals.get(finding.currency) ?? 0) + value);
  }
  return formatTotals(totals);
}

/** Outstanding = eligible minus closed, per currency, period-residency-aware - see sumAmountByCurrencyInPeriod()'s own doc comment. */
export function sumOutstandingByCurrencyInPeriod(db: Database, periodId: string, candidates: Finding[]): string {
  const totals = new Map<string, number>();
  for (const { finding, slice } of findingsResidentInPeriod(db, periodId, candidates)) {
    totals.set(finding.currency, (totals.get(finding.currency) ?? 0) + (slice.eligibleAmount - slice.closedAmount));
  }
  return formatTotals(totals);
}
