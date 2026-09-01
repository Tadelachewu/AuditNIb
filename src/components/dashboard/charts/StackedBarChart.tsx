import { formatNumber } from "@/lib/format";

export interface StackedBarSegment {
  key: string;
  label: string;
  color: string;
}

export interface StackedBarRow {
  id: string;
  label: string;
  values: Record<string, number>;
}

/**
 * Part-to-whole horizontal bar chart (dataviz skill: "part-to-whole rides
 * on the stacked bar chart" - a donut is deprioritized). One row per item
 * (a source, or a single "Open findings" total), segments proportional to
 * each series' share, a 2px surface gap between touching segments per the
 * mark spec, and a legend since there are always >= 2 series here.
 */
export function StackedBarChart({
  segments,
  rows,
  emptyText = "No data yet.",
}: {
  segments: StackedBarSegment[];
  rows: StackedBarRow[];
  emptyText?: string;
}) {
  const hasData = rows.some((r) => segments.some((s) => (r.values[s.key] ?? 0) > 0));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>

      {!hasData ? (
        <p className="py-4 text-center text-sm text-slate-400">{emptyText}</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((row) => {
            const total = segments.reduce((sum, s) => sum + (row.values[s.key] ?? 0), 0);
            return (
              <div key={row.id} className="flex items-center gap-2 text-sm">
                <span className="w-32 shrink-0 truncate text-xs text-slate-600" title={row.label}>
                  {row.label}
                </span>
                <div className="flex h-4 flex-1 gap-0.5 overflow-hidden rounded-full bg-slate-100">
                  {total === 0
                    ? null
                    : segments.map((s) => {
                        const value = row.values[s.key] ?? 0;
                        if (value <= 0) return null;
                        const pct = (value / total) * 100;
                        return (
                          <div
                            key={s.key}
                            className="h-full first:rounded-l-full last:rounded-r-full"
                            style={{ width: `${pct}%`, backgroundColor: s.color }}
                            title={`${row.label} — ${s.label}: ${formatNumber(value)}`}
                          />
                        );
                      })}
                </div>
                <span className="w-16 shrink-0 text-right text-xs font-medium text-slate-700">
                  {formatNumber(total)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
