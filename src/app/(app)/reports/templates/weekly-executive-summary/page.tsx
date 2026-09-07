import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { formatNumber } from "@/lib/format";
import { getWeeklyExecutiveSummary, weekEndDate } from "@/lib/reportTemplates";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import { PrintButton } from "@/components/reports/PrintButton";

function DifferenceBadge({ value }: { value: number | null }) {
  if (value === null) return <>--</>;
  return (
    <Badge tone={value > 0 ? "green" : value < 0 ? "red" : "gray"}>
      {value > 0 ? "+" : ""}
      {value.toFixed(1)}pp
    </Badge>
  );
}

// Deliberately live, not a persisted snapshot - "this week" vs "last week"
// is recomputed from current findingDate data on every view. One section
// per active, admin-configured classified category (not hardcoded to
// Other Case) - see src/lib/reportTemplates.ts's getWeeklyExecutiveSummary
// doc comment for why, and for what "Previous/Current Balance" means here.
// Both cutoff dates default to the real Monday-start current/last calendar
// week but are overridable via the two date pickers below, so a reviewer
// can reproduce a past week-over-week comparison, not just the live one.
export default async function WeeklyExecutiveSummaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPermission(user.permissions, permissionKey("report-templates", "weekly-executive-summary"))) redirect("/reports/templates");

  const db = readDb();
  const params = await searchParams;
  const thisWeekDate = (typeof params.thisWeekDate === "string" && params.thisWeekDate) || weekEndDate(0);
  const lastWeekDate = (typeof params.lastWeekDate === "string" && params.lastWeekDate) || weekEndDate(1);
  const sections = getWeeklyExecutiveSummary(db, thisWeekDate, lastWeekDate);

  return (
    <div className="flex flex-col gap-5">
      <style>{`@media print { nav, header, .no-print { display: none !important; } main { padding: 0 !important; } }`}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/reports/templates" className="text-xs text-blue-800 hover:underline">
            ← Report Templates
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">Weekly Executive Summary</h1>
          <p className="mt-1 text-sm text-slate-500">Every classified category x district, balance carried forward this week vs. last week.</p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/report-templates/weekly-executive-summary/export?thisWeekDate=${thisWeekDate}&lastWeekDate=${lastWeekDate}`}>
            <span className="inline-flex items-center rounded-md border border-brand-gold-dark bg-brand-gold px-3 py-1.5 text-sm font-medium text-slate-900 transition-colors hover:bg-brand-gold-dark">
              Download CSV
            </span>
          </a>
          <PrintButton />
        </div>
      </div>

      <form method="GET" className="no-print flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="thisWeekDate">This week (cutoff date)</Label>
          <Input id="thisWeekDate" type="date" name="thisWeekDate" defaultValue={thisWeekDate} />
        </div>
        <div>
          <Label htmlFor="lastWeekDate">Previous week (cutoff date)</Label>
          <Input id="lastWeekDate" type="date" name="lastWeekDate" defaultValue={lastWeekDate} />
        </div>
        <Button type="submit">View</Button>
      </form>

      {sections.length === 0 && (
        <Card className="p-4">
          <p className="text-sm text-slate-400">No classified categories configured yet.</p>
        </Card>
      )}

      {sections.map((section, sIdx) => (
        <Card key={section.category.id}>
          <CardHeader
            title={`${sIdx + 1}. ${section.category.name}`}
            description={`Current balance: ${formatNumber(section.totalRow.currentBalance)} - Rectified this week: ${formatNumber(section.totalRow.rectified)} - Additional this week: ${formatNumber(section.totalRow.additional)}`}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-2 font-medium">SN</th>
                  <th className="px-4 py-2 font-medium">Total No. of Branches</th>
                  <th className="px-4 py-2 font-medium">District</th>
                  <th className="px-4 py-2 font-medium">Previous Balance</th>
                  <th className="px-4 py-2 font-medium">Additional</th>
                  <th className="px-4 py-2 font-medium">Rectified</th>
                  <th className="px-4 py-2 font-medium">Current Balance</th>
                  <th className="px-4 py-2 font-medium">This Week %</th>
                  <th className="px-4 py-2 font-medium">Last Week %</th>
                  <th className="px-4 py-2 font-medium">Difference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {section.rows.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-center text-slate-400" colSpan={10}>
                      No districts configured yet.
                    </td>
                  </tr>
                )}
                {section.rows.map((r, i) => (
                  <tr key={r.district.id}>
                    <td className="px-4 py-2 text-slate-400">{i + 1}</td>
                    <td className="px-4 py-2 text-slate-700">{formatNumber(r.totalBranches)}</td>
                    <td className="px-4 py-2 text-slate-900">{r.district.name}</td>
                    <td className="px-4 py-2 text-slate-700">{formatNumber(r.previousBalance)}</td>
                    <td className="px-4 py-2 text-slate-700">{formatNumber(r.additional)}</td>
                    <td className="px-4 py-2 text-slate-700">{formatNumber(r.rectified)}</td>
                    <td className="px-4 py-2 text-slate-700">{formatNumber(r.currentBalance)}</td>
                    <td className="px-4 py-2 text-slate-700">{r.thisWeekPct !== null ? `${r.thisWeekPct.toFixed(1)}%` : "--"}</td>
                    <td className="px-4 py-2 text-slate-700">{r.lastWeekPct !== null ? `${r.lastWeekPct.toFixed(1)}%` : "--"}</td>
                    <td className="px-4 py-2">
                      <DifferenceBadge value={r.difference} />
                    </td>
                  </tr>
                ))}
                {section.rows.length > 0 && (
                  <tr className="bg-slate-50 font-semibold">
                    <td className="px-4 py-2 text-slate-900" colSpan={3}>
                      TOTAL
                    </td>
                    <td className="px-4 py-2 text-slate-900">{formatNumber(section.totalRow.previousBalance)}</td>
                    <td className="px-4 py-2 text-slate-900">{formatNumber(section.totalRow.additional)}</td>
                    <td className="px-4 py-2 text-slate-900">{formatNumber(section.totalRow.rectified)}</td>
                    <td className="px-4 py-2 text-slate-900">{formatNumber(section.totalRow.currentBalance)}</td>
                    <td className="px-4 py-2 text-slate-900">{section.totalRow.thisWeekPct !== null ? `${section.totalRow.thisWeekPct.toFixed(1)}%` : "--"}</td>
                    <td className="px-4 py-2 text-slate-900">{section.totalRow.lastWeekPct !== null ? `${section.totalRow.lastWeekPct.toFixed(1)}%` : "--"}</td>
                    <td className="px-4 py-2">
                      <DifferenceBadge value={section.totalRow.difference} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}
