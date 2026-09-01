import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { formatNumber } from "@/lib/format";
import { getCategoryPerformanceSummary, formatPercentageRange } from "@/lib/reportTemplates";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select, Label } from "@/components/ui/Field";
import { PrintButton } from "@/components/reports/PrintButton";

export default async function CategoryPerformanceSummaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPermission(user.permissions, permissionKey("report-templates", "category-performance-summary"))) redirect("/reports/templates");

  const db = readDb();
  const params = await searchParams;
  const periodId = typeof params.periodId === "string" ? params.periodId : "";
  const { rows, totalRow, grossPercentage } = getCategoryPerformanceSummary(db, periodId || undefined);

  return (
    <div className="flex flex-col gap-5">
      <style>{`@media print { nav, header, .no-print { display: none !important; } main { padding: 0 !important; } }`}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/reports/templates" className="text-xs text-blue-800 hover:underline">
            ← Report Templates
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">Category Performance Summary</h1>
          <p className="mt-1 text-sm text-slate-500">Bank-wide rectification rate per category, with the district range.</p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/report-templates/category-performance-summary/export?periodId=${periodId}`}>
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
            <option value="">All periods</option>
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
          title="Category Performance Summary"
          description={`${periodId ? db.reportingPeriods.find((p) => p.id === periodId)?.code : "All periods"} - Gross: ${grossPercentage !== null ? `${grossPercentage.toFixed(1)}%` : "--"}`}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">SN</th>
                <th className="px-4 py-2 font-medium">Types of cases</th>
                <th className="px-4 py-2 font-medium">Unrectified</th>
                <th className="px-4 py-2 font-medium">Rectified</th>
                <th className="px-4 py-2 font-medium">Total Outstanding Unrectified</th>
                <th className="px-4 py-2 font-medium">Percentage Ranges</th>
                <th className="px-4 py-2 font-medium">Gross Percentage</th>
                <th className="px-4 py-2 font-medium">Previous Period</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-400" colSpan={8}>
                    No classified categories configured yet.
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.category.id}>
                  <td className="px-4 py-2 text-slate-400">{i + 1}</td>
                  <td className="px-4 py-2 text-slate-900">{r.category.name}</td>
                  <td className="px-4 py-2 text-slate-700">{formatNumber(r.totalCases)}</td>
                  <td className="px-4 py-2 text-slate-700">{formatNumber(r.rectifiedCases)}</td>
                  <td className="px-4 py-2 text-slate-700">{formatNumber(r.outstandingCases)}</td>
                  <td className="px-4 py-2 text-slate-700">{formatPercentageRange(r.minDistrictPct, r.maxDistrictPct)}</td>
                  <td className="px-4 py-2 text-slate-700">{r.performance !== null ? `${r.performance.toFixed(1)}%` : "--"}</td>
                  <td className="px-4 py-2 text-slate-700">{r.previousPeriodPerformance !== null ? `${r.previousPeriodPerformance.toFixed(1)}%` : "--"}</td>
                </tr>
              ))}
              {rows.length > 0 && (
                <tr className="bg-slate-50 font-semibold">
                  <td className="px-4 py-2 text-slate-900" colSpan={2}>
                    TOTAL
                  </td>
                  <td className="px-4 py-2 text-slate-900">{formatNumber(totalRow.totalCases)}</td>
                  <td className="px-4 py-2 text-slate-900">{formatNumber(totalRow.rectifiedCases)}</td>
                  <td className="px-4 py-2 text-slate-900">{formatNumber(totalRow.outstandingCases)}</td>
                  <td className="px-4 py-2" />
                  <td className="px-4 py-2 text-slate-900">{grossPercentage !== null ? `${grossPercentage.toFixed(1)}%` : "--"}</td>
                  <td className="px-4 py-2" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
