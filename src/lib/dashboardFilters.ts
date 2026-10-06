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
/**
 * The FilterBar period Select's explicit "All periods" choice - never an
 * empty string, which already means something different ("no filter
 * picked yet," under which every dashboard defaults to whichever period is
 * currently OPEN). Without this distinct sentinel, picking "All periods"
 * was indistinguishable from picking nothing at all.
 */
export const ALL_PERIODS_VALUE = "ALL";

export interface DashboardFilters {
  periodId: string;
  districtId: string;
  branchId: string;
  sourceId: string;
  categoryId: string;
  risk: string;
  status: string;
  operationArea: string;
  irregularityType: string;
}

export const EMPTY_DASHBOARD_FILTERS: DashboardFilters = {
  periodId: "",
  districtId: "",
  branchId: "",
  sourceId: "",
  categoryId: "",
  risk: "",
  status: "",
  operationArea: "",
  irregularityType: "",
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
    operationArea: get("operationArea"),
    irregularityType: get("irregularityType"),
  };
}

/**
 * Filter match for the free-text list fields (Operation Area, Type of
 * Irregularity): a finding stores whatever the registrant picked or typed
 * (or an import sheet carried), so an exact === missed findings saved as
 * "cash operations" or "Cash  Operations " against the configured
 * "Cash Operations" filter value. Case-, spacing- and edge-whitespace-
 * insensitive. An empty filter value always matches (= no filter).
 */
export function matchesListValue(filterValue: string, findingValue: string | null | undefined): boolean {
  if (!filterValue) return true;
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return norm(findingValue ?? "") === norm(filterValue);
}

/** Operation Area + Type of Irregularity together - every findings list/export applies both. */
export function matchesOperationAndIrregularity(
  f: Pick<Finding, "operationArea" | "irregularityType">,
  filters: { operationArea: string; irregularityType: string }
): boolean {
  return matchesListValue(filters.operationArea, f.operationArea) && matchesListValue(filters.irregularityType, f.irregularityType);
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
      (!filters.status || f.status === filters.status) &&
      matchesOperationAndIrregularity(f, filters)
  );
}

/**
 * The Findings list address for a dashboard chart click: the dashboard's own
 * filters carried over (district, branch, source, category, risk, status,
 * operation area, irregularity type, date range), its period (the selected
 * one, "ALL", or the current period it defaulted to), `current=1` (only
 * findings currently in that period - the same set the dashboard counts),
 * then the clicked segment's own values in `extra`, which win.
 */
export function dashboardFindingsHref(
  filters: DashboardFilters,
  dateRange: { from?: string; to?: string },
  periodId: string,
  extra: Record<string, string> = {}
): string {
  const qs = new URLSearchParams();
  const set = (k: string, v: string | undefined) => {
    if (v) qs.set(k, v);
  };
  set("periodId", periodId);
  set("districtId", filters.districtId);
  set("branchId", filters.branchId);
  set("sourceId", filters.sourceId);
  set("categoryId", filters.categoryId);
  set("risk", filters.risk);
  set("status", filters.status);
  set("operationArea", filters.operationArea);
  set("irregularityType", filters.irregularityType);
  set("dateFrom", dateRange.from);
  set("dateTo", dateRange.to);
  if (periodId && periodId !== ALL_PERIODS_VALUE) qs.set("current", "1");
  for (const [k, v] of Object.entries(extra)) set(k, v);
  return `/findings?${qs.toString()}`;
}
