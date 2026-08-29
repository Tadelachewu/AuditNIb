import { Card, CardHeader } from "@/components/ui/Card";
import { computePerformance, type PerformanceScope } from "@/lib/findings";
import { TrendChart } from "@/components/dashboard/charts/TrendChart";
import type { Database } from "@/types";

/**
 * master.txt §10's "monthly performance trend" - "how is performance
 * changing over time" is a line-chart question (chart-selection rule #1:
 * trend over time -> line, X = time, Y = metric), not a ranking, so this
 * renders a real line rather than a bar per period.
 */
export function MonthlyTrend({ db, scope }: { db: Database; scope: Omit<PerformanceScope, "periodId"> }) {
  const periods = [...db.reportingPeriods].sort((a, b) => a.code.localeCompare(b.code));
  const values = periods.map((p) => computePerformance(db, { ...scope, periodId: p.id }));

  return (
    <Card>
      <CardHeader title="Monthly Performance Trend" description="Rectification performance across reporting periods" />
      <div className="p-4">
        <TrendChart
          labels={periods.map((p) => p.code)}
          series={[{ key: "performance", label: "Performance", color: "#2a78d6", values }]}
          maxValue={100}
          valueSuffix="%"
          emptyText="No performance data yet."
        />
      </div>
    </Card>
  );
}
