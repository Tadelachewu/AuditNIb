"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { MRT_ColumnDef } from "material-react-table";
import { AdminTable } from "@/components/ui/AdminTable";
import type { GridPage } from "@/lib/gridPage";
import { useGridUrlState } from "@/lib/useGridUrlState";

/** One row of a performance ranking, computed server-side (plain, serializable). */
export interface RankingRow {
  id: string;
  /** Official rank (by performance), kept even when the table is re-sorted. */
  rank: number;
  name: string;
  href: string;
  /** District rankings only. */
  branchCount?: number;
  totalCases: number;
  rectifiedCases: number;
  outstandingCases: number;
  performance: number | null;
}

/**
 * The table half of RankingGrid (RankingGrid.tsx pages the rows on the
 * server): the branch / district ranking - Material React Table
 * (AdminTable) showing one server page: search, sort by any column,
 * show/hide columns, export CSV. Rank stays the
 * official performance rank whatever the table is sorted by. Clicking a
 * % shows its math (or, when adjusted, the override's reason and what the
 * formula would give).
 */
export function RankingGridClient({
  grid,
  kind,
  hasScope,
  exportFileName,
}: {
  grid: GridPage<RankingRow>;
  kind: "branch" | "district";
  hasScope: boolean;
  exportFileName: string;
}) {
  const columns = useMemo<MRT_ColumnDef<RankingRow>[]>(() => {
    const cols: MRT_ColumnDef<RankingRow>[] = [
      { accessorKey: "rank", header: "Rank", size: 70, enableColumnFilter: false },
      {
        accessorKey: "name",
        header: kind === "branch" ? "Branch" : "District",
        Cell: ({ row }) => (
          <Link href={row.original.href} className="text-blue-800 hover:underline">
            {row.original.name}
          </Link>
        ),
      },
    ];
    if (kind === "district") cols.push({ accessorKey: "branchCount", header: "Branches", size: 90, filterVariant: "range" });
    cols.push(
      { accessorKey: "totalCases", header: "Total Eligible Cases", filterVariant: "range", Cell: ({ cell }) => <>{hasScope ? cell.getValue<number>() : "--"}</> },
      { accessorKey: "rectifiedCases", header: "Solved", filterVariant: "range", Cell: ({ cell }) => <>{hasScope ? cell.getValue<number>() : "--"}</> },
      { accessorKey: "outstandingCases", header: "Unsolved", filterVariant: "range", Cell: ({ cell }) => <>{hasScope ? cell.getValue<number>() : "--"}</> },
      {
        accessorKey: "performance",
        header: "Performance",
        filterVariant: "range",
        sortUndefined: "last",
        meta: {
          exportValue: (r: RankingRow) =>
            r.performance === null ? "" : r.performance.toFixed(1),
        },
        Cell: ({ row }) => {
          const r = row.original;
          if (r.performance === null) return <>--</>;
          return (
            <details className="group">
              <summary className="cursor-pointer list-none text-slate-700 marker:content-none hover:underline">
                {r.performance.toFixed(1)}%
              </summary>
              <div className="mt-1 max-w-[14rem] text-xs leading-relaxed text-slate-500">
                    {r.rectifiedCases} of {r.totalCases} eligible case(s) closed (unless it&apos;s closed, it never counts as rectified):{" "}
                    {r.rectifiedCases} ÷ {r.totalCases} × 100 = {r.performance.toFixed(1)}%.
              </div>
            </details>
          );
        },
      }
    );
    return cols;
  }, [kind, hasScope]);

  const url = useGridUrlState(grid, columns, exportFileName);
  return (
    <AdminTable
      columns={url.columns}
      data={grid.rows}
      getRowId={(r) => r.id}
      exportFileName={exportFileName}
      onExport={url.onExport}
      emptyText={kind === "branch" ? "No branches configured yet." : "No districts configured yet."}
      tableOptions={url.tableOptions}
    />
  );
}
