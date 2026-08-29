import { Card, CardHeader } from "@/components/ui/Card";
import { StackedBarChart, type StackedBarSegment } from "@/components/dashboard/charts/StackedBarChart";
import { categoricalColor } from "@/components/dashboard/charts/categoricalPalette";
import type { ClassifiedCategory, Finding } from "@/types";

/**
 * master.txt §10 / Document_3 §24's "category distribution" analytics
 * widget - open findings broken down by classified category, as a
 * part-to-whole stacked bar (dataviz skill: donut stays deprioritized in
 * favor of the stacked bar for this job) plus the numeric count/percentage
 * per category, same graphical+numeric pairing as RiskDistribution.
 * Categories are identity, not severity, so this uses the fixed
 * categorical palette rather than the status colors RiskDistribution uses.
 */
export function CategoryDistribution({ findings, categories }: { findings: Finding[]; categories: ClassifiedCategory[] }) {
  const open = findings.filter((f) => !["RECTIFIED", "CLOSED", "REJECTED"].includes(f.status));
  const total = open.length;

  const segments: StackedBarSegment[] = categories.map((c, i) => ({
    key: c.id,
    label: c.name,
    color: categoricalColor(i),
  }));
  const counts = Object.fromEntries(categories.map((c) => [c.id, open.filter((f) => f.categoryId === c.id).length]));

  return (
    <Card>
      <CardHeader title="Category Distribution" description="Open findings by classified category" />
      <div className="flex flex-col gap-4 p-4">
        <StackedBarChart
          segments={segments}
          rows={[{ id: "open", label: "Open findings", values: counts }]}
          emptyText="No open findings yet."
        />
        {total > 0 && (
          <div className="grid grid-cols-1 gap-x-4 gap-y-1 border-t border-slate-100 pt-3 sm:grid-cols-2">
            {categories.map((c) => (
              <div key={c.id} className="text-xs">
                <span className="text-slate-500">{c.name}</span>{" "}
                <span className="font-medium text-slate-900">
                  {counts[c.id]} ({total > 0 ? ((counts[c.id] / total) * 100).toFixed(0) : 0}%)
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
