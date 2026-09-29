import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { findingsInScope } from "@/lib/findings-scope";
import { computePerformance, computeEligibleCaseCounts, findingsResidentInPeriod, type FindingPeriodSlice, getActiveScoringAdjustment } from "@/lib/findings";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { paginate, parsePage } from "@/lib/pagination";
import { Card, CardHeader } from "@/components/ui/Card";
import { FilterBar } from "@/components/dashboard/FilterBar";
import { TimeRangeFilter } from "@/components/reports/TimeRangeFilter";
import { PrintButton } from "@/components/reports/PrintButton";
import { FILTERABLE_FINDING_STATUSES, type Finding } from "@/types";
import { matchesOperationAndIrregularity } from "@/lib/dashboardFilters";
import { RankingGrid, type RankingRow } from "@/components/dashboard/RankingGrid";
import { ReportFindingsGrid, TransfersGrid, type ReportFindingRow, type TransferRow } from "@/components/reports/ReportGrids";
import { filterFindingsByText, sortFindings, parseFindingSort, parsePageSize } from "@/lib/findingListQuery";

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

  const db = await readDb();
  let findings: Finding[] = findingsInScope(db, user);

  const periodId = get("periodId");
  const districtId = get("districtId");
  const branchId = get("branchId");
  const sourceId = get("sourceId");
  const categoryId = get("categoryId");
  const risk = get("risk");
  const operationArea = get("operationArea");
  const irregularityType = get("irregularityType");
  const status = get("status");
  const dateFrom = get("dateFrom");
  const dateTo = get("dateTo");

  if (districtId) findings = findings.filter((f) => f.districtId === districtId);
  if (branchId) findings = findings.filter((f) => f.branchId === branchId);
  if (sourceId) findings = findings.filter((f) => f.sourceId === sourceId);
  if (categoryId) findings = findings.filter((f) => f.categoryId === categoryId);
  if (risk) findings = findings.filter((f) => f.riskLevel === risk);
  if (operationArea || irregularityType) findings = findings.filter((f) => matchesOperationAndIrregularity(f, { operationArea, irregularityType }));
  if (status) findings = findings.filter((f) => f.status === status);
  // Today/This Week/This Month/Custom (TimeRangeFilter) - by each
  // finding's own findingDate, distinct from the reporting-period
  // dropdown above (a period is a monthly bucket; this is a free date
  // range within or across periods). Plain string comparison works since
  // both findingDate and dateFrom/dateTo are YYYY-MM-DD.
  if (dateFrom) findings = findings.filter((f) => f.findingDate >= dateFrom);
  if (dateTo) findings = findings.filter((f) => f.findingDate <= dateTo);

  // A period filter now includes a finding that has since transferred out
  // of it (paired with that period's own slice of its cases/amount), not
  // just findings still currently in it - see findingsResidentInPeriod()'s
  // doc comment. `findings` stays the flat list for the aggregates below
  // that don't need the slice (risk breakdown, transfers-in-scope);
  // `resident` carries the slice for the ones that do (findings table,
  // category breakdown - both must use the period-scoped numbers instead
  // of the finding's live lifetime totals, or a transferred finding would
  // be double-counted once in its origin period and again in its
  // destination period).
  type ResidentFinding = { finding: Finding; slice: FindingPeriodSlice | null };
  let resident: ResidentFinding[] = periodId
    ? findingsResidentInPeriod(db, periodId, findings)
    : findings.map((f) => ({ finding: f, slice: null }));
  resident = [...resident].sort((a, b) => b.finding.updatedAt.localeCompare(a.finding.updatedAt));
  findings = resident.map((r) => r.finding);

  const district = db.districts.find((d) => d.id === user.districtId);
  const branch = db.branches.find((b) => b.id === user.branchId);

  const exportQuery = new URLSearchParams();
  const searchText = get("q");
  for (const [k, v] of Object.entries({ periodId, districtId, branchId, sourceId, categoryId, risk, status, operationArea, irregularityType, dateFrom, dateTo, q: searchText, sort: get("sort"), dir: get("dir") })) {
    if (v) exportQuery.set(k, v);
  }

  const branchName = (id: string) => db.branches.find((b) => b.id === id)?.name ?? "—";
  const categoryName = (id: string) => db.categories.find((c) => c.id === id)?.name ?? (id || "—");
  const sourceName = (id: string) => db.sources.find((s) => s.id === id)?.name ?? "—";
  const departmentName = (id: string) => db.departments.find((d) => d.id === id)?.name ?? "—";

  const inScopeBranches = user.orgScope === "BANK" ? db.branches : user.orgScope === "DISTRICT" ? db.branches.filter((b) => b.districtId === user.districtId) : branch ? [branch] : [];
  const inScopeDistricts = user.orgScope === "BANK" ? db.districts : district ? [district] : [];

  // Same numbers as the dashboards' ranking tables (RankingGrid): % plus
  // the eligible / solved / unsolved case counts behind it.
  const perfPeriod = periodId || undefined;
  function rankingRows(items: { id: string; name: string }[], kind: "branch" | "district"): RankingRow[] {
    return items
      .map((o) => {
        const scope = kind === "branch" ? { branchId: o.id, periodId: perfPeriod } : { districtId: o.id, periodId: perfPeriod };
        const counts = computeEligibleCaseCounts(db, scope);
        const totalCases = counts?.totalCases ?? 0;
        const rectifiedCases = counts?.rectifiedCases ?? 0;
        return {
          id: o.id,
          rank: 0,
          name: o.name,
          href: `/findings?${kind === "branch" ? "branchId" : "districtId"}=${o.id}`,
          branchCount: kind === "district" ? db.branches.filter((b) => b.districtId === o.id).length : undefined,
          totalCases,
          rectifiedCases,
          outstandingCases: totalCases - rectifiedCases,
          performance: computePerformance(db, scope),
          adjustmentReason: getActiveScoringAdjustment(db, scope)?.reason ?? null,
        };
      })
      .filter((r) => r.performance !== null)
      .sort((a, b) => (b.performance ?? 0) - (a.performance ?? 0))
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }
  const branchPerformance = rankingRows(inScopeBranches, "branch");

  const districtPerformance = rankingRows(inScopeDistricts, "district");

  const categoryBreakdown = db.categories
    .filter((c) => c.active)
    .map((c) => {
      const catEntries = resident.filter((r) => r.finding.categoryId === c.id);
      // Period-scoped (slice.eligibleCases/closedCases) when a period is
      // filtered, so a transferred finding's cases count toward exactly one
      // period's total here too - unchanged (live caseCount/rectifiedCases)
      // when no period is selected, same as before this fix.
      const total = catEntries.reduce((sum, r) => sum + (r.slice ? r.slice.eligibleCases : r.finding.caseCount), 0);
      const rectified = catEntries.reduce((sum, r) => sum + (r.slice ? r.slice.closedCases : r.finding.rectifiedCases), 0);
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

  const transferRows: TransferRow[] = transfers.map((t) => {
    const finding = db.findings.find((f) => f.id === t.findingId);
    return {
      id: t.id,
      findingId: t.findingId,
      reference: finding?.reference ?? t.findingId,
      fromCode: db.reportingPeriods.find((p) => p.id === t.fromPeriodId)?.code ?? t.fromPeriodId,
      toCode: db.reportingPeriods.find((p) => p.id === t.toPeriodId)?.code ?? t.toPeriodId,
      currency: finding?.currency ?? "",
      originalAmount: t.originalAmount,
      outstandingAmount: t.amountTransferred,
      originalCases: t.originalCaseCount,
      outstandingCases: t.casesTransferred,
      caseAgeDays: t.caseAgeAtTransferDays,
      method: t.method,
      createdByName: t.createdByName,
      createdAt: t.createdAt,
      reason: t.reason,
    };
  });

  // Findings Report: search / sort / page applied server-side, exactly as
  // the Findings list does (src/lib/findingListQuery.ts), so its Export
  // CSV (/api/findings/export) returns what the grid shows. The aggregates
  // above use every filtered finding, not just the searched ones.
  const names = { branchName, departmentName, categoryName, sourceName };
  const sort = parseFindingSort(get("sort"), get("dir"));
  const amountOf = (r: ResidentFinding) => (r.slice ? r.slice.eligibleAmount : r.finding.amount);
  const listed = sortFindings(filterFindingsByText(resident, searchText, names), sort, names, amountOf);
  const findingsPage = paginate(listed, parsePage(get("page")), parsePageSize(get("pageSize")));
  const findingRows: ReportFindingRow[] = findingsPage.items.map(({ finding: f, slice }) => ({
    id: f.id,
    reference: f.reference,
    title: f.title,
    branchName: branchName(f.branchId),
    departmentName: departmentName(f.departmentId),
    categoryName: categoryName(f.categoryId),
    sourceName: sourceName(f.sourceId),
    currency: f.currency,
    amount: amountOf({ finding: f, slice }),
    outstanding: slice ? slice.eligibleAmount - slice.closedAmount : f.amount - f.rectifiedAmount,
    status: f.status,
    isHistorical: slice ? !slice.isCurrentPeriod : false,
    transferredOutToCode: slice?.transferredOutToCode ?? null,
  }));

  return (
    <div className="flex flex-col gap-5">
      <style>{`@media print { nav, header, .no-print { display: none !important; } main { padding: 0 !important; } }`}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Reports</h1>
          <p className="mt-1 text-sm text-slate-600">
            Findings, performance, category/risk breakdowns, and transfers - export as CSV or print to PDF.
          </p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/findings/export?${exportQuery.toString()}`}>
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
          periods={db.reportingPeriods}
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
          <RankingGrid kind="branch" hasScope rows={branchPerformance} exportFileName="report-branch-performance" />
        </Card>

        <Card>
          <CardHeader title="District Performance" description={periodId ? "Filtered period" : "All periods"} />
          <RankingGrid kind="district" hasScope rows={districtPerformance} exportFileName="report-district-performance" />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Category Breakdown" description="Matching the current filters" />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600">
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
