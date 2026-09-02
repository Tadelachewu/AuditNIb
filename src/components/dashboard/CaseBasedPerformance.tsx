import type { Database } from "@/types";
import { computeEligibleCaseCounts, type PerformanceScope } from "@/lib/findings";
import { Card, CardHeader } from "@/components/ui/Card";

function Bar({ label, count, pct, color }: { label: string; count: number | string; pct: number; color: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-slate-600">{label}</span>
        <span className="text-slate-500">
          {count} {typeof count === "number" ? `(${pct.toFixed(0)}%)` : ""}
        </span>
      </div>
      <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

/**
 * Document_3 §14's "Performance Section" - deliberately its own visually
 * distinct Card, separated from the general StatCards grid above it, so
 * "Case-Based Performance" reads as management's headline metric rather
 * than one stat among many. Labeled with whatever category the active
 * ScoringRule actually scores (generalized, same as SourcePerformanceSummary
 * - "Other Case" is just the seeded example, not a hard-coded name).
 *
 * "Total Eligible Cases" comes from computeEligibleCaseCounts() - the same
 * transfer-chain-aware, category-AND-source-gated eligibility the headline
 * Performance % StatCard uses - rather than a hand-rolled category-only
 * filter over raw period-resident findings (that older version silently
 * dropped the ScoringRule's source filter and could disagree with the
 * StatCard next to it). "Rectified Cases" is closed-only (Finding.closedCases),
 * same "iff closed" gate as findingCaseTotals() - a self-reported RECTIFIED
 * status isn't official until a controller closes it out.
 */
export function CaseBasedPerformance({
  db,
  scope,
  openPeriod,
}: {
  db: Database;
  scope: PerformanceScope;
  openPeriod?: { id: string };
}) {
  const activeScoringRule = db.scoringRules.find((r) => r.active);
  const scoredCategoryIds = new Set(activeScoringRule?.categories ?? []);
  const categoryNames = db.categories.filter((c) => scoredCategoryIds.has(c.id)).map((c) => c.name);
  const categoryLabel = categoryNames.length > 0 ? categoryNames.join(" / ") : "Scored Case";

  if (!activeScoringRule) {
    return (
      <Card className="border-blue-100 bg-blue-50/30">
        <CardHeader title="Case-Based Performance" description="Performance section" />
        <p className="p-4 text-sm text-slate-400">No active scoring rule configured yet.</p>
      </Card>
    );
  }

  const counts = openPeriod ? computeEligibleCaseCounts(db, { ...scope, periodId: openPeriod.id }) : null;
  const totalEligible = counts?.totalCases ?? 0;
  // Closed-only, summed over the same eligible-category/source candidates
  // (excluding REJECTED), for findings currently resident in this period -
  // a simpler, non-transfer-chain-walking cousin of computeEligibleCaseCounts
  // since FindingClosure isn't period-ledgered the way RectificationEntry is.
  const closed =
    openPeriod && counts
      ? db.findings
          .filter(
            (f) =>
              activeScoringRule.categories.includes(f.categoryId) &&
              activeScoringRule.sources.includes(f.sourceId) &&
              f.status !== "REJECTED" &&
              f.periodId === openPeriod.id &&
              (!scope.branchId || f.branchId === scope.branchId) &&
              (!scope.districtId || f.districtId === scope.districtId)
          )
          .reduce((sum, f) => sum + f.closedCases, 0)
      : 0;
  const outstanding = totalEligible - closed;
  const closedPct = totalEligible > 0 ? (closed / totalEligible) * 100 : 0;
  const outstandingPct = totalEligible > 0 ? (outstanding / totalEligible) * 100 : 0;

  return (
    <Card className="border-blue-100 bg-blue-50/30">
      <CardHeader title="Case-Based Performance" description={`Current primary performance category: ${categoryLabel}`} />
      <div className="flex flex-col gap-4 p-4">
        <Bar label="Total Eligible Cases" count={openPeriod ? totalEligible : "--"} pct={100} color="#1d4ed8" />
        <Bar label="Rectified Cases (Closed)" count={openPeriod ? closed : "--"} pct={openPeriod ? closedPct : 0} color="#0ca30c" />
        <Bar label="Outstanding" count={openPeriod ? outstanding : "--"} pct={openPeriod ? outstandingPct : 0} color="#ec835a" />
      </div>
    </Card>
  );
}
