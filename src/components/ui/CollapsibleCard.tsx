"use client";

import { useState, type ReactNode } from "react";

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
  children,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`rounded-lg border border-slate-200 bg-slate-100 shadow-sm ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left"
      >
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
        </div>
        <svg
          className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="border-t border-slate-200">{children}</div>}
    </div>
  );
}
