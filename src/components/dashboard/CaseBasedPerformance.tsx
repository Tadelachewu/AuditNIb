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
 * "Total Eligible Cases" and "Rectified Cases" both come straight from
 * computeEligibleCaseCounts() - the exact same function computePerformance()
 * itself uses, rather than a hand-rolled candidate filter - so this widget
 * can never disagree with the headline Performance % StatCard, and so it
 * automatically inherits that function's transfer-case segmentation
 * (findingCasesEligibleInPeriod(), in src/lib/findings.ts): a case that
 * transferred OUT of this period is credited only for the portion that
 * never left, never the finding's full caseCount - performance must never
 * be moved by a transferred case, in the period it left or anywhere else.
 * "Rectified Cases" is every rectification stamped to this period
 * (RectificationEntry.periodId) that's also been District-*verified* - not
 * closed-only (Finding.closedCases), but also not the Branch Manager's raw
 * self-report the moment it's recorded: a case only counts as rectified
 * once the authorized person (District Controller, via verify-rectification)
 * has accepted it. A rectification sitting unverified is still a claim, not
 * yet something the scoring formula credits - see verifiedRectifiedInPeriod()
 * in src/lib/findings.ts. (Total Findings/Rectified Findings on the
 * StatCards row above stay closed-only - that pairing is about *records*,
 * not this widget's *cases* breakdown.)
 *
 * `allPeriods` (from the FilterBar's own "All periods" choice - see
 * ALL_PERIODS_VALUE) omits periodId from scope entirely, which is
 * computeEligibleCaseCounts()'s own "lifetime, no period filter" mode.
 */
export function CaseBasedPerformance({
  db,
  scope,
  openPeriod,
  allPeriods = false,
}: {
  db: Database;
  scope: PerformanceScope;
  openPeriod?: { id: string };
  allPeriods?: boolean;
}) {
  const activeScoringRule = db.scoringRules.find((r) => r.active);
  const scoredCategoryIds = new Set(activeScoringRule?.categories ?? []);
  const categoryNames = db.categories.filter((c) => scoredCategoryIds.has(c.id)).map((c) => c.name);
  const categoryLabel = categoryNames.length > 0 ? categoryNames.join(" / ") : "Scored Case";
  const hasScope = allPeriods || Boolean(openPeriod);

  if (!activeScoringRule) {
    return (
      <Card className="border-blue-100 bg-blue-50/30">
        <CardHeader title="Case-Based Performance" description="Performance section" />
        <p className="p-4 text-sm text-slate-400">No active scoring rule configured yet.</p>
      </Card>
    );
  }

  const counts = hasScope
    ? computeEligibleCaseCounts(db, { ...scope, periodId: allPeriods ? undefined : openPeriod?.id })
    : null;
  const totalEligible = counts?.totalCases ?? 0;
  const rectified = counts?.rectifiedCases ?? 0;
  const outstanding = totalEligible - rectified;
  const rectifiedPct = totalEligible > 0 ? (rectified / totalEligible) * 100 : 0;
  const outstandingPct = totalEligible > 0 ? (outstanding / totalEligible) * 100 : 0;

  return (
    <Card className="border-blue-100 bg-blue-50/30">
      <CardHeader title="Case-Based Performance" description={`Current primary performance category: ${categoryLabel}`} />
      <div className="flex flex-col gap-4 p-4">
        <Bar label="Total Eligible Cases" count={hasScope ? totalEligible : "--"} pct={100} color="#1d4ed8" />
        <Bar label="Rectified Cases" count={hasScope ? rectified : "--"} pct={hasScope ? rectifiedPct : 0} color="#0ca30c" />
        <Bar label="Outstanding" count={hasScope ? outstanding : "--"} pct={hasScope ? outstandingPct : 0} color="#ec835a" />
      </div>
    </Card>
  );
}
