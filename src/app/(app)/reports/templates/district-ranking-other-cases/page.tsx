import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { formatNumber } from "@/lib/format";
import { getDistrictRankingOtherCases } from "@/lib/reportTemplates";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PrintButton } from "@/components/reports/PrintButton";

export default async function DistrictRankingOtherCasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPermission(user.permissions, permissionKey("report-templates", "district-ranking-other-cases"))) redirect("/reports/templates");

  const db = readDb();
  const params = await searchParams;
  const raw = params.periodIds;
  const selectedPeriodIds = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];

  const { rows, totalRow, narrative } = getDistrictRankingOtherCases(db, selectedPeriodIds.length > 0 ? selectedPeriodIds : undefined);

  const exportQuery = new URLSearchParams();
  for (const id of selectedPeriodIds) exportQuery.append("periodIds", id);

  return (
    <div className="flex flex-col gap-5">
      <style>{`@media print { nav, header, .no-print { display: none !important; } main { padding: 0 !important; } }`}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/reports/templates" className="text-xs text-blue-800 hover:underline">
            ← Report Templates
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">District Ranking - Other Cases</h1>
          <p className="mt-1 text-sm text-slate-500">Cumulative district ranking on the official scored category.</p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/report-templates/district-ranking-other-cases/export?${exportQuery.toString()}`}>
            <span className="inline-flex items-center rounded-md border border-brand-gold-dark bg-brand-gold px-3 py-1.5 text-sm font-medium text-slate-900 transition-colors hover:bg-brand-gold-dark">
              Download CSV
            </span>
          </a>
          <PrintButton />
        </div>
      </div>

      <form method="GET" className="no-print">
        <p className="mb-2 text-xs font-medium text-slate-600">
          Periods to include (none selected = every period, cumulative lifetime totals)
        </p>
        <div className="flex flex-wrap gap-3">
          {db.reportingPeriods.map((p) => (
            <label key={p.id} className="flex items-center gap-1.5 text-sm text-slate-700">
              <input type="checkbox" name="periodIds" value={p.id} defaultChecked={selectedPeriodIds.includes(p.id)} />
              {p.code}
            </label>
          ))}
        </div>
        <Button type="submit" className="mt-2">
          Apply
        </Button>
      </form>

      <Card>
        <CardHeader
          title="District Ranking - Other Cases"
          description={selectedPeriodIds.length > 0 ? `${selectedPeriodIds.length} period(s) selected` : "All periods (cumulative)"}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">SN</th>
                <th className="px-4 py-2 font-medium">Total No. of Branches</th>
                <th className="px-4 py-2 font-medium">District</th>
                <th className="px-4 py-2 font-medium">Total Others Cases</th>
                <th className="px-4 py-2 font-medium">Unrectified</th>
                <th className="px-4 py-2 font-medium">Rectified</th>
                <th className="px-4 py-2 font-medium">Rank</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-400" colSpan={7}>
                    No districts configured yet.
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.district.id}>
                  <td className="px-4 py-2 text-slate-400">{i + 1}</td>
                  <td className="px-4 py-2 text-slate-700">{formatNumber(r.totalBranches)}</td>
                  <td className="px-4 py-2 text-slate-900">{r.district.name}</td>
                  <td className="px-4 py-2 text-slate-700">{formatNumber(r.totalCases)}</td>
                  <td className="px-4 py-2 text-slate-700">{formatNumber(r.outstandingCases)}</td>
                  <td className="px-4 py-2 text-slate-700">{formatNumber(r.rectifiedCases)}</td>
                  <td className="px-4 py-2 text-slate-700">{r.performance !== null ? `${r.performance.toFixed(1)}%` : "--"}</td>
                </tr>
              ))}
              {rows.length > 0 && (
                <tr className="bg-slate-50 font-semibold">
                  <td className="px-4 py-2" />
                  <td className="px-4 py-2 text-slate-900">{formatNumber(totalRow.totalBranches)}</td>
                  <td className="px-4 py-2 text-slate-900">TOTAL</td>
                  <td className="px-4 py-2 text-slate-900">{formatNumber(totalRow.totalCases)}</td>
                  <td className="px-4 py-2 text-slate-900">{formatNumber(totalRow.outstandingCases)}</td>
                  <td className="px-4 py-2 text-slate-900">{formatNumber(totalRow.rectifiedCases)}</td>
                  <td className="px-4 py-2 text-slate-900">{totalRow.performance !== null ? `${totalRow.performance.toFixed(1)}%` : "--"}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {rows.length > 0 && <p className="border-t border-slate-100 px-4 py-3 text-sm text-slate-600">{narrative}</p>}
      </Card>
    </div>
  );
}
