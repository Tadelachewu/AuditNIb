import Link from "next/link";
import { SESSION_ENDED_PATH } from "@/lib/session";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { buildReportsData } from "@/lib/reportsPageData";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { Card, CardHeader } from "@/components/ui/Card";
import { FilterBar } from "@/components/dashboard/FilterBar";
import { TimeRangeFilter } from "@/components/reports/TimeRangeFilter";
import { PrintButton } from "@/components/reports/PrintButton";
import { FILTERABLE_FINDING_STATUSES } from "@/types";
import { RankingGrid } from "@/components/dashboard/RankingGrid";
import { ReportFindingsGrid } from "@/components/reports/ReportGrids";
import { CategoryBreakdownGrid, RiskBreakdownGrid, TransfersGrid } from "@/components/reports/ReportSectionGrids";
import { currentPeriod, sortPeriods } from "@/lib/periods";
import { setGridParams } from "@/lib/gridParams";

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
  if (!user) redirect(SESSION_ENDED_PATH);
  if (!hasPermission(user.permissions, permissionKey("reports", "view"))) redirect("/dashboard");

  const params = await searchParams;
  // The section tables are paged on the server, each per its own URL parameters (src/lib/gridPage.ts).
  setGridParams(params);
  const get = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");

  const db = await readDb();
  const {
    findings,
    periodId,
    district,
    branch,
    exportQuery,
    searchText,
    sort,
    findingsPage,
    findingRows,
    branchPerformance,
    districtPerformance,
    categoryBreakdown,
    riskBreakdown,
    transferRows,
  } = buildReportsData(db, user, get);

  return (
    <div className="flex flex-col gap-5">
      <style>{`@media print { nav, header, .no-print { display: none !important; } main { padding: 0 !important; } }`}</style>

      <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-slate-900">Reports</h1>
          <p className="mt-1 text-sm text-slate-600">
            Findings, performance, category/risk breakdowns, and transfers - export as CSV or print to PDF.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <a href={`/api/reports/export?${exportQuery.toString()}`} title="Every section of this report, with the current filters">
            <span className="inline-flex items-center rounded-md border border-brand-gold-dark bg-brand-gold px-3 py-1.5 text-sm font-medium text-on-gold transition-colors hover:bg-brand-gold-dark">
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
          periods={sortPeriods(db.reportingPeriods)}
          defaultPeriodId={currentPeriod(db.reportingPeriods)?.id}
          districts={user.orgScope === "BRANCH" || user.orgScope === "DISTRICT" ? (district ? [district] : []) : db.districts}
          branches={user.orgScope === "BRANCH" ? (branch ? [branch] : []) : db.branches}
          sources={db.sources.filter((s) => s.active)}
          categories={db.categories.filter((c) => c.active)}
          riskLevels={db.settings.riskLevels}
          operationAreas={db.settings.operationAreas}
          irregularityTypes={db.settings.irregularityTypes}
          fixedDistrict={user.orgScope !== "BANK" && district ? { id: district.id, name: district.name } : undefined}
          fixedBranch={user.orgScope === "BRANCH" && branch ? { id: branch.id, name: branch.name } : undefined}
          statusOptions={FILTERABLE_FINDING_STATUSES}
          hint="Filters apply immediately."
        />
      </div>

      <Card>
        <CardHeader title="Findings Report" description={`${findings.length} finding(s) matching the current filters`} />
        <ReportFindingsGrid
          rows={findingRows}
          paging={{ page: findingsPage.page, pageSize: findingsPage.pageSize, total: findingsPage.total }}
          sort={{ id: sort.key, desc: sort.desc }}
          searchText={searchText}
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Branch Performance" description={periodId ? "Filtered period" : "All periods"} />
          <RankingGrid id="branchPerf" kind="branch" hasScope rows={branchPerformance} exportFileName="report-branch-performance" />
        </Card>

        <Card>
          <CardHeader title="District Performance" description={periodId ? "Filtered period" : "All periods"} />
          <RankingGrid id="districtPerf" kind="district" hasScope rows={districtPerformance} exportFileName="report-district-performance" />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Category Breakdown" description="Matching the current filters" />
          <CategoryBreakdownGrid
            rows={categoryBreakdown.map(({ category: c, total, rectified, outstanding }) => ({ id: c.id, name: c.name, total, rectified, outstanding }))}
          />
        </Card>

        <Card>
          <CardHeader title="Risk Breakdown" description="Matching the current filters" />
          <RiskBreakdownGrid rows={riskBreakdown} />
        </Card>
      </div>

      <Card>
        <CardHeader title="Transfers" description="Findings carried into a later reporting period, matching the current filters" />
        <TransfersGrid rows={transferRows} />
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
