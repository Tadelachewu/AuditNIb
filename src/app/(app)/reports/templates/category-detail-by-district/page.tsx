import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { formatNumber } from "@/lib/format";
import { getCategoryDetailByDistrict } from "@/lib/reportTemplates";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select, Label } from "@/components/ui/Field";
import { PrintButton } from "@/components/reports/PrintButton";

export default async function CategoryDetailByDistrictPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPermission(user.permissions, permissionKey("report-templates", "category-detail-by-district"))) redirect("/reports/templates");

  const db = readDb();
  const params = await searchParams;
  const openPeriod = db.reportingPeriods.find((p) => p.status === "OPEN");
  const periodId = (typeof params.periodId === "string" && params.periodId) || openPeriod?.id || db.reportingPeriods[0]?.id || "";
  const period = db.reportingPeriods.find((p) => p.id === periodId);
  const { rows, categories, totalRow } = periodId
    ? getCategoryDetailByDistrict(db, periodId)
    : { rows: [], categories: [], totalRow: { totalCases: 0, totalRectified: 0, totalOutstanding: 0, rectifiedPct: null } };

  return (
    <div className="flex flex-col gap-5">
      <style>{`@media print { nav, header, .no-print { display: none !important; } main { padding: 0 !important; } }`}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/reports/templates" className="text-xs text-blue-800 hover:underline">
            ← Report Templates
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">Category Detail by District</h1>
          <p className="mt-1 text-sm text-slate-500">Every district x classified-case category, Unrectified/Rectified.</p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/report-templates/category-detail-by-district/export?periodId=${periodId}`}>
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
        <CardHeader title="Category Detail by District" description={period ? period.code : "No reporting period"} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
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
                <th className="px-4 py-2 text-center font-medium" colSpan={3}>
                  Status of the irregularities
                </th>
              </tr>
              <tr>
                {categories.map((c) => (
                  <Fragment key={c.id}>
                    <th className="px-2 py-1 font-normal">Unrect.</th>
                    <th className="px-2 py-1 font-normal">Rect.</th>
                  </Fragment>
                ))}
                <th className="px-2 py-1 font-normal">Unrect.</th>
                <th className="px-2 py-1 font-normal">Rect.</th>
                <th className="px-2 py-1 font-normal">Rect. %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-400" colSpan={5 + categories.length * 2}>
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
                    <Fragment key={c.category.id}>
                      <td className="px-2 py-2 text-center text-slate-700">{formatNumber(c.outstanding)}</td>
                      <td className="px-2 py-2 text-center text-slate-700">{formatNumber(c.rectified)}</td>
                    </Fragment>
                  ))}
                  <td className="px-2 py-2 text-center font-medium text-slate-900">{formatNumber(r.totalOutstanding)}</td>
                  <td className="px-2 py-2 text-center font-medium text-slate-900">{formatNumber(r.totalRectified)}</td>
                  <td className="px-2 py-2 text-center font-medium text-slate-900">{r.rectifiedPct !== null ? `${r.rectifiedPct.toFixed(1)}%` : "--"}</td>
                </tr>
              ))}
              {rows.length > 0 && (
                <tr className="bg-slate-50 font-semibold">
                  <td className="px-4 py-2 text-slate-900" colSpan={3}>
                    TOTAL
                  </td>
                  {categories.map((c) => (
                    <td key={c.id} className="px-2 py-2" colSpan={2} />
                  ))}
                  <td className="px-2 py-2 text-center text-slate-900">{formatNumber(totalRow.totalOutstanding)}</td>
                  <td className="px-2 py-2 text-center text-slate-900">{formatNumber(totalRow.totalRectified)}</td>
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
