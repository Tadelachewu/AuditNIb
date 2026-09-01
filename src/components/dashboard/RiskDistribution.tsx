import { Card, CardHeader } from "@/components/ui/Card";
import { DonutChart } from "@/components/dashboard/charts/DonutChart";
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
 * breakdown of open findings (not RECTIFIED/CLOSED/REJECTED), rendered as
 * a donut (part-to-whole, few categories - chart-selection rule #4).
 * Clicking a segment (arc or legend row) filters the Findings list to
 * that risk level - /findings already re-scopes server-side to whoever's
 * viewing, so no extra district/branch param is needed here.
 */
export function RiskDistribution({ findings, riskLevels }: { findings: Finding[]; riskLevels: string[] }) {
  const open = findings.filter((f) => !["RECTIFIED", "CLOSED", "REJECTED"].includes(f.status));

  const segments = riskLevels.map((level) => ({
    key: level,
    label: level,
    value: open.filter((f) => f.riskLevel === level).length,
    color: STATUS_COLORS[level.trim().toLowerCase()] ?? FALLBACK_COLOR,
    href: `/findings?risk=${encodeURIComponent(level)}`,
  }));

  return (
    <Card>
      <CardHeader title="Risk Distribution" description="Open findings by risk level - click a segment to filter" />
      <div className="p-4">
        <DonutChart segments={segments} emptyText="No open findings yet." ariaLabel="Risk distribution" />
      </div>
    </Card>
  );
}
