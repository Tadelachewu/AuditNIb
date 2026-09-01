import type { Database, Finding, Source } from "@/types";
import { computePerformance, type PerformanceScope } from "@/lib/findings";
import { Card, CardHeader } from "@/components/ui/Card";

/**
 * Document_3 §9's "IC + IA Performance": per-source eligible-case
 * breakdown (Total/Rectified/Outstanding "Other Cases", i.e. whatever the
 * active ScoringRule currently scores - not hard-coded "Other Case"), plus
 * a Combined row with the real Performance % (computePerformance, so it
 * matches every other performance figure on the dashboard exactly). Named
 * generically because the two sources in question are whatever's active
 * in Settings, not hard-coded "Internal Control"/"Internal Audit" - those
 * just happen to be the seeded names.
 */
export function SourcePerformanceSummary({
  db,
  sources,
  periodFindings,
  scope,
  openPeriod,
}: {
  db: Database;
  sources: Source[];
  periodFindings: Finding[];
  scope: PerformanceScope;
  openPeriod?: { id: string };
}) {
  const activeScoringRule = db.scoringRules.find((r) => r.active);
  const scoredCategoryIds = new Set(activeScoringRule?.categories ?? []);
  const categoryNames = db.categories.filter((c) => scoredCategoryIds.has(c.id)).map((c) => c.name);
  const categoryLabel = categoryNames.length > 0 ? categoryNames.join(" / ") : "Scored";

  const perSource = sources.map((s) => {
    const findings = periodFindings.filter((f) => f.sourceId === s.id && scoredCategoryIds.has(f.categoryId));
    const total = findings.reduce((sum, f) => sum + f.caseCount, 0);
    const rectified = findings.reduce((sum, f) => sum + f.rectifiedCases, 0);
    return { source: s, total, rectified, outstanding: total - rectified };
  });

  const combinedTotal = perSource.reduce((sum, r) => sum + r.total, 0);
  const combinedRectified = perSource.reduce((sum, r) => sum + r.rectified, 0);
  const combinedOutstanding = combinedTotal - combinedRectified;
  const combinedPerformance = openPeriod ? computePerformance(db, { ...scope, periodId: openPeriod.id }) : null;

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
                <dd className="font-medium text-slate-900">{openPeriod ? total : "--"}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Rectified</dt>
                <dd className="font-medium text-slate-900">{openPeriod ? rectified : "--"}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Outstanding</dt>
                <dd className="font-medium text-slate-900">{openPeriod ? outstanding : "--"}</dd>
              </div>
            </dl>
          </div>
        ))}
        <div className="rounded-md border border-blue-200 bg-blue-50/50 p-3">
          <p className="text-sm font-semibold text-slate-900">Combined</p>
          <dl className="mt-2 space-y-1 text-xs">
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Total</dt>
              <dd className="font-medium text-slate-900">{openPeriod ? combinedTotal : "--"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Rectified</dt>
              <dd className="font-medium text-slate-900">{openPeriod ? combinedRectified : "--"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Outstanding</dt>
              <dd className="font-medium text-slate-900">{openPeriod ? combinedOutstanding : "--"}</dd>
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
