"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { FilterBar, type DashboardFilters } from "@/components/dashboard/FilterBar";
import type { ReportingPeriod, District, Branch, Source, ClassifiedCategory } from "@/types";

/**
 * Wraps the shared FilterBar (built inert in Phase 4) with real behavior:
 * every change pushes the new values onto the URL's query string, which
 * src/app/(app)/findings/page.tsx (a Server Component) reads directly to
 * re-query the scoped finding list - no client-side fetch/state duplication.
 */
export function FindingsFilterBar(props: {
  periods: ReportingPeriod[];
  districts: District[];
  branches: Branch[];
  sources: Source[];
  categories: ClassifiedCategory[];
  riskLevels: string[];
  fixedDistrict?: { id: string; name: string };
  fixedBranch?: { id: string; name: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(filters: DashboardFilters) {
    const params = new URLSearchParams();
    if (filters.periodId) params.set("periodId", filters.periodId);
    if (filters.districtId) params.set("districtId", filters.districtId);
    if (filters.branchId) params.set("branchId", filters.branchId);
    if (filters.sourceId) params.set("sourceId", filters.sourceId);
    if (filters.categoryId) params.set("categoryId", filters.categoryId);
    if (filters.risk) params.set("risk", filters.risk);
    if (filters.status) params.set("status", filters.status);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <FilterBar
      {...props}
      defaultPeriodId={searchParams.get("periodId") ?? undefined}
      onChange={handleChange}
      hint="Filters apply immediately."
    />
  );
}
