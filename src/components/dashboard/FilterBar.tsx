"use client";

import { useState } from "react";
import { Select, Label } from "@/components/ui/Field";
import { FINDING_STATUSES, type ReportingPeriod, type District, type Branch, type Source, type ClassifiedCategory } from "@/types";

export interface DashboardFilters {
  periodId: string;
  districtId: string;
  branchId: string;
  sourceId: string;
  categoryId: string;
  risk: string;
  status: string;
}

export const EMPTY_FILTERS: DashboardFilters = {
  periodId: "",
  districtId: "",
  branchId: "",
  sourceId: "",
  categoryId: "",
  risk: "",
  status: "",
};

export interface FilterBarProps {
  periods: ReportingPeriod[];
  districts: District[];
  branches: Branch[];
  sources: Source[];
  categories: ClassifiedCategory[];
  riskLevels: string[];
  defaultPeriodId?: string;
  /** Org fields the caller's role may not widen past their own scope - shown fixed, not editable. */
  fixedDistrict?: { id: string; name: string };
  fixedBranch?: { id: string; name: string };
  onChange?: (filters: DashboardFilters) => void;
  /** Small caption under the bar, e.g. explaining what these filters do (or don't yet) drive. */
  hint?: string;
}

/**
 * The BRD's shared filter bar (master.txt §10: "Period, District, Branch,
 * Source, Classified Case, Risk, Status"). Org fields are locked to the
 * caller's own scope when provided - "Filters must never bypass
 * organizational scope" - so a Branch user cannot pick a different branch
 * even in the UI. State is local only for now: there is no Finding query
 * yet for these to drive, so this establishes the correct control set
 * ahead of that (see PHASE4.md).
 */
export function FilterBar({
  periods,
  districts,
  branches,
  sources,
  categories,
  riskLevels,
  defaultPeriodId,
  fixedDistrict,
  fixedBranch,
  onChange,
  hint,
}: FilterBarProps) {
  const [filters, setFilters] = useState<DashboardFilters>({
    ...EMPTY_FILTERS,
    periodId: defaultPeriodId ?? "",
    districtId: fixedDistrict?.id ?? "",
    branchId: fixedBranch?.id ?? "",
  });

  function update(patch: Partial<DashboardFilters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    onChange?.(next);
  }

  const branchOptions = filters.districtId ? branches.filter((b) => b.districtId === filters.districtId) : branches;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="f-period">Period</Label>
          <Select id="f-period" value={filters.periodId} onChange={(e) => update({ periodId: e.target.value })}>
            <option value="">All periods</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} {p.status === "LOCKED" ? "(locked)" : ""}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="f-district">District</Label>
          {fixedDistrict ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-500">
              {fixedDistrict.name}
            </p>
          ) : (
            <Select
              id="f-district"
              value={filters.districtId}
              onChange={(e) => update({ districtId: e.target.value, branchId: "" })}
            >
              <option value="">All districts</option>
              {districts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </div>

        <div>
          <Label htmlFor="f-branch">Branch</Label>
          {fixedBranch ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-500">
              {fixedBranch.name}
            </p>
          ) : (
            <Select id="f-branch" value={filters.branchId} onChange={(e) => update({ branchId: e.target.value })}>
              <option value="">All branches</option>
              {branchOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          )}
        </div>

        <div>
          <Label htmlFor="f-source">Source</Label>
          <Select id="f-source" value={filters.sourceId} onChange={(e) => update({ sourceId: e.target.value })}>
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="f-category">Classified Case</Label>
          <Select id="f-category" value={filters.categoryId} onChange={(e) => update({ categoryId: e.target.value })}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="f-risk">Risk</Label>
          <Select id="f-risk" value={filters.risk} onChange={(e) => update({ risk: e.target.value })}>
            <option value="">All risk levels</option>
            {riskLevels.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="f-status">Status</Label>
          <Select id="f-status" value={filters.status} onChange={(e) => update({ status: e.target.value })}>
            <option value="">All statuses</option>
            {FINDING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {hint && <p className="mt-2 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
