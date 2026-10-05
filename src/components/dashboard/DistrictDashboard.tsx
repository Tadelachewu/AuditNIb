import Link from "next/link";
import { HO_APPROVED_OR_LATER_STATUSES, type Database } from "@/types";
import type { SessionData } from "@/lib/session";
import {
  computePerformance,
  computeEligibleCaseCounts,
  queueStatusesForSession,
  findingCaseTotals,
  findingCaseTotalsInPeriod,
  transferTotals,
  isHoApproved,
} from "@/lib/findings";
import { sumAmountByCurrency, sumOutstandingByCurrency, sumAmountByCurrencyInPeriod, sumOutstandingByCurrencyInPeriod, addCurrency, mergeCurrencyTotals, formatCurrencyTotals, type CurrencyTotals } from "@/lib/currency";
import { formatDateTime } from "@/lib/format";
import { inDateRange, type DateRange } from "@/lib/dateRange";
import { applyDashboardFilters, EMPTY_DASHBOARD_FILTERS, ALL_PERIODS_VALUE, type DashboardFilters } from "@/lib/dashboardFilters";
import { Card, CardHeader, StatCard } from "@/components/ui/Card";
import { DASHBOARD_ICONS as ICON } from "@/lib/dashboardIcons";
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
import { PerformanceCalculation, PerformancePct } from "@/components/dashboard/PerformanceMath";
import { DashboardGrid } from "@/components/dashboard/DashboardGrid";
import { currentPeriod, sortPeriods } from "@/lib/periods";

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
  const allPeriodsSelected = filters.periodId === ALL_PERIODS_VALUE;
  const openPeriod = allPeriodsSelected
    ? undefined
    : filters.periodId
      ? db.reportingPeriods.find((p) => p.id === filters.periodId)
      : currentPeriod(db.reportingPeriods);
  // True whenever there's real data to show - a specific period, or "All
  // periods" explicitly chosen - see BranchDashboard.tsx's own doc comment.
  const hasPeriodScope = allPeriodsSelected || Boolean(openPeriod);
  const periodDisplayMarker = hasPeriodScope ? (openPeriod ?? { id: ALL_PERIODS_VALUE }) : undefined;
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
  const periodFindings = allPeriodsSelected
    ? districtFindingsInRange
    : openPeriod
      ? districtFindingsInRange.filter((f) => f.periodId === openPeriod.id)
      : [];
  const requiringReviewFindings = periodFindings.filter((f) => f.status === "DISTRICT_REVIEW").length;
  // "Approved" = passed district review and hasn't been rejected/returned
  // since - i.e. currently sitting at or past HO_REVIEW. Deliberately a
  // wider set than Total Findings' HO_APPROVED_OR_LATER (includes
  // HO_REVIEW/HO_APPROVED, still mid-review) since this card is tracking
  // workflow progress, not "is this finding official yet."
  const approvedFindings = periodFindings.filter((f) =>
    ["HO_REVIEW", "HO_APPROVED", "SENT_TO_BRANCH_MANAGER", "REVERSED", "PARTIALLY_RECTIFIED", "RECTIFIED", "TRANSFERRED", "CLOSED"].includes(f.status)
  ).length;
  const rejectedFindings = periodFindings.filter((f) => f.status === "REJECTED").length;
  const returnedFindings = periodFindings.filter((f) => f.status === "RETURNED").length;
  // Total Findings/Cases/Rectified below only count HO-approved-or-later,
  // closed-only-rectified findings, same as every other dashboard - see
  // findingCaseTotals()'s own doc comment in src/lib/findings.ts.
  // Period-residency-aware (see findingCaseTotalsInPeriod()'s doc comment
  // in src/lib/findings.ts) - a finding partially rectified here and then
  // transferred still counts its slice toward this period instead of
  // vanishing from it.
  const { totalFindings, totalCases, reportedCases, rectifiedFindings, rectifiedCases } =
    !allPeriodsSelected && openPeriod ? findingCaseTotalsInPeriod(db, openPeriod.id, districtFindingsInRange) : findingCaseTotals(periodFindings);
  // Every other "official" figure below (as opposed to
  // FindingStatusDistribution's deliberately broader in-flight-workflow
  // view - RiskDistribution applies this same isHoApproved() gate
  // internally now too) shares that same isHoApproved() gate, so Total Amount,
  // Outstanding, Category Totals, etc. don't inflate before a finding's
  // actually been approved.
  const approvedPeriodFindings = periodFindings.filter(isHoApproved);
  const outstandingFindings = approvedPeriodFindings.filter((f) => !["RECTIFIED", "CLOSED", "REJECTED"].includes(f.status)).length;
  // A transfer moves periodId forward, so a transferred finding is no
  // longer in periodFindings for its *source* period - counted separately
  // from FindingTransfer records: distinct findings this district
  // transferred out of the current period. Built from
  // districtFindingsInRange (district-fixed, plus whatever
  // branch/source/category/risk/status/date-range the FilterBar currently
  // has selected), not the raw per-district set - otherwise picking a
  // branch left this (and Recent Activity below, which shares this same
  // set) showing every branch's transfers/activity instead of narrowing
  // like every other stat on this page does.
  const districtFindingIds = new Set(districtFindingsInRange.map((f) => f.id));
  const districtTransfers = hasPeriodScope
    ? db.findingTransfers.filter((t) => districtFindingIds.has(t.findingId))
    : [];
  const { transferredFindings, transferredCases } = transferTotals(db, districtTransfers, allPeriodsSelected ? undefined : openPeriod?.id);
  const districtPerformanceScope = { districtId: district.id, periodId: allPeriodsSelected ? undefined : openPeriod?.id };
  const performance = hasPeriodScope ? computePerformance(db, districtPerformanceScope) : null;
  // The counts behind it, for the card's "click % for detail" calculation.
  const performanceCounts = hasPeriodScope ? computeEligibleCaseCounts(db, districtPerformanceScope) : null;
  // Period-residency-aware (see sumAmountByCurrencyInPeriod()'s doc
  // comment in src/lib/currency.ts) - a finding partially rectified here
  // and then transferred must have its amount split between this period
  // and wherever it went, not attributed wholesale to just one of them.
  const approvedDistrictFindingsInRange = districtFindingsInRange.filter(isHoApproved);
  const totalAmount =
    !allPeriodsSelected && openPeriod
      ? sumAmountByCurrencyInPeriod(db, openPeriod.id, approvedDistrictFindingsInRange, "eligible")
      : sumAmountByCurrency(approvedPeriodFindings, "amount");
  const outstandingAmount =
    !allPeriodsSelected && openPeriod
      ? sumOutstandingByCurrencyInPeriod(db, openPeriod.id, approvedDistrictFindingsInRange)
      : sumOutstandingByCurrency(approvedPeriodFindings);
  // Resolved Amount counts only formally CLOSED amount, never merely
  // rectified-but-unclosed - same "a controller's sign-off is what makes it
  // official" reasoning as findingCaseTotals()'s own closed-only gate.
  const resolvedAmount =
    !allPeriodsSelected && openPeriod
      ? sumAmountByCurrencyInPeriod(db, openPeriod.id, approvedDistrictFindingsInRange, "closed")
      : sumAmountByCurrency(approvedPeriodFindings, "closedAmount");

  // Performance Ranking Visibility, enabled: bank-wide, so a District
  // Controller/Director can see how their own district compares to every
  // other district - the same comparison HO Dashboard already shows,
  // deliberately extended here for competitive visibility rather than kept
  // HO-only, since the setting is what decides whether this comparison is
  // shown at all, not who has oversight of what.
  const districtRanking = db.districts
    .map((d) => ({
      district: d,
      performance: hasPeriodScope
        ? computePerformance(db, { districtId: d.id, periodId: allPeriodsSelected ? undefined : openPeriod?.id })
        : null,
    }))
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
      const perf = hasPeriodScope
        ? computePerformance(db, { branchId: b.id, periodId: allPeriodsSelected ? undefined : openPeriod?.id })
        : null;
      // Same isHoApproved() gate as everywhere else on this dashboard - a
      // volume count feeding "Findings by Branch" shouldn't grow the moment
      // something's merely registered either.
      const findings = approvedPeriodFindings.filter((f) => f.branchId === b.id);
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

  // Rectified/Rectified Amount are closedCases/closedAmount, not raw
  // self-reported rectifiedCases/rectifiedAmount - unless it is closed,
  // never count as rectified, same rule as computeEligibleCaseCounts()
  // (src/lib/findings.ts) now applies to the headline Performance % - same
  // shape as BranchDashboard's own categoryTotals.
  const categoryTotals = categoriesInScope.map((c) => {
    const findings = approvedPeriodFindings.filter((f) => f.categoryId === c.id);
    const total = findings.reduce((sum, f) => sum + f.caseCount, 0);
    const rectified = findings.reduce((sum, f) => sum + f.closedCases, 0);
    const amount = findings.reduce((sum, f) => sum + f.amount, 0);
    const rectifiedAmount = findings.reduce((sum, f) => sum + f.closedAmount, 0);
    // Per currency for display (never added across currencies).
    const amountCur = findings.reduce((t, f) => addCurrency(t, f.currency, f.amount), {} as CurrencyTotals);
    const closedCur = findings.reduce((t, f) => addCurrency(t, f.currency, f.closedAmount), {} as CurrencyTotals);
    const outstandingCur = findings.reduce((t, f) => addCurrency(t, f.currency, f.amount - f.closedAmount), {} as CurrencyTotals);
    return { category: c, total, rectified, outstanding: total - rectified, amount, rectifiedAmount, outstandingAmount: amount - rectifiedAmount, amountCur, closedCur, outstandingCur };
  });

  const isQueued = queueStatusesForSession(user, db);
  const workQueue = db.findings
    .filter((f) => f.districtId === district.id && isQueued(f))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);

  // District's own distinctive second-stage gate is *verifying* a
  // self-reported rectification, not closing it (that's the same
  // verify-rectification/return-rectification predicate
  // queueStatusesForSession() uses) - "Requiring Review" above already
  // covers the DISTRICT_REVIEW count, so there's no separate "Pending
  // Approval" card here (that was a duplicate of Requiring Review). Not
  // period-scoped - "what needs action right now," not a per-period
  // reporting total.
  const pendingVerifyFindings = db.findings.filter(
    (f) =>
      f.districtId === district.id &&
      f.status !== "RECTIFICATION_RETURNED" &&
      f.status !== "CLOSED" &&
      (f.rectifiedCases > f.districtVerifiedCases || f.rectifiedAmount > f.districtVerifiedAmount)
  );

  const recentActivity = db.findingTransitions
    .filter((t) => districtFindingIds.has(t.findingId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">
          {district.name} <span className="font-mono text-sm font-normal text-slate-500">({district.code})</span>
        </h1>
        <p className="mt-1 text-sm text-slate-600">{branches.length} branch(es)</p>
      </div>

      <FilterBar
        periods={sortPeriods(db.reportingPeriods)}
        districts={[district]}
        branches={branches}
        sources={db.sources.filter((s) => s.active)}
        categories={activeCategories}
        riskLevels={db.settings.riskLevels}
        operationAreas={db.settings.operationAreas}
        irregularityTypes={db.settings.irregularityTypes}
        defaultPeriodId={currentPeriod(db.reportingPeriods)?.id}
        fixedDistrict={{ id: district.id, name: district.name }}
        statusOptions={HO_APPROVED_OR_LATER_STATUSES}
        hint="Filters apply immediately. Performance % always reflects the full scoring formula, not narrowed by source/category/risk/status."
      />

      <TimeRangeFilter />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={ICON.totalFindings}
          label="Total Findings"
          value={hasPeriodScope ? totalFindings : "--"}
          hint={allPeriodsSelected ? "All periods" : openPeriod ? openPeriod.code : "No open period"}
        />
        <StatCard icon={ICON.totalCases} label="Reported Cases" value={hasPeriodScope ? reportedCases : "--"} hint="Originally registered - not changed by transfers" />
        <StatCard icon={ICON.totalCases} label="Total Cases" value={hasPeriodScope ? totalCases : "--"} hint="In this period, after transfers in / out" />
        <StatCard icon={ICON.requiringReview} label="Requiring Review" value={hasPeriodScope ? requiringReviewFindings : "--"} hint="Awaiting district decision" />
        <StatCard icon={ICON.approved} label="Approved" value={hasPeriodScope ? approvedFindings : "--"} hint="Passed district review" />
        <StatCard icon={ICON.outstanding} label="Outstanding" value={hasPeriodScope ? outstandingFindings : "--"} hint="Findings" />
        <StatCard icon={ICON.rejected} label="Rejected" value={hasPeriodScope ? rejectedFindings : "--"} hint="Findings" />
        <StatCard icon={ICON.returned} label="Returned" value={hasPeriodScope ? returnedFindings : "--"} hint="Findings" />
        <StatCard icon={ICON.rectified} label="Rectified Findings" value={hasPeriodScope ? rectifiedFindings : "--"} hint="Formally closed" />
        <StatCard icon={ICON.rectified} label="Rectified Cases" value={hasPeriodScope ? rectifiedCases : "--"} hint="Closed, this period" />
        <StatCard icon={ICON.outstandingCases} label="Outstanding Cases" value={hasPeriodScope ? totalCases - rectifiedCases : "--"} hint="Total minus rectified" />
        <StatCard icon={ICON.transferred} label="Transferred Findings" value={hasPeriodScope ? transferredFindings : "--"} hint="Out of this period" />
        <StatCard icon={ICON.transferred} label="Transferred Cases" value={hasPeriodScope ? transferredCases : "--"} hint="Out of this period" />
        <StatCard
          icon={ICON.performance}
          label="District Performance"
          value={performance !== null ? `${performance.toFixed(1)}%` : "--"}
          hint={activeScoringRule ? `v${activeScoringRule.version} formula - click % for detail` : "No active scoring rule"}
          detail={
            performance !== null && performanceCounts ? (
              <PerformanceCalculation counts={performanceCounts} formula={activeScoringRule?.basis} />
            ) : (
              "No eligible cases in scope yet."
            )
          }
        />
        <StatCard icon={ICON.totalAmount} label="Total Amount" value={hasPeriodScope ? totalAmount : "--"} hint="All findings" />
        <StatCard icon={ICON.resolvedAmount} label="Resolved Amount" value={hasPeriodScope ? resolvedAmount : "--"} hint="Cumulative closed only" />
        <StatCard icon={ICON.outstandingAmount} label="Outstanding Amount" value={hasPeriodScope ? outstandingAmount : "--"} hint="Still owed" />
      </div>

      <Card>
        <CardHeader title="Pending Verify" description={`${pendingVerifyFindings.length} rectified, awaiting your verification`} />
        <div className="divide-y divide-slate-100">
          {pendingVerifyFindings.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">Nothing pending.</p>}
          {pendingVerifyFindings
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, 8)
            .map((f) => (
              <Link key={f.id} href={`/findings/${f.id}`} className="flex items-center justify-between px-4 py-2 text-sm hover:bg-slate-50">
                <span className="font-mono text-xs text-blue-800">{f.reference}</span>
                <FindingStatusBadge status={f.status} />
              </Link>
            ))}
        </div>
      </Card>

      <CaseBasedPerformance
        db={db}
        scope={{ districtId: district.id, branchId: filters.branchId || undefined }}
        openPeriod={openPeriod}
        allPeriods={allPeriodsSelected}
      />

      {db.settings.rankingVisibility.branches && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Top Performers" description={`Branches at or above ${topPercent}% this period`} />
            <div className="divide-y divide-slate-100">
              {topBranches.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">No performance data yet.</p>}
              {topBranches.map((row, i) => (
                <div key={row.branch.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm hover:bg-slate-50">
                  <Link href={`/findings?branchId=${row.branch.id}`} className="flex items-center gap-2">
                    <Badge tone={i === 0 ? "green" : "gray"}>#{i + 1}</Badge>
                    <span className="text-slate-900">{row.branch.name}</span>
                  </Link>
                  <PerformancePct counts={computeEligibleCaseCounts(db, { branchId: row.branch.id, periodId: allPeriodsSelected ? undefined : openPeriod?.id })} />
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Bottom Performers" description={`Branches at or below ${bottomPercent}% this period`} />
            <div className="divide-y divide-slate-100">
              {bottomBranches.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">No performance data yet.</p>}
              {bottomBranches.map((row) => (
                <div key={row.branch.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm hover:bg-slate-50">
                  <Link href={`/findings?branchId=${row.branch.id}`} className="flex items-center gap-2">
                    <Badge tone="red">Rank #{branchRanking.findIndex((r) => r.branch.id === row.branch.id) + 1}</Badge>
                    <span className="text-slate-900">{row.branch.name}</span>
                  </Link>
                  <PerformancePct counts={computeEligibleCaseCounts(db, { branchId: row.branch.id, periodId: allPeriodsSelected ? undefined : openPeriod?.id })} />
                </div>
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
            allPeriods={allPeriodsSelected}
            description="Every district bank-wide - branch counts are dynamic per district"
          />
        </>
      ) : (
        <Card>
          <CardHeader title="District Ranking" />
          <p className="p-4 text-sm text-slate-500">District ranking visibility is disabled by your administrator.</p>
        </Card>
      )}

      {db.settings.rankingVisibility.branches ? (
        <BranchPerformanceTable
          db={db}
          branches={branchesInScope}
          openPeriod={openPeriod}
          allPeriods={allPeriodsSelected}
          title="Branch Performance"
          description="Every branch in this district, ranked by performance this period"
        />
      ) : (
        <Card>
          <CardHeader title="Branch Ranking" />
          <p className="p-4 text-sm text-slate-500">Branch ranking visibility is disabled by your administrator.</p>
        </Card>
      )}

      <SourcePerformanceSummary
        db={db}
        sources={sourcesInScope}
        scope={{ districtId: district.id, branchId: filters.branchId || undefined }}
        openPeriod={openPeriod}
        allPeriods={allPeriodsSelected}
      />

      <Card>
        <CardHeader title="Findings by Branch" description="Top branches by finding count, current period" />
        <div className="p-4">
          <ColumnChart items={findingsByBranch.map((r) => ({ id: r.branch.id, label: r.branch.name, value: r.total }))} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Category Totals" description="Every active classified case category for this district, current period" />
        <DashboardGrid
          id="categoryTotals"
          exportFileName="district-category-totals"
          columns={[
            { key: "category", header: "Category", badgeWhen: "scored", badgeLabel: "Scored" },
            { key: "total", header: "Total Cases", type: "number", total: true },
            { key: "rectified", header: "Rectified Cases", type: "number", total: true },
            { key: "outstanding", header: "Outstanding Cases", type: "number", total: true },
            { key: "amount", header: "Amount", footer: hasPeriodScope ? formatCurrencyTotals(mergeCurrencyTotals(categoryTotals.map((x) => x.amountCur))) : "--" },
            { key: "rectifiedAmount", header: "Rectified Amount", footer: hasPeriodScope ? formatCurrencyTotals(mergeCurrencyTotals(categoryTotals.map((x) => x.closedCur))) : "--" },
            { key: "outstandingAmount", header: "Outstanding Amount", footer: hasPeriodScope ? formatCurrencyTotals(mergeCurrencyTotals(categoryTotals.map((x) => x.outstandingCur))) : "--" },
          ]}
          rows={categoryTotals.map(({ category: c, total, rectified, outstanding, amountCur, closedCur, outstandingCur }) => ({
            category: c.name,
            // "Scored" = counted toward performance by the active scoring rule.
            scored: activeScoringRule?.categories.includes(c.id) ?? false,
            total: hasPeriodScope ? total : null,
            rectified: hasPeriodScope ? rectified : null,
            outstanding: hasPeriodScope ? outstanding : null,
            amount: hasPeriodScope ? formatCurrencyTotals(amountCur) : null,
            rectifiedAmount: hasPeriodScope ? formatCurrencyTotals(closedCur) : null,
            outstandingAmount: hasPeriodScope ? formatCurrencyTotals(outstandingCur) : null,
          }))}
        />
      </Card>

      <FindingsByCategoryChart findings={approvedPeriodFindings} categories={categoriesInScope} openPeriod={periodDisplayMarker} />

      <MonthlyTrend db={db} scope={{ districtId: district.id, branchId: filters.branchId || undefined }} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FindingStatusDistribution findings={districtFindingsInRange} />
        <RiskDistribution findings={districtFindingsInRange} riskLevels={db.settings.riskLevels} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Work Queue" description="Every finding awaiting your action, all categories" />
          <div className="divide-y divide-slate-100">
            {workQueue.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">Nothing pending.</p>}
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
            {recentActivity.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">No activity yet.</p>}
            {recentActivity.map((t) => (
              <div key={t.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-slate-600">
                  <span className="font-medium text-slate-900">{t.userName}</span> {t.action.replaceAll("_", " ").toLowerCase()}
                </span>
                <span className="text-xs text-slate-500">{formatDateTime(t.createdAt)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
