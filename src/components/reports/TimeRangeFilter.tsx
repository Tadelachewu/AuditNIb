"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";

type Preset = "today" | "week" | "month" | "custom";

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function presetRange(preset: Exclude<Preset, "custom">): { from: string; to: string } {
  const now = new Date();
  if (preset === "today") {
    const d = toDateInput(now);
    return { from: d, to: d };
  }
  if (preset === "week") {
    // Monday-start week, matching how most bank reporting calendars read.
    const day = now.getDay();
    const diffToMonday = day === 0 ? 6 : day - 1;
    const start = new Date(now);
    start.setDate(now.getDate() - diffToMonday);
    return { from: toDateInput(start), to: toDateInput(now) };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: toDateInput(start), to: toDateInput(now) };
}

/**
 * Reporting time filter (distinct from the reporting-*period* dropdown in
 * FilterBar) - filters the Reports page by each finding's own
 * `findingDate`, quick-preset style. Pushes `dateFrom`/`dateTo` onto the
 * URL query string, same convention as FilterBar, so the server
 * component re-queries with no client-side fetch duplication.
 */
export function TimeRangeFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlFrom = searchParams.get("dateFrom") ?? "";
  const urlTo = searchParams.get("dateTo") ?? "";
  const [customFrom, setCustomFrom] = useState(urlFrom);
  const [customTo, setCustomTo] = useState(urlTo);
  const [showCustom, setShowCustom] = useState(Boolean(urlFrom || urlTo));

  function pushRange(from: string, to: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (from) params.set("dateFrom", from);
    else params.delete("dateFrom");
    if (to) params.set("dateTo", to);
    else params.delete("dateTo");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  function applyPreset(preset: Exclude<Preset, "custom">) {
    setShowCustom(false);
    const { from, to } = presetRange(preset);
    setCustomFrom(from);
    setCustomTo(to);
    pushRange(from, to);
  }

  function clearRange() {
    setShowCustom(false);
    setCustomFrom("");
    setCustomTo("");
    pushRange("", "");
  }

  const activePreset: Preset | null = (() => {
    if (!urlFrom && !urlTo) return null;
    if (urlFrom === urlTo && urlFrom === toDateInput(new Date())) return "today";
    const week = presetRange("week");
    if (urlFrom === week.from && urlTo === week.to) return "week";
    const month = presetRange("month");
    if (urlFrom === month.from && urlTo === month.to) return "month";
    return "custom";
  })();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-slate-500">Date range:</span>
      <Button variant={activePreset === "today" ? "primary" : "secondary"} onClick={() => applyPreset("today")}>
        Today
      </Button>
      <Button variant={activePreset === "week" ? "primary" : "secondary"} onClick={() => applyPreset("week")}>
        This Week
      </Button>
      <Button variant={activePreset === "month" ? "primary" : "secondary"} onClick={() => applyPreset("month")}>
        This Month
      </Button>
      <Button
        variant={activePreset === "custom" || showCustom ? "primary" : "secondary"}
        onClick={() => setShowCustom(true)}
      >
        Custom
      </Button>
      {(urlFrom || urlTo) && (
        <button type="button" onClick={clearRange} className="text-xs text-slate-500 hover:underline">
          Clear
        </button>
      )}
      {showCustom && (
        <div className="flex items-end gap-2">
          <div>
            <Label htmlFor="dateFrom">From</Label>
            <Input id="dateFrom" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="dateTo">To</Label>
            <Input id="dateTo" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </div>
          <Button onClick={() => pushRange(customFrom, customTo)} disabled={!customFrom || !customTo}>
            Apply
          </Button>
        </div>
      )}
    </div>
  );
}
