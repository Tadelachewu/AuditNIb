"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  MRT_ColumnDef,
  MRT_ColumnFiltersState,
  MRT_PaginationState,
  MRT_RowData,
  MRT_SortingState,
  MRT_TableOptions,
  MRT_Updater,
} from "material-react-table";
import { ALL_ROWS } from "@/lib/pagination";
import { datedFileName, downloadCsv } from "@/lib/csv";
import { gridParam, type GridPage } from "@/lib/gridPage";

/**
 * The client half of a server-paged grid (src/lib/gridPage.ts): keeps the
 * table's page, search, column filters and sort in the URL under the
 * grid's own prefix; each change asks the server for that page (the
 * Server Component re-renders with just those rows). Export CSV asks the
 * server for the file the same way, then downloads it.
 *
 * Returns `tableOptions` for AdminTable, `columns` (with the server's
 * dropdown-filter choices) and `onExport`. With `exportFrom`, Export CSV
 * downloads from that API instead, with the page's current URL parameters
 * ("shown") or none ("all") - e.g. the Findings list's /api/findings/export.
 */
export function useGridUrlState<T extends MRT_RowData>(
  grid: GridPage<T>,
  columns: MRT_ColumnDef<T>[],
  exportFileName: string,
  opts: { exportFrom?: string } = {}
) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(grid.q);
  const [columnFilters, setColumnFilters] = useState<MRT_ColumnFiltersState>(grid.filters);
  const key = (name: string) => gridParam(grid.id, name);

  function setParams(changes: Record<string, string | null>, resetPage = false) {
    const qs = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") qs.delete(k);
      else qs.set(k, v);
    }
    if (resetPage) qs.delete(key("page"));
    const s = qs.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }

  // Search after a short typing pause.
  useEffect(() => {
    if (search === grid.q) return;
    const t = setTimeout(() => setParams({ [key("q")]: search || null }, true), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Column filters, after a short pause too (range boxes are typed into).
  useEffect(() => {
    const t = setTimeout(() => {
      const changes: Record<string, string | null> = {};
      for (const k of searchParams.keys()) {
        if (k.startsWith(key("f.")) || k.startsWith(key("min.")) || k.startsWith(key("max."))) changes[k] = null;
      }
      for (const f of columnFilters) {
        if (Array.isArray(f.value)) {
          const [lo, hi] = f.value as unknown[];
          if (lo !== undefined && lo !== null && lo !== "") changes[key(`min.${f.id}`)] = String(lo);
          if (hi !== undefined && hi !== null && hi !== "") changes[key(`max.${f.id}`)] = String(hi);
        } else if (f.value !== undefined && f.value !== null && f.value !== "") {
          changes[key(`f.${f.id}`)] = String(f.value);
        }
      }
      const current = [...searchParams.entries()].filter(([k]) => k in changes);
      const same =
        current.length === Object.values(changes).filter((v) => v !== null).length &&
        current.every(([k, v]) => changes[k] === v);
      if (!same) setParams(changes, true);
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnFilters]);

  // A requested export arrived with the page: download it once, then drop the request from the URL.
  const downloaded = useRef<string | null>(null);
  useEffect(() => {
    if (!grid.csv || downloaded.current === grid.csv.content) return;
    downloaded.current = grid.csv.content;
    downloadCsv(datedFileName(grid.csv.scope === "all" ? `${exportFileName}-all` : exportFileName), grid.csv.content);
    setParams({ [key("export")]: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid.csv]);

  const pagination: MRT_PaginationState = { pageIndex: grid.page - 1, pageSize: grid.pageSize };
  const sorting: MRT_SortingState = grid.sort ? [grid.sort] : [];

  const tableOptions: Partial<MRT_TableOptions<T>> = {
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    enableFacetedValues: false,
    enableMultiSort: false,
    rowCount: grid.total,
    onGlobalFilterChange: (v: unknown) => setSearch(typeof v === "string" ? v : ""),
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: (updater: MRT_Updater<MRT_PaginationState>) => {
      const next = typeof updater === "function" ? updater(pagination) : updater;
      const sizeChanged = next.pageSize !== pagination.pageSize;
      setParams({
        [key("page")]: sizeChanged || next.pageIndex === 0 ? null : String(next.pageIndex + 1),
        [key("size")]: next.pageSize === 25 ? null : next.pageSize >= ALL_ROWS ? "all" : String(next.pageSize),
      });
    },
    onSortingChange: (updater: MRT_Updater<MRT_SortingState>) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const s = next[0];
      setParams({ [key("sort")]: s ? s.id : "", [key("dir")]: s ? (s.desc ? "desc" : "asc") : null }, true);
    },
    state: { pagination, sorting, globalFilter: search, columnFilters, showGlobalFilter: true },
  };

  // Dropdown filters list every value in the whole table (from the server), not just this page's.
  const withFacets = columns.map((c) => {
    const id = (c.id ?? (c as { accessorKey?: string }).accessorKey) as string | undefined;
    return c.filterVariant === "select" && !c.filterSelectOptions && id && grid.facets[id] ? { ...c, filterSelectOptions: grid.facets[id] } : c;
  });

  function exportFromApi(endpoint: string, scope: "shown" | "all") {
    const qs = scope === "all" ? new URLSearchParams() : new URLSearchParams(searchParams.toString());
    qs.delete(key("page"));
    qs.delete(key("size"));
    const a = document.createElement("a");
    a.href = `${endpoint}?${qs.toString()}`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return {
    tableOptions,
    columns: withFacets,
    onExport: (scope: "shown" | "all") => (opts.exportFrom ? exportFromApi(opts.exportFrom, scope) : setParams({ [key("export")]: scope })),
  };
}
