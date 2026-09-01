import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { formatNumber } from "@/lib/format";
import { getDistrictSnapshotAsOf } from "@/lib/reportTemplates";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select, Input, Label } from "@/components/ui/Field";
import { PrintButton } from "@/components/reports/PrintButton";

export default async function MidMonthDistrictSnapshotPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPermission(user.permissions, permissionKey("report-templates", "mid-month-district-snapshot"))) redirect("/reports/templates");

  const db = readDb();
  const params = await searchParams;
  const openPeriod = db.reportingPeriods.find((p) => p.status === "OPEN");
  const periodId = (typeof params.periodId === "string" && params.periodId) || openPeriod?.id || db.reportingPeriods[0]?.id || "";
  const period = db.reportingPeriods.find((p) => p.id === periodId);
  const today = new Date().toISOString().slice(0, 10);
  const asOfDate = (typeof params.asOfDate === "string" && params.asOfDate) || today;
  const { rows, totalRow } = periodId
    ? getDistrictSnapshotAsOf(db, periodId, asOfDate)
    : { rows: [], totalRow: { totalBranches: 0, totalCases: 0, rectifiedCases: 0, outstandingCases: 0, performance: null } };

  return (
    <div className="flex flex-col gap-5">
      <style>{`@media print { nav, header, .no-print { display: none !important; } main { padding: 0 !important; } }`}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/reports/templates" className="text-xs text-blue-800 hover:underline">
            ← Report Templates
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">Mid-Month District Snapshot</h1>
          <p className="mt-1 text-sm text-slate-500">District performance as of any chosen cutoff date within a period.</p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/report-templates/mid-month-district-snapshot/export?periodId=${periodId}&asOfDate=${asOfDate}`}>
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
        <div>
          <Label htmlFor="asOfDate">As of date</Label>
          <Input id="asOfDate" type="date" name="asOfDate" defaultValue={asOfDate} />
        </div>
        <Button type="submit">View</Button>
      </form>

      <Card>
        <CardHeader
          title="Mid-Month District Snapshot"
          description={period ? `${period.code} - findings dated on or before ${asOfDate}` : "No reporting period"}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">SN</th>
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
                  <td className="px-4 py-6 text-center text-slate-400" colSpan={6}>
                    No districts configured yet.
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.district.id}>
                  <td className="px-4 py-2 text-slate-400">{i + 1}</td>
                  <td className="px-4 py-2 text-slate-900">{r.district.name}</td>
                  <td className="px-4 py-2 text-slate-700">{formatNumber(r.totalCases)}</td>
                  <td className="px-4 py-2 text-slate-700">{formatNumber(r.outstandingCases)}</td>
                  <td className="px-4 py-2 text-slate-700">{formatNumber(r.rectifiedCases)}</td>
                  <td className="px-4 py-2 text-slate-700">{r.performance !== null ? `${r.performance.toFixed(1)}%` : "--"}</td>
                </tr>
              ))}
              {rows.length > 0 && (
                <tr className="bg-slate-50 font-semibold">
                  <td className="px-4 py-2" />
                  <td className="px-4 py-2 text-slate-900">TOTAL</td>
                  <td className="px-4 py-2 text-slate-900">{formatNumber(totalRow.totalCases)}</td>
                  <td className="px-4 py-2 text-slate-900">{formatNumber(totalRow.outstandingCases)}</td>
                  <td className="px-4 py-2 text-slate-900">{formatNumber(totalRow.rectifiedCases)}</td>
                  <td className="px-4 py-2 text-slate-900">{totalRow.performance !== null ? `${totalRow.performance.toFixed(1)}%` : "--"}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
