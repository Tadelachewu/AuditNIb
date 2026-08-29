import { Card, CardHeader } from "@/components/ui/Card";
import { StackedBarChart, type StackedBarSegment } from "@/components/dashboard/charts/StackedBarChart";
import type { Finding } from "@/types";

// Fixed status palette (never themed) - a risk tier is a severity state,
// not an arbitrary category, so it gets good/warning/serious/critical
// rather than a categorical hue. Matched case-insensitively since
// riskLevels is admin-configurable free text (Settings.riskLevels), not a
// fixed enum - "Low"/"Medium"/"High"/"Critical" are the seeded defaults,
// not guaranteed casing.
const STATUS_COLORS: Record<string, string> = {
  low: "#0ca30c",
  medium: "#fab219",
  high: "#ec835a",
  critical: "#d03b3b",
};
const FALLBACK_COLOR = "#898781";

/**
 * master.txt §10's "risk distribution" widget - a real per-riskLevel
 * breakdown of open findings (not RECTIFIED/CLOSED/REJECTED). Rendered as
 * a part-to-whole stacked bar (dataviz skill: donut stays deprioritized in
 * favor of the stacked bar for this job) plus the numeric count/percentage
 * per level, so the graphical and numeric views sit side by side rather
 * than one replacing the other.
 */
export function RiskDistribution({ findings, riskLevels }: { findings: Finding[]; riskLevels: string[] }) {
  const open = findings.filter((f) => !["RECTIFIED", "CLOSED", "REJECTED"].includes(f.status));
  const total = open.length;

  const segments: StackedBarSegment[] = riskLevels.map((level) => ({
    key: level,
    label: level,
    color: STATUS_COLORS[level.trim().toLowerCase()] ?? FALLBACK_COLOR,
  }));
  const counts = Object.fromEntries(riskLevels.map((level) => [level, open.filter((f) => f.riskLevel === level).length]));

  return (
    <Card>
      <CardHeader title="Risk Distribution" description="Open findings by risk level" />
      <div className="flex flex-col gap-4 p-4">
        <StackedBarChart
          segments={segments}
          rows={[{ id: "open", label: "Open findings", values: counts }]}
          emptyText="No open findings yet."
        />
        {total > 0 && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-slate-100 pt-3 sm:grid-cols-4">
            {riskLevels.map((level) => (
              <div key={level} className="text-xs">
                <span className="text-slate-500">{level}</span>{" "}
                <span className="font-medium text-slate-900">
                  {counts[level]} ({total > 0 ? ((counts[level] / total) * 100).toFixed(0) : 0}%)
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
