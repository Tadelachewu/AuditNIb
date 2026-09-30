"use client";

import { useMemo } from "react";
import type { MRT_ColumnDef } from "material-react-table";
import { AdminTable } from "@/components/ui/AdminTable";
import { Badge } from "@/components/ui/Badge";
import { formatCurrency, formatNumber } from "@/lib/format";

/**
 * The standard table (AdminTable / Material React Table: search, sort,
 * show/hide columns, CSV export) for dashboard summaries. Dashboards are
 * Server Components, so they pass plain rows and column descriptions (no
 * functions). A null value renders "--" (e.g. no period selected). Columns
 * marked `total` get a bank/branch/district TOTAL in the table footer.
 */
export type GridValue = string | number | boolean | null;
export interface GridColumn {
  key: string;
  header: string;
  type?: "text" | "number" | "currency";
  /** Sum this column in the footer. */
  total?: boolean;
  /** Footer text given directly (e.g. a per-currency total) - wins over `total`. */
  footer?: string;
  /** For a text column: show a small badge when row[badgeWhen] is true. */
  badgeWhen?: string;
  badgeLabel?: string;
}

function show(v: GridValue, type: GridColumn["type"]): string {
  if (v === null || v === undefined) return "--";
  if (typeof v === "number") return type === "currency" ? formatCurrency(v) : formatNumber(v);
  return String(v);
}

export function DashboardGrid({
  rows,
  columns,
  exportFileName,
  emptyText = "No data.",
}: {
  rows: Record<string, GridValue>[];
  columns: GridColumn[];
  exportFileName: string;
  emptyText?: string;
}) {
  const defs = useMemo<MRT_ColumnDef<Record<string, GridValue>>[]>(
    () =>
      columns.map((c) => {
        const numeric = c.type === "number" || c.type === "currency";
        const total = c.total ? rows.reduce((s, r) => s + (typeof r[c.key] === "number" ? (r[c.key] as number) : 0), 0) : null;
        const anyValue = rows.some((r) => r[c.key] !== null && r[c.key] !== undefined);
        return {
          id: c.key,
          header: c.header,
          accessorFn: (r) => r[c.key] ?? null,
          sortUndefined: "last" as const,
          muiTableHeadCellProps: numeric ? { align: "right" as const } : undefined,
          muiTableBodyCellProps: numeric ? { align: "right" as const } : undefined,
          muiTableFooterCellProps: numeric ? { align: "right" as const } : undefined,
          meta: { exportValue: (r: Record<string, GridValue>) => (r[c.key] === null ? "" : (r[c.key] as string | number)) },
          Cell: ({ row }) => (
            <span className={numeric ? "tabular-nums" : undefined}>
              {show(row.original[c.key], c.type)}
              {c.badgeWhen && row.original[c.badgeWhen] === true && (
                <span className="ml-1.5">
                  <Badge tone="blue">{c.badgeLabel ?? "Yes"}</Badge>
                </span>
              )}
            </span>
          ),
          Footer: () =>
            c.footer !== undefined ? (
              <span className="font-semibold">{c.footer}</span>
            ) : c.total ? (
              <span className="font-semibold tabular-nums">{anyValue ? show(total, c.type) : "--"}</span>
            ) : c === columns[0] ? (
              <span className="font-semibold">TOTAL</span>
            ) : null,
        };
      }),
    [columns, rows]
  );

  const hasTotals = columns.some((c) => c.total || c.footer !== undefined);
  return (
    <AdminTable
      columns={defs}
      data={rows}
      exportFileName={exportFileName}
      emptyText={emptyText}
      tableOptions={{
        enableTableFooter: hasTotals,
        enableColumnFilters: false,
        initialState: { density: "compact", showGlobalFilter: true, pagination: { pageIndex: 0, pageSize: 25 } },
      }}
    />
  );
}
