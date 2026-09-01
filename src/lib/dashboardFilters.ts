import type { Finding } from "@/types";

/**
 * master.txt §10's shared dashboard FilterBar (Period, District, Branch,
 * Source, Classified Case, Risk, Status). Previously this was UI-only -
 * FilterBar kept its own local useState and never told any dashboard about
 * it, so every selector was decorative. Now it's URL-driven, the same
 * pattern TimeRangeFilter already uses for date range: FilterBar
 * (src/components/dashboard/FilterBar.tsx) pushes these onto the query
 * string, and each dashboard page parses them straight from
 * `searchParams` server-side - no client fetch, no duplicated state.
 */
export interface DashboardFilters {
  periodId: string;
  districtId: string;
  branchId: string;
  sourceId: string;
  categoryId: string;
  risk: string;
  status: string;
}

export const EMPTY_DASHBOARD_FILTERS: DashboardFilters = {
  periodId: "",
  districtId: "",
  branchId: "",
  sourceId: "",
  categoryId: "",
  risk: "",
  status: "",
};

export function parseDashboardFilters(searchParams: Record<string, string | string[] | undefined>): DashboardFilters {
  const get = (key: string): string => {
    const v = searchParams[key];
    return typeof v === "string" ? v : "";
  };
  return {
    periodId: get("periodId"),
    districtId: get("districtId"),
    branchId: get("branchId"),
    sourceId: get("sourceId"),
    categoryId: get("categoryId"),
    risk: get("risk"),
    status: get("status"),
  };
}

/**
 * Applies every field except `periodId` to a findings list - a dashboard
 * resolves its own "effective period" separately (picking which
 * ReportingPeriod counts as `openPeriod` changes what the whole page
 * means, not just which findings show), so callers filter by period
 * themselves via whichever period they resolve to. Every other field is
 * always safe to apply even when the caller's own org scope already fixes
 * it (e.g. a Branch dashboard filtering by its own branchId is a no-op),
 * so this never needs to know which fields are "already fixed."
 */
export function applyDashboardFilters(findings: Finding[], filters: DashboardFilters): Finding[] {
  return findings.filter(
    (f) =>
      (!filters.districtId || f.districtId === filters.districtId) &&
      (!filters.branchId || f.branchId === filters.branchId) &&
      (!filters.sourceId || f.sourceId === filters.sourceId) &&
      (!filters.categoryId || f.categoryId === filters.categoryId) &&
      (!filters.risk || f.riskLevel === filters.risk) &&
      (!filters.status || f.status === filters.status)
  );
}
