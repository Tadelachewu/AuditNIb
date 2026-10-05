import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

// Every tone here is one of the handful of color families globals.css
// actually gives a dark-mode remap (slate/blue/emerald/amber/red) - a tone
// outside that set would look right in light mode and inverted/wrong the
// moment dark mode is on, so no other Tailwind color family belongs here.
// `gold` is the one deliberate exception: --brand-gold/--brand-gold-dark
// are themselves already theme-invariant by design (see globals.css's own
// comment), so they're safe to use without a remap - reserved for the one
// headline metric each dashboard has (Performance %), the same "this is
// the one important number" role brand-gold already plays via Button's
// `primary` variant.
export type StatTone = "slate" | "blue" | "emerald" | "amber" | "red" | "gold";

// The colour of each tone's icon tile (globals.css .tone-tile mixes the tile
// and the icon from it, readable in light and dark mode). Gold is the brand's
// darker gold, so the headline metric's icon stays readable on its tile.
const TONE_COLORS: Record<StatTone, string> = {
  slate: "#475569",
  blue: "#2563eb",
  emerald: "#059669",
  amber: "#d97706",
  red: "#dc2626",
  gold: "#d89d11",
};

// A card reads as its own surface against the page: on the Standard template
// it stands out white against the light-grey page; on the Clean white
// template (page also white) the app-card / app-card-header classes give it
// a soft shadow and a faintly tinted header strip instead (globals.css).
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`app-card rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>;
}

export function CardHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="app-card-header flex items-start justify-between gap-4 rounded-t-lg border-b border-slate-200 px-4 py-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

// `detail`, when given, makes `value` a native <details>/<summary>
// disclosure instead of plain text - click (or tap) it to reveal the
// breakdown behind the number (e.g. "how is this percentage actually
// calculated") right there in the card, with no client-side JS needed.
// `icon`, when given, shows a small colored glyph next to the label - see
// src/lib/dashboardIcons.ts for the one shared label->icon+tone mapping
// every dashboard draws from, so the same stat reads with the same icon
// AND the same meaning-carrying color everywhere it appears (green for a
// good outcome, red/amber for something that needs attention, blue for a
// plain volume total, gold for the one headline metric) rather than every
// glyph reading as equally neutral. Both optional and backward-compatible -
// every existing StatCard without them renders exactly as before.
export function StatCard({
  label,
  value,
  hint,
  detail,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  detail?: ReactNode;
  icon?: { icon: LucideIcon; tone?: StatTone };
}) {
  const Icon = icon?.icon;
  const toneColor = TONE_COLORS[icon?.tone ?? "slate"];
  return (
    <Card className="px-4 py-3">
      <div className="flex items-start gap-2.5">
        {Icon && (
          <span className="tone-tile mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ "--ql": toneColor } as React.CSSProperties}>
            <Icon size={15} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-slate-600">{label}</p>
          {detail ? (
            <details className="group mt-1">
              <summary className="cursor-pointer list-none text-2xl font-semibold tabular-nums text-slate-900 marker:content-none">{value}</summary>
              <div className="mt-1.5 border-t border-slate-200 pt-1.5 text-xs leading-relaxed text-slate-600">{detail}</div>
            </details>
          ) : (
            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
          )}
          {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
        </div>
      </div>
    </Card>
  );
}
