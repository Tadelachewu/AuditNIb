"use client";

import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

// A Card whose whole body toggles shut behind its own header - same
// visual language as Card/CardHeader (kept in a separate "use client"
// file so those two stay server-renderable; this one needs useState),
// same open/close mechanics as SettingsListEditor's own accordion rows,
// just at the whole-section level rather than one list at a time. Used on
// the admin Settings page, whose form fields would otherwise all render
// at once down one very long scroll.
export function CollapsibleCard({
  title,
  description,
  defaultOpen = false,
  className = "",
  // Wraps children in a <fieldset disabled> - not the toggle button above
  // it, which must stay clickable regardless so a view-only viewer can
  // still expand a section to read it, just not edit anything inside.
  // `contents` keeps the fieldset out of layout entirely (no default
  // browser border/padding) while its native disabled-cascade still
  // reaches every input/select/button nested inside, component
  // boundaries included - see the Settings page's own usage.
  disabled = false,
  // Optional leading glyph beside the title.
  icon: Icon,
  // Optional title weight and colour (default: semibold body text), e.g. a
  // bold accent that adapts to dark mode such as font-bold text-amber-900.
  titleClassName = "font-semibold text-slate-900",
  // Optional header strip background, e.g. a tint that adapts to dark mode
  // such as bg-amber-50! (the ! wins over a UI template's header colour).
  headerClassName = "",
  // Optional colours of the icon's chip (default: the gold brand chip).
  iconClassName = "bg-brand-gold/20 text-brand-brown",
  // Controlled mode: pass both to own the open state from outside (e.g.
  // closing a section after a successful save). Omit both for the
  // default self-managed toggle.
  open: controlledOpen,
  onOpenChange,
  children,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  className?: string;
  disabled?: boolean;
  icon?: LucideIcon;
  titleClassName?: string;
  headerClassName?: string;
  iconClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => (onOpenChange ? onOpenChange(next) : setUncontrolledOpen(next));

  return (
    <div className={`app-card rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={`app-card-header flex w-full items-start justify-between gap-4 px-4 py-3 text-left ${open ? "rounded-t-lg" : "rounded-lg"} ${headerClassName}`}
      >
        <div className="flex items-start gap-2.5">
          {Icon && (
            <span className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${iconClassName}`}>
              <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
            </span>
          )}
          <div>
          <h2 className={`text-sm ${titleClassName}`}>{title}</h2>
          {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
          </div>
        </div>
        <svg
          className={`mt-0.5 h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-slate-200">
          <fieldset disabled={disabled} className="contents">
            {children}
          </fieldset>
        </div>
      )}
    </div>
  );
}
