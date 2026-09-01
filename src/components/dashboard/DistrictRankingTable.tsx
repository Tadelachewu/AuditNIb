import Link from "next/link";
import type { Database, District } from "@/types";
import { computePerformance } from "@/lib/findings";
import { Card, CardHeader } from "@/components/ui/Card";

/**
 * Document_3 §17's "District Ranking": Rank/District/Branches/Cases/
 * Performance, for Head Office users - branch count per district is
 * dynamic (db.branches.filter(...).length), not a fixed number, since
 * different districts have different numbers of branches.
 */
export function DistrictRankingTable({
  db,
  districts,
  openPeriod,
  title = "District Ranking",
  description = "All districts, ranked by performance, current period",
}: {
  db: Database;
  districts: District[];
  openPeriod?: { id: string };
  title?: string;
  description?: string;
}) {
  const rows = districts.map((d) => {
    const branchCount = db.branches.filter((b) => b.districtId === d.id && b.status === "ACTIVE").length;
    const findings = openPeriod ? db.findings.filter((f) => f.districtId === d.id && f.periodId === openPeriod.id) : [];
    const totalCases = findings.reduce((sum, f) => sum + f.caseCount, 0);
    const performance = openPeriod ? computePerformance(db, { districtId: d.id, periodId: openPeriod.id }) : null;
    return { district: d, branchCount, totalCases, performance };
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
              <th className="px-4 py-2 font-medium">Cases</th>
              <th className="px-4 py-2 font-medium">Performance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ranked.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
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
                <td className="px-4 py-2 text-slate-700">{openPeriod ? row.totalCases : "--"}</td>
                <td className="px-4 py-2 text-slate-700">{row.performance !== null ? `${row.performance.toFixed(1)}%` : "--"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
