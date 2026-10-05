"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MRT_ColumnDef } from "material-react-table";
import { AdminTable } from "@/components/ui/AdminTable";
import { Badge } from "@/components/ui/Badge";
import { FindingStatusBadge } from "@/components/findings/FindingStatusBadge";
import { useGridUrlState } from "@/lib/useGridUrlState";
import { pagedList, type GridPage } from "@/lib/gridPage";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/format";
import type { FindingStatus } from "@/types";

// Grids for the Reports page (src/app/(app)/reports/page.tsx), which
// computes every row server-side and hands them here as plain data.

export interface ReportFindingRow {
  id: string;
  reference: string;
  title: string;
  districtName: string;
  branchName: string;
  departmentName: string;
  categoryName: string;
  sourceName: string;
  currency: string;
  amount: number;
  /** Originally registered - never changed by transfers. */
  reportedCases: number;
  /** In the filtered period, after transfers. */
  totalCases: number;
  outstanding: number;
  status: FindingStatus;
  isHistorical: boolean;
  transferredOutToCode: string | null;
}

/**
 * Findings Report - server mode (same URL-driven search / sort / paging as
 * the Findings list, src/lib/findingListQuery.ts); Export CSV downloads
 * every matching finding. Clicking a row opens the finding.
 */
export function ReportFindingsGrid({
  rows,
  paging,
  sort,
  searchText,
}: {
  rows: ReportFindingRow[];
  paging: { page: number; pageSize: number; total: number };
  sort: { id: string; desc: boolean };
  searchText: string;
}) {
  const router = useRouter();
  const grid = useMemo(() => pagedList(rows, paging, sort, searchText), [rows, paging, sort, searchText]);
  const columns = useMemo<MRT_ColumnDef<ReportFindingRow>[]>(
    () => [
      {
        id: "reference",
        accessorKey: "reference",
        header: "Reference",
        size: 150,
        Cell: ({ row }) => (
          <Link href={`/findings/${row.original.id}`} className="font-mono text-xs text-blue-800 hover:underline">
            {row.original.reference}
          </Link>
        ),
      },
      { id: "title", accessorKey: "title", header: "Title" },
      { id: "district", accessorKey: "districtName", header: "District" },
      { id: "branch", accessorKey: "branchName", header: "Branch" },
      { id: "department", accessorKey: "departmentName", header: "Department" },
      { id: "category", accessorKey: "categoryName", header: "Category" },
      { id: "source", accessorKey: "sourceName", header: "Source" },
      {
        id: "amount",
        accessorKey: "amount",
        header: "Amount",
        Cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {row.original.currency} {formatCurrency(row.original.amount)}
          </span>
        ),
      },
      {
        id: "reportedCases",
        accessorKey: "reportedCases",
        header: "Reported Cases",
        muiTableHeadCellProps: { title: "Originally registered - not changed by transfers" },
        Cell: ({ row }) => <span className="tabular-nums">{formatNumber(row.original.reportedCases)}</span>,
      },
      {
        id: "cases",
        accessorKey: "totalCases",
        header: "Total Cases",
        muiTableHeadCellProps: { title: "In this period, after transfers in / out" },
        Cell: ({ row }) => <span className="tabular-nums">{formatNumber(row.original.totalCases)}</span>,
      },
      {
        id: "outstanding",
        accessorKey: "outstanding",
        header: "Outstanding",
        enableSorting: false,
        Cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {row.original.currency} {formatCurrency(row.original.outstanding)}
          </span>
        ),
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        Cell: ({ row }) =>
          row.original.isHistorical ? (
            <span
              className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500"
              title="This period's own record for this finding - it has since transferred on."
            >
              Transferred → {row.original.transferredOutToCode ?? "—"}
            </span>
          ) : (
            <FindingStatusBadge status={row.original.status} />
          ),
      },
    ],
    []
  );
  // Same URL-driven paging as the Findings list; Export CSV = /api/findings/export.
  const url = useGridUrlState(grid, columns, "findings-report", { exportFrom: "/api/findings/export" });
  return (
    <AdminTable
      columns={url.columns}
      data={rows}
      getRowId={(r) => r.id}
      onExport={url.onExport}
      emptyText="No findings match these filters."
      tableOptions={{
        ...url.tableOptions,
        enableColumnFilters: false, // filtering is the FilterBar above
        muiSearchTextFieldProps: { placeholder: "Search reference, title, branch, category...", size: "small", variant: "outlined" },
        muiTableBodyRowProps: ({ row }) => ({
          onClick: (e) => {
            if ((e.target as HTMLElement).closest("a, button, input")) return;
            if (window.getSelection()?.toString()) return;
            router.push(`/findings/${row.original.id}`);
          },
          sx: { cursor: "pointer" },
        }),
      }}
    />
  );
}

export interface TransferRow {
  id: string;
  findingId: string;
  reference: string;
  fromCode: string;
  toCode: string;
  currency: string;
  originalAmount: number;
  outstandingAmount: number;
  originalCases: number;
  outstandingCases: number;
  caseAgeDays: number;
  method: "AUTOMATIC" | "MANUAL";
  createdByName: string;
  createdAt: string;
  reason: string;
}

