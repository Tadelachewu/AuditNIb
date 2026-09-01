"use client";

import { useState } from "react";

export interface TrendSeries {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
  /** Which y-axis this series scales against. Defaults to "left". */
  axis?: "left" | "right";
  /** Dashed stroke - used to visually set a derived/percentage series (e.g. Performance %) apart from the raw counts it's derived from. */
  dashed?: boolean;
}

// Catmull-Rom -> cubic Bezier conversion, so the line reads as a smooth
// curve through every point (not a curve-fit approximation - it still
// passes exactly through each real value) rather than the straight
// polyline segments a plain SVG polyline would give.
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
  }
  return d;
}

function niceMax(dataMax: number, fallback = 1): number {
  return dataMax <= 0 ? fallback : Math.ceil((dataMax * 1.2) / 4) * 4 || dataMax * 1.2;
}

/**
 * Real line chart (dataviz skill / chart-selection rules: "trend over
 * time" is a line, not a bar list) - used for Monthly Trend. A smooth
 * multi-series curve with a floating hover tooltip (one shared crosshair
 * across every series, so comparing lines at the same month is a single
 * glance). Supports an optional secondary (right-hand) y-axis for a
 * series on a different scale - e.g. raw case counts on the left next to
 * a 0-100 performance percentage on the right, rather than forcing both
 * onto one scale where the percentage line would flatten to noise.
 */
export function TrendChart({
  labels,
  series,
  maxValue,
  valueSuffix = "",
  rightMaxValue,
  rightValueSuffix = "",
  legendPosition = "top",
  height = 220,
  emptyText = "No data yet.",
}: {
  labels: string[];
  series: TrendSeries[];
  /** Fixed scale for left-axis series (e.g. 100 for a percentage). Auto-computed with headroom when omitted. */
  maxValue?: number;
  valueSuffix?: string;
  /** Fixed scale for right-axis series. Auto-computed with headroom when omitted. */
  rightMaxValue?: number;
  rightValueSuffix?: string;
  legendPosition?: "top" | "bottom";
  height?: number;
  emptyText?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  const hasAnyValue = series.some((s) => s.values.some((v) => v !== null));
  if (labels.length === 0 || !hasAnyValue) {
    return <p className="py-10 text-center text-sm text-slate-400">{emptyText}</p>;
  }

  const leftSeries = series.filter((s) => (s.axis ?? "left") === "left");
  const rightSeries = series.filter((s) => s.axis === "right");
  const hasRightAxis = rightSeries.length > 0;

  const width = 600;
  const padTop = 20;
  const padBottom = legendPosition === "bottom" ? 28 : 28;
  const padLeft = 34;
  const padRight = hasRightAxis ? 40 : 14;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const leftValues = leftSeries.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const leftScaleMax = maxValue ?? niceMax(leftValues.length > 0 ? Math.max(...leftValues, 0) : 0);
  const rightValues = rightSeries.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const rightScaleMax = rightMaxValue ?? niceMax(rightValues.length > 0 ? Math.max(...rightValues, 0) : 0);

  const xFor = (i: number) => padLeft + (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
  const yForScale = (v: number, scaleMax: number) => padTop + plotH - (Math.max(0, Math.min(v, scaleMax)) / scaleMax) * plotH;
  const yFor = (s: TrendSeries, v: number) => yForScale(v, s.axis === "right" ? rightScaleMax : leftScaleMax);

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: padTop + plotH - f * plotH,
    leftValue: Math.round(leftScaleMax * f),
    rightValue: Math.round(rightScaleMax * f),
  }));

  const bandW = plotW / labels.length;
  const hoveredX = hovered !== null ? xFor(hovered) : null;
  const hoveredY =
    hovered !== null
      ? Math.min(...series.map((s) => (s.values[hovered] !== null ? yFor(s, s.values[hovered]!) : Infinity)).filter((y) => y !== Infinity))
      : null;

  const legend = (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
      {series.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5 text-xs text-slate-600">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );

  return (
    <div className="relative">
      {series.length > 1 && legendPosition === "top" && <div className="mb-2">{legend}</div>}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label="Trend chart"
        preserveAspectRatio="none"
        style={{ height }}
        onMouseLeave={() => setHovered(null)}
      >
        {gridLines.map((g) => (
          <g key={g.y}>
            <line x1={padLeft} x2={width - padRight} y1={g.y} y2={g.y} stroke="#e1e0d9" strokeWidth={1} strokeDasharray="3 3" />
            <text x={padLeft - 6} y={g.y + 3} fontSize={10} fill="#898781" textAnchor="end">
              {g.leftValue}
              {valueSuffix}
            </text>
            {hasRightAxis && (
              <text x={width - padRight + 6} y={g.y + 3} fontSize={10} fill="#898781" textAnchor="start">
                {g.rightValue}
                {rightValueSuffix}
              </text>
            )}
          </g>
        ))}
        {labels.map((label, i) => (
          <text key={label} x={xFor(i)} y={height - padBottom + 18} fontSize={10} fill="#898781" textAnchor="middle">
            {label}
          </text>
        ))}

        {hoveredX !== null && (
          <line x1={hoveredX} x2={hoveredX} y1={padTop} y2={padTop + plotH} stroke="#c8c6bd" strokeWidth={1} strokeDasharray="3 3" />
        )}

        {series.map((s) => {
          const points = s.values
            .map((v, i) => (v === null ? null : { x: xFor(i), y: yFor(s, v), v, labelIndex: i }))
            .filter((p): p is { x: number; y: number; v: number; labelIndex: number } => p !== null);
          if (points.length === 0) return null;
          return (
            <g key={s.key}>
              <path
                d={smoothPath(points)}
                fill="none"
                stroke={s.color}
                strokeWidth={s.dashed ? 2.5 : 3}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={s.dashed ? "6 4" : undefined}
              />
              {points.map((p) => (
                <circle
                  key={p.labelIndex}
                  cx={p.x}
                  cy={p.y}
                  r={hovered === p.labelIndex ? 5 : 4}
                  fill="#fcfcfb"
                  stroke={s.color}
                  strokeWidth={2}
                />
              ))}
            </g>
          );
        })}

        {labels.map((_, i) => (
          <rect
            key={i}
            x={padLeft + i * bandW}
            y={padTop}
            width={bandW}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHovered(i)}
          />
        ))}
      </svg>

      {series.length > 1 && legendPosition === "bottom" && <div className="mt-2">{legend}</div>}

      {hovered !== null && hoveredX !== null && hoveredY !== null && (
        <div
          className="pointer-events-none absolute z-10 min-w-[9rem] -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
          style={{ left: `${(hoveredX / width) * 100}%`, top: `${(hoveredY / height) * 100}%` }}
        >
          <p className="font-semibold text-slate-900">{labels[hovered]}</p>
          {series.map((s) => {
            const v = s.values[hovered];
            return (
              <p key={s.key} className="mt-0.5 font-medium" style={{ color: s.color }}>
                {s.label} : {v === null ? "--" : Number.isInteger(v) ? v : v.toFixed(1)}
                {s.axis === "right" ? rightValueSuffix : valueSuffix}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}
