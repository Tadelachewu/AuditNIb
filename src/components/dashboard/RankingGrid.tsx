import { gridPage } from "@/lib/gridPage";
import { getGridParams } from "@/lib/gridParams";
import { RankingGridClient, type RankingRow } from "@/components/dashboard/RankingGridClient";

export type { RankingRow } from "@/components/dashboard/RankingGridClient";

/**
 * A branch / district performance ranking, paged on the server: the page
 * computes every row (rank = official performance rank), this searches /
 * filters / sorts / pages them per the URL (src/lib/gridPage.ts, under
 * `id`) and sends the browser one page.
 */
export function RankingGrid({
  id,
  rows,
  kind,
  hasScope,
  exportFileName,
}: {
  /** The grid's URL prefix - unique on the page. */
  id: string;
  rows: RankingRow[];
  kind: "branch" | "district";
  hasScope: boolean;
  exportFileName: string;
}) {
  const grid = gridPage(id, rows, getGridParams(), {
    fields: {
      rank: (r) => r.rank,
      name: (r) => r.name,
      branchCount: (r) => r.branchCount,
      totalCases: (r) => r.totalCases,
      rectifiedCases: (r) => r.rectifiedCases,
      outstandingCases: (r) => r.outstandingCases,
      performance: (r) => r.performance,
    },
    search: ["name"],
    defaultSort: { id: "rank", desc: false },
    csv: [
      { header: "Rank", value: (r) => r.rank },
      { header: kind === "branch" ? "Branch" : "District", value: (r) => r.name },
      ...(kind === "district" ? [{ header: "Branches", value: (r: RankingRow) => r.branchCount }] : []),
      { header: "Total Eligible Cases", value: (r) => r.totalCases },
      { header: "Solved", value: (r) => r.rectifiedCases },
      { header: "Unsolved", value: (r) => r.outstandingCases },
      { header: "Performance", value: (r) => (r.performance === null ? "" : r.performance.toFixed(1)) },
    ],
  });
  return <RankingGridClient grid={grid} kind={kind} hasScope={hasScope} exportFileName={exportFileName} />;
}
