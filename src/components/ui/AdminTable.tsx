"use client";

import { useState, type ReactNode } from "react";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemText from "@mui/material/ListItemText";
import {
  MaterialReactTable,
  useMaterialReactTable,
  type MRT_ColumnDef,
  type MRT_RowData,
  type MRT_TableInstance,
  type MRT_TableOptions,
} from "material-react-table";
import { ChevronDown, Download } from "lucide-react";
import { toCsv, downloadCsv, datedFileName, type CsvColumn } from "@/lib/csv";
import { ALL_ROWS } from "@/lib/pagination";

/** Rows-per-page menu of every table: 10 / 25 / 50 / 100 / All. */
export const PAGE_SIZE_OPTIONS = [...[10, 25, 50, 100].map((n) => ({ label: String(n), value: n })), { label: "All", value: ALL_ROWS }];

/**
 * What Export CSV downloads: "shown" = the rows the search / filters leave
 * (sorted, every page); "all" = the whole table, ignoring search and filters.
 */
export type ExportScope = "shown" | "all";

/**
 * Every admin list table: Material React Table (material-react-table.com)
 * with one set of defaults, so all lists behave the same -
 *   global search + per-column filters, click-to-sort headers, show/hide
 *   columns, density, full screen, 25/page pagination (pinned to the
 *   bottom of the screen while scrolling), skeleton rows while loading,
 *   the row "Actions" menu in the last column, an "All" rows-per-page
 *   choice, and an Export CSV menu: the rows shown (search + filters +
 *   sort applied, all pages) or the full table.
 *
 * Columns: `accessorFn`/`accessorKey` should return the plain value used
 * for sorting, filtering and export; `Cell` can render anything richer.
 * A column can override its exported value with `meta.exportValue`.
 * Theme (brand colours, dark mode, font): MuiProvider.tsx.
 */

type ExportMeta<T> = { exportValue?: (row: T) => string | number | boolean | null | undefined };

function exportRows<T extends MRT_RowData>(table: MRT_TableInstance<T>, fileBase: string, scope: ExportScope) {
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
  const rows = scope === "all" ? table.getCoreRowModel().rows : table.getPrePaginationRowModel().rows;
  downloadCsv(datedFileName(scope === "all" ? `${fileBase}-all` : fileBase), toCsv(rows, csvColumns));
}

/** The toolbar's Export CSV button and its "rows shown / full table" menu. */
function ExportMenu<T extends MRT_RowData>({ table, onPick }: { table: MRT_TableInstance<T>; onPick: (scope: ExportScope) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const server = Boolean(table.options.manualPagination);
  const shown = server ? table.getRowCount() : table.getPrePaginationRowModel().rows.length;
  const all = server ? null : table.getCoreRowModel().rows.length;
  function pick(scope: ExportScope) {
    setAnchor(null);
    onPick(scope);
  }
  return (
    <>
      <button
        type="button"
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-haspopup="menu"
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
      >
        <Download className="h-4 w-4" />
        Export CSV
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem onClick={() => pick("shown")}>
          <ListItemText primary={`Rows shown (${shown.toLocaleString()})`} secondary="Search, filters and sort applied - all pages" />
        </MenuItem>
        <MenuItem onClick={() => pick("all")}>
          <ListItemText
            primary={all === null ? "Full table" : `Full table (${all.toLocaleString()})`}
            secondary="Every row, ignoring search and filters"
          />
        </MenuItem>
      </Menu>
    </>
  );
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
  onExport?: (scope: ExportScope) => void;
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
    // Not while loading: MRT fills the skeleton with empty placeholder rows,
    // and computing filter dropdown values runs every accessorFn on them
    // (a column reading `row.names.length` would crash the whole page).
    enableFacetedValues: !isLoading,
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
    muiPaginationProps: { rowsPerPageOptions: PAGE_SIZE_OPTIONS, showFirstButton: true, showLastButton: true },
    muiSearchTextFieldProps: { placeholder: "Search all columns", size: "small", variant: "outlined" },
    // Table body = the card's own colour (white), the same as an open Settings
    // section - not the theme's grey page background, MRT's default. The
    // Clean white template re-tints it with the card colour (globals.css).
    mrtTheme: (theme) => ({ baseBackgroundColor: theme.palette.background.paper }),
    muiTablePaperProps: { elevation: 0, sx: { borderRadius: 0, overflow: "visible", backgroundColor: "transparent" } },
    muiTableHeadCellProps: {
      sx: { fontSize: "0.75rem", color: "text.secondary", fontWeight: 600 },
    },
    muiTableBodyCellProps: { sx: { fontSize: "0.875rem" } },
    // Pagination pinned to the bottom of the screen while the list scrolls
    // (same behaviour as the rest of the app's lists).
    // Toolbars (search, export, page bar) are hidden when printing - only
    // the rows print (the "no-print" rule, e.g. on the Reports page).
    muiTopToolbarProps: { className: "no-print app-table-toolbar" },
    muiBottomToolbarProps: {
      className: "no-print app-table-toolbar",
      sx: { position: "sticky", bottom: 0, zIndex: 3, backgroundColor: "background.paper", borderTop: 1, borderColor: "divider" },
    },
    localization: { noRecordsToDisplay: emptyText },
    renderTopToolbarCustomActions: ({ table: t }) =>
      exportFileName || onExport || toolbarActions ? (
        <div className="flex flex-wrap items-center gap-2">
          {toolbarActions}
          {(exportFileName || onExport) && (
            <ExportMenu table={t} onPick={(scope) => (onExport ? onExport(scope) : exportRows(t, exportFileName!, scope))} />
          )}
        </div>
      ) : null,
    ...tableOptions,
  });
  return <MaterialReactTable table={table} />;
}
