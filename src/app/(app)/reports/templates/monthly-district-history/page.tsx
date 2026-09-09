import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { formatNumber } from "@/lib/format";
import { getMonthlyDistrictSeries } from "@/lib/reportTemplates";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select, Label } from "@/components/ui/Field";
import { PrintButton } from "@/components/reports/PrintButton";

// Filtered to one reporting period at a time (a period picker, same
// convention as every other template's Period select) rather than
// stacking every period's block vertically on one page - the same series
// as Monthly District Detail (long format) still covers the full history
// when that's what's actually wanted.
export default async function MonthlyDistrictHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPermission(user.permissions, permissionKey("report-templates", "monthly-district-history"))) redirect("/reports/templates");

  const db = readDb();
  const params = await searchParams;
  const openPeriod = db.reportingPeriods.find((p) => p.status === "OPEN");
  const periodId = (typeof params.periodId === "string" && params.periodId) || openPeriod?.id || db.reportingPeriods[0]?.id || "";
  const period = db.reportingPeriods.find((p) => p.id === periodId);
  const periodsSorted = [...db.reportingPeriods].sort((a, b) => b.code.localeCompare(a.code));

  const { otherCases } = getMonthlyDistrictSeries(db);
  const rows = period ? otherCases.filter((r) => r.period.id === period.id) : [];
  const totalCases = rows.reduce((sum, r) => sum + r.totalCases, 0);
  const rectifiedCases = rows.reduce((sum, r) => sum + r.rectifiedCases, 0);

  return (
    <div className="flex flex-col gap-5">
      <style>{`@media print { nav, header, .no-print { display: none !important; } main { padding: 0 !important; } }`}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link
            href="/reports/templates"
            className="inline-flex items-center rounded-md bg-brand-gold px-3 py-1.5 text-sm font-bold text-slate-900 transition-colors hover:bg-brand-gold-dark"
          >
            ← Back
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">Monthly District History</h1>
          <p className="mt-1 text-sm text-slate-500">Other-Case performance by district, for a selected reporting period.</p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/report-templates/monthly-district-history/export?periodId=${periodId}`}>
            <span className="inline-flex items-center rounded-md border border-brand-gold-dark bg-brand-gold px-3 py-1.5 text-sm font-medium text-slate-900 transition-colors hover:bg-brand-gold-dark">
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
            {periodsSorted.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} {p.status === "LOCKED" ? "(locked)" : ""}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit">View</Button>
      </form>

      {!period && (
        <Card className="p-4">
          <p className="text-sm text-slate-400">No reporting periods configured yet.</p>
        </Card>
      )}

      {period && (
        <Card>
          <CardHeader
            title={period.code}
            description={`${period.status === "OPEN" ? "Open" : "Locked"} - ${formatNumber(rectifiedCases)} of ${formatNumber(totalCases)} eligible cases rectified`}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
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
