import type { Database, Source } from "@/types";
import { computeEligibleCaseCounts, type PerformanceScope } from "@/lib/findings";
import { Card, CardHeader } from "@/components/ui/Card";

/**
 * Document_3 §9's "IC + IA Performance": per-source eligible-case
 * breakdown (Total/Rectified/Outstanding "Other Cases", i.e. whatever the
 * active ScoringRule currently scores - not hard-coded "Other Case").
 * Named generically because the two sources in question are whatever's
 * active in Settings, not hard-coded "Internal Control"/"Internal Audit" -
 * those just happen to be the seeded names.
 *
 * Each source's Total/Rectified comes straight from
 * computeEligibleCaseCounts(db, { ...scope, sourceId: s.id, periodId }) -
 * the exact same function computePerformance() itself uses (narrowed to
 * one source at a time via PerformanceScope.sourceId), rather than a
 * hand-rolled candidate filter - so this widget can never disagree with
 * the headline Performance % StatCard, and automatically inherits that
 * function's transfer-case segmentation (findingCasesEligibleInPeriod(),
 * in src/lib/findings.ts): a case transferred OUT of this period is
 * credited only for the portion that never left, never the finding's full
 * caseCount. A source the active rule doesn't include at all returns null
 * (0 eligible cases) regardless of category, same as computeEligibleCaseCounts
 * itself does for a non-matching source. Combined Performance % is derived
 * from this same Total/Rectified pair, not a separately-computed figure,
 * so it can never show a percentage that doesn't match the numbers right
 * above it.
 */
export function SourcePerformanceSummary({
  db,
  sources,
  scope,
  openPeriod,
  allPeriods = false,
}: {
  db: Database;
  sources: Source[];
  scope: PerformanceScope;
  openPeriod?: { id: string };
  allPeriods?: boolean;
}) {
  const activeScoringRule = db.scoringRules.find((r) => r.active);
  const scoredCategoryIds = new Set(activeScoringRule?.categories ?? []);
  const categoryNames = db.categories.filter((c) => scoredCategoryIds.has(c.id)).map((c) => c.name);
  const categoryLabel = categoryNames.length > 0 ? categoryNames.join(" / ") : "Scored";
  const hasScope = allPeriods || Boolean(openPeriod);

  const perSource = sources.map((s) => {
    const counts = hasScope
      ? computeEligibleCaseCounts(db, { ...scope, sourceId: s.id, periodId: allPeriods ? undefined : openPeriod?.id })
      : null;
    const total = counts?.totalCases ?? 0;
    const rectified = counts?.rectifiedCases ?? 0;
    return { source: s, total, rectified, outstanding: total - rectified };
  });

  const combinedTotal = perSource.reduce((sum, r) => sum + r.total, 0);
  const combinedRectified = perSource.reduce((sum, r) => sum + r.rectified, 0);
  const combinedOutstanding = combinedTotal - combinedRectified;
  const combinedPerformance = hasScope && combinedTotal > 0 ? (combinedRectified / combinedTotal) * 100 : null;

  if (sources.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader title="IC + IA Performance" description={`Eligible ${categoryLabel} cases by source, current period`} />
      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
        {perSource.map(({ source: s, total, rectified, outstanding }) => (
          <div key={s.id} className="rounded-md border border-slate-200 p-3">
            <p className="text-sm font-semibold text-slate-900">{s.name}</p>
            <dl className="mt-2 space-y-1 text-xs">
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Total {categoryLabel} Cases</dt>
                <dd className="font-medium text-slate-900">{hasScope ? total : "--"}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Rectified</dt>
                <dd className="font-medium text-slate-900">{hasScope ? rectified : "--"}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Outstanding</dt>
                <dd className="font-medium text-slate-900">{hasScope ? outstanding : "--"}</dd>
              </div>
            </dl>
          </div>
        ))}
        <div className="rounded-md border border-blue-200 bg-blue-50/50 p-3">
          <p className="text-sm font-semibold text-slate-900">Combined</p>
          <dl className="mt-2 space-y-1 text-xs">
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Total</dt>
              <dd className="font-medium text-slate-900">{hasScope ? combinedTotal : "--"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Rectified</dt>
              <dd className="font-medium text-slate-900">{hasScope ? combinedRectified : "--"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Outstanding</dt>
              <dd className="font-medium text-slate-900">{hasScope ? combinedOutstanding : "--"}</dd>
            </div>
            <div className="flex items-center justify-between border-t border-blue-100 pt-1">
              <dt className="font-medium text-slate-600">Performance %</dt>
              <dd className="font-semibold text-blue-800">{combinedPerformance !== null ? `${combinedPerformance.toFixed(1)}%` : "--"}</dd>
            </div>
          </dl>
        </div>
      </div>
    </Card>
  );
}
