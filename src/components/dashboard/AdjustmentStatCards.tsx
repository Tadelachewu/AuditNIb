import Link from "next/link";
import { StatCard } from "@/components/ui/Card";
import { DASHBOARD_ICONS as ICON } from "@/lib/dashboardIcons";
import { formatCurrency } from "@/lib/format";
import type { CurrencyTotals } from "@/lib/currency";
import { adjustmentDashboardTotals } from "@/lib/adjustments/dashboard";
import { ADJUSTMENT_STATUS_LABELS } from "@/lib/adjustments/types";
import type { SessionData } from "@/lib/session";
import type { Database, Finding } from "@/types";

/** "ETB +2,000.00 · USD -50.00" - signed, per currency (never added across currencies). */
function signedTotals(totals: CurrencyTotals): string {
  const entries = Object.entries(totals).filter(([, v]) => v !== 0);
  if (entries.length === 0) return "no amount change";
  return entries
    .sort((a, b) => a[0].localeCompare(b[0], "en-US"))
    .map(([currency, v]) => `${currency} ${v > 0 ? "+" : "-"}${formatCurrency(Math.abs(v))}`)
    .join(" · ");
}

const cases = (n: number) => `+${n} case${n === 1 ? "" : "s"}`;

/**
 * The two revolving-finding cards every dashboard shows (docs/revolving-findings.md):
 * Adjustments Pending (headline: the ones waiting on this user - their review
 * step or their returned ones; total in review below) and Adjustment Diff
 * (approved, reported in the selected period). `findings` = the dashboard's
 * scoped, filtered findings.
 */
export function AdjustmentStatCards({
  user,
  db,
  findings,
  periodId,
  periodLabel,
  hasPeriodScope,
}: {
  user: SessionData;
  db: Database;
  findings: Finding[];
  /** undefined = all periods. */
  periodId: string | undefined;
  periodLabel: string;
  hasPeriodScope: boolean;
}) {
  const { pending, awaitingYou, diff } = adjustmentDashboardTotals(db, findings, periodId, user);
  const steps = (Object.entries(pending.byStep) as [keyof typeof pending.byStep, number][]).filter(([, n]) => n > 0);

  return (
    <>
      <StatCard
        icon={ICON.adjustmentsPending}
        label="Adjustments Awaiting You"
        value={awaitingYou.total}
        hint={`${pending.count} in review in total${pending.count > 0 ? ` · ${cases(pending.addedCases)} · ${signedTotals(pending.amountChange)}` : ""}`}
        detail={
          awaitingYou.total > 0 || pending.count > 0 ? (
            <ul>
              <li>To review (your step): {awaitingYou.review}</li>
              <li>Returned to you to correct: {awaitingYou.returned}</li>
              {steps.map(([step, n]) => (
                <li key={step}>
                  All at {ADJUSTMENT_STATUS_LABELS[step]}: {n}
                </li>
              ))}
              <li>
                <Link href="/findings?queue=1" className="font-medium text-blue-700 hover:underline">
                  Open in Show My Queue
                </Link>
              </li>
            </ul>
          ) : undefined
        }
      />
      <StatCard
        icon={ICON.adjustmentDiff}
        label="Adjustment Diff"
        value={hasPeriodScope ? cases(diff.addedCases) : "--"}
        hint={hasPeriodScope ? `${signedTotals(diff.amountChange)} · ${periodLabel}` : "No open period"}
        detail={
          hasPeriodScope && diff.count > 0 ? (
            <ul>
              <li>
                {diff.count} approved adjustment{diff.count === 1 ? "" : "s"}, reported in {periodLabel}
              </li>
              <li>Cases added: {diff.addedCases}</li>
              <li>Increases: {signedTotals(diff.increase)}</li>
              <li>Decreases: {signedTotals(diff.decrease)}</li>
              <li>Net: {signedTotals(diff.amountChange)}</li>
            </ul>
          ) : undefined
        }
      />
    </>
  );
}
