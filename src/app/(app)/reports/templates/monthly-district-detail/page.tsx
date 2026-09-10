import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { formatNumber } from "@/lib/format";
import { getMonthlyDistrictSeries, type DistrictPeriodRow, type DistrictVariousRow } from "@/lib/reportTemplates";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select, Label } from "@/components/ui/Field";
import { PrintButton } from "@/components/reports/PrintButton";

// The same District x Period series as Monthly District History, grouped
// the other way - one block per district (months as rows) instead of one
// block per period. "Detail monthly summaryBD" in the source workbook -
// "BD" is "By District". Each district's block is its official "Other
// Cases" scored row per period, followed by exactly ONE final "Various
// internal Audit report" row (the catch-all for every non-scored
// category, lifetime for that district) - cross-checked directly against
// the source Excel's raw cells: it's the literal last row of each
// district's block there too, not repeated per month. Each district's
// block ends with a subtotal row (periods + the one Various row), and the
// whole table ends with one grand TOTAL row.
export default async function MonthlyDistrictDetailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPermission(user.permissions, permissionKey("report-templates", "monthly-district-detail"))) redirect("/reports/templates");

  const db = readDb();
  const params = await searchParams;
  const districtId = typeof params.districtId === "string" ? params.districtId : "";
  const activeDistricts = db.districts.filter((d) => d.status === "ACTIVE").sort((a, b) => a.name.localeCompare(b.name, "en-US"));

  const { otherCases: allOtherCases, various: allVarious } = getMonthlyDistrictSeries(db);
  // Filtered to one district when chosen - "All Districts" (the default)
  // shows the full bank-wide series exactly as before.
  const otherCases = districtId ? allOtherCases.filter((r) => r.district.id === districtId) : allOtherCases;
  const various = districtId ? allVarious.filter((v) => v.district.id === districtId) : allVarious;

  const variousByDistrict = new Map(various.map((v) => [v.district.id, v]));
  const byDistrict = new Map<string, DistrictPeriodRow[]>();
  for (const r of otherCases) {
    const list = byDistrict.get(r.district.id) ?? [];
    list.push(r);
    byDistrict.set(r.district.id, list);
  }
  // Insertion order already follows chronological period order per
  // district (otherCases is built period-outer, district-inner, so each
  // district's own slice stays in period sequence as entries are appended).
  const groups = [...byDistrict.entries()].map(([districtId, periodRows]) => ({
    district: periodRows[0].district,
    periodRows,
    variousRow: variousByDistrict.get(districtId) as DistrictVariousRow | undefined,
  }));

  const totalRowCount = otherCases.length + various.length;

  // Grand TOTAL sums both the period rows and the one Various row per
  // district - scoped to whatever the district filter left in `otherCases`/
  // `various` above, so it reads as "total for this district" rather than
  // silently staying bank-wide while the table above it is filtered.
  let grandTotalCases = 0;
  let grandRectified = 0;
  for (const r of otherCases) {
    grandTotalCases += r.totalCases;
    grandRectified += r.rectifiedCases;
  }
  for (const v of various) {
    grandTotalCases += v.totalCases;
    grandRectified += v.rectifiedCases;
  }

  return (
    <div className="flex flex-col gap-5">
      <style>{`@media print { nav, header, .no-print { display: none !important; } main { padding: 0 !important; } }`}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link
            href="/reports/templates"
            className="inline-flex items-center rounded-md bg-brand-gold px-3 py-1.5 text-sm font-bold text-on-gold transition-colors hover:bg-brand-gold-dark"
          >
            ← Back
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">Monthly District Detail</h1>
          <p className="mt-1 text-sm text-slate-500">
            District-by-district history: Other Cases per period, then one closing &quot;Various internal Audit report&quot; row per district, subtotal, and grand total.
          </p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/report-templates/monthly-district-detail/export?districtId=${districtId}`}>
            <span className="inline-flex items-center rounded-md border border-brand-gold-dark bg-brand-gold px-3 py-1.5 text-sm font-medium text-on-gold transition-colors hover:bg-brand-gold-dark">
              Download CSV
            </span>
          </a>
          <PrintButton />
        </div>
      </div>

      <form method="GET" className="no-print flex items-end gap-2">
        <div>
          <Label htmlFor="districtId">District</Label>
          <Select id="districtId" name="districtId" defaultValue={districtId}>
            <option value="">All Districts</option>
            {activeDistricts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit">View</Button>
      </form>

      <Card>
        <CardHeader title="Monthly District Detail" description={`${totalRowCount} row(s) across ${groups.length} district(s)`} />
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
              {groups.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-400" colSpan={8}>
                    No reporting periods configured yet.
                  </td>
                </tr>
              )}
              {groups.map(({ district, periodRows, variousRow }) => {
                const totalCases = periodRows.reduce((sum, r) => sum + r.totalCases, 0) + (variousRow?.totalCases ?? 0);
                const rectifiedCases = periodRows.reduce((sum, r) => sum + r.rectifiedCases, 0) + (variousRow?.rectifiedCases ?? 0);
                const outstandingCases = totalCases - rectifiedCases;
                const performance = totalCases > 0 ? (rectifiedCases / totalCases) * 100 : null;
                return (
                  <Fragment key={district.id}>
                    {periodRows.map((r, i) => (
                      <tr key={`${district.id}-${r.period.id}`}>
                        <td className="px-4 py-2 text-slate-400">{i + 1}</td>
                        <td className="px-4 py-2 text-slate-900">{i === 0 ? district.name : ""}</td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-600">{r.period.code}</td>
                        <td className="px-4 py-2 text-slate-700">Other Cases</td>
                        <td className="px-4 py-2 text-slate-700">{formatNumber(r.totalCases)}</td>
                        <td className="px-4 py-2 text-slate-700">{formatNumber(r.outstandingCases)}</td>
                        <td className="px-4 py-2 text-slate-700">{formatNumber(r.rectifiedCases)}</td>
                        <td className="px-4 py-2 text-slate-700">{r.performance !== null ? `${r.performance.toFixed(1)}%` : "--"}</td>
                      </tr>
                    ))}
                    {variousRow && (
                      <tr key={`${district.id}-various`} className="bg-slate-50/50">
                        <td className="px-4 py-2 text-slate-400">{periodRows.length + 1}</td>
                        <td className="px-4 py-2" />
                        <td className="px-4 py-2" />
                        <td className="px-4 py-2 text-slate-700">
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">Various internal Audit report</span>
                        </td>
                        <td className="px-4 py-2 text-slate-700">{formatNumber(variousRow.totalCases)}</td>
                        <td className="px-4 py-2 text-slate-700">{formatNumber(variousRow.outstandingCases)}</td>
                        <td className="px-4 py-2 text-slate-700">{formatNumber(variousRow.rectifiedCases)}</td>
                        <td className="px-4 py-2 text-slate-700">{variousRow.performance !== null ? `${variousRow.performance.toFixed(1)}%` : "--"}</td>
                      </tr>
                    )}
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
              {groups.length > 0 && (
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
