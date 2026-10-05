import { formatCurrency, formatNumber } from "@/lib/format";
import { gridPage } from "@/lib/gridPage";
import { getGridParams } from "@/lib/gridParams";
import { DashboardGridClient, type GridColumn, type GridValue } from "@/components/dashboard/DashboardGridClient";

export type { GridColumn, GridValue } from "@/components/dashboard/DashboardGridClient";

/**
 * The standard table for dashboard summaries, paged on the server.
 * Dashboards are Server Components: they pass every row and plain column
 * descriptions (no functions); this searches / filters / sorts / pages
 * them per the URL (src/lib/gridPage.ts, under `id`) and sends the
 * browser one page. Columns marked `total` get a TOTAL in the footer,
 * summed here over every row.
 */
export function DashboardGrid({
  id,
  rows,
  columns,
  exportFileName,
  emptyText,
}: {
  /** The grid's URL prefix - unique on the page. */
  id: string;
  rows: Record<string, GridValue>[];
  columns: GridColumn[];
  exportFileName: string;
  emptyText?: string;
}) {
  const fields = Object.fromEntries(columns.map((c) => [c.key, (r: Record<string, GridValue>) => r[c.key]]));
  const grid = gridPage(id, rows, getGridParams(), {
    fields,
    search: columns.filter((c) => !c.type || c.type === "text").map((c) => c.key),
    csv: columns.map((c) => ({ header: c.header, value: (r: Record<string, GridValue>) => r[c.key] })),
  });
  const withTotals: GridColumn[] = columns.map((c) => {
    if (c.footer !== undefined || !c.total) return c;
    const values = rows.map((r) => r[c.key]).filter((v) => v !== null && v !== undefined);
    const sum = values.reduce<number>((s, v) => s + (typeof v === "number" ? v : 0), 0);
    return { ...c, footer: values.length === 0 ? "--" : c.type === "currency" ? formatCurrency(sum) : formatNumber(sum) };
  });
  return <DashboardGridClient grid={grid} columns={withTotals} exportFileName={exportFileName} emptyText={emptyText} />;
}
