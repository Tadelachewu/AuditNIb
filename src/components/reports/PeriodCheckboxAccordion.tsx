import type { ReportingPeriod } from "@/types";

// Plain <details>/<summary> - no client JS needed, so this stays a Server
// Component like the pages that use it. Grouped by year because the flat
// flex-wrap checkbox list this replaces doesn't scale: at a couple of years
// of monthly periods it turns into several wrapped rows with no way to
// jump to a specific year or see at a glance what's already selected.
// Every year starts collapsed, even one holding an existing GET-param
// selection - the summary line still shows "<n> selected" for that year,
// so nothing is silently hidden, just not auto-expanded.
export function PeriodCheckboxAccordion({ periods, selectedIds }: { periods: ReportingPeriod[]; selectedIds: string[] }) {
  const byYear = new Map<number, ReportingPeriod[]>();
  for (const p of periods) {
    if (!byYear.has(p.year)) byYear.set(p.year, []);
    byYear.get(p.year)!.push(p);
  }
  const years = [...byYear.keys()].sort((a, b) => b - a);

  if (years.length === 0) {
    return <p className="text-sm text-slate-400">No reporting periods yet.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {years.map((year) => {
        const yearPeriods = byYear.get(year)!.sort((a, b) => b.month - a.month);
        const selectedCount = yearPeriods.filter((p) => selectedIds.includes(p.id)).length;
        return (
          <details key={year} className="rounded-md border border-slate-200">
            <summary className="cursor-pointer select-none rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              {year}{" "}
              <span className="font-normal text-slate-400">
                ({yearPeriods.length} period{yearPeriods.length === 1 ? "" : "s"}
                {selectedCount > 0 ? `, ${selectedCount} selected` : ""})
              </span>
            </summary>
            <div className="flex flex-wrap gap-3 border-t border-slate-100 px-3 py-2">
              {yearPeriods.map((p) => (
                <label key={p.id} className="flex items-center gap-1.5 text-sm text-slate-700">
                  <input type="checkbox" name="periodIds" value={p.id} defaultChecked={selectedIds.includes(p.id)} />
                  {p.code}
                </label>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}