/** Transfers - one server page of every transfer in scope (paged by TransfersGrid, ReportSectionGrids.tsx). */
export function TransfersGridClient({ grid }: { grid: GridPage<TransferRow> }) {
  const columns = useMemo<MRT_ColumnDef<TransferRow>[]>(
    () => [
      {
        accessorKey: "reference",
        header: "Finding",
        Cell: ({ row }) => (
          <Link href={`/findings/${row.original.findingId}`} className="font-mono text-xs text-blue-800 hover:underline">
            {row.original.reference}
          </Link>
        ),
      },
      { accessorKey: "fromCode", header: "From Period", size: 100, filterVariant: "select" },
      { accessorKey: "toCode", header: "To Period", size: 100, filterVariant: "select" },
      {
        accessorKey: "originalAmount",
        header: "Original Amount",
        filterVariant: "range",
        Cell: ({ row }) => <span className="tabular-nums">{row.original.currency} {formatCurrency(row.original.originalAmount)}</span>,
      },
      {
        accessorKey: "outstandingAmount",
        header: "Outstanding Amount",
        filterVariant: "range",
        Cell: ({ row }) => <span className="tabular-nums">{row.original.currency} {formatCurrency(row.original.outstandingAmount)}</span>,
      },
      { accessorKey: "originalCases", header: "Original Cases", filterVariant: "range", Cell: ({ cell }) => <>{formatNumber(cell.getValue<number>())}</> },
      { accessorKey: "outstandingCases", header: "Outstanding Cases", filterVariant: "range", Cell: ({ cell }) => <>{formatNumber(cell.getValue<number>())}</> },
      { accessorKey: "caseAgeDays", header: "Case Age (days)", filterVariant: "range" },
      {
        id: "method",
        header: "Method",
        accessorFn: (t) => (t.method === "AUTOMATIC" ? "Automatic" : "Manual"),
        filterVariant: "select",
        filterSelectOptions: ["Automatic", "Manual"],
        Cell: ({ row }) => <Badge tone={row.original.method === "AUTOMATIC" ? "blue" : "gray"}>{row.original.method === "AUTOMATIC" ? "Automatic" : "Manual"}</Badge>,
      },
      { accessorKey: "createdByName", header: "Transferred By", filterVariant: "select" },
      {
        accessorKey: "createdAt",
        header: "Transfer Date",
        meta: { exportValue: (t: TransferRow) => formatDateTime(t.createdAt) },
        Cell: ({ row }) => <span className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(row.original.createdAt)}</span>,
      },
      { accessorKey: "reason", header: "Transfer Reason" },
    ],
    []
  );
  const url = useGridUrlState(grid, columns, "transfers");
  return (
    <AdminTable
      columns={url.columns}
      data={grid.rows}
      getRowId={(t) => t.id}
      exportFileName="transfers"
      onExport={url.onExport}
      emptyText="No transfers recorded."
      tableOptions={url.tableOptions}
    />
  );
}

export interface CategoryBreakdownRow {
  id: string;
  name: string;
  total: number;
  rectified: number;
  outstanding: number;
}

/** Category Breakdown - the same table as the page's other sections (one server page). */
export function CategoryBreakdownGridClient({ grid }: { grid: GridPage<CategoryBreakdownRow> }) {
  const columns = useMemo<MRT_ColumnDef<CategoryBreakdownRow>[]>(
    () => [
      { accessorKey: "name", header: "Category", Cell: ({ cell }) => <span className="text-slate-900">{cell.getValue<string>()}</span> },
      { accessorKey: "total", header: "Total", filterVariant: "range", Cell: ({ cell }) => <span className="tabular-nums">{formatNumber(cell.getValue<number>())}</span> },
      { accessorKey: "rectified", header: "Rectified", filterVariant: "range", Cell: ({ cell }) => <span className="tabular-nums">{formatNumber(cell.getValue<number>())}</span> },
      { accessorKey: "outstanding", header: "Outstanding", filterVariant: "range", Cell: ({ cell }) => <span className="tabular-nums">{formatNumber(cell.getValue<number>())}</span> },
    ],
    []
  );
  const url = useGridUrlState(grid, columns, "report-category-breakdown");
  return (
    <AdminTable
      columns={url.columns}
      data={grid.rows}
      getRowId={(r) => r.id}
      exportFileName="report-category-breakdown"
      onExport={url.onExport}
      emptyText="No categories."
      tableOptions={url.tableOptions}
    />
  );
}

export interface RiskBreakdownRow {
  risk: string;
  count: number;
}

/** Risk Breakdown - the same table as the page's other sections (one server page). */
export function RiskBreakdownGridClient({ grid }: { grid: GridPage<RiskBreakdownRow> }) {
  const columns = useMemo<MRT_ColumnDef<RiskBreakdownRow>[]>(
    () => [
      { accessorKey: "risk", header: "Risk Level", Cell: ({ cell }) => <span className="text-slate-900">{cell.getValue<string>()}</span> },
      { accessorKey: "count", header: "Findings", filterVariant: "range", Cell: ({ cell }) => <span className="tabular-nums">{formatNumber(cell.getValue<number>())}</span> },
    ],
    []
  );
  const url = useGridUrlState(grid, columns, "report-risk-breakdown");
  return (
    <AdminTable
      columns={url.columns}
      data={grid.rows}
      getRowId={(r) => r.risk}
      exportFileName="report-risk-breakdown"
      onExport={url.onExport}
      emptyText="No risk levels."
      tableOptions={url.tableOptions}
    />
  );
}
