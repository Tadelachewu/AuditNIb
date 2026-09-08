import { Card, CardHeader } from "@/components/ui/Card";
import { findingCaseTotalsInPeriod, computePerformance, computeEligibleCaseCounts, type PerformanceScope } from "@/lib/findings";
import { TrendChart } from "@/components/dashboard/charts/TrendChart";
import type { Database } from "@/types";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * master.txt §10's "monthly performance trend" - merges the case-volume
 * trend (Total Cases / Rectified, left axis) with the scoring formula's
 * own Performance % (right axis, dashed, 0-100 fixed scale) into one
 * chart rather than two separate widgets, since "is performance improving
 * because volume dropped, or because more got rectified" is a single
 * question that needs both scales side by side to answer.
 *
 * Total Eligible Cases / Rectified Eligible Cases are added alongside the
 * existing Total Cases/Rectified pair, not in place of them - both pairs
 * are closed-only now (unless it's closed, never count as rectified), but
 * the existing pair is every-category (findingCaseTotals(), same
 * definition the StatCards row above uses) while these two are
 * computeEligibleCaseCounts()'s own numbers: the officially scored
 * category only - the exact same basis Performance % itself divides.
 * Showing both pairs side by side is
 * what makes "why did performance move" answerable from this one chart:
 * a widening gap between Total Cases and Total Eligible Cases means
 * volume grew somewhere Performance % doesn't even count, not that the
 * score itself is understating anything.
 */
export function MonthlyTrend({ db, scope }: { db: Database; scope: Omit<PerformanceScope, "periodId"> }) {
  const periods = [...db.reportingPeriods].sort((a, b) => a.year - b.year || a.month - b.month);
  const scopedFindings = db.findings.filter(
    (f) => (!scope.branchId || f.branchId === scope.branchId) && (!scope.districtId || f.districtId === scope.districtId)
  );

  // Period-residency-aware (see findingCaseTotalsInPeriod()'s doc comment
  // in src/lib/findings.ts), not a raw f.periodId === p.id filter - a
  // finding partially rectified in one month and transferred to the next
  // would otherwise vanish from the month it actually left (0 cases shown
  // there) and dump its full lifetime caseCount into the month it arrived
  // in (overcounting there), which is exactly the kind of month-to-month
  // spike/dip this trend chart exists to show honestly.
  const totals = periods.map((p) => findingCaseTotalsInPeriod(db, p.id, scopedFindings));
  const performance = periods.map((p) => computePerformance(db, { ...scope, periodId: p.id }));
  const eligible = periods.map((p) => computeEligibleCaseCounts(db, { ...scope, periodId: p.id }));

  return (
    <Card>
      <CardHeader
        title="Monthly Performance vs Case Volume"
        description="Comparing total cases, rectified cases, eligible-case totals, and performance percentage"
      />
      <div className="p-4">
        <TrendChart
          labels={periods.map((p) => MONTH_NAMES[p.month - 1])}
          series={[
            { key: "total", label: "Total Cases", color: "#27231d", values: totals.map((t) => t.totalCases) },
            { key: "rectified", label: "Rectified", color: "#0ca30c", values: totals.map((t) => t.rectifiedCases) },
            { key: "eligibleTotal", label: "Total Eligible Cases", color: "#1d4ed8", values: eligible.map((e) => e?.totalCases ?? null) },
            {
              key: "eligibleRectified",
              label: "Rectified Eligible Cases",
              color: "#0ea5a5",
              values: eligible.map((e) => e?.rectifiedCases ?? null),
            },
            { key: "performance", label: "Performance %", color: "#fab219", axis: "right", dashed: true, values: performance },
          ]}
          rightMaxValue={100}
          rightValueSuffix="%"
          legendPosition="bottom"
          emptyText="No findings data yet."
        />
      </div>
    </Card>
  );
}
