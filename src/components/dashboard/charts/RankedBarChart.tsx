import Link from "next/link";

export interface RankedBarItem {
  id: string;
  label: string;
  value: number | null;
  href?: string;
}

/**
 * Single-series horizontal bar chart for ranking/comparison (district
 * performance, branch performance, monthly trend) - one hue, no legend
 * needed (dataviz skill: "a single series needs no legend box"). The value
 * is direct-labeled at the bar's tip since these lists are short enough
 * that every row's number is the point, not noise.
 */
export function RankedBarChart({
  items,
  max = 100,
  unit = "%",
  color = "#2a78d6",
  emptyText = "No data yet.",
  showRank = true,
}: {
  items: RankedBarItem[];
  max?: number;
  unit?: string;
  color?: string;
  emptyText?: string;
  /** Off for a chronological series (e.g. monthly trend) where "1, 2, 3..." would misread as a ranking. */
  showRank?: boolean;
}) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-400">{emptyText}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => {
        const pct = item.value === null ? 0 : Math.max(0, Math.min(100, (item.value / max) * 100));
        const label = (
          <span className="w-32 shrink-0 truncate text-xs text-slate-600" title={item.label}>
            {item.label}
          </span>
        );
        return (
          <div key={item.id} className="flex items-center gap-2 text-sm">
            {showRank && <span className="w-4 shrink-0 text-right text-xs text-slate-400">{i + 1}</span>}
            {item.href ? (
              <Link href={item.href} className="w-32 shrink-0 truncate text-xs text-blue-800 hover:underline" title={item.label}>
                {item.label}
              </Link>
            ) : (
              label
            )}
            <div className="h-4 flex-1 overflow-hidden rounded-full bg-slate-100" title={`${item.label}: ${item.value === null ? "no data" : item.value.toFixed(1) + unit}`}>
              <div className="h-full rounded-r-full" style={{ width: `${pct}%`, backgroundColor: color }} />
            </div>
            <span className="w-14 shrink-0 text-right text-xs font-medium text-slate-700">
              {item.value === null ? "--" : `${item.value.toFixed(1)}${unit}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
