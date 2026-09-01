import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { findingsInScope } from "@/lib/findings-scope";
import { computePerformance } from "@/lib/findings";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { paginate, parsePage } from "@/lib/pagination";
import { formatDateTime, formatNumber } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { FindingStatusBadge } from "@/components/findings/FindingStatusBadge";
import { FilterBar } from "@/components/dashboard/FilterBar";
import { TimeRangeFilter } from "@/components/reports/TimeRangeFilter";
import { PrintButton } from "@/components/reports/PrintButton";
import type { Finding } from "@/types";

// master.txt §18's 14 named reports, covered as a small number of real,
// data-backed views rather than 14 separate pages (see PHASE7.md): the
// Findings Report + CSV/PDF export below covers Monthly/Outstanding/
// IC-vs-IA findings reports; Performance Summary covers branch/district/
// bank-wide performance and rectification progress; Category & Risk
// breakdown covers the classified-case and risk reports; Transfers covers
// the transferred/continuing-cases report. Reporting-period status and
// audit trail are already real, existing admin pages, linked rather than
// duplicated here.
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPermission(user.permissions, permissionKey("reports", "view"))) redirect("/dashboard");

  const params = await searchParams;
  const get = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");

  const db = readDb();
  let findings: Finding[] = findingsInScope(db, user);

  const periodId = get("periodId");
  const districtId = get("districtId");
  const branchId = get("branchId");
  const sourceId = get("sourceId");
  const categoryId = get("categoryId");
  const risk = get("risk");
  const status = get("status");
  const dateFrom = get("dateFrom");
  const dateTo = get("dateTo");

  if (periodId) findings = findings.filter((f) => f.periodId === periodId);
  if (districtId) findings = findings.filter((f) => f.districtId === districtId);
  if (branchId) findings = findings.filter((f) => f.branchId === branchId);
  if (sourceId) findings = findings.filter((f) => f.sourceId === sourceId);
  if (categoryId) findings = findings.filter((f) => f.categoryId === categoryId);
  if (risk) findings = findings.filter((f) => f.riskLevel === risk);
  if (status) findings = findings.filter((f) => f.status === status);
  // Today/This Week/This Month/Custom (TimeRangeFilter) - by each
  // finding's own findingDate, distinct from the reporting-period
  // dropdown above (a period is a monthly bucket; this is a free date
  // range within or across periods). Plain string comparison works since
  // both findingDate and dateFrom/dateTo are YYYY-MM-DD.
  if (dateFrom) findings = findings.filter((f) => f.findingDate >= dateFrom);
  if (dateTo) findings = findings.filter((f) => f.findingDate <= dateTo);

  findings = [...findings].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const district = db.districts.find((d) => d.id === user.districtId);
  const branch = db.branches.find((b) => b.id === user.branchId);

  const exportQuery = new URLSearchParams();
  for (const [k, v] of Object.entries({ periodId, districtId, branchId, sourceId, categoryId, risk, status, dateFrom, dateTo })) {
    if (v) exportQuery.set(k, v);
  }

  const branchName = (id: string) => db.branches.find((b) => b.id === id)?.name ?? "—";
  const categoryName = (id: string) => db.categories.find((c) => c.id === id)?.name ?? "—";
  const sourceName = (id: string) => db.sources.find((s) => s.id === id)?.name ?? "—";
  const departmentName = (id: string) => db.departments.find((d) => d.id === id)?.name ?? "—";

  const inScopeBranches = user.orgScope === "BANK" ? db.branches : user.orgScope === "DISTRICT" ? db.branches.filter((b) => b.districtId === user.districtId) : branch ? [branch] : [];
  const inScopeDistricts = user.orgScope === "BANK" ? db.districts : district ? [district] : [];

  const branchPerformance = inScopeBranches
    .map((b) => ({ branch: b, performance: computePerformance(db, { branchId: b.id, periodId: periodId || undefined }) }))
    .filter((r) => r.performance !== null)
    .sort((a, b) => (b.performance ?? 0) - (a.performance ?? 0));

  const districtPerformance = inScopeDistricts
    .map((d) => ({ district: d, performance: computePerformance(db, { districtId: d.id, periodId: periodId || undefined }) }))
    .filter((r) => r.performance !== null)
    .sort((a, b) => (b.performance ?? 0) - (a.performance ?? 0));

  const categoryBreakdown = db.categories
    .filter((c) => c.active)
    .map((c) => {
      const catFindings = findings.filter((f) => f.categoryId === c.id);
      const total = catFindings.reduce((sum, f) => sum + f.caseCount, 0);
      const rectified = catFindings.reduce((sum, f) => sum + f.rectifiedCases, 0);
      return { category: c, total, rectified, outstanding: total - rectified };
    });

  const riskBreakdown = db.settings.riskLevels.map((r) => ({
    risk: r,
    count: findings.filter((f) => f.riskLevel === r).length,
  }));

  const findingIdsInScope = new Set(findings.map((f) => f.id));
  const transfers = db.findingTransfers
    .filter((t) => findingIdsInScope.has(t.findingId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Server-side pagination for the two tables on this page that can grow
  // unboundedly (every finding matching the filters, every transfer ever
  // recorded) - the rest (performance/category/risk breakdowns) are
  // small, fixed-size aggregates by nature, not raw per-record lists.
  function hrefWithPage(param: string, targetPage: number) {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === param) continue;
      if (typeof value === "string" && value) q.set(key, value);
    }
    if (targetPage > 1) q.set(param, String(targetPage));
    const qs = q.toString();
    return qs ? `/reports?${qs}` : "/reports";
  }
  const findingsPage = paginate(findings, parsePage(get("page")));
  const transfersPage = paginate(transfers, parsePage(get("transfersPage")));

  return (
    <div className="flex flex-col gap-5">
      <style>{`@media print { nav, header, .no-print { display: none !important; } main { padding: 0 !important; } }`}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Reports</h1>
          <p className="mt-1 text-sm text-slate-500">
            Findings, performance, category/risk breakdowns, and transfers - export as CSV or print to PDF.
          </p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/findings/export?${exportQuery.toString()}`}>
            <span className="inline-flex items-center rounded-md border border-brand-gold-dark bg-brand-gold px-3 py-1.5 text-sm font-medium text-slate-900 transition-colors hover:bg-brand-gold-dark">
              Download CSV
            </span>
          </a>
          <PrintButton />
        </div>
      </div>

      <div className="no-print">
        <TimeRangeFilter />
      </div>

      <div className="no-print">
        <FilterBar
          periods={db.reportingPeriods}
          districts={user.orgScope === "BRANCH" || user.orgScope === "DISTRICT" ? (district ? [district] : []) : db.districts}
          branches={user.orgScope === "BRANCH" ? (branch ? [branch] : []) : db.branches}
          sources={db.sources.filter((s) => s.active)}
          categories={db.categories.filter((c) => c.active)}
          riskLevels={db.settings.riskLevels}
          fixedDistrict={user.orgScope !== "BANK" && district ? { id: district.id, name: district.name } : undefined}
          fixedBranch={user.orgScope === "BRANCH" && branch ? { id: branch.id, name: branch.name } : undefined}
          hint="Filters apply immediately."
        />
      </div>

      <Card>
        <CardHeader title="Findings Report" description={`${findings.length} finding(s) matching the current filters`} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">Reference</th>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 font-medium">Branch</th>
                <th className="px-4 py-2 font-medium">Department</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Outstanding</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {findingsPage.items.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-400" colSpan={9}>
                    No findings match these filters.
                  </td>
                </tr>
              )}
              {findingsPage.items.map((f) => (
                <tr key={f.id}>
                  <td className="px-4 py-2 font-mono text-xs text-slate-700">{f.reference}</td>
                  <td className="px-4 py-2 text-slate-900">{f.title}</td>
                  <td className="px-4 py-2 text-slate-600">{branchName(f.branchId)}</td>
                  <td className="px-4 py-2 text-slate-600">{departmentName(f.departmentId)}</td>
                  <td className="px-4 py-2 text-slate-600">{categoryName(f.categoryId)}</td>
                  <td className="px-4 py-2 text-slate-600">{sourceName(f.sourceId)}</td>
                  <td className="px-4 py-2 text-slate-900">
                    {f.currency} {formatNumber(f.amount)}
                  </td>
                  <td className="px-4 py-2 text-slate-900">
                    {f.currency} {formatNumber(f.amount - f.rectifiedAmount)}
                  </td>
                  <td className="px-4 py-2">
                    <FindingStatusBadge status={f.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={findingsPage.page}
          totalPages={findingsPage.totalPages}
          total={findingsPage.total}
          pageSize={findingsPage.pageSize}
          hrefFor={(p) => hrefWithPage("page", p)}
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Branch Performance" description={periodId ? "Filtered period" : "All periods"} />
          <div className="divide-y divide-slate-100">
            {branchPerformance.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">No data yet.</p>}
            {branchPerformance.map((row, i) => (
              <div key={row.branch.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-slate-900">
                  <span className="mr-2 text-slate-400">#{i + 1}</span>
                  {row.branch.name}
                </span>
                <span className="font-medium text-slate-700">{row.performance!.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="District Performance" description={periodId ? "Filtered period" : "All periods"} />
          <div className="divide-y divide-slate-100">
            {districtPerformance.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">No data yet.</p>}
            {districtPerformance.map((row, i) => (
              <div key={row.district.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-slate-900">
                  <span className="mr-2 text-slate-400">#{i + 1}</span>
                  {row.district.name}
                </span>
                <span className="font-medium text-slate-700">{row.performance!.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Category Breakdown" description="Matching the current filters" />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Category</th>
                  <th className="px-4 py-2 font-medium">Total</th>
                  <th className="px-4 py-2 font-medium">Rectified</th>
                  <th className="px-4 py-2 font-medium">Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {categoryBreakdown.map(({ category: c, total, rectified, outstanding }) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2 text-slate-900">{c.name}</td>
                    <td className="px-4 py-2 text-slate-700">{total}</td>
                    <td className="px-4 py-2 text-slate-700">{rectified}</td>
                    <td className="px-4 py-2 text-slate-700">{outstanding}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Risk Breakdown" description="Matching the current filters" />
          <div className="divide-y divide-slate-100">
            {riskBreakdown.map(({ risk, count }) => (
              <div key={risk} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-slate-900">{risk}</span>
                <span className="font-medium text-slate-700">{count}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Transfers" description="Findings carried into a later reporting period, matching the current filters" />
        <div className="divide-y divide-slate-100">
          {transfersPage.items.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">No transfers recorded.</p>}
          {transfersPage.items.map((t) => {
            const finding = db.findings.find((f) => f.id === t.findingId);
            return (
              <div key={t.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-slate-600">
                  <Link href={`/findings/${t.findingId}`} className="font-mono text-xs text-blue-800 hover:underline">
                    {finding?.reference ?? t.findingId}
                  </Link>{" "}
                  — <span className="font-medium text-slate-900">{t.createdByName}</span> transferred {t.casesTransferred}{" "}
                  case(s) / {finding?.currency ?? ""} {formatNumber(t.amountTransferred)}
                </span>
                <span className="text-xs text-slate-400">{formatDateTime(t.createdAt)}</span>
              </div>
            );
          })}
        </div>
        <Pagination
          page={transfersPage.page}
          totalPages={transfersPage.totalPages}
          total={transfersPage.total}
          pageSize={transfersPage.pageSize}
          hrefFor={(p) => hrefWithPage("transfersPage", p)}
        />
      </Card>

      <Card className="no-print">
        <CardHeader title="More Reports" description="Reporting-period status and the full audit trail are covered by their own pages." />
        <div className="flex flex-wrap gap-4 p-4 text-sm">
          {hasPermission(user.permissions, permissionKey("reporting-periods", "view")) && (
            <Link href="/admin/reporting-periods" className="font-medium text-blue-800 hover:underline">
              Reporting Period Status →
            </Link>
          )}
          {hasPermission(user.permissions, permissionKey("audit-log", "view")) && (
            <Link href="/admin/audit-log" className="font-medium text-blue-800 hover:underline">
              Audit Trail →
            </Link>
          )}
          {hasPermission(user.permissions, permissionKey("report-templates", "view")) && (
            <Link href="/reports/templates" className="font-medium text-blue-800 hover:underline">
              Report Templates →
            </Link>
          )}
        </div>
      </Card>
    </div>
  );
}
