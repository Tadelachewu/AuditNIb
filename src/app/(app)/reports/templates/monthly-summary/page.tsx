import Link from "next/link";
import { currenciesIn, formatCurrencyTotals } from "@/lib/currency";
import { SESSION_ENDED_PATH } from "@/lib/session";
import { ALL_PERIODS_VALUE } from "@/lib/dashboardFilters";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { formatNumber, formatCurrency } from "@/lib/format";
import { getMonthlySummaryReport, templateSourceNote } from "@/lib/reportTemplates";
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
  if (!user) redirect(SESSION_ENDED_PATH);
  if (!hasPermission(user.permissions, permissionKey("report-templates", "monthly-summary"))) redirect("/reports/templates");

  const db = await readDb();
  // Shown when Settings limits this template to certain sources, so its
  // counts are never mistaken for the bank-wide totals.
  const sourceNote = templateSourceNote(db, "monthly-summary");
  const params = await searchParams;
  const openPeriod = db.reportingPeriods.find((p) => p.status === "OPEN");
  const periodId = (typeof params.periodId === "string" && params.periodId) || openPeriod?.id || db.reportingPeriods[0]?.id || "";
  // "All periods" = every period combined (each case counted once).
  const allPeriods = periodId === ALL_PERIODS_VALUE;
  const period = db.reportingPeriods.find((p) => p.id === periodId);
  const { rows, categories, totalRow } = periodId
    ? getMonthlySummaryReport(db, allPeriods ? undefined : periodId)
    : { rows: [], categories: [], totalRow: { totalOutstanding: 0, officialRectified: 0, totalAmount: {}, totalCases: 0 } };

  // Currency sub-columns under "Amount Involved": every currency present (ETB when none yet).
  const found = currenciesIn([totalRow.totalAmount, ...rows.map((row) => row.amountInvolved)]);
  const currencies = found.length > 0 ? found : ["ETB"];

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
          <h1 className="mt-1 text-lg font-semibold text-slate-900">Monthly Summary Report</h1>
          <p className="mt-1 text-sm text-slate-600">
            Total cases per category, amount involved, branch dispatch coverage, and the district&apos;s official score.
            Unrect./Rect./Rect. % reflect only the scored performance category (Other Case).
          </p>
          {sourceNote && <p className="mt-1 text-xs font-medium text-amber-800">{sourceNote}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          <a href={`/api/report-templates/monthly-summary/export?periodId=${periodId}`}>
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
          description={allPeriods || period ? `${allPeriods ? "All periods" : period!.code} - Total amount involved: ${formatCurrencyTotals(totalRow.totalAmount)}` : "No reporting period"}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-2 font-medium" rowSpan={2}>SN</th>
                <th className="px-4 py-2 font-medium" rowSpan={2}>Total No. of Branches</th>
                <th className="px-4 py-2 font-medium" rowSpan={2}>District</th>
                {categories.map((c) => (
                  <th key={c.id} className="px-2 py-2 text-center font-medium" rowSpan={2}>
                    {c.name}
                  </th>
                ))}
                {/* One sub-column per currency - amounts are never added across currencies. */}
                <th className="px-4 py-2 text-center font-medium" colSpan={currencies.length}>
                  Amount Involved
                </th>
                <th className="px-4 py-2 text-center font-medium" rowSpan={2}>Unrect.</th>
                <th className="px-4 py-2 text-center font-medium" rowSpan={2}>Rect.</th>
                <th className="px-4 py-2 text-center font-medium" rowSpan={2}>Rect. %</th>
                <th className="px-4 py-2 text-center font-medium" rowSpan={2}>Dispatched</th>
                <th className="px-4 py-2 text-center font-medium" rowSpan={2}>Not Dispatched</th>
                <th className="px-4 py-2 text-center font-medium" rowSpan={2}>Total Cases</th>
              </tr>
              <tr>
                {currencies.map((c) => (
                  <th key={c} className="px-2 py-1 text-center font-normal">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={9 + categories.length + currencies.length}>
                    No districts configured yet.
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.district.id}>
                  <td className="px-4 py-2 text-slate-500">{i + 1}</td>
                  <td className="px-4 py-2 text-slate-700">{formatNumber(r.totalBranches)}</td>
                  <td className="px-4 py-2 text-slate-900">{r.district.name}</td>
                  {r.perCategory.map((c) => (
                    <td key={c.category.id} className="px-2 py-2 text-center text-slate-700">
                      {formatNumber(c.total)}
                    </td>
                  ))}
                  {currencies.map((cur) => (
                    <td key={cur} className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-slate-700">
                      {r.amountInvolved[cur] ? formatCurrency(r.amountInvolved[cur]) : "--"}
                    </td>
                  ))}
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
                  {categories.map((c, i) => (
                    <td key={c.id} className="px-2 py-2 text-center text-slate-900">
                      {formatNumber(rows.reduce((sum, row) => sum + (row.perCategory[i]?.total ?? 0), 0))}
                    </td>
                  ))}
                  {currencies.map((cur) => (
                    <td key={cur} className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-slate-900">
                      {totalRow.totalAmount[cur] ? formatCurrency(totalRow.totalAmount[cur]) : "--"}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-center text-slate-900">{formatNumber(totalRow.totalOutstanding)}</td>
                  <td className="px-2 py-2 text-center text-slate-900">{formatNumber(totalRow.officialRectified)}</td>
                  <td className="px-2 py-2 text-center text-slate-900">
                    {(() => {
                      const pct = totalRow.totalOutstanding + totalRow.officialRectified;
                      return pct > 0 ? `${((totalRow.officialRectified / pct) * 100).toFixed(1)}%` : "--";
                    })()}
                  </td>
                  <td className="px-2 py-2 text-center text-slate-900">{formatNumber(rows.reduce((sum, row) => sum + row.branchesDispatched, 0))}</td>
                  <td className="px-2 py-2 text-center text-slate-900">{formatNumber(rows.reduce((sum, row) => sum + row.branchesNotDispatched, 0))}</td>
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
