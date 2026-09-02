"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Select, Label } from "@/components/ui/Field";
import { FINDING_STATUSES, type ReportingPeriod, type District, type Branch, type Source, type ClassifiedCategory } from "@/types";
import { ALL_PERIODS_VALUE, type DashboardFilters } from "@/lib/dashboardFilters";

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
  /** Small caption under the bar, e.g. explaining what these filters do. */
  hint?: string;
}

/**
 * The BRD's shared filter bar (master.txt §10: "Period, District, Branch,
 * Source, Classified Case, Risk, Status"). Org fields are locked to the
 * caller's own scope when provided - "Filters must never bypass
 * organizational scope" - so a Branch user cannot pick a different branch
 * even in the UI. URL-driven, same convention as TimeRangeFilter's own
 * dateFrom/dateTo: every change pushes onto the query string, and the
 * server-component dashboard that renders this bar reads the same
 * searchParams (via parseDashboardFilters) to actually filter what it
 * shows - so a picked filter genuinely changes the page, not just this
 * control's own local state.
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
  hint,
}: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters: DashboardFilters = {
    periodId: searchParams.get("periodId") ?? defaultPeriodId ?? "",
    districtId: fixedDistrict?.id ?? searchParams.get("districtId") ?? "",
    branchId: fixedBranch?.id ?? searchParams.get("branchId") ?? "",
    sourceId: searchParams.get("sourceId") ?? "",
    categoryId: searchParams.get("categoryId") ?? "",
    risk: searchParams.get("risk") ?? "",
    status: searchParams.get("status") ?? "",
  };

  function update(patch: Partial<DashboardFilters>) {
    const next = { ...filters, ...patch };
    const params = new URLSearchParams(searchParams.toString());
    (Object.keys(next) as (keyof DashboardFilters)[]).forEach((key) => {
      // Never write a field the caller's org scope already locks - the
      // Select for it isn't even rendered, so there's nothing to reflect.
      if (key === "districtId" && fixedDistrict) return;
      if (key === "branchId" && fixedBranch) return;
      if (next[key]) params.set(key, next[key]);
      else params.delete(key);
    });
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  const branchOptions = filters.districtId ? branches.filter((b) => b.districtId === filters.districtId) : branches;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="f-period">Period</Label>
          {/* "All periods" is a real, explicit choice ("ALL"), never an
              empty/unset value - an empty periodId means "no filter picked
              yet," which every dashboard defaults to whichever period is
              currently OPEN. Without a distinct sentinel, picking "All
              periods" was indistinguishable from picking nothing at all and
              silently fell back to that same single open period - see each
              dashboard's own openPeriod/allPeriodsSelected computation. */}
          <Select id="f-period" value={filters.periodId} onChange={(e) => update({ periodId: e.target.value })}>
            <option value={ALL_PERIODS_VALUE}>All periods</option>
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

        {(filters.periodId !== (defaultPeriodId ?? "") ||
          filters.districtId !== (fixedDistrict?.id ?? "") ||
          filters.branchId !== (fixedBranch?.id ?? "") ||
          filters.sourceId ||
          filters.categoryId ||
          filters.risk ||
          filters.status) && (
          <button
            type="button"
            onClick={() =>
              update({
                periodId: defaultPeriodId ?? "",
                districtId: fixedDistrict?.id ?? "",
                branchId: fixedBranch?.id ?? "",
                sourceId: "",
                categoryId: "",
                risk: "",
                status: "",
              })
            }
            className="text-xs text-slate-500 hover:underline"
          >
            Reset filters
          </button>
        )}
      </div>
      {hint && <p className="mt-2 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
