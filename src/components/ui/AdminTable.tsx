"use client";

import type { ReactNode } from "react";
import {
  MaterialReactTable,
  useMaterialReactTable,
  type MRT_ColumnDef,
  type MRT_RowData,
  type MRT_TableInstance,
  type MRT_TableOptions,
} from "material-react-table";
import { Download } from "lucide-react";
import { toCsv, downloadCsv, datedFileName, type CsvColumn } from "@/lib/csv";

/**
 * Every admin list table: Material React Table (material-react-table.com)
 * with one set of defaults, so all lists behave the same -
 *   global search + per-column filters, click-to-sort headers, show/hide
 *   columns, density, full screen, 25/page pagination (pinned to the
 *   bottom of the screen while scrolling), skeleton rows while loading,
 *   the row "Actions" menu in the last column, and Export CSV of exactly
 *   what's shown (search + filters + sort applied, all pages).
 *
 * Columns: `accessorFn`/`accessorKey` should return the plain value used
 * for sorting, filtering and export; `Cell` can render anything richer.
 * A column can override its exported value with `meta.exportValue`.
 * Theme (brand colours, dark mode, font): MuiProvider.tsx.
 */

type ExportMeta<T> = { exportValue?: (row: T) => string | number | boolean | null | undefined };

function exportRows<T extends MRT_RowData>(table: MRT_TableInstance<T>, fileBase: string) {
  const columns = table
    .getVisibleLeafColumns()
    // Data columns only (not the actions/select display columns).
    .filter((c) => !c.id.startsWith("mrt-") && Boolean(c.accessorFn));
  const csvColumns: CsvColumn<{ original: T; getValue: (id: string) => unknown }>[] = columns.map((c) => {
    const meta = c.columnDef.meta as ExportMeta<T> | undefined;
    return {
      header: typeof c.columnDef.header === "string" ? c.columnDef.header : c.id,
      value: (r) => {
        if (meta?.exportValue) return meta.exportValue(r.original);
        const v = r.getValue(c.id);
        return v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : (v as string | number | boolean);
      },
    };
  });
  const rows = table.getPrePaginationRowModel().rows;
  downloadCsv(datedFileName(fileBase), toCsv(rows, csvColumns));
}

export function AdminTable<T extends MRT_RowData>({
  columns,
  data,
  isLoading = false,
  exportFileName,
  onExport,
  toolbarActions,
  renderRowActions,
  getRowId,
  emptyText = "No records yet.",
  tableOptions,
}: {
  columns: MRT_ColumnDef<T>[];
  data: T[];
  isLoading?: boolean;
  /** Enables "Export CSV" (client-side, of the current filtered + sorted rows). */
  exportFileName?: string;
  /** Replaces the client-side export (e.g. a server export for server-paged data). */
  onExport?: () => void;
  /** Extra buttons at the top-left of the toolbar (e.g. Import CSV). */
  toolbarActions?: ReactNode;
  renderRowActions?: (row: T) => ReactNode;
  getRowId?: (row: T) => string;
  emptyText?: string;
  /** Escape hatch for anything else (e.g. manual/server-side mode). */
  tableOptions?: Partial<MRT_TableOptions<T>>;
}) {
  const table = useMaterialReactTable<T>({
    columns,
    data,
    getRowId,
    enableRowActions: Boolean(renderRowActions),
    positionActionsColumn: "last",
    renderRowActions: renderRowActions ? ({ row }) => renderRowActions(row.original) : undefined,
    displayColumnDefOptions: {
      "mrt-row-actions": {
        header: "",
        size: 120,
        muiTableHeadCellProps: { align: "right" },
        muiTableBodyCellProps: { align: "right" },
      },
    },
    enableColumnResizing: false,
    enableFacetedValues: true,
    enableStickyHeader: false,
    enableDensityToggle: true,
    enableFullScreenToggle: true,
    enableColumnActions: true,
    columnFilterDisplayMode: "subheader",
    positionGlobalFilter: "left",
    initialState: {
      density: "compact",
      showGlobalFilter: true,
      showColumnFilters: false,
      pagination: { pageIndex: 0, pageSize: 25 },
    },
    state: { isLoading, showSkeletons: isLoading },
    muiPaginationProps: { rowsPerPageOptions: [10, 25, 50, 100], showFirstButton: true, showLastButton: true },
    muiSearchTextFieldProps: { placeholder: "Search all columns", size: "small", variant: "outlined" },
    muiTablePaperProps: { elevation: 0, sx: { borderRadius: 0, overflow: "visible", backgroundColor: "transparent" } },
    muiTableHeadCellProps: {
      sx: { fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.025em", color: "text.secondary", fontWeight: 600 },
    },
    muiTableBodyCellProps: { sx: { fontSize: "0.875rem" } },
    // Pagination pinned to the bottom of the screen while the list scrolls
    // (same behaviour as the rest of the app's lists).
    // Toolbars (search, export, page bar) are hidden when printing - only
    // the rows print (the "no-print" rule, e.g. on the Reports page).
    muiTopToolbarProps: { className: "no-print" },
    muiBottomToolbarProps: {
      className: "no-print",
      sx: { position: "sticky", bottom: 0, zIndex: 3, backgroundColor: "background.paper", borderTop: 1, borderColor: "divider" },
    },
    localization: { noRecordsToDisplay: emptyText },
    renderTopToolbarCustomActions: ({ table: t }) =>
      exportFileName || onExport || toolbarActions ? (
        <div className="flex flex-wrap items-center gap-2">
          {toolbarActions}
          {(exportFileName || onExport) && (
            <button
              type="button"
              onClick={() => (onExport ? onExport() : exportRows(t, exportFileName!))}
              title="Export the rows currently shown (search, filters and sort applied, all pages) as CSV"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          )}
        </div>
      ) : null,
    ...tableOptions,
  });
  return <MaterialReactTable table={table} />;
}
