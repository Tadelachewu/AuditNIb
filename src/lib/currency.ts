import { formatNumber } from "@/lib/format";
import type { Finding } from "@/types";

/**
 * Sums a numeric Finding field grouped by currency, formatted for display
 * on a dashboard StatCard. Findings can legitimately be in different
 * currencies (ETB, USD, EUR, GBP - see Settings), so a raw cross-currency
 * sum would be meaningless; this groups instead, e.g. "ETB 45,000 · USD 500".
 */
export function sumAmountByCurrency(findings: Finding[], field: "amount" | "rectifiedAmount"): string {
  const totals = new Map<string, number>();
  for (const f of findings) {
    const value = field === "amount" ? f.amount : f.rectifiedAmount;
    totals.set(f.currency, (totals.get(f.currency) ?? 0) + value);
  }
  if (totals.size === 0) return "--";
  return [...totals.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "en-US"))
    .map(([currency, total]) => `${currency} ${formatNumber(total)}`)
    .join(" · ");
}

/** Same grouping, but for outstanding = amount - rectifiedAmount per finding. */
export function sumOutstandingByCurrency(findings: Finding[]): string {
  const totals = new Map<string, number>();
  for (const f of findings) {
    totals.set(f.currency, (totals.get(f.currency) ?? 0) + (f.amount - f.rectifiedAmount));
  }
  if (totals.size === 0) return "--";
  return [...totals.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "en-US"))
    .map(([currency, total]) => `${currency} ${formatNumber(total)}`)
    .join(" · ");
}
