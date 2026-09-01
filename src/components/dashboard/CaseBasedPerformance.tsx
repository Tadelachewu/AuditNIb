import type { Database, Finding } from "@/types";
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
 */
export function CaseBasedPerformance({
  db,
  periodFindings,
  openPeriod,
}: {
  db: Database;
  periodFindings: Finding[];
  openPeriod?: { id: string };
}) {
  const activeScoringRule = db.scoringRules.find((r) => r.active);
  const scoredCategoryIds = new Set(activeScoringRule?.categories ?? []);
  const categoryNames = db.categories.filter((c) => scoredCategoryIds.has(c.id)).map((c) => c.name);
  const categoryLabel = categoryNames.length > 0 ? categoryNames.join(" / ") : "Scored Case";

  const eligible = periodFindings.filter((f) => scoredCategoryIds.has(f.categoryId));
  const totalEligible = eligible.reduce((sum, f) => sum + f.caseCount, 0);
  const rectified = eligible.reduce((sum, f) => sum + f.rectifiedCases, 0);
  const outstanding = totalEligible - rectified;
  const rectifiedPct = totalEligible > 0 ? (rectified / totalEligible) * 100 : 0;
  const outstandingPct = totalEligible > 0 ? (outstanding / totalEligible) * 100 : 0;

  if (!activeScoringRule) {
    return (
      <Card className="border-blue-100 bg-blue-50/30">
        <CardHeader title="Case-Based Performance" description="Performance section" />
        <p className="p-4 text-sm text-slate-400">No active scoring rule configured yet.</p>
      </Card>
    );
  }

  return (
    <Card className="border-blue-100 bg-blue-50/30">
      <CardHeader title="Case-Based Performance" description={`Current primary performance category: ${categoryLabel}`} />
      <div className="flex flex-col gap-4 p-4">
        <Bar label="Total Eligible Cases" count={openPeriod ? totalEligible : "--"} pct={100} color="#1d4ed8" />
        <Bar label="Rectified Cases" count={openPeriod ? rectified : "--"} pct={openPeriod ? rectifiedPct : 0} color="#0ca30c" />
        <Bar label="Outstanding" count={openPeriod ? outstanding : "--"} pct={openPeriod ? outstandingPct : 0} color="#ec835a" />
      </div>
    </Card>
  );
}
