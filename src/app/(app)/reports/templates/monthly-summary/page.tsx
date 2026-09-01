import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { formatNumber } from "@/lib/format";
import { getMonthlySummaryReport } from "@/lib/reportTemplates";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select, Label } from "@/components/ui/Field";
import { PrintButton } from "@/components/reports/PrintButton";

export default async function MonthlySummaryReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPermission(user.permissions, permissionKey("report-templates", "monthly-summary"))) redirect("/reports/templates");

  const db = readDb();
  const params = await searchParams;
  const openPeriod = db.reportingPeriods.find((p) => p.status === "OPEN");
  const periodId = (typeof params.periodId === "string" && params.periodId) || openPeriod?.id || db.reportingPeriods[0]?.id || "";
  const period = db.reportingPeriods.find((p) => p.id === periodId);
  const { rows, categories, totalRow } = periodId
    ? getMonthlySummaryReport(db, periodId)
    : { rows: [], categories: [], totalRow: { totalOutstanding: 0, officialRectified: 0, totalAmount: 0, totalCases: 0 } };

  return (
    <div className="flex flex-col gap-5">
      <style>{`@media print { nav, header, .no-print { display: none !important; } main { padding: 0 !important; } }`}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/reports/templates" className="text-xs text-blue-800 hover:underline">
            ← Report Templates
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">Monthly Summary Report</h1>
          <p className="mt-1 text-sm text-slate-500">
            Outstanding cases per category, amount involved, branch dispatch coverage, and the district&apos;s official score.
          </p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/report-templates/monthly-summary/export?periodId=${periodId}`}>
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
            {db.reportingPeriods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} {p.status === "LOCKED" ? "(locked)" : ""}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit">View</Button>
      </form>

      <Card>
        <CardHeader
          title="Monthly Summary Report"
          description={period ? `${period.code} - Total amount involved: ETB ${formatNumber(totalRow.totalAmount)}` : "No reporting period"}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">SN</th>
                <th className="px-4 py-2 font-medium">Total No. of Branches</th>
                <th className="px-4 py-2 font-medium">District</th>
                {categories.map((c) => (
                  <th key={c.id} className="px-2 py-2 text-center font-medium">
                    {c.name}
                  </th>
                ))}
                <th className="px-4 py-2 text-center font-medium">Amount (ETB)</th>
                <th className="px-4 py-2 text-center font-medium">Unrect.</th>
                <th className="px-4 py-2 text-center font-medium">Rect.</th>
                <th className="px-4 py-2 text-center font-medium">Rect. %</th>
                <th className="px-4 py-2 text-center font-medium">Dispatched</th>
                <th className="px-4 py-2 text-center font-medium">Not Dispatched</th>
                <th className="px-4 py-2 text-center font-medium">Total Cases</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-400" colSpan={10 + categories.length}>
                    No districts configured yet.
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.district.id}>
                  <td className="px-4 py-2 text-slate-400">{i + 1}</td>
                  <td className="px-4 py-2 text-slate-700">{formatNumber(r.totalBranches)}</td>
                  <td className="px-4 py-2 text-slate-900">{r.district.name}</td>
                  {r.perCategory.map((c) => (
                    <td key={c.category.id} className="px-2 py-2 text-center text-slate-700">
                      {formatNumber(c.outstanding)}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-center text-slate-700">{formatNumber(r.amountInvolved)}</td>
                  <td className="px-2 py-2 text-center text-slate-700">{formatNumber(r.totalOutstanding)}</td>
                  <td className="px-2 py-2 text-center text-slate-700">{formatNumber(r.officialRectified)}</td>
                  <td className="px-2 py-2 text-center text-slate-700">{r.officialPerformance !== null ? `${r.officialPerformance.toFixed(1)}%` : "--"}</td>
                  <td className="px-2 py-2 text-center text-slate-700">{r.branchesDispatched}</td>
                  <td className="px-2 py-2 text-center text-slate-700">{r.branchesNotDispatched}</td>
                  <td className="px-2 py-2 text-center font-medium text-slate-900">{formatNumber(r.totalCases)}</td>
                </tr>
              ))}
              {rows.length > 0 && (
                <tr className="bg-slate-50 font-semibold">
                  <td className="px-4 py-2 text-slate-900" colSpan={3}>
                    TOTAL
                  </td>
                  {categories.map((c) => (
                    <td key={c.id} className="px-2 py-2" />
                  ))}
                  <td className="px-2 py-2 text-center text-slate-900">{formatNumber(totalRow.totalAmount)}</td>
                  <td className="px-2 py-2 text-center text-slate-900">{formatNumber(totalRow.totalOutstanding)}</td>
                  <td className="px-2 py-2 text-center text-slate-900">{formatNumber(totalRow.officialRectified)}</td>
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2 text-center text-slate-900">{formatNumber(totalRow.totalCases)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
