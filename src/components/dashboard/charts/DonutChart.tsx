import { formatNumber } from "@/lib/format";

export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  color: string;
  // When set, the arc (an SVG <a>, not a Next Link - a full navigation to
  // a server-rendered page is exactly what "filter to this segment's
  // findings" needs) and its legend row both become clickable, filtering
  // to that segment (e.g. Risk Distribution -> /findings?risk=High).
  // Omitted entirely, this stays the plain read-only chart it always was.
  href?: string;
}

/**
 * Part-to-whole composition with few categories (chart-selection rule #4:
 * donut/pie ONLY for part-to-whole, never trends/rankings, and never with
 * "too many" slices). Used specifically for Finding Status Distribution
 * (Open/In-Review/Rectified-awaiting-close/Closed/Rejected) - a genuinely
 * different question ("what fraction of all findings sit in each stage
 * right now") from the existing per-branch/per-category stacked bars
 * elsewhere, so this doesn't duplicate them. Identity is never
 * color-only: every segment gets a swatch + text label + count +
 * percentage in the legend, not just a colored wedge.
 */
export function DonutChart({
  segments,
  emptyText = "No data yet.",
  ariaLabel = "Status distribution",
}: {
  segments: DonutSegment[];
  emptyText?: string;
  ariaLabel?: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) {
    return <p className="py-10 text-center text-sm text-slate-400">{emptyText}</p>;
  }

  const size = 140;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 4;
  const rInner = rOuter * 0.6;

  const arcs = segments
    .filter((s) => s.value > 0)
    .reduce<{ cumulative: number; arcs: (DonutSegment & { path: string })[] }>(
      (acc, s) => {
        const startAngle = (acc.cumulative / total) * 2 * Math.PI - Math.PI / 2;
        const nextCumulative = acc.cumulative + s.value;
        const endAngle = (nextCumulative / total) * 2 * Math.PI - Math.PI / 2;
        const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
        const outerStart = { x: cx + rOuter * Math.cos(startAngle), y: cy + rOuter * Math.sin(startAngle) };
        const outerEnd = { x: cx + rOuter * Math.cos(endAngle), y: cy + rOuter * Math.sin(endAngle) };
        const innerStart = { x: cx + rInner * Math.cos(endAngle), y: cy + rInner * Math.sin(endAngle) };
        const innerEnd = { x: cx + rInner * Math.cos(startAngle), y: cy + rInner * Math.sin(startAngle) };
        const path = [
          `M ${outerStart.x} ${outerStart.y}`,
          `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
          `L ${innerStart.x} ${innerStart.y}`,
          `A ${rInner} ${rInner} 0 ${largeArc} 0 ${innerEnd.x} ${innerEnd.y}`,
          "Z",
        ].join(" ");
        acc.arcs.push({ ...s, path });
        return { cumulative: nextCumulative, arcs: acc.arcs };
      },
      { cumulative: 0, arcs: [] }
    ).arcs;

  return (
    <div className="flex items-center gap-5">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-32 w-32 shrink-0" role="img" aria-label={ariaLabel}>
        {arcs.map((a) => {
          const arc = (
            <path
              d={a.path}
              fill={a.color}
              stroke="#fcfcfb"
              strokeWidth={2}
              className={a.href ? "cursor-pointer transition-opacity hover:opacity-80" : undefined}
            >
              <title>
                {a.label}: {formatNumber(a.value)} ({((a.value / total) * 100).toFixed(0)}%)
              </title>
            </path>
          );
          return a.href ? (
            <a key={a.key} href={a.href}>
              {arc}
            </a>
          ) : (
            <g key={a.key}>{arc}</g>
          );
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize={16} fontWeight={600} fill="#0b0b0b">
          {formatNumber(total)}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize={8} fill="#898781">
          total
        </text>
      </svg>
      <div className="flex flex-col gap-1.5">
        {segments.map((s) => {
          const row = (
            <>
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} />
              <span className="text-slate-600">{s.label}</span>
              <span className="font-medium text-slate-900">
                {formatNumber(s.value)} ({total > 0 ? ((s.value / total) * 100).toFixed(0) : 0}%)
              </span>
            </>
          );
          return s.href ? (
            <a key={s.key} href={s.href} className="flex items-center gap-2 text-xs hover:underline">
              {row}
            </a>
          ) : (
            <div key={s.key} className="flex items-center gap-2 text-xs">
              {row}
            </div>
          );
        })}
      </div>
    </div>
  );
}
