import { Card, CardHeader } from "@/components/ui/Card";
import { findingCaseTotals, computePerformance, type PerformanceScope } from "@/lib/findings";
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
 */
export function MonthlyTrend({ db, scope }: { db: Database; scope: Omit<PerformanceScope, "periodId"> }) {
  const periods = [...db.reportingPeriods].sort((a, b) => a.year - b.year || a.month - b.month);
  const scopedFindings = db.findings.filter(
    (f) => (!scope.branchId || f.branchId === scope.branchId) && (!scope.districtId || f.districtId === scope.districtId)
  );

  const totals = periods.map((p) => findingCaseTotals(scopedFindings.filter((f) => f.periodId === p.id)));
  const performance = periods.map((p) => computePerformance(db, { ...scope, periodId: p.id }));

  return (
    <Card>
      <CardHeader title="Monthly Performance vs Case Volume" description="Comparing total cases, rectified cases, and performance percentage" />
      <div className="p-4">
        <TrendChart
          labels={periods.map((p) => MONTH_NAMES[p.month - 1])}
          series={[
            { key: "total", label: "Total Cases", color: "#27231d", values: totals.map((t) => t.totalCases) },
            { key: "rectified", label: "Rectified", color: "#0ca30c", values: totals.map((t) => t.rectifiedCases) },
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
