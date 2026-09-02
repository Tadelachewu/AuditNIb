import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { formatNumber } from "@/lib/format";
import { getMonthlyDistrictSeries } from "@/lib/reportTemplates";
import { Card, CardHeader } from "@/components/ui/Card";
import { PrintButton } from "@/components/reports/PrintButton";

// The same District x Period series as Monthly District History, grouped
// the other way - one block per district (months as rows) instead of one
// block per period. "Detail monthly summaryBD" in the source workbook -
// "BD" is "By District". Per district/period it now shows TWO rows (as the
// source Excel does): one for the official "Other Cases" scored metric,
// and a second catch-all "Various internal Audit report" row for all
// non-scored categories (ATM, IT, Zero Balance, Dormant, Cheque Book…).
// Each district's block ends with a subtotal row, and the whole table
// ends with one grand TOTAL row — both reproduced here.
export default async function MonthlyDistrictDetailPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPermission(user.permissions, permissionKey("report-templates", "monthly-district-detail"))) redirect("/reports/templates");

  const db = readDb();
  const series = getMonthlyDistrictSeries(db);

  const byDistrict = new Map<string, typeof series>();
  for (const r of series) {
    const list = byDistrict.get(r.district.id) ?? [];
    list.push(r);
    byDistrict.set(r.district.id, list);
  }
  const groups = [...byDistrict.values()];

  const caseTypeLabel = (kind: "OTHER_CASES" | "VARIOUS_INTERNAL_AUDIT") =>
    kind === "OTHER_CASES" ? "Other Cases" : "Various internal Audit report";

  // Grand TOTAL sums BOTH bucket types, matching the subtotal rows.
  let grandTotalCases = 0;
  let grandRectified = 0;
  for (const rows of byDistrict.values()) {
    grandTotalCases += rows.reduce((sum, r) => sum + r.totalCases, 0);
    grandRectified += rows.reduce((sum, r) => sum + r.rectifiedCases, 0);
  }

  return (
    <div className="flex flex-col gap-5">
      <style>{`@media print { nav, header, .no-print { display: none !important; } main { padding: 0 !important; } }`}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/reports/templates" className="text-xs text-blue-800 hover:underline">
            ← Report Templates
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">Monthly District Detail</h1>
          <p className="mt-1 text-sm text-slate-500">District-by-district history with Other Cases plus the &quot;Various internal Audit report&quot; catch-all, subtotal per district, and grand total.</p>
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
                <th className="px-4 py-2 font-medium">Case Type</th>
                <th className="px-4 py-2 font-medium">Total Cases</th>
                <th className="px-4 py-2 font-medium">Unrectified</th>
                <th className="px-4 py-2 font-medium">Rectified</th>
                <th className="px-4 py-2 font-medium">Rectified %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {series.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-400" colSpan={8}>
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
                // Group the flat OTHER_CASES + VARIOUS_INTERNAL_AUDIT rows
                // by Period.code so each month shows two sub-rows with
                // shared SN numbering (one SN per month).
                const byPeriod = new Map<string, typeof rows>();
                for (const r of rows) {
                  const list = byPeriod.get(r.period.id) ?? [];
                  list.push(r);
                  byPeriod.set(r.period.id, list);
                }
                return (
                  <Fragment key={district.id}>
                    {[...byPeriod.values()].map((periodRows, i) => (
                      <Fragment key={periodRows[0].period.id}>
                        {periodRows.map((r, kindIdx) => (
                          <tr key={`${r.period.id}-${r.district.id}-${r.rowKind}`} className={kindIdx === 1 ? "bg-slate-50/50" : ""}>
                            <td className="px-4 py-2 text-slate-400">{kindIdx === 0 ? i + 1 : ""}</td>
                            <td className="px-4 py-2 text-slate-900">{kindIdx === 0 ? r.district.name : ""}</td>
                            <td className="px-4 py-2 font-mono text-xs text-slate-600">{kindIdx === 0 ? r.period.code : ""}</td>
                            <td className="px-4 py-2 text-slate-700">
                              <span
                                className={
                                  r.rowKind === "VARIOUS_INTERNAL_AUDIT"
                                    ? "rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                                    : ""
                                }
                              >
                                {caseTypeLabel(r.rowKind)}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-slate-700">{formatNumber(r.totalCases)}</td>
                            <td className="px-4 py-2 text-slate-700">{formatNumber(r.outstandingCases)}</td>
                            <td className="px-4 py-2 text-slate-700">{formatNumber(r.rectifiedCases)}</td>
                            <td className="px-4 py-2 text-slate-700">{r.performance !== null ? `${r.performance.toFixed(1)}%` : "--"}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                    <tr key={`${district.id}-subtotal`} className="bg-slate-50 font-medium">
                      <td className="px-4 py-2" colSpan={4} />
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
                  <td className="px-4 py-2" colSpan={2} />
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
