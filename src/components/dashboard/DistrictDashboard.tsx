import Link from "next/link";
import type { Database } from "@/types";
import type { SessionData } from "@/lib/session";
import { computePerformance, queueStatusesForSession, findingCaseTotals, transferTotals } from "@/lib/findings";
import { sumAmountByCurrency, sumOutstandingByCurrency } from "@/lib/currency";
import { formatDateTime } from "@/lib/format";
import { inDateRange, type DateRange } from "@/lib/dateRange";
import { applyDashboardFilters, EMPTY_DASHBOARD_FILTERS, type DashboardFilters } from "@/lib/dashboardFilters";
import { Card, CardHeader, StatCard } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { FilterBar } from "@/components/dashboard/FilterBar";
import { TimeRangeFilter } from "@/components/reports/TimeRangeFilter";
import { RiskDistribution } from "@/components/dashboard/RiskDistribution";
import { FindingStatusDistribution } from "@/components/dashboard/FindingStatusDistribution";
import { MonthlyTrend } from "@/components/dashboard/MonthlyTrend";
import { RankedBarChart } from "@/components/dashboard/charts/RankedBarChart";
import { ColumnChart } from "@/components/dashboard/charts/ColumnChart";
import { FindingStatusBadge } from "@/components/findings/FindingStatusBadge";
import { BranchPerformanceTable } from "@/components/dashboard/BranchPerformanceTable";
import { DistrictRankingTable } from "@/components/dashboard/DistrictRankingTable";
import { SourcePerformanceSummary } from "@/components/dashboard/SourcePerformanceSummary";
import { CaseBasedPerformance } from "@/components/dashboard/CaseBasedPerformance";
import { FindingsByCategoryChart } from "@/components/dashboard/FindingsByCategoryChart";

