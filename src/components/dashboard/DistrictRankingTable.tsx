import Link from "next/link";
import type { Database, District } from "@/types";
import { computePerformance, computeEligibleCaseCounts } from "@/lib/findings";
import { Card, CardHeader } from "@/components/ui/Card";

interface DistrictRow {
  district: District;
  branchCount: number;
  totalCases: number;
  rectifiedCases: number;
  outstandingCases: number;
  performance: number | null;
}

/** Performance %'s own math, revealed on click - same pattern as BranchPerformanceTable's own PerformanceDetail. */
function PerformanceDetail({ row }: { row: DistrictRow }) {
  if (row.performance === null) return null;
  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-slate-700 marker:content-none hover:underline">
        {row.performance.toFixed(1)}%
      </summary>
      <div className="mt-1 max-w-[14rem] text-xs leading-relaxed text-slate-500">
        {row.rectifiedCases} of {row.totalCases} eligible case(s) closed (unless it&apos;s closed, it never counts as rectified):{" "}
        {row.rectifiedCases} ÷ {row.totalCases} × 100 = {row.performance.toFixed(1)}%.
      </div>
    </details>
  );
}

/**
 * Document_3 §17's "District Ranking": Rank/District/Branches/Cases/
 * Performance, for Head Office users - branch count per district is
 * dynamic (db.branches.filter(...).length), not a fixed number, since
 * different districts have different numbers of branches. Total/Rectified/
 * Outstanding come from computeEligibleCaseCounts() - the exact same
 * function computePerformance() itself divides to get the Performance %
 * shown in the same row - not a hand-rolled raw findings reduce (every
 * category, self-reported rectifiedCases), which could disagree with what
 * the percentage right next to it actually means.
 */
export function DistrictRankingTable({
  db,
  districts,
  openPeriod,
  allPeriods = false,
  title = "District Ranking",
  description = "All districts, ranked by performance, current period",
}: {
  db: Database;
  districts: District[];
  openPeriod?: { id: string };
  /** FilterBar's "All periods" choice (ALL_PERIODS_VALUE) - aggregates across every period instead of one; `openPeriod` is undefined in this mode. */
  allPeriods?: boolean;
  title?: string;
  description?: string;
}) {
  const hasScope = allPeriods || Boolean(openPeriod);
  const rows: DistrictRow[] = districts.map((d) => {
    const branchCount = db.branches.filter((b) => b.districtId === d.id && b.status === "ACTIVE").length;
    const eligible = hasScope
      ? computeEligibleCaseCounts(db, { districtId: d.id, periodId: allPeriods ? undefined : openPeriod!.id })
      : null;
    const totalCases = eligible?.totalCases ?? 0;
    const rectifiedCases = eligible?.rectifiedCases ?? 0;
    const performance = hasScope
      ? computePerformance(db, { districtId: d.id, periodId: allPeriods ? undefined : openPeriod!.id })
      : null;
    return { district: d, branchCount, totalCases, rectifiedCases, outstandingCases: totalCases - rectifiedCases, performance };
  });

  const ranked = [...rows].sort((a, b) => (b.performance ?? -1) - (a.performance ?? -1));

  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-4 py-2 font-medium">Rank</th>
              <th className="px-4 py-2 font-medium">District</th>
              <th className="px-4 py-2 font-medium">Branches</th>
              <th className="px-4 py-2 font-medium">Total Eligible Cases</th>
              <th className="px-4 py-2 font-medium">Solved</th>
              <th className="px-4 py-2 font-medium">Unsolved</th>
              <th className="px-4 py-2 font-medium">Performance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ranked.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  No districts configured yet.
                </td>
              </tr>
            )}
            {ranked.map((row, i) => (
              <tr key={row.district.id}>
                <td className="px-4 py-2 text-slate-400">{i + 1}</td>
                <td className="px-4 py-2">
                  <Link href={`/findings?districtId=${row.district.id}`} className="text-blue-800 hover:underline">
                    {row.district.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-slate-700">{row.branchCount}</td>
                <td className="px-4 py-2 text-slate-700">{hasScope ? row.totalCases : "--"}</td>
                <td className="px-4 py-2 text-slate-700">{hasScope ? row.rectifiedCases : "--"}</td>
                <td className="px-4 py-2 text-slate-700">{hasScope ? row.outstandingCases : "--"}</td>
                <td className="px-4 py-2 text-slate-700">{row.performance !== null ? <PerformanceDetail row={row} /> : "--"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
