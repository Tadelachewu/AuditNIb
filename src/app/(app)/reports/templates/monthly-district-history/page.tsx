import Link from "next/link";
import { SESSION_ENDED_PATH } from "@/lib/session";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { formatNumber } from "@/lib/format";
import { getMonthlyDistrictSeries, sumDistrictRowsAcrossPeriods, templateSourceNote } from "@/lib/reportTemplates";
import { ALL_PERIODS_VALUE } from "@/lib/dashboardFilters";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select, Label } from "@/components/ui/Field";
import { PrintButton } from "@/components/reports/PrintButton";

// One reporting period at a time (a period picker, same convention as every
// other template's Period select), or "All periods": each district summed
// across every period (sumDistrictRowsAcrossPeriods - no double counting,
// % recomputed from the summed counts). Monthly District Detail still
// shows the month-by-month breakdown.
export default async function MonthlyDistrictHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_ENDED_PATH);
  if (!hasPermission(user.permissions, permissionKey("report-templates", "monthly-district-history"))) redirect("/reports/templates");

  const db = await readDb();
  // Shown when Settings limits this template to certain sources, so its
  // counts are never mistaken for the bank-wide totals.
  const sourceNote = templateSourceNote(db, "monthly-district-history");
  const params = await searchParams;
  const openPeriod = db.reportingPeriods.find((p) => p.status === "OPEN");
  const periodId = (typeof params.periodId === "string" && params.periodId) || openPeriod?.id || db.reportingPeriods[0]?.id || "";
  const allPeriods = periodId === ALL_PERIODS_VALUE;
  const period = db.reportingPeriods.find((p) => p.id === periodId);
  const periodsSorted = [...db.reportingPeriods].sort((a, b) => b.code.localeCompare(a.code));

  const { otherCases } = getMonthlyDistrictSeries(db, "monthly-district-history");
  const rows = allPeriods ? sumDistrictRowsAcrossPeriods(otherCases) : period ? otherCases.filter((r) => r.period.id === period.id) : [];
  const totalCases = rows.reduce((sum, r) => sum + r.totalCases, 0);
  const rectifiedCases = rows.reduce((sum, r) => sum + r.rectifiedCases, 0);

  return (
    <div className="flex flex-col gap-5">
      <style>{`@media print { nav, header, .no-print { display: none !important; } main { padding: 0 !important; } }`}</style>

      <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <Link
            href="/reports/templates"
            className="inline-flex items-center rounded-md bg-brand-gold px-3 py-1.5 text-sm font-bold text-on-gold transition-colors hover:bg-brand-gold-dark"
          >
            ← Back
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">Monthly District History</h1>
          <p className="mt-1 text-sm text-slate-600">Other-Case performance by district, for one reporting period or all periods combined.</p>
          {sourceNote && <p className="mt-1 text-xs font-medium text-amber-800">{sourceNote}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          <a href={`/api/report-templates/monthly-district-history/export?periodId=${periodId}`}>
            <span className="inline-flex items-center rounded-md border border-brand-gold-dark bg-brand-gold px-3 py-1.5 text-sm font-medium text-on-gold transition-colors hover:bg-brand-gold-dark">
              Download CSV
            </span>
          </a>
          <PrintButton />
        </div>
      </div>

      <form method="GET" className="no-print flex items-end gap-2">
        <div>
          <Label htmlFor="periodId">Period</Label>
          <Select id="periodId" name="periodId" defaultValue={periodId}>
            <option value={ALL_PERIODS_VALUE}>All periods</option>
            {periodsSorted.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} {p.status === "LOCKED" ? "(locked)" : ""}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit">View</Button>
      </form>

      {!period && !allPeriods && (
        <Card className="p-4">
          <p className="text-sm text-slate-500">No reporting periods configured yet.</p>
        </Card>
      )}

      {(period || allPeriods) && (
        <Card>
          <CardHeader
            title={allPeriods ? "All periods" : period!.code}
            description={`${allPeriods ? `${db.reportingPeriods.length} period(s) combined` : period!.status === "OPEN" ? "Open" : "Locked"} - ${formatNumber(rectifiedCases)} of ${formatNumber(totalCases)} eligible cases rectified`}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs text-slate-600">
                <tr>
                  <th className="px-4 py-2 font-medium">SN</th>
                  <th className="px-4 py-2 font-medium">Total No. of Branches</th>
                  <th className="px-4 py-2 font-medium">District</th>
                  <th className="px-4 py-2 font-medium">Others Cases</th>
                  <th className="px-4 py-2 font-medium">Unrectified</th>
                  <th className="px-4 py-2 font-medium">Rectified</th>
                  <th className="px-4 py-2 font-medium">Rectified %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-center text-slate-500" colSpan={7}>
                      No districts configured yet.
                    </td>
                  </tr>
                )}
                {rows.map((r, i) => (
                  <tr key={r.district.id}>
                    <td className="px-4 py-2 text-slate-500">{i + 1}</td>
                    <td className="px-4 py-2 text-slate-700">{formatNumber(r.totalBranches)}</td>
                    <td className="px-4 py-2 text-slate-900">{r.district.name}</td>
                    <td className="px-4 py-2 text-slate-700">{formatNumber(r.totalCases)}</td>
                    <td className="px-4 py-2 text-slate-700">{formatNumber(r.outstandingCases)}</td>
                    <td className="px-4 py-2 text-slate-700">{formatNumber(r.rectifiedCases)}</td>
                    <td className="px-4 py-2 text-slate-700">{r.performance !== null ? <>{r.performance.toFixed(1)}%</> : "--"}</td>
                  </tr>
                ))}
                {rows.length > 0 && (
                  <tr className="bg-slate-50 font-semibold">
                    <td className="px-4 py-2 text-slate-900" colSpan={3}>
                      TOTAL
                    </td>
                    <td className="px-4 py-2 text-slate-900">{formatNumber(totalCases)}</td>
                    <td className="px-4 py-2 text-slate-900">{formatNumber(totalCases - rectifiedCases)}</td>
                    <td className="px-4 py-2 text-slate-900">{formatNumber(rectifiedCases)}</td>
                    <td className="px-4 py-2 text-slate-900">{totalCases > 0 ? `${((rectifiedCases / totalCases) * 100).toFixed(1)}%` : "--"}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
