"use client";

import { useState } from "react";

export interface ColumnItem {
  id: string;
  label: string;
  value: number;
  href?: string;
  /** Per-bar color override, for identity-based series (e.g. one hue per category) rather than a single-hue volume series. Falls back to the chart-level `color`. */
  color?: string;
}

function roundedTopBarPath(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.min(r, w / 2, h);
  if (h <= 0) return "";
  return [
    `M${x},${y + h}`,
    `L${x},${y + radius}`,
    `Q${x},${y} ${x + radius},${y}`,
    `L${x + w - radius},${y}`,
    `Q${x + w},${y} ${x + w},${y + radius}`,
    `L${x + w},${y + h}`,
    "Z",
  ].join(" ");
}

/**
 * Single-series vertical column chart for "how many per category" counts
 * (Findings by Branch, Findings by District) - a genuinely different
 * question from RankedBarChart's horizontal percentage-ranking bars
 * elsewhere on these dashboards, so this doesn't replace those. A hover
 * highlight column + floating tooltip (rather than a native <title>)
 * matches the interactive feel of TrendChart's own hover state.
 */
export function ColumnChart({
  items,
  color = "#fab219",
  unit = "",
  valueLabel = "Findings",
  emptyText = "No data yet.",
  height = 260,
}: {
  items: ColumnItem[];
  color?: string;
  unit?: string;
  valueLabel?: string;
  emptyText?: string;
  height?: number;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (items.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-400">{emptyText}</p>;
  }

  const width = 600;
  const padTop = 16;
  const padBottom = 50;
  const padLeft = 28;
  const padRight = 12;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const dataMax = Math.max(...items.map((i) => i.value), 0);
  const scaleMax = dataMax <= 0 ? 1 : Math.ceil((dataMax * 1.15) / 4) * 4 || dataMax * 1.15;

  const bandW = plotW / items.length;
  const barW = Math.min(bandW * 0.55, 44);

  const yFor = (v: number) => padTop + plotH - (Math.max(0, Math.min(v, scaleMax)) / scaleMax) * plotH;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: padTop + plotH - f * plotH,
    value: Math.round(scaleMax * f),
  }));

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label="Column chart"
        preserveAspectRatio="none"
        style={{ height }}
        onMouseLeave={() => setHovered(null)}
      >
        {gridLines.map((g) => (
          <g key={g.y}>
            <line x1={padLeft} x2={width - padRight} y1={g.y} y2={g.y} stroke="#e1e0d9" strokeWidth={1} strokeDasharray="3 3" />
            <text x={padLeft - 6} y={g.y + 3} fontSize={10} fill="#898781" textAnchor="end">
              {g.value}
            </text>
          </g>
        ))}

        {items.map((item, i) => {
          const bandX = padLeft + i * bandW;
          const barX = bandX + (bandW - barW) / 2;
          const barY = yFor(item.value);
          const barH = padTop + plotH - barY;
          const labelX = bandX + bandW / 2;
          const content = (
            <>
              {hovered === i && <rect x={bandX} y={padTop} width={bandW} height={plotH} fill="#0b0b0b" opacity={0.04} />}
              <path
                d={roundedTopBarPath(barX, barY, barW, barH, 5)}
                fill={item.color ?? color}
                opacity={hovered === null || hovered === i ? 1 : 0.55}
              />
              <rect
                x={bandX}
                y={padTop}
                width={bandW}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHovered(i)}
              />
              <text
                x={labelX}
                y={height - padBottom + 14}
                fontSize={10}
                fill="#898781"
                textAnchor="end"
                transform={`rotate(-30 ${labelX} ${height - padBottom + 14})`}
              >
                {item.label}
              </text>
            </>
          );
          // A full <a> navigation (not Next Link), same convention as
          // DonutChart's clickable arcs - "filter to this item's findings"
          // is exactly what a server-rendered /findings page load needs.
          return item.href ? (
            <a key={item.id} href={item.href} className="cursor-pointer">
              {content}
            </a>
          ) : (
            <g key={item.id}>{content}</g>
          );
        })}
      </svg>

      {hovered !== null && (
        <div
          className="pointer-events-none absolute z-10 min-w-[8rem] -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
          style={{
            left: `${((padLeft + hovered * bandW + bandW / 2) / width) * 100}%`,
            top: `${(yFor(items[hovered].value) / height) * 100}%`,
          }}
        >
          <p className="font-semibold text-slate-900">{items[hovered].label}</p>
          <p className="mt-0.5 font-medium" style={{ color: items[hovered].color ?? color }}>
            {valueLabel} : {items[hovered].value}
            {unit}
          </p>
        </div>
      )}
    </div>
  );
}
