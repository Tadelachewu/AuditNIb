import { Card, CardHeader } from "@/components/ui/Card";
import { ColumnChart } from "@/components/dashboard/charts/ColumnChart";
import { categoricalColor } from "@/components/dashboard/charts/categoricalPalette";
import type { ClassifiedCategory, Finding } from "@/types";

/**
 * "Findings by Category" as a real bar graph - the same volume-count
 * question as Findings by Branch/District (ColumnChart), just grouped by
 * classified category instead. Categories are identity, not severity
 * (same reasoning as CategoryDistribution), so each bar keeps its
 * category's own hue from the shared categorical palette rather than one
 * flat color.
 */
export function FindingsByCategoryChart({
  findings,
  categories,
  openPeriod,
}: {
  findings: Finding[];
  categories: ClassifiedCategory[];
  openPeriod?: { id: string };
}) {
  const items = categories.map((c, i) => ({
    id: c.id,
    label: c.name,
    value: findings.filter((f) => f.categoryId === c.id).length,
    color: categoricalColor(i),
  }));

  return (
    <Card>
      <CardHeader title="Findings by Category" description="Every classified case category, current period" />
      <div className="p-4">
        <ColumnChart items={items} emptyText={openPeriod ? "No findings yet." : "No open reporting period."} />
      </div>
    </Card>
  );
}
