"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ALL_ROWS } from "@/lib/pagination";
import type { MRT_TableOptions, MRT_RowData, MRT_Updater, MRT_PaginationState, MRT_SortingState } from "material-react-table";

/**
 * Server-mode table state kept in the URL (page, pageSize, sort, dir, q):
 * for lists the server searches/sorts/pages itself - the Findings list and
 * the Reports page's Findings Report (see src/lib/findingListQuery.ts).
 * Returns the MRT options to spread into AdminTable's `tableOptions`.
 * A view is shareable and survives refresh; search is applied after a
 * short typing pause; any new search or sort goes back to page 1.
 */
export function useUrlTableState<T extends MRT_RowData>({
  paging,
  sort,
  searchText,
  defaultPageSize = 25,
}: {
  paging: { page: number; pageSize: number; total: number };
  sort: { id: string; desc: boolean };
  searchText: string;
  defaultPageSize?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchText);

  function setParams(changes: Record<string, string | null>) {
    const qs = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") qs.delete(k);
      else qs.set(k, v);
    }
    const s = qs.toString();
    router.push(s ? `${pathname}?${s}` : pathname);
  }

  useEffect(() => {
    if ((search ?? "") === (searchText ?? "")) return;
    const t = setTimeout(() => setParams({ q: search || null, page: null }), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const current: MRT_PaginationState = { pageIndex: paging.page - 1, pageSize: paging.pageSize };
  const sorting: MRT_SortingState = [{ id: sort.id, desc: sort.desc }];

  const tableOptions: Partial<MRT_TableOptions<T>> = {
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    enableFacetedValues: false,
    enableMultiSort: false,
    rowCount: paging.total,
    onGlobalFilterChange: (v: unknown) => setSearch(typeof v === "string" ? v : ""),
    onPaginationChange: (updater: MRT_Updater<MRT_PaginationState>) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      setParams({
        page: next.pageSize !== current.pageSize || next.pageIndex === 0 ? null : String(next.pageIndex + 1),
        pageSize: next.pageSize === defaultPageSize ? null : next.pageSize === ALL_ROWS ? "all" : String(next.pageSize),
      });
    },
    onSortingChange: (updater: MRT_Updater<MRT_SortingState>) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const s = next[0];
      setParams({ sort: s ? s.id : null, dir: s ? (s.desc ? "desc" : "asc") : null, page: null });
    },
  };

  /**
   * Download via a server CSV endpoint: "shown" = every row matching the
   * current URL filters / search / sort; "all" = the whole list (no filters).
   */
  function exportFrom(endpoint: string, scope: "shown" | "all" = "shown") {
    const qs = scope === "all" ? new URLSearchParams() : new URLSearchParams(searchParams.toString());
    qs.delete("page");
    qs.delete("pageSize");
    const a = document.createElement("a");
    a.href = `${endpoint}?${qs.toString()}`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return {
    tableOptions,
    state: { pagination: current, sorting, globalFilter: search, showGlobalFilter: true },
    exportFrom,
  };
}
