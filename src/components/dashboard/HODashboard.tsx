import Link from "next/link";
import type { Database } from "@/types";
import type { SessionData } from "@/lib/session";
import { computePerformance, findingCaseTotals, transferTotals, averageCaseAgeDays, isHoApproved } from "@/lib/findings";
import { sumAmountByCurrency, sumOutstandingByCurrency } from "@/lib/currency";
import { formatDateTime, formatNumber } from "@/lib/format";
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
import { StackedBarChart } from "@/components/dashboard/charts/StackedBarChart";
import { FindingStatusBadge } from "@/components/findings/FindingStatusBadge";
import { BranchPerformanceTable } from "@/components/dashboard/BranchPerformanceTable";
import { DistrictRankingTable } from "@/components/dashboard/DistrictRankingTable";
import { SourcePerformanceSummary } from "@/components/dashboard/SourcePerformanceSummary";
import { CaseBasedPerformance } from "@/components/dashboard/CaseBasedPerformance";
import { FindingsByCategoryChart } from "@/components/dashboard/FindingsByCategoryChart";

// master.txt §10: bank + district aggregates, district ranking, IC-vs-IA
// source comparison, reporting-period status, work queue - the Head
// Office Internal Controller's bank-wide view.
export function HODashboard({
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
  // FilterBar's own period picker takes priority over "whichever period is
  // currently OPEN" - picking a locked/past period is exactly how you'd
  // review dashboard history, not just the live one.
  const openPeriod = filters.periodId
    ? db.reportingPeriods.find((p) => p.id === filters.periodId)
    : db.reportingPeriods.find((p) => p.status === "OPEN");
  const activeSources = db.sources.filter((s) => s.active);
  const activeScoringRule = db.scoringRules.find((r) => r.active);

  // Optional Today/Week/Month/Custom filter (TimeRangeFilter) plus
  // FilterBar's district/branch/source/category/risk/status fields, by
  // each finding's own attributes - never computePerformance()'s scoring
  // formula itself (Bank-wide/District/Branch Performance and every
  // ranking below stay keyed to the full BRD-defined eligible-case set,
  // not narrowed by an ad-hoc filter, so "80% performance" always means
  // what Settings/the active ScoringRule says it means). District/branch
  // selection does narrow which rows the ranking tables even show,
  // though - see districtsInScope/branchesInScope below.
  const allFindingsInRange = applyDashboardFilters(
    db.findings.filter((f) => inDateRange(dateRange, f.findingDate)),
    filters
  );
  const periodFindings = openPeriod ? allFindingsInRange.filter((f) => f.periodId === openPeriod.id) : [];
  const { totalFindings, totalCases, rectifiedFindings, rectifiedCases } = findingCaseTotals(periodFindings);
  // Every other "official" figure below (as opposed to RiskDistribution/
  // FindingStatusDistribution's deliberately broader in-flight-workflow
  // view) shares that same isHoApproved() gate, so Total Amount,
  // Outstanding, Source Comparison, etc. don't inflate before a finding's
  // actually been approved.
  const approvedPeriodFindings = periodFindings.filter(isHoApproved);
  const outstandingFindings = approvedPeriodFindings.filter((f) => !["RECTIFIED", "CLOSED", "REJECTED"].includes(f.status)).length;
  const bankPerformance = openPeriod ? computePerformance(db, { periodId: openPeriod.id }) : null;
  const totalAmount = sumAmountByCurrency(approvedPeriodFindings, "amount");
  const outstandingAmount = sumOutstandingByCurrency(approvedPeriodFindings);
  const resolvedAmount = sumAmountByCurrency(approvedPeriodFindings, "rectifiedAmount");
  // "How stale is our backlog?" bank-wide - all periods, not just the open
  // one, since a stale finding that got transferred forward is still part
  // of the same outstanding backlog HO needs visibility into.
  const avgOutstandingAgeDays = averageCaseAgeDays(db.findings.filter((f) => !["RECTIFIED", "CLOSED", "REJECTED"].includes(f.status)));

  // A district/branch filter narrows which rows the ranking tables even
  // list - a real narrowing of "what am I looking at," not a redefinition
  // of the performance formula (computePerformance() itself is untouched).
  const districtsInScope = filters.districtId ? db.districts.filter((d) => d.id === filters.districtId) : db.districts;
  const branchesInScope = filters.branchId
    ? db.branches.filter((b) => b.id === filters.branchId)
    : filters.districtId
      ? db.branches.filter((b) => b.districtId === filters.districtId)
      : db.branches;
  const sourcesInScope = filters.sourceId ? activeSources.filter((s) => s.id === filters.sourceId) : activeSources;
  const categoriesInScope = filters.categoryId
    ? db.categories.filter((c) => c.active && c.id === filters.categoryId)
    : db.categories.filter((c) => c.active);

  const districtRanking = districtsInScope
    .map((d) => {
      const perf = openPeriod ? computePerformance(db, { districtId: d.id, periodId: openPeriod.id }) : null;
      // Same isHoApproved() gate as everywhere else on this dashboard - a
      // volume count feeding "Findings by District" shouldn't grow the
      // moment something's merely registered either.
      const findings = approvedPeriodFindings.filter((f) => f.districtId === d.id);
      return { district: d, performance: perf, total: findings.length };
    })
    .sort((a, b) => (b.performance ?? -1) - (a.performance ?? -1));
  const rankedDistricts = districtRanking.filter((r) => r.performance !== null);
  const { topPercent, bottomPercent } = db.settings.performanceThresholds;
  // "Findings by District" - a plain volume count, a different question
  // from the performance-ranked table above, sorted by count rather than %.
  const findingsByDistrict = [...districtRanking].sort((a, b) => b.total - a.total).slice(0, 10);
  const topDistricts = rankedDistricts.filter((r) => r.performance! >= topPercent);
  const bottomDistricts = [...rankedDistricts].reverse().filter((r) => r.performance! <= bottomPercent);

  // Bank-wide, every branch across every district - the district ranking
  // above is one level up; this is the branch-level comparison master.txt
  // §10/§26 asks for separately ("branch comparison" / "top-performing
  // branches"), not just rolled up into its district's number.
  const branchRanking = branchesInScope
    .map((b) => {
      const perf = openPeriod ? computePerformance(db, { branchId: b.id, periodId: openPeriod.id }) : null;
      const findings = approvedPeriodFindings.filter((f) => f.branchId === b.id);
      return { branch: b, performance: perf, total: findings.length };
    })
    .sort((a, b) => (b.performance ?? -1) - (a.performance ?? -1));
  const rankedBranches = branchRanking.filter((r) => r.performance !== null);
  // Document_3 §25's "Top performers"/"Bottom performers" pairing -
  // threshold-based (Settings.performanceThresholds), not a fixed
  // top-5/bottom-5-by-rank cut, so every branch that clears the bar shows,
  // and the list is legitimately empty when nobody does yet.
  const topBranches = rankedBranches.filter((r) => r.performance! >= topPercent);
  const bottomBranches = [...rankedBranches].reverse().filter((r) => r.performance! <= bottomPercent);

  // Document_3 §18's IC vs IA table: Total Cases / Other Cases / Rectified
  // / Outstanding / Amount / Rectified Amount, per source. "Other Cases"
  // here means whatever categories the *active scoring rule* currently
  // scores - generalized the same way computePerformance() already avoids
  // hard-coding "Other Case" as a category name (master.txt §9: "do not
  // hard-code these policy decisions").
  const scoredCategoryIds = new Set(activeScoringRule?.categories ?? []);
  const scoredSourceIds = new Set(activeScoringRule?.sources ?? []);
  const sourceComparison = sourcesInScope.map((s) => {
    // isHoApproved(), same gate as everywhere else on this dashboard - a
    // finding still in DISTRICT_REVIEW/HO_REVIEW doesn't belong in Source
    // Comparison's Total/Rectified/Outstanding columns yet either.
    const findings = approvedPeriodFindings.filter((f) => f.sourceId === s.id);
    const total = findings.reduce((sum, f) => sum + f.caseCount, 0);
    const rectified = findings.reduce((sum, f) => sum + f.rectifiedCases, 0);
    const amount = findings.reduce((sum, f) => sum + f.amount, 0);
    const rectifiedAmount = findings.reduce((sum, f) => sum + f.rectifiedAmount, 0);
    // Eligible = the same category AND source gate computeEligibleCaseCounts
    // enforces (not category-only) - a source the active rule doesn't
    // include contributes 0 eligible cases regardless of category. findings
    // is already isHoApproved()-filtered above, so no separate status check
    // is needed here.
    const eligibleCases = scoredSourceIds.has(s.id)
      ? findings.filter((f) => scoredCategoryIds.has(f.categoryId)).reduce((sum, f) => sum + f.caseCount, 0)
      : 0;
    return {
      source: s,
      total,
      rectified,
      outstanding: total - rectified,
      amount,
      rectifiedAmount,
      outstandingAmount: amount - rectifiedAmount,
      eligibleCases,
    };
  });

  // High-risk = the top two tiers of whatever Settings.riskLevels currently
  // defines, matched case-insensitively since it's admin-configurable free
  // text, not a fixed enum - "High"/"Critical" are just the seeded names.
  const highRiskTiers = new Set(db.settings.riskLevels.slice(-2).map((l) => l.toLowerCase()));
  const highRiskFindings = periodFindings.filter(
    (f) => !["RECTIFIED", "CLOSED", "REJECTED"].includes(f.status) && highRiskTiers.has(f.riskLevel.toLowerCase())
  ).length;

  // Same convention as DistrictDashboard.tsx: a transfer moves periodId
  // forward, so a transferred finding is no longer in periodFindings for
  // its *source* period - counted from FindingTransfer records instead,
  // bank-wide here rather than scoped to one district.
  const bankTransfers = openPeriod ? db.findingTransfers.filter((t) => t.fromPeriodId === openPeriod.id) : [];
  // Previously this StatCard was labeled "Transferred Cases" but held this
  // distinct-finding count, not a case count - transferredCases below is
  // the real per-case sum (FindingTransfer.casesTransferred), added
  // alongside rather than in place of the finding count.
  const { transferredFindings, transferredCases } = transferTotals(bankTransfers);

  // Two figures HO specifically needs called out on their own: "awaiting my
  // approval decision" and "district-verified, awaiting my close/accept."
  // HO's own queue is exactly these two categories (findings.ho-review /
  // close, plus any bank-approval assignment - see the seeded
  // HO_CONTROLLER role's permission list), so unlike Branch/District these
  // two dedicated cards fully replace a generic capped Work Queue rather
  // than duplicating it. Not period-scoped - these are "what needs action
  // right now," not a per-period reporting total.
  const isBankApprover = Boolean(user.userId && db.settings.hoApproval.approverUserIds.includes(user.userId));
  const pendingApprovalFindings = db.findings.filter(
    (f) => f.status === "HO_REVIEW" || (isBankApprover && f.status === "PENDING_BANK_APPROVAL")
  );
  // Same closable-amount calculation as queueStatusesForSession()'s close()
  // matcher and close/route.ts itself - a rectification only counts once
  // district has verified it, not merely self-reported.
  const pendingCloseFindings = db.findings.filter((f) => {
    const verifiedCases = Math.min(f.rectifiedCases, f.districtVerifiedCases);
    const verifiedAmount = Math.min(f.rectifiedAmount, f.districtVerifiedAmount);
    return f.status !== "CLOSED" && (verifiedCases > f.closedCases || verifiedAmount > f.closedAmount);
  });

  const recentActivity = [...db.findingTransitions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Head Office Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">Bank-wide view across {db.districts.length} district(s)</p>
      </div>

      <FilterBar
        periods={db.reportingPeriods}
        districts={db.districts}
        branches={db.branches}
        sources={activeSources}
        categories={db.categories.filter((c) => c.active)}
        riskLevels={db.settings.riskLevels}
        defaultPeriodId={db.reportingPeriods.find((p) => p.status === "OPEN")?.id}
        hint="Filters apply immediately. Performance % always reflects the full scoring formula, not narrowed by source/category/risk/status."
      />

      <TimeRangeFilter />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Findings" value={openPeriod ? totalFindings : "--"} hint={openPeriod ? openPeriod.code : "No open period"} />
        <StatCard label="Total Cases" value={openPeriod ? totalCases : "--"} hint="Sum of case counts, bank-wide" />
        <StatCard label="Rectified Findings" value={openPeriod ? rectifiedFindings : "--"} hint="Formally closed" />
        <StatCard label="Rectified Cases" value={openPeriod ? rectifiedCases : "--"} hint="Closed, this period" />
        <StatCard label="Outstanding" value={openPeriod ? outstandingFindings : "--"} hint="Findings" />
        <StatCard
          label="Bank-wide Performance"
          value={bankPerformance !== null ? `${bankPerformance.toFixed(1)}%` : "--"}
          hint={activeScoringRule ? `v${activeScoringRule.version} formula` : "No active scoring rule"}
        />
        <StatCard label="High-Risk Findings" value={openPeriod ? highRiskFindings : "--"} hint="Open, top risk tiers" />
        <StatCard label="Transferred Findings" value={openPeriod ? transferredFindings : "--"} hint="Out of this period" />
        <StatCard label="Transferred Cases" value={openPeriod ? transferredCases : "--"} hint="Out of this period" />
        <StatCard label="Total Amount" value={openPeriod ? totalAmount : "--"} hint="All findings, bank-wide" />
        <StatCard label="Resolved Amount" value={openPeriod ? resolvedAmount : "--"} hint="Cumulative rectified" />
        <StatCard label="Outstanding Amount" value={openPeriod ? outstandingAmount : "--"} hint="Still owed, bank-wide" />
        <StatCard
          label="Avg. Backlog Age"
          value={avgOutstandingAgeDays !== null ? `${avgOutstandingAgeDays}d` : "--"}
          hint="Outstanding findings, all periods"
        />
      </div>

      <CaseBasedPerformance db={db} scope={{}} openPeriod={openPeriod} />

      {db.settings.rankingVisibility.districts && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Top-Performing Districts" description={`Performance at or above ${topPercent}% this period, bank-wide`} />
            <div className="divide-y divide-slate-100">
              {topDistricts.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">No performance data yet.</p>}
              {topDistricts.map((row, i) => (
                <Link
                  key={row.district.id}
                  href={`/findings?districtId=${row.district.id}`}
                  className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-slate-50"
                >
                  <span className="flex items-center gap-2">
                    <Badge tone={i === 0 ? "green" : "gray"}>#{i + 1}</Badge>
                    <span className="text-slate-900">{row.district.name}</span>
                  </span>
                  <span className="font-medium text-slate-700">{row.performance!.toFixed(1)}%</span>
                </Link>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Bottom-Performing Districts" description={`Performance at or below ${bottomPercent}% this period, bank-wide`} />
            <div className="divide-y divide-slate-100">
              {bottomDistricts.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">No performance data yet.</p>}
              {bottomDistricts.map((row) => (
                <Link
                  key={row.district.id}
                  href={`/findings?districtId=${row.district.id}`}
                  className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-slate-50"
                >
                  <span className="flex items-center gap-2">
                    <Badge tone="red">Rank #{districtRanking.findIndex((r) => r.district.id === row.district.id) + 1}</Badge>
                    <span className="text-slate-900">{row.district.name}</span>
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
            <CardHeader title="District Ranking" description="Performance by district, current period" />
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
            districts={districtsInScope}
            openPeriod={openPeriod}
            description="All districts, ranked by performance - branch counts are dynamic per district"
          />
        </>
      ) : (
        <Card>
          <CardHeader title="District Ranking" />
          <p className="p-4 text-sm text-slate-400">District ranking visibility is disabled by your administrator.</p>
        </Card>
      )}

      {db.settings.rankingVisibility.branches && (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Top-Performing Branches" description={`Performance at or above ${topPercent}% this period, bank-wide`} />
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
              <CardHeader title="Bottom-Performing Branches" description={`Performance at or below ${bottomPercent}% this period, bank-wide`} />
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

          <BranchPerformanceTable
            db={db}
            branches={branchesInScope}
            openPeriod={openPeriod}
            title="Branch Performance"
            description="Every branch bank-wide, ranked by performance this period"
          />
        </>
      )}

      <SourcePerformanceSummary db={db} sources={sourcesInScope} periodFindings={periodFindings} scope={{}} openPeriod={openPeriod} />

      <Card>
        <CardHeader title="Findings by District" description="Top districts by finding count, current period" />
        <div className="p-4">
          <ColumnChart items={findingsByDistrict.map((r) => ({ id: r.district.id, label: r.district.name, value: r.total }))} />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Source Comparison"
          description={`Internal Control vs. Internal Audit (and any other active source), current period${
            activeScoringRule ? ` — "Eligible Cases" = v${activeScoringRule.version}'s scored categories` : ""
          }`}
        />
        <div className="flex flex-col gap-4 p-4">
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-500">By case count</p>
            <StackedBarChart
              segments={[
                { key: "rectified", label: "Rectified", color: "#0ca30c" },
                { key: "outstanding", label: "Outstanding", color: "#898781" },
              ]}
              rows={sourceComparison.map(({ source: s, rectified, outstanding }) => ({
                id: s.id,
                label: s.name,
                values: { rectified, outstanding },
              }))}
            />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-500">By amount</p>
            <StackedBarChart
              segments={[
                { key: "rectifiedAmount", label: "Rectified", color: "#0ca30c" },
                { key: "outstandingAmount", label: "Outstanding", color: "#898781" },
              ]}
              rows={sourceComparison.map(({ source: s, rectifiedAmount, outstandingAmount }) => ({
                id: s.id,
                label: s.name,
                values: { rectifiedAmount, outstandingAmount },
              }))}
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Total Cases</th>
                <th className="px-4 py-2 font-medium">Eligible Cases</th>
                <th className="px-4 py-2 font-medium">Rectified Cases</th>
                <th className="px-4 py-2 font-medium">Outstanding Cases</th>
                <th className="px-4 py-2 font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Rectified Amount</th>
                <th className="px-4 py-2 font-medium">Outstanding Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sourceComparison.map(
                ({ source: s, total, eligibleCases, rectified, outstanding, amount, rectifiedAmount, outstandingAmount }) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2 text-slate-900">{s.name}</td>
                    <td className="px-4 py-2 text-slate-700">{openPeriod ? total : "--"}</td>
                    <td className="px-4 py-2 text-slate-700">{openPeriod ? eligibleCases : "--"}</td>
                    <td className="px-4 py-2 text-slate-700">{openPeriod ? rectified : "--"}</td>
                    <td className="px-4 py-2 text-slate-700">{openPeriod ? outstanding : "--"}</td>
                    <td className="px-4 py-2 text-slate-700">{openPeriod ? formatNumber(amount) : "--"}</td>
                    <td className="px-4 py-2 text-slate-700">{openPeriod ? formatNumber(rectifiedAmount) : "--"}</td>
                    <td className="px-4 py-2 text-slate-700">{openPeriod ? formatNumber(outstandingAmount) : "--"}</td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <FindingsByCategoryChart findings={approvedPeriodFindings} categories={categoriesInScope} openPeriod={openPeriod} />

      <MonthlyTrend db={db} scope={{}} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FindingStatusDistribution findings={allFindingsInRange} />
        <RiskDistribution findings={allFindingsInRange} riskLevels={db.settings.riskLevels} />
      </div>

      <Card>
        <CardHeader title="Reporting Period Status" />
        <div className="divide-y divide-slate-100">
          {db.reportingPeriods.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="font-mono text-slate-900">{p.code}</span>
              <Badge tone={p.status === "OPEN" ? "green" : "gray"}>{p.status}</Badge>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Pending Approval"
            description={`${pendingApprovalFindings.length} awaiting your review decision${isBankApprover ? " (HO review + bank approval)" : ""}`}
          />
          <div className="divide-y divide-slate-100">
            {pendingApprovalFindings.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">Nothing pending.</p>}
            {pendingApprovalFindings
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

        <Card>
          <CardHeader
            title="Pending Close / Accept"
            description={`${pendingCloseFindings.length} district-verified, awaiting close`}
          />
          <div className="divide-y divide-slate-100">
            {pendingCloseFindings.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">Nothing pending.</p>}
            {pendingCloseFindings
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
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recent Activity" description="Submit, approve, return, and rectification events bank-wide" />
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
