import { Fragment } from "react";
import { SESSION_ENDED_PATH } from "@/lib/session";
import { ALL_PERIODS_VALUE } from "@/lib/dashboardFilters";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { formatNumber } from "@/lib/format";
import { getCategoryDetailByDistrict, templateSourceNote } from "@/lib/reportTemplates";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select, Label } from "@/components/ui/Field";
import { PrintButton } from "@/components/reports/PrintButton";
import { currentPeriod, sortPeriods } from "@/lib/periods";

export default async function CategoryDetailByDistrictPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_ENDED_PATH);
  if (!hasPermission(user.permissions, permissionKey("report-templates", "category-detail-by-district"))) redirect("/reports/templates");

  const db = await readDb();
  // Shown when Settings limits this template to certain sources, so its
  // counts are never mistaken for the bank-wide totals.
  const sourceNote = templateSourceNote(db, "category-detail-by-district");
  const params = await searchParams;
  const openPeriod = currentPeriod(db.reportingPeriods);
  const periodId = (typeof params.periodId === "string" && params.periodId) || openPeriod?.id || db.reportingPeriods[0]?.id || "";
  // "All periods" = every period combined (each case counted once).
  const allPeriods = periodId === ALL_PERIODS_VALUE;
  const period = db.reportingPeriods.find((p) => p.id === periodId);
  const { rows, categories, totalRow } = periodId
    ? getCategoryDetailByDistrict(db, allPeriods ? undefined : periodId)
    : { rows: [], categories: [], totalRow: { totalCases: 0, totalRectified: 0, totalOutstanding: 0, rectifiedPct: null, perCategory: [] } };

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
          <h1 className="mt-1 text-lg font-semibold text-slate-900">Category Detail by District</h1>
          <p className="mt-1 text-sm text-slate-600">Every district x classified-case category, Unrectified/Rectified.</p>
          {sourceNote && <p className="mt-1 text-xs font-medium text-amber-800">{sourceNote}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          <a href={`/api/report-templates/category-detail-by-district/export?periodId=${periodId}`}>
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
            {sortPeriods(db.reportingPeriods).map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} {p.status === "LOCKED" ? "(locked)" : ""}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit">View</Button>
      </form>

      <Card>
        <CardHeader title="Category Detail by District" description={allPeriods ? "All periods" : period ? period.code : "No reporting period"} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs text-slate-600">
              <tr>
                <th className="px-4 py-2 font-medium" rowSpan={2}>
                  SN
                </th>
                <th className="px-4 py-2 font-medium" rowSpan={2}>
                  Total No. of Branches
                </th>
                <th className="px-4 py-2 font-medium" rowSpan={2}>
                  District
                </th>
                {categories.map((c) => (
                  <th key={c.id} className="px-4 py-2 text-center font-medium" colSpan={2}>
                    {c.name}
                  </th>
                ))}
                <th className="px-4 py-2 text-center font-medium" colSpan={4}>
                  Status of the irregularities
                </th>
              </tr>
              <tr>
                {categories.map((c) => (
                  <Fragment key={c.id}>
                    <th className="px-2 py-1 font-normal">Reported Case</th>
                    <th className="px-2 py-1 font-normal">Rectified</th>
                  </Fragment>
                ))}
                <th className="px-2 py-1 font-normal">Total Reported Case</th>
                <th className="px-2 py-1 font-normal">Rectified</th>
                <th className="px-2 py-1 font-normal">Outstanding Case</th>
                <th className="px-2 py-1 font-normal">Rectified %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={7 + categories.length * 2}>
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
                    <Fragment key={c.category.id}>
                      <td className="px-2 py-2 text-center text-slate-700">{formatNumber(c.total)}</td>
                      <td className="px-2 py-2 text-center text-slate-700">{formatNumber(c.rectified)}</td>
                    </Fragment>
                  ))}
                  <td className="px-2 py-2 text-center font-medium text-slate-900">{formatNumber(r.totalCases)}</td>
                  <td className="px-2 py-2 text-center font-medium text-slate-900">{formatNumber(r.totalRectified)}</td>
                  <td className="px-2 py-2 text-center font-medium text-slate-900">{formatNumber(r.totalOutstanding)}</td>
                  <td className="px-2 py-2 text-center font-medium text-slate-900">{r.rectifiedPct !== null ? `${r.rectifiedPct.toFixed(1)}%` : "--"}</td>
                </tr>
              ))}
              {rows.length > 0 && (
                <tr className="bg-slate-50 font-semibold">
                  <td className="px-4 py-2 text-slate-900" colSpan={3}>
                    TOTAL
                  </td>
                  {categories.map((c, i) => (
                    <Fragment key={c.id}>
                      <td className="px-2 py-2 text-center text-slate-900">{formatNumber(totalRow.perCategory[i]?.total ?? 0)}</td>
                      <td className="px-2 py-2 text-center text-slate-900">{formatNumber(totalRow.perCategory[i]?.rectified ?? 0)}</td>
                    </Fragment>
                  ))}
                  <td className="px-2 py-2 text-center text-slate-900">{formatNumber(totalRow.totalCases)}</td>
                  <td className="px-2 py-2 text-center text-slate-900">{formatNumber(totalRow.totalRectified)}</td>
                  <td className="px-2 py-2 text-center text-slate-900">{formatNumber(totalRow.totalOutstanding)}</td>
                  <td className="px-2 py-2 text-center text-slate-900">{totalRow.rectifiedPct !== null ? `${totalRow.rectifiedPct.toFixed(1)}%` : "--"}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
