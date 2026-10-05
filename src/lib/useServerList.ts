"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MRT_ColumnDef, MRT_ColumnFiltersState, MRT_PaginationState, MRT_RowData, MRT_SortingState, MRT_TableOptions } from "material-react-table";
import { apiGet } from "@/lib/api-client";
import { ALL_ROWS } from "@/lib/pagination";
import { downloadCsv, datedFileName, toCsv, type CsvColumn } from "@/lib/csv";

/**
 * The client half of a server-paged table (the server half is
 * runListQuery() in src/lib/serverList.ts). Keeps the table's page, search,
 * column filters and sort, asks `endpoint` for just that page, and returns:
 *   rows, total, loading, reload()   - for the page
 *   tableOptions                     - spread into <AdminTable tableOptions>
 *   withFacets(columns)              - fills dropdown filters' choices from the server
 *   exportCsv(scope, columns, name)  - Export CSV of every matching row (or the whole list)
 * Search waits for a short typing pause; any new search / filter / sort goes back to page 1.
 */
export function useServerList<T extends MRT_RowData>(
  endpoint: string,
  opts: { key: string; defaultSort?: { id: string; desc: boolean }; pageSize?: number; params?: Record<string, string> }
) {
  const [pagination, setPagination] = useState<MRT_PaginationState>({ pageIndex: 0, pageSize: opts.pageSize ?? 25 });
  const [globalFilter, setGlobalFilter] = useState("");
  const [search, setSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<MRT_ColumnFiltersState>([]);
  const [sorting, setSorting] = useState<MRT_SortingState>(opts.defaultSort ? [opts.defaultSort] : []);
  const [data, setData] = useState<{ rows: T[]; total: number; facets: Record<string, string[]>; meta: Record<string, unknown> }>({
    rows: [],
    total: 0,
    facets: {},
    meta: {},
  });
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState(0);
  const extra = JSON.stringify(opts.params ?? {});

  // Search after a short typing pause.
  useEffect(() => {
    const t = setTimeout(() => setSearch(globalFilter), 400);
    return () => clearTimeout(t);
  }, [globalFilter]);

  // Any new search or filter starts again from page 1.
  useEffect(() => {
    setPagination((p) => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 }));
  }, [search, columnFilters, sorting]);

  const filterParams = useCallback(
    (includeFilters: boolean) => {
      const qs = new URLSearchParams(JSON.parse(extra) as Record<string, string>);
      if (!includeFilters) return qs;
      if (search) qs.set("q", search);
      for (const f of columnFilters) {
        if (Array.isArray(f.value)) {
          const [lo, hi] = f.value as [unknown, unknown];
          if (lo !== undefined && lo !== null && lo !== "") qs.set(`fmin_${f.id}`, String(lo));
          if (hi !== undefined && hi !== null && hi !== "") qs.set(`fmax_${f.id}`, String(hi));
        } else if (f.value !== undefined && f.value !== null && f.value !== "") {
          qs.set(`f_${f.id}`, String(f.value));
        }
      }
      const s = sorting[0];
      if (s) {
        qs.set("sort", s.id);
        qs.set("dir", s.desc ? "desc" : "asc");
      }
      return qs;
    },
    [extra, search, columnFilters, sorting]
  );

  useEffect(() => {
    let cancelled = false;
    const qs = filterParams(true);
    qs.set("page", String(pagination.pageIndex + 1));
    qs.set("pageSize", pagination.pageSize >= ALL_ROWS ? "all" : String(pagination.pageSize));
    setLoading(true);
    apiGet<Record<string, unknown> & { total: number; facets?: Record<string, string[]> }>(`${endpoint}?${qs.toString()}`)
      .then((res) => {
        if (cancelled) return;
        // A page past the end (e.g. after deleting the last row on it) -> the server sends the last page.
        const served = typeof res.page === "number" ? res.page - 1 : pagination.pageIndex;
        if (served !== pagination.pageIndex) setPagination((p) => ({ ...p, pageIndex: served }));
        setData({ rows: (res[opts.key] as T[]) ?? [], total: res.total ?? 0, facets: res.facets ?? {}, meta: res });
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, filterParams, pagination, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  const tableOptions: Partial<MRT_TableOptions<T>> = {
    manualPagination: true,
    manualFiltering: true,
    manualSorting: true,
    enableFacetedValues: false,
    enableMultiSort: false,
    rowCount: data.total,
    onPaginationChange: setPagination,
    onGlobalFilterChange: (v: unknown) => setGlobalFilter(typeof v === "string" ? v : ""),
    onColumnFiltersChange: setColumnFilters,
    onSortingChange: setSorting,
    state: {
      pagination,
      globalFilter,
      columnFilters,
      sorting,
      isLoading: !loaded,
      showSkeletons: !loaded,
      showProgressBars: loaded && loading,
    },
  };

  /** Dropdown ("select") filters get their choices from the server (the whole list, not just this page). */
  const withFacets = useCallback(
    (columns: MRT_ColumnDef<T>[]): MRT_ColumnDef<T>[] =>
      columns.map((c) => {
        const id = (c.id ?? (c as { accessorKey?: string }).accessorKey) as string | undefined;
        return c.filterVariant === "select" && !c.filterSelectOptions && id && data.facets[id] ? { ...c, filterSelectOptions: data.facets[id] } : c;
      }),
    [data.facets]
  );

  /** "shown" = every row matching the search / filters / sort; "all" = the whole list. */
  async function exportCsv(scope: "shown" | "all", columns: MRT_ColumnDef<T>[], fileBase: string) {
    const qs = filterParams(scope === "shown");
    qs.set("page", "1");
    qs.set("pageSize", "all");
    const res = await apiGet<Record<string, unknown>>(`${endpoint}?${qs.toString()}`);
    const rows = (res[opts.key] as T[]) ?? [];
    downloadCsv(datedFileName(scope === "all" ? `${fileBase}-all` : fileBase), toCsv(rows, csvColumnsFor(columns)));
  }

  // `meta` = the whole last response, for anything else the API sends along with the page.
  const result = useMemo(() => ({ rows: data.rows, total: data.total, facets: data.facets, meta: data.meta }), [data]);
  return { ...result, loading: !loaded, reload, tableOptions, withFacets, exportCsv };
}

export type ServerList<T extends MRT_RowData> = ReturnType<typeof useServerList<T>>;

type ExportMeta<T> = { exportValue?: (row: T) => string | number | boolean | null | undefined };

/** CSV columns from table columns: header text, and each row's export value (meta.exportValue, else the column's value). */
export function csvColumnsFor<T extends MRT_RowData>(columns: MRT_ColumnDef<T>[]): CsvColumn<T>[] {
  return columns
    .filter((c) => typeof c.header === "string" && c.header && (c.accessorFn || (c as { accessorKey?: string }).accessorKey))
    .map((c) => {
      const meta = c.meta as ExportMeta<T> | undefined;
      const key = (c as { accessorKey?: string }).accessorKey;
      return {
        header: c.header as string,
        value: (row: T) => {
          if (meta?.exportValue) return meta.exportValue(row) ?? "";
          const v = c.accessorFn ? c.accessorFn(row) : key ? (row as Record<string, unknown>)[key] : "";
          return v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : (v as string | number | boolean);
        },
      };
    });
}

/**
 * Server paging for card lists that use the <Pagination> bar instead of a
 * table (Roles, Scoring Rules, Import History, Support). Same API side as
 * useServerList (listPageJson); returns the same shape as
 * the old client-side pager (page, setPage, pageItems, total, totalPages,
 * pageSize) plus loading / reload / meta.
 */
export function useServerPager<T>(endpoint: string, key: string, opts: { pageSize?: number; params?: Record<string, string> } = {}) {
  const pageSize = opts.pageSize ?? 25;
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{ items: T[]; total: number; totalPages: number; meta: Record<string, unknown>; loaded: boolean }>({
    items: [],
    total: 0,
    totalPages: 1,
    meta: {},
    loaded: false,
  });
  const extra = JSON.stringify(opts.params ?? {});

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams(JSON.parse(extra) as Record<string, string>);
    qs.set("page", String(page));
    qs.set("pageSize", String(pageSize));
    apiGet<Record<string, unknown> & { total: number; totalPages: number; page: number }>(`${endpoint}?${qs.toString()}`)
      .then((res) => {
        if (cancelled) return;
        // A page past the end (e.g. after deleting the last item on it) -> the last page.
        if (res.page && res.page !== page) setPage(res.page);
        setState({ items: (res[key] as T[]) ?? [], total: res.total ?? 0, totalPages: Math.max(1, res.totalPages ?? 1), meta: res, loaded: true });
      })
      .catch(() => {
        if (!cancelled) setState((s) => ({ ...s, loaded: true }));
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint, key, extra, page, pageSize, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { page, setPage, pageItems: state.items, total: state.total, totalPages: state.totalPages, pageSize, loading: !state.loaded, reload, meta: state.meta };
}
