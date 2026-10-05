"use client";

import { useEffect, useMemo, useState } from "react";
import type { MRT_ColumnDef, MRT_ColumnFiltersState, MRT_PaginationState, MRT_SortingState } from "material-react-table";
import { apiGet } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { AdminTable, PAGE_SIZE_OPTIONS, type ExportScope } from "@/components/ui/AdminTable";
import type { AuditLogEntry } from "@/types";

interface AuditResponse {
  auditLogs: AuditLogEntry[];
  total: number;
  actions: string[];
  entityTypes: string[];
  chainValid: boolean;
  chainBrokenAtSequence?: string;
}

// Server-side mode: the log can be far larger than a browser should load,
// so search / filters / sort / paging are sent to /api/admin/audit-log and
// only the current page comes back. Export CSV asks the server for every
// matching entry.
export default function AuditLogPage() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<MRT_PaginationState>({ pageIndex: 0, pageSize: 50 });
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnFilters, setColumnFilters] = useState<MRT_ColumnFiltersState>([]);
  const [sorting, setSorting] = useState<MRT_SortingState>([{ id: "timestamp", desc: true }]);

  const query = useMemo(() => {
    const qs = new URLSearchParams();
    qs.set("page", String(pagination.pageIndex + 1));
    qs.set("pageSize", String(pagination.pageSize));
    if (globalFilter) qs.set("q", globalFilter);
    for (const f of columnFilters) {
      if (f.id === "action" && f.value) qs.set("action", String(f.value));
      if (f.id === "entityType" && f.value) qs.set("entityType", String(f.value));
      if (f.id === "userName" && f.value) qs.set("actor", String(f.value));
      if (f.id === "timestamp" && Array.isArray(f.value)) {
        const [from, to] = f.value as [string | undefined, string | undefined];
        if (from) qs.set("from", String(from));
        if (to) qs.set("to", String(to));
      }
    }
    qs.set("sort", sorting[0]?.desc === false ? "asc" : "desc");
    return qs;
  }, [pagination, globalFilter, columnFilters, sorting]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet<AuditResponse>(`/api/admin/audit-log?${query.toString()}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  // Any new search/filter starts again from page 1.
  useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [globalFilter, columnFilters]);

  const columns = useMemo<MRT_ColumnDef<AuditLogEntry>[]>(
    () => [
      {
        accessorKey: "timestamp",
        header: "Time",
        // From / To as two plain date fields (YYYY-MM-DD), matched by day.
        filterVariant: "range",
        muiFilterTextFieldProps: { type: "date", InputLabelProps: { shrink: true } },
        enableSorting: true,
        Cell: ({ row }) => <span className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(row.original.timestamp)}</span>,
      },
      { accessorKey: "userName", header: "Actor", enableSorting: false },
      {
        accessorKey: "action",
        header: "Action",
        enableSorting: false,
        filterVariant: "select",
        filterSelectOptions: data?.actions ?? [],
        Cell: ({ row }) => <Badge tone="blue">{row.original.action}</Badge>,
      },
      { accessorKey: "entityType", header: "Entity", enableSorting: false, filterVariant: "select", filterSelectOptions: data?.entityTypes ?? [] },
      { accessorKey: "reason", header: "Reason", enableSorting: false, enableColumnFilter: false, Cell: ({ row }) => <>{row.original.reason ?? "—"}</> },
    ],
    [data?.actions, data?.entityTypes]
  );

  const chain = data ? { valid: data.chainValid, brokenAtSequence: data.chainBrokenAtSequence } : null;

  // "shown" = every entry matching the search / filters; "all" = the whole log.
  function exportAll(scope: ExportScope) {
    const qs = scope === "all" ? new URLSearchParams() : new URLSearchParams(query);
    qs.delete("page");
    qs.delete("pageSize");
    qs.set("format", "csv");
    // A download link rather than a navigation - the file is served with
    // Content-Disposition: attachment, so the page stays where it is.
    const a = document.createElement("a");
    a.href = `/api/admin/audit-log?${qs.toString()}`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-slate-900">Audit Log</h1>
        {chain && (
          <Badge tone={chain.valid ? "green" : "red"}>
            {chain.valid ? "Chain verified" : `Tampering detected at entry #${chain.brokenAtSequence}`}
          </Badge>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Immutable record of workflow, configuration and authentication events - every entry is cryptographically chained to the one
        before it, so an edit or deletion made directly in the database (bypassing this app) is detectable, not just assumed impossible.
      </p>

      <Card className="mt-5">
        <CardHeader title="Events" description={`${data?.total ?? 0} matching`} />
        <AdminTable
          columns={columns}
          data={data?.auditLogs ?? []}
          isLoading={loading && !data}
          getRowId={(l) => l.id}
          onExport={exportAll}
          emptyText="No events match."
          tableOptions={{
            manualPagination: true,
            manualFiltering: true,
            manualSorting: true,
            enableFacetedValues: false,
            enableMultiSort: false,
            rowCount: data?.total ?? 0,
            onPaginationChange: setPagination,
            onGlobalFilterChange: setGlobalFilter,
            onColumnFiltersChange: setColumnFilters,
            onSortingChange: setSorting,
            state: { pagination, globalFilter, columnFilters, sorting, isLoading: loading && !data, showProgressBars: loading && !!data },
            muiPaginationProps: { rowsPerPageOptions: PAGE_SIZE_OPTIONS, showFirstButton: true, showLastButton: true },
          }}
        />
      </Card>
    </div>
  );
}
