export interface TrendSeries {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
}

/**
 * Real line chart (dataviz skill / chart-selection rules: "trend over
 * time" is a line, not a bar list) - used for Monthly Performance Trend
 * and Findings Created vs Resolved. Rendered as inline SVG so an actual
 * line/area is possible (CSS bars can't do this); 2px lines, round caps,
 * hairline gridlines, direct end-labels, legend only when there's more
 * than one series, and a native <title> per point for a hover tooltip
 * without any JS state.
 */
export function TrendChart({
  labels,
  series,
  maxValue,
  valueSuffix = "",
  area = false,
  height = 180,
  emptyText = "No data yet.",
}: {
  labels: string[];
  series: TrendSeries[];
  /** Fixed scale (e.g. 100 for a percentage). Auto-computed with headroom when omitted. */
  maxValue?: number;
  valueSuffix?: string;
  area?: boolean;
  height?: number;
  emptyText?: string;
}) {
  const hasAnyValue = series.some((s) => s.values.some((v) => v !== null));
  if (labels.length === 0 || !hasAnyValue) {
    return <p className="py-10 text-center text-sm text-slate-400">{emptyText}</p>;
  }

  const width = 600;
  const padTop = 16;
  const padBottom = 24;
  const padLeft = 8;
  const padRight = 8;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const allValues = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const dataMax = allValues.length > 0 ? Math.max(...allValues, 0) : 0;
  const scaleMax = maxValue ?? (dataMax <= 0 ? 1 : Math.ceil((dataMax * 1.15) / 5) * 5 || dataMax * 1.15);

  const xFor = (i: number) => padLeft + (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
  const yFor = (v: number) => padTop + plotH - (Math.max(0, Math.min(v, scaleMax)) / scaleMax) * plotH;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: padTop + plotH - f * plotH,
    value: Math.round(scaleMax * f),
  }));

  return (
    <div>
      {series.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-xs text-slate-600">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Trend chart" preserveAspectRatio="none" style={{ height }}>
        {gridLines.map((g) => (
          <g key={g.y}>
            <line x1={padLeft} x2={width - padRight} y1={g.y} y2={g.y} stroke="#e1e0d9" strokeWidth={1} />
            <text x={padLeft} y={g.y - 3} fontSize={9} fill="#898781">
              {g.value}
              {valueSuffix}
            </text>
          </g>
        ))}
        {labels.map((label, i) => (
          <text key={label} x={xFor(i)} y={height - 6} fontSize={9} fill="#898781" textAnchor="middle">
            {label}
          </text>
        ))}
        {series.map((s) => {
          const points = s.values
            .map((v, i) => (v === null ? null : { x: xFor(i), y: yFor(v), v, labelIndex: i }))
            .filter((p): p is { x: number; y: number; v: number; labelIndex: number } => p !== null);
          if (points.length === 0) return null;
          const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
          const areaPath = area
            ? `${linePath} L${points[points.length - 1].x},${padTop + plotH} L${points[0].x},${padTop + plotH} Z`
            : null;
          const last = points[points.length - 1];
          return (
            <g key={s.key}>
              {areaPath && <path d={areaPath} fill={s.color} opacity={0.1} stroke="none" />}
              <path d={linePath} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {points.map((p) => (
                <circle key={p.labelIndex} cx={p.x} cy={p.y} r={3} fill={s.color} stroke="#fcfcfb" strokeWidth={1.5}>
                  <title>
                    {s.label} — {labels[p.labelIndex]}: {p.v.toFixed(1)}
                    {valueSuffix}
                  </title>
                </circle>
              ))}
              <text x={last.x} y={last.y - 8} fontSize={10} fontWeight={600} fill="#0b0b0b" textAnchor="middle">
                {last.v.toFixed(0)}
                {valueSuffix}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
