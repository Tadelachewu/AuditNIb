"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { FIELD_FOCUS } from "@/components/ui/Field";
import { sortPeriods } from "@/lib/periods";
import type { ReportingPeriod } from "@/types";

/**
 * A compact multi-period picker that looks like the other report filters'
 * Period dropdown: one select-sized button ("All periods" / "2026-10" /
 * "3 periods") that opens a list of checkboxes, newest first, grouped by
 * year. Submits as repeated `periodIds` inside the surrounding GET form.
 * No selection = every period (cumulative).
 */
export function PeriodMultiSelect({ periods, selectedIds, id = "periodIds" }: { periods: ReportingPeriod[]; selectedIds: string[]; id?: string }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(selectedIds);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const sorted = sortPeriods(periods);
  const years = [...new Set(sorted.map((p) => p.year))];
  const label =
    selected.length === 0
      ? "All periods"
      : selected.length === 1
        ? (periods.find((p) => p.id === selected[0])?.code ?? "1 period")
        : `${selected.length} periods`;
  const toggle = (pid: string) => setSelected((s) => (s.includes(pid) ? s.filter((x) => x !== pid) : [...s, pid]));

  return (
    <div ref={ref} className="relative">
      {/* What the form submits */}
      {selected.map((pid) => (
        <input key={pid} type="hidden" name="periodIds" value={pid} />
      ))}
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-56 items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-left text-sm text-slate-900 ${FIELD_FOCUS}`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div role="listbox" aria-multiselectable="true" className="absolute left-0 z-30 mt-1 max-h-72 w-56 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            <input type="checkbox" checked={selected.length === 0} onChange={() => setSelected([])} />
            All periods (cumulative)
          </label>
          {years.map((year) => (
            <div key={year}>
              <p className="border-t border-slate-100 px-3 pb-0.5 pt-1.5 text-xs font-semibold text-slate-500">{year}</p>
              {sorted
                .filter((p) => p.year === year)
                .map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                    <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
                    {p.code}
                    {p.status === "LOCKED" && <span className="text-xs text-slate-500">(locked)</span>}
                  </label>
                ))}
            </div>
          ))}
          {periods.length === 0 && <p className="px-3 py-1.5 text-sm text-slate-500">No reporting periods yet.</p>}
        </div>
      )}
    </div>
  );
}