// master.txt §10: district-level aggregate, branch-by-branch ranking,
// category totals, risk distribution, recent activity, work queue -
// the same widget set as BranchDashboard.tsx, one org level up.
export function DistrictDashboard({
  user,
  db,
  dateRange = {},
  filters = EMPTY_DASHBOARD_FILTERS,
}: {
  user: SessionData;
  db: Database;
  dateRange?: DateRange;
  filters?: DashboardFilters;
}) {
  const district = db.districts.find((d) => d.id === user.districtId);
  const branches = district ? db.branches.filter((b) => b.districtId === district.id) : [];
  // FilterBar's own period picker takes priority over "whichever period is
  // currently OPEN" - picking a locked/past period is exactly how you'd
  // review dashboard history, not just the live one.
  const openPeriod = filters.periodId
    ? db.reportingPeriods.find((p) => p.id === filters.periodId)
    : db.reportingPeriods.find((p) => p.status === "OPEN");
  const activeCategories = db.categories.filter((c) => c.active);
  const activeScoringRule = db.scoringRules.find((r) => r.active);

  if (!district) {
    return (
      <Card className="p-4">
        <p className="text-sm text-red-600">
          Your account isn&apos;t assigned to an active district. Contact an administrator.
        </p>
      </Card>
    );
  }

  const districtFindings = db.findings.filter((f) => f.districtId === district.id);
  // Optional Today/Week/Month/Custom filter (TimeRangeFilter) plus
  // FilterBar's branch/source/category/risk/status fields (districtId is
  // already fixed to this district, so that field is a no-op here), by
  // each finding's own attributes - never computePerformance()'s scoring
  // formula itself (District/Branch Performance and both rankings stay
  // keyed to the full BRD-defined eligible-case set, not narrowed by an
  // ad-hoc filter). A branch filter does narrow which rows the branch
  // ranking table shows - see branchesInScope below.
  const districtFindingsInRange = applyDashboardFilters(districtFindings.filter((f) => inDateRange(dateRange, f.findingDate)), filters);
  const periodFindings = openPeriod ? districtFindingsInRange.filter((f) => f.periodId === openPeriod.id) : [];
  // "Submitted" excludes DRAFT - a draft hasn't entered the workflow yet,
  // so it isn't one of this period's submitted findings.
  const submittedFindings = periodFindings.filter((f) => f.status !== "DRAFT").length;
  const requiringReviewFindings = periodFindings.filter((f) => f.status === "DISTRICT_REVIEW").length;
  // "Approved" = passed district review and hasn't been rejected/returned
  // since - i.e. currently sitting at or past HO_REVIEW.
  const approvedFindings = periodFindings.filter((f) =>
    ["HO_REVIEW", "HO_APPROVED", "SENT_TO_BRANCH_MANAGER", "PARTIALLY_RECTIFIED", "RECTIFIED", "TRANSFERRED", "CLOSED"].includes(f.status)
  ).length;
  const rejectedFindings = periodFindings.filter((f) => f.status === "REJECTED").length;
  const returnedFindings = periodFindings.filter((f) => f.status === "RETURNED").length;
  const outstandingFindings = periodFindings.filter((f) => !["RECTIFIED", "CLOSED", "REJECTED"].includes(f.status)).length;
  const { totalFindings, totalCases, rectifiedFindings, rectifiedCases } = findingCaseTotals(periodFindings);
  // A transfer moves periodId forward, so a transferred finding is no
  // longer in periodFindings for its *source* period - counted separately
  // from FindingTransfer records: distinct findings this district
  // transferred out of the current period.
  const districtFindingIds = new Set(districtFindings.map((f) => f.id));
  const districtTransfers = openPeriod
    ? db.findingTransfers.filter((t) => t.fromPeriodId === openPeriod.id && districtFindingIds.has(t.findingId))
    : [];
  const { transferredFindings, transferredCases } = transferTotals(districtTransfers);
  const performance = openPeriod ? computePerformance(db, { districtId: district.id, periodId: openPeriod.id }) : null;
  const totalAmount = sumAmountByCurrency(periodFindings, "amount");
  const outstandingAmount = sumOutstandingByCurrency(periodFindings);
  const resolvedAmount = sumAmountByCurrency(periodFindings, "rectifiedAmount");

  // Performance Ranking Visibility, enabled: bank-wide, so a District
  // Controller/Director can see how their own district compares to every
  // other district - the same comparison HO Dashboard already shows,
  // deliberately extended here for competitive visibility rather than kept
  // HO-only, since the setting is what decides whether this comparison is
  // shown at all, not who has oversight of what.
  const districtRanking = db.districts
    .map((d) => ({ district: d, performance: openPeriod ? computePerformance(db, { districtId: d.id, periodId: openPeriod.id }) : null }))
    .sort((a, b) => (b.performance ?? -1) - (a.performance ?? -1));

  // A branch/source/category filter narrows which rows the ranking tables
  // and per-source/per-category widgets even list - a real narrowing of
  // "what am I looking at," not a redefinition of the performance formula
  // (computePerformance() itself is untouched).
  const branchesInScope = filters.branchId ? branches.filter((b) => b.id === filters.branchId) : branches;
  const sourcesInScope = filters.sourceId
    ? db.sources.filter((s) => s.active && s.id === filters.sourceId)
    : db.sources.filter((s) => s.active);
  const categoriesInScope = filters.categoryId
    ? activeCategories.filter((c) => c.id === filters.categoryId)
    : activeCategories;

  const branchRanking = branchesInScope
    .map((b) => {
      const perf = openPeriod ? computePerformance(db, { branchId: b.id, periodId: openPeriod.id }) : null;
      const findings = periodFindings.filter((f) => f.branchId === b.id);
      return { branch: b, performance: perf, total: findings.length };
    })
    .sort((a, b) => (b.performance ?? -1) - (a.performance ?? -1));
  const rankedBranches = branchRanking.filter((r) => r.performance !== null);
  const { topPercent, bottomPercent } = db.settings.performanceThresholds;
  // Document_3 §25: "Top performers" and "Bottom performers" as separate
  // callouts - threshold-based (Settings.performanceThresholds), not a
  // fixed top-5/bottom-5-by-rank cut, so every branch that clears the bar
  // shows, and the list is legitimately empty when nobody does yet.
  const topBranches = rankedBranches.filter((r) => r.performance! >= topPercent);
  const bottomBranches = [...rankedBranches].reverse().filter((r) => r.performance! <= bottomPercent);

  // "Findings by Branch" - a plain volume count (how many findings came
  // from each branch this period), a different question from the
  // performance-ranked table above, sorted by count rather than %.
  const findingsByBranch = [...branchRanking].sort((a, b) => b.total - a.total).slice(0, 10);

  const categoryTotals = categoriesInScope.map((c) => {
    const findings = periodFindings.filter((f) => f.categoryId === c.id);
    const total = findings.reduce((sum, f) => sum + f.caseCount, 0);
    const rectified = findings.reduce((sum, f) => sum + f.rectifiedCases, 0);
    return { category: c, total, rectified, outstanding: total - rectified };
  });

  const isQueued = queueStatusesForSession(user);
  const workQueue = db.findings
    .filter((f) => f.districtId === district.id && isQueued(f))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);

  const recentActivity = db.findingTransitions
    .filter((t) => districtFindingIds.has(t.findingId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">
          {district.name} <span className="font-mono text-sm font-normal text-slate-400">({district.code})</span>
        </h1>
        <p className="mt-1 text-sm text-slate-500">{branches.length} branch(es)</p>
      </div>

      <FilterBar
        periods={db.reportingPeriods}
        districts={[district]}
        branches={branches}
        sources={db.sources.filter((s) => s.active)}
        categories={activeCategories}
        riskLevels={db.settings.riskLevels}
        defaultPeriodId={db.reportingPeriods.find((p) => p.status === "OPEN")?.id}
        fixedDistrict={{ id: district.id, name: district.name }}
        hint="Filters apply immediately. Performance % always reflects the full scoring formula, not narrowed by source/category/risk/status."
      />

      <TimeRangeFilter />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Submitted" value={openPeriod ? submittedFindings : "--"} hint={openPeriod ? openPeriod.code : "No open period"} />
        <StatCard label="Total Cases" value={openPeriod ? totalCases : "--"} hint={`Across ${totalFindings} finding(s)`} />
        <StatCard label="Requiring Review" value={openPeriod ? requiringReviewFindings : "--"} hint="Awaiting district decision" />
        <StatCard label="Approved" value={openPeriod ? approvedFindings : "--"} hint="Passed district review" />
        <StatCard label="Outstanding" value={openPeriod ? outstandingFindings : "--"} hint="Findings" />
        <StatCard label="Rejected" value={openPeriod ? rejectedFindings : "--"} hint="Findings" />
        <StatCard label="Returned" value={openPeriod ? returnedFindings : "--"} hint="Findings" />
        <StatCard label="Rectified Findings" value={openPeriod ? rectifiedFindings : "--"} hint="Fully rectified or closed" />
        <StatCard label="Rectified Cases" value={openPeriod ? rectifiedCases : "--"} hint="Cumulative, this period" />
        <StatCard label="Transferred Findings" value={openPeriod ? transferredFindings : "--"} hint="Out of this period" />
        <StatCard label="Transferred Cases" value={openPeriod ? transferredCases : "--"} hint="Out of this period" />
        <StatCard
          label="District Performance"
          value={performance !== null ? `${performance.toFixed(1)}%` : "--"}
          hint={activeScoringRule ? `v${activeScoringRule.version} formula` : "No active scoring rule"}
        />
        <StatCard label="Total Amount" value={openPeriod ? totalAmount : "--"} hint="All findings" />
        <StatCard label="Resolved Amount" value={openPeriod ? resolvedAmount : "--"} hint="Cumulative rectified" />
        <StatCard label="Outstanding Amount" value={openPeriod ? outstandingAmount : "--"} hint="Still owed" />
      </div>

      <CaseBasedPerformance db={db} periodFindings={periodFindings} openPeriod={openPeriod} />

      {db.settings.rankingVisibility.branches && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Top Performers" description={`Branches at or above ${topPercent}% this period`} />
            <div className="divide-y divide-slate-100">
              {topBranches.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">No performance data yet.</p>}
              {topBranches.map((row, i) => (
                <Link
                  key={row.branch.id}
                  href={`/findings?branchId=${row.branch.id}`}
                  className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-slate-50"
                >
                  <span className="flex items-center gap-2">
                    <Badge tone={i === 0 ? "green" : "gray"}>#{i + 1}</Badge>
                    <span className="text-slate-900">{row.branch.name}</span>
                  </span>
                  <span className="font-medium text-slate-700">{row.performance!.toFixed(1)}%</span>
                </Link>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Bottom Performers" description={`Branches at or below ${bottomPercent}% this period`} />
            <div className="divide-y divide-slate-100">
              {bottomBranches.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">No performance data yet.</p>}
              {bottomBranches.map((row) => (
                <Link
                  key={row.branch.id}
                  href={`/findings?branchId=${row.branch.id}`}
                  className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-slate-50"
                >
                  <span className="flex items-center gap-2">
                    <Badge tone="red">Rank #{branchRanking.findIndex((r) => r.branch.id === row.branch.id) + 1}</Badge>
                    <span className="text-slate-900">{row.branch.name}</span>
                  </span>
                  <span className="font-medium text-slate-700">{row.performance!.toFixed(1)}%</span>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      )}

      {db.settings.rankingVisibility.districts ? (
        <>
          <Card>
            <CardHeader title="District Ranking" description="Every district bank-wide, performance this period" />
            <div className="p-4">
              <RankedBarChart
                items={districtRanking.map((r) => ({
                  id: r.district.id,
                  label: r.district.name,
                  value: r.performance,
                  href: `/findings?districtId=${r.district.id}`,
                }))}
                emptyText="No districts configured yet."
              />
            </div>
          </Card>
          <DistrictRankingTable
            db={db}
            districts={db.districts}
            openPeriod={openPeriod}
            description="Every district bank-wide - branch counts are dynamic per district"
          />
        </>
      ) : (
        <Card>
          <CardHeader title="District Ranking" />
          <p className="p-4 text-sm text-slate-400">District ranking visibility is disabled by your administrator.</p>
        </Card>
      )}

      {db.settings.rankingVisibility.branches ? (
        <BranchPerformanceTable
          db={db}
          branches={branchesInScope}
          openPeriod={openPeriod}
          title="Branch Performance"
          description="Every branch in this district, ranked by performance this period"
        />
      ) : (
        <Card>
          <CardHeader title="Branch Ranking" />
          <p className="p-4 text-sm text-slate-400">Branch ranking visibility is disabled by your administrator.</p>
        </Card>
      )}

      <SourcePerformanceSummary
        db={db}
        sources={sourcesInScope}
        periodFindings={periodFindings}
        scope={{ districtId: district.id }}
        openPeriod={openPeriod}
      />

      <Card>
        <CardHeader title="Findings by Branch" description="Top branches by finding count, current period" />
        <div className="p-4">
          <ColumnChart items={findingsByBranch.map((r) => ({ id: r.branch.id, label: r.branch.name, value: r.total }))} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Category Totals" description="Every active classified case category for this district, current period" />
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
              {categoryTotals.map(({ category: c, total, rectified, outstanding }) => (
                <tr key={c.id}>
                  <td className="px-4 py-2 text-slate-900">{c.name}</td>
                  <td className="px-4 py-2 text-slate-700">{openPeriod ? total : "--"}</td>
                  <td className="px-4 py-2 text-slate-700">{openPeriod ? rectified : "--"}</td>
                  <td className="px-4 py-2 text-slate-700">{openPeriod ? outstanding : "--"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <FindingsByCategoryChart findings={periodFindings} categories={categoriesInScope} openPeriod={openPeriod} />

      <MonthlyTrend db={db} scope={{ districtId: district.id }} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FindingStatusDistribution findings={districtFindingsInRange} />
        <RiskDistribution findings={districtFindingsInRange} riskLevels={db.settings.riskLevels} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Work Queue" description="Findings awaiting your action" />
          <div className="divide-y divide-slate-100">
            {workQueue.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">Nothing pending.</p>}
            {workQueue.map((f) => (
              <Link key={f.id} href={`/findings/${f.id}`} className="flex items-center justify-between px-4 py-2 text-sm hover:bg-slate-50">
                <span className="font-mono text-xs text-blue-800">{f.reference}</span>
                <FindingStatusBadge status={f.status} />
              </Link>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Recent Activity" description="Submit, approve, return, and rectification events for this district" />
          <div className="divide-y divide-slate-100">
            {recentActivity.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">No activity yet.</p>}
            {recentActivity.map((t) => (
              <div key={t.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-slate-600">
                  <span className="font-medium text-slate-900">{t.userName}</span> {t.action.replaceAll("_", " ").toLowerCase()}
                </span>
                <span className="text-xs text-slate-400">{formatDateTime(t.createdAt)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
