import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { formatNumber } from "@/lib/format";
import { getMonthlyDistrictSeries, type DistrictPeriodRow } from "@/lib/reportTemplates";
import { Card, CardHeader } from "@/components/ui/Card";
import { PrintButton } from "@/components/reports/PrintButton";

// The same District x Period series as Monthly District History, grouped
// the other way - one block per district (months as rows) instead of one
// block per period. "Detail monthly summaryBD" in the source workbook -
// "BD" is "By District" - each district's block ends with a subtotal row,
// and the whole table ends with one grand TOTAL row, both reproduced here.
export default async function MonthlyDistrictDetailPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPermission(user.permissions, permissionKey("report-templates", "monthly-district-detail"))) redirect("/reports/templates");

  const db = readDb();
  const series = getMonthlyDistrictSeries(db);

  const byDistrict = new Map<string, DistrictPeriodRow[]>();
  for (const r of series) {
    const list = byDistrict.get(r.district.id) ?? [];
    list.push(r);
    byDistrict.set(r.district.id, list);
  }
  const groups = [...byDistrict.values()];
  const grandTotalCases = series.reduce((sum, r) => sum + r.totalCases, 0);
  const grandRectified = series.reduce((sum, r) => sum + r.rectifiedCases, 0);

  return (
    <div className="flex flex-col gap-5">
      <style>{`@media print { nav, header, .no-print { display: none !important; } main { padding: 0 !important; } }`}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/reports/templates" className="text-xs text-blue-800 hover:underline">
            ← Report Templates
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">Monthly District Detail</h1>
          <p className="mt-1 text-sm text-slate-500">The same district/period history, grouped by district with a subtotal for each.</p>
        </div>
        <div className="flex gap-2">
          <a href="/api/report-templates/monthly-district-detail/export">
            <span className="inline-flex items-center rounded-md border border-brand-gold-dark bg-brand-gold px-3 py-1.5 text-sm font-medium text-slate-900 transition-colors hover:bg-brand-gold-dark">
              Download CSV
            </span>
          </a>
          <PrintButton />
        </div>
      </div>

      <Card>
        <CardHeader title="Monthly District Detail" description={`${series.length} row(s) across ${groups.length} district(s)`} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">SN</th>
                <th className="px-4 py-2 font-medium">District</th>
                <th className="px-4 py-2 font-medium">Month</th>
                <th className="px-4 py-2 font-medium">Others Cases</th>
                <th className="px-4 py-2 font-medium">Unrectified</th>
                <th className="px-4 py-2 font-medium">Rectified</th>
                <th className="px-4 py-2 font-medium">Rectified %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {series.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-400" colSpan={7}>
                    No reporting periods configured yet.
                  </td>
                </tr>
              )}
              {groups.map((rows) => {
                const totalCases = rows.reduce((sum, r) => sum + r.totalCases, 0);
                const rectifiedCases = rows.reduce((sum, r) => sum + r.rectifiedCases, 0);
                const outstandingCases = totalCases - rectifiedCases;
                const performance = totalCases > 0 ? (rectifiedCases / totalCases) * 100 : null;
                const district = rows[0].district;
                return (
                  <Fragment key={district.id}>
                    {rows.map((r, i) => (
                      <tr key={`${r.period.id}-${r.district.id}`}>
                        <td className="px-4 py-2 text-slate-400">{i + 1}</td>
                        <td className="px-4 py-2 text-slate-900">{r.district.name}</td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-600">{r.period.code}</td>
                        <td className="px-4 py-2 text-slate-700">{formatNumber(r.totalCases)}</td>
                        <td className="px-4 py-2 text-slate-700">{formatNumber(r.outstandingCases)}</td>
                        <td className="px-4 py-2 text-slate-700">{formatNumber(r.rectifiedCases)}</td>
                        <td className="px-4 py-2 text-slate-700">{r.performance !== null ? `${r.performance.toFixed(1)}%` : "--"}</td>
                      </tr>
                    ))}
                    <tr key={`${district.id}-subtotal`} className="bg-slate-50 font-medium">
                      <td className="px-4 py-2" colSpan={3} />
                      <td className="px-4 py-2 text-slate-900">{formatNumber(totalCases)}</td>
                      <td className="px-4 py-2 text-slate-900">{formatNumber(outstandingCases)}</td>
                      <td className="px-4 py-2 text-slate-900">{formatNumber(rectifiedCases)}</td>
                      <td className="px-4 py-2 text-slate-900">{performance !== null ? `${performance.toFixed(1)}%` : "--"}</td>
                    </tr>
                  </Fragment>
                );
              })}
              {series.length > 0 && (
                <tr className="bg-slate-100 font-semibold">
                  <td className="px-4 py-2" />
                  <td className="px-4 py-2 text-slate-900">TOTAL</td>
                  <td className="px-4 py-2" />
                  <td className="px-4 py-2 text-slate-900">{formatNumber(grandTotalCases)}</td>
                  <td className="px-4 py-2 text-slate-900">{formatNumber(grandTotalCases - grandRectified)}</td>
                  <td className="px-4 py-2 text-slate-900">{formatNumber(grandRectified)}</td>
                  <td className="px-4 py-2 text-slate-900">{grandTotalCases > 0 ? `${((grandRectified / grandTotalCases) * 100).toFixed(1)}%` : "--"}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
