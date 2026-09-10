import Link from "next/link";
import type { Database } from "@/types";
import type { SessionData } from "@/lib/session";
import { findBranchManager, findBranchSubManager, findBranchController } from "@/lib/org";
import { computePerformance, computeEligibleCaseCounts, queueStatusesForSession, findingCaseTotals, findingCaseTotalsInPeriod, transferTotals, isHoApproved } from "@/lib/findings";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { sumAmountByCurrency, sumOutstandingByCurrency, sumAmountByCurrencyInPeriod, sumOutstandingByCurrencyInPeriod } from "@/lib/currency";
import { formatDateTime, formatNumber } from "@/lib/format";
import { inDateRange, type DateRange } from "@/lib/dateRange";
import { applyDashboardFilters, EMPTY_DASHBOARD_FILTERS, ALL_PERIODS_VALUE, type DashboardFilters } from "@/lib/dashboardFilters";
import { Card, CardHeader, StatCard } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { FilterBar } from "@/components/dashboard/FilterBar";
import { TimeRangeFilter } from "@/components/reports/TimeRangeFilter";
import { RiskDistribution } from "@/components/dashboard/RiskDistribution";
import { FindingStatusDistribution } from "@/components/dashboard/FindingStatusDistribution";
import { CategoryDistribution } from "@/components/dashboard/CategoryDistribution";
import { MonthlyTrend } from "@/components/dashboard/MonthlyTrend";
import { FindingStatusBadge } from "@/components/findings/FindingStatusBadge";
import { CaseBasedPerformance } from "@/components/dashboard/CaseBasedPerformance";
import { FindingsByCategoryChart } from "@/components/dashboard/FindingsByCategoryChart";
import { SourcePerformanceSummary } from "@/components/dashboard/SourcePerformanceSummary";

// Per master.txt §10: "Selected month; category totals; total/rectified/
// outstanding; Other Case summary; performance; monthly trend; risk
// distribution; recent activity; relevant work queues."
export function BranchDashboard({
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
  const branch = db.branches.find((b) => b.id === user.branchId);
  const district = db.districts.find((d) => d.id === user.districtId);
  // FilterBar's own period picker takes priority over "whichever period is
  // currently OPEN" - picking a locked/past period is exactly how you'd
  // review dashboard history, not just the live one. "All periods" is its
  // own explicit choice (ALL_PERIODS_VALUE), distinct from an unset filter -
  // an unset filter still defaults to the current OPEN period, "All
  // periods" genuinely aggregates across every period instead.
  const allPeriodsSelected = filters.periodId === ALL_PERIODS_VALUE;
  const openPeriod = allPeriodsSelected
    ? undefined
    : filters.periodId
      ? db.reportingPeriods.find((p) => p.id === filters.periodId)
      : db.reportingPeriods.find((p) => p.status === "OPEN");
  // True whenever there's real data to show - either a specific period was
  // resolved, or "All periods" was explicitly chosen. Only false in the
  // genuine "nothing to show" case (no period exists/selected at all) -
  // every `openPeriod ? X : "--"` StatCard below reads this instead, so
  // "All periods" renders real aggregated numbers rather than "--".
  const hasPeriodScope = allPeriodsSelected || Boolean(openPeriod);
  // For child components that only need a truthy {id}-shaped signal to
  // decide "is there a period scope to show real numbers for" (they never
  // read .id for filtering) - FindingsByCategoryChart, SourcePerformanceSummary.
  const periodDisplayMarker = hasPeriodScope ? (openPeriod ?? { id: ALL_PERIODS_VALUE }) : undefined;
  const activeCategories = db.categories.filter((c) => c.active);
  const activeScoringRule = db.scoringRules.find((r) => r.active);
  const manager = branch ? findBranchManager(db, branch.id) : undefined;
  const subManager = branch ? findBranchSubManager(db, branch.id) : undefined;
  const controller = branch ? findBranchController(db, branch.id) : undefined;

  if (!branch) {
    return (
      <Card className="p-4">
        <p className="text-sm text-red-600">
          Your account isn&apos;t assigned to an active branch. Contact an administrator.
        </p>
      </Card>
    );
  }

  // Optional Today/Week/Month/Custom filter (TimeRangeFilter) plus
  // FilterBar's source/category/risk/status fields (district/branch are
  // already fixed to this branch, so those two fields are a no-op here),
  // by each finding's own attributes - never computePerformance()'s
  // scoring formula itself (Performance %, Branch Ranking below stay
  // keyed to the full BRD-defined eligible-case set, not narrowed by an
  // ad-hoc filter).
  const branchAllFindings = applyDashboardFilters(
    db.findings.filter((f) => f.branchId === branch.id && inDateRange(dateRange, f.findingDate)),
    filters
  );
  const periodFindings = allPeriodsSelected
    ? branchAllFindings
    : openPeriod
      ? branchAllFindings.filter((f) => f.periodId === openPeriod.id)
      : [];
  // Period-residency-aware (findingCaseTotalsInPeriod()), not a raw
  // periodFindings sum - a finding partially rectified here and then
  // transferred must still count its slice of cases/rectification toward
  // this period, not vanish from it (see the function's own doc comment).
  // "All periods"/no-scope modes have no single period to walk a transfer
  // chain against, so they keep the plain findingCaseTotals() over
  // periodFindings, unchanged from before this existed.
  const { totalFindings, totalCases, rectifiedFindings, rectifiedCases } =
    !allPeriodsSelected && openPeriod ? findingCaseTotalsInPeriod(db, openPeriod.id, branchAllFindings) : findingCaseTotals(periodFindings);
  // Every StatCard/table below that reports an "official" figure (as
  // opposed to FindingStatusDistribution's deliberately broader
  // in-flight-workflow view - RiskDistribution/CategoryDistribution both
  // apply this same isHoApproved() gate internally now, not an exception)
  // is scoped to this, not periodFindings -
  // same isHoApproved() gate findingCaseTotals() already applies to Total
  // Findings/Total Cases above, so a finding sitting in DISTRICT_REVIEW/
  // HO_REVIEW doesn't inflate Total Amount, Outstanding, Category Totals,
  // etc. before anyone's actually approved it.
  const approvedPeriodFindings = periodFindings.filter(isHoApproved);
  const outstandingFindings = approvedPeriodFindings.filter((f) => !["RECTIFIED", "CLOSED", "REJECTED"].includes(f.status)).length;
  // periodId: undefined (allPeriodsSelected) is computePerformance()'s own
  // "lifetime, no period filter" mode - exactly what "All periods" means.
  const performance = hasPeriodScope
    ? computePerformance(db, { branchId: branch.id, periodId: allPeriodsSelected ? undefined : openPeriod?.id })
    : null;
  // Same eligible-case counts computePerformance() itself divides to get
  // that percentage - surfaced so the StatCard can show its own math on
  // click (see StatCard's `detail` prop) instead of a bare, unexplained %.
  const eligibleCounts = hasPeriodScope
    ? computeEligibleCaseCounts(db, { branchId: branch.id, periodId: allPeriodsSelected ? undefined : openPeriod?.id })
    : null;
  // Period-residency-aware (see sumAmountByCurrencyInPeriod()'s doc
  // comment in src/lib/currency.ts) - a finding partially rectified here
  // and then transferred must have its amount split between this period
  // and wherever it went, not attributed wholesale to just one of them.
  const approvedBranchAllFindings = branchAllFindings.filter(isHoApproved);
  const totalAmount =
    !allPeriodsSelected && openPeriod
      ? sumAmountByCurrencyInPeriod(db, openPeriod.id, approvedBranchAllFindings, "eligible")
      : sumAmountByCurrency(approvedPeriodFindings, "amount");
  const outstandingAmount =
    !allPeriodsSelected && openPeriod
      ? sumOutstandingByCurrencyInPeriod(db, openPeriod.id, approvedBranchAllFindings)
      : sumOutstandingByCurrency(approvedPeriodFindings);
  // Resolved Amount counts only formally CLOSED amount, never merely
  // rectified-but-unclosed - same "a controller's sign-off is what makes it
  // official" reasoning as findingCaseTotals()'s own closed-only gate.
  const resolvedAmount =
    !allPeriodsSelected && openPeriod
      ? sumAmountByCurrencyInPeriod(db, openPeriod.id, approvedBranchAllFindings, "closed")
      : sumAmountByCurrency(approvedPeriodFindings, "closedAmount");

  // Same computeEligibleCaseCounts() call Case-Based Performance itself
  // uses (see CaseBasedPerformance.tsx's own doc comment) - not a
  // hand-rolled filter, and NOT literally category code "OTHER_CASE"
  // alone the way this used to be computed (a stale hardcode from before
  // ScoringRule.categories became admin-configurable to span more than one
  // category - "Other Case" has only ever been the seeded example
  // category, never a name this section should still special-case). That
  // old version also summed each finding's full caseCount rather than its
  // transfer-aware eligible slice, so it could both undercount (missing
  // every other scored category) and overcount (a case that transferred
  // out of this period) at the same time - this widget must never be able
  // to disagree with Case-Based Performance above it, for the same period
  // and scope, since both are meant to be the exact same headline number.
  const scoredCounts =
    branch && hasPeriodScope
      ? computeEligibleCaseCounts(db, { branchId: branch.id, periodId: allPeriodsSelected ? undefined : openPeriod?.id })
      : null;
  const otherCaseTotal = scoredCounts?.totalCases ?? 0;
  const otherCaseRectified = scoredCounts?.rectifiedCases ?? 0;

  // A category/source filter narrows which rows those widgets even list -
  // a real narrowing of "what am I looking at," not a redefinition of the
  // performance formula (computePerformance() itself is untouched). Same
  // convention as DistrictDashboard's own categoriesInScope/sourcesInScope.
  const categoriesInScope = filters.categoryId ? activeCategories.filter((c) => c.id === filters.categoryId) : activeCategories;
  const sourcesInScope = filters.sourceId
    ? db.sources.filter((s) => s.active && s.id === filters.sourceId)
    : db.sources.filter((s) => s.active);

  // Rectified/Rectified Amount are closedCases/closedAmount, not raw
  // self-reported rectifiedCases/rectifiedAmount - unless it is closed,
  // never count as rectified, same rule as computeEligibleCaseCounts()
  // (src/lib/findings.ts) now applies to the headline Performance %.
  const categoryTotals = categoriesInScope.map((c) => {
    const findings = approvedPeriodFindings.filter((f) => f.categoryId === c.id);
    const total = findings.reduce((sum, f) => sum + f.caseCount, 0);
    const rectified = findings.reduce((sum, f) => sum + f.closedCases, 0);
    const amount = findings.reduce((sum, f) => sum + f.amount, 0);
    const rectifiedAmount = findings.reduce((sum, f) => sum + f.closedAmount, 0);
    return { category: c, total, rectified, outstanding: total - rectified, amount, rectifiedAmount, outstandingAmount: amount - rectifiedAmount };
  });

  // High-risk = the top two tiers of Settings.riskLevels, matched
  // case-insensitively since it's admin-configurable free text - same
  // convention as HODashboard's own High-Risk Findings stat. Scoped to
  // approvedPeriodFindings, not periodFindings - a finding still in
  // DISTRICT_REVIEW/HO_REVIEW hasn't cleared approval yet and shouldn't
  // count here before it does, same isHoApproved() gate every other
  // "official" figure on this dashboard already uses.
  const highRiskTiers = new Set(db.settings.riskLevels.slice(-2).map((l) => l.toLowerCase()));
  const highRiskFindings = approvedPeriodFindings.filter(
    (f) => !["RECTIFIED", "CLOSED", "REJECTED"].includes(f.status) && highRiskTiers.has(f.riskLevel.toLowerCase())
  ).length;

  // Same convention as DistrictDashboard/HODashboard: a transfer moves
  // periodId forward, so a transferred finding is no longer in
  // periodFindings for its *source* period - counted from FindingTransfer
  // records instead, scoped to this branch.
  const branchTransfers = hasPeriodScope
    ? db.findingTransfers.filter(
        (t) =>
          (allPeriodsSelected || t.fromPeriodId === openPeriod!.id) &&
          db.findings.some((f) => f.id === t.findingId && f.branchId === branch.id)
      )
    : [];
  const { transferredFindings, transferredCases } = transferTotals(branchTransfers);

  // The person who registers findings (findings.create - Branch Controller)
  // needs to see their OWN draft/in-flight-approval backlog - scoped to
  // createdBy, not the whole branch: edit/delete/submit are now
  // createdBy-restricted too (see [id]/route.ts and submit/route.ts), so a
  // branch-wide count would include drafts this session can't actually act
  // on if another Branch Controller shares the branch. The rectifier
  // (findings.rectify - Branch Manager) isn't the finding's author, so
  // their pending-rectification backlog stays branch-wide - it's every
  // finding awaiting rectification at this branch, not just ones they
  // personally touched. Both scoped to db.findings directly (not
  // branchAllFindings/periodFindings), same convention as HO/District's
  // own "what needs action right now" cards: this is an action-needed
  // count, not a per-period reporting total, so it must never be narrowed
  // by an ad-hoc FilterBar/date-range filter.
  const hasFindingsAction = (action: string) => hasPermission(user.permissions, permissionKey("findings", action));
  const canRegister = hasFindingsAction("create");
  const canRectify = hasFindingsAction("rectify");
  const ownFindings = db.findings.filter((f) => f.createdBy === user.userId);
  const draftFindings = ownFindings.filter((f) => f.status === "DRAFT").length;
  const pendingApprovalFindings = ownFindings.filter((f) =>
    ["DISTRICT_REVIEW", "HO_REVIEW", "PENDING_BANK_APPROVAL"].includes(f.status)
  ).length;
  // Same statuses as queueStatusesForSession()'s own "rectify" matcher.
  const pendingRectificationFindings = db.findings
    .filter((f) => f.branchId === branch.id)
    .filter((f) => ["SENT_TO_BRANCH_MANAGER", "PARTIALLY_RECTIFIED", "RECTIFICATION_RETURNED"].includes(f.status)).length;

  const isQueued = queueStatusesForSession(user, db);
  const workQueue = db.findings
    .filter((f) => f.branchId === branch.id && isQueued(f))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);

  const branchFindingIds = new Set(db.findings.filter((f) => f.branchId === branch.id).map((f) => f.id));
  const recentActivity = db.findingTransitions
    .filter((t) => branchFindingIds.has(t.findingId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8);

  // Performance Ranking Visibility, enabled: peer branches within the same
  // district get to see where they stand against each other, the same
  // comparison the District Controller already sees on DistrictDashboard -
  // deliberately scoped to "my district's branches," never bank-wide, so
  // this never leaks another district's branches to a branch-level user
  // (BR-WF-015's org-scope boundary still holds; the setting only decides
  // whether the comparison within that boundary is shown or hidden).
  const districtBranches = district ? db.branches.filter((b) => b.districtId === district.id) : [];
  const branchRanking = districtBranches
    .map((b) => ({
      branch: b,
      performance: hasPeriodScope
        ? computePerformance(db, { branchId: b.id, periodId: allPeriodsSelected ? undefined : openPeriod?.id })
        : null,
    }))
    .sort((a, b) => (b.performance ?? -1) - (a.performance ?? -1));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">
          {branch.name} <span className="font-mono text-sm font-normal text-slate-400">({branch.code})</span>
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {district?.name ?? "Unknown district"} · Manager: {manager?.name ?? "Unassigned"}
          {subManager && <> · Sub-Manager: {subManager.name}</>} · Controller: {controller?.name ?? "Unassigned"}
        </p>
      </div>

      <FilterBar
        periods={db.reportingPeriods}
        districts={district ? [district] : []}
        branches={[branch]}
        sources={db.sources.filter((s) => s.active)}
        categories={activeCategories}
        riskLevels={db.settings.riskLevels}
        defaultPeriodId={db.reportingPeriods.find((p) => p.status === "OPEN")?.id}
        fixedDistrict={district ? { id: district.id, name: district.name } : undefined}
        fixedBranch={{ id: branch.id, name: branch.name }}
        hint="Filters apply immediately. Performance % always reflects the full scoring formula, not narrowed by source/category/risk/status."
      />

      <TimeRangeFilter />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Total Findings"
          value={hasPeriodScope ? totalFindings : "--"}
          hint={allPeriodsSelected ? "All periods" : openPeriod ? openPeriod.code : "No open period"}
        />
        <StatCard label="Total Cases" value={hasPeriodScope ? totalCases : "--"} hint="Sum of case counts" />
        <StatCard label="Rectified Findings" value={hasPeriodScope ? rectifiedFindings : "--"} hint="Formally closed" />
        <StatCard label="Rectified Cases" value={hasPeriodScope ? rectifiedCases : "--"} hint="Closed, this period" />
        <StatCard label="Outstanding Cases" value={hasPeriodScope ? totalCases - rectifiedCases : "--"} hint="Total minus rectified" />
        <StatCard label="Outstanding" value={hasPeriodScope ? outstandingFindings : "--"} hint="Findings" />
        <StatCard label="Transferred Findings" value={hasPeriodScope ? transferredFindings : "--"} hint="Out of this period" />
        <StatCard label="Transferred Cases" value={hasPeriodScope ? transferredCases : "--"} hint="Out of this period" />
        <StatCard label="High-Risk Findings" value={hasPeriodScope ? highRiskFindings : "--"} hint="Open, top risk tiers" />
        <StatCard
          label="Branch Performance"
          value={performance !== null ? `${performance.toFixed(1)}%` : "--"}
          hint={activeScoringRule ? `v${activeScoringRule.version} formula - click % for detail` : "No active scoring rule"}
          detail={
            performance !== null && eligibleCounts ? (
              <>
                <p>
                  <span className="font-medium text-slate-900">{eligibleCounts.rectifiedCases}</span> of{" "}
                  <span className="font-medium text-slate-900">{eligibleCounts.totalCases}</span> eligible case(s) closed (unless it&apos;s
                  closed, it never counts as rectified), giving {eligibleCounts.rectifiedCases} ÷ {eligibleCounts.totalCases} × 100 ={" "}
                  {performance.toFixed(1)}%.
                </p>
                {activeScoringRule && <p className="mt-1 text-slate-500">Formula: {activeScoringRule.basis}</p>}
              </>
            ) : (
              "No eligible cases in scope yet."
            )
          }
        />
        <StatCard label="Total Amount" value={hasPeriodScope ? totalAmount : "--"} hint="All findings" />
        <StatCard label="Resolved Amount" value={hasPeriodScope ? resolvedAmount : "--"} hint="Cumulative closed only" />
        <StatCard label="Outstanding Amount" value={hasPeriodScope ? outstandingAmount : "--"} hint="Still owed" />
        {canRegister && <StatCard label="Draft" value={draftFindings} hint="Not yet submitted" />}
        {canRegister && (
          <StatCard label="Pending Approval" value={pendingApprovalFindings} hint="District/HO review, your registrations" />
        )}
        {(canRegister || canRectify) && (
          <StatCard label="Pending Rectification" value={pendingRectificationFindings} hint="Awaiting rectification" />
        )}
      </div>

      <CaseBasedPerformance db={db} scope={{ branchId: branch.id }} openPeriod={openPeriod} allPeriods={allPeriodsSelected} />

      {db.settings.rankingVisibility.branches ? (
        <Card>
          <CardHeader
            title="Branch Ranking"
            description={district ? `Every branch in ${district.name}, performance this period` : "Peer branches, performance this period"}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Rank</th>
                  <th className="px-4 py-2 font-medium">Branch</th>
                  <th className="px-4 py-2 font-medium">Performance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {branchRanking.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                      No peer branches in this district yet.
                    </td>
                  </tr>
                )}
                {branchRanking.map((row, i) => (
                  <tr key={row.branch.id} className={row.branch.id === branch.id ? "bg-blue-50" : undefined}>
                    <td className="px-4 py-2 text-slate-400">{i + 1}</td>
                    <td className="px-4 py-2 text-slate-900">
                      <span className="flex items-center gap-2">
                        {row.branch.name}
                        {row.branch.id === branch.id && <Badge tone="blue">Your Branch</Badge>}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-slate-700">{row.performance !== null ? `${row.performance.toFixed(1)}%` : "--"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Branch Ranking" />
          <p className="p-4 text-sm text-slate-400">Branch ranking visibility is disabled by your administrator.</p>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Other Case Summary"
          description={activeScoringRule ? "The BRD's primary scored category" : "No active scoring rule configured yet"}
        />
        <div className="px-4 py-3 text-sm text-slate-600">
          {activeScoringRule ? (
            <>
              <p>
                Total / Rectified / Outstanding:{" "}
                <span className="font-medium text-slate-900">
                  {otherCaseTotal} / {otherCaseRectified} / {otherCaseTotal - otherCaseRectified}
                </span>
              </p>
              {activeScoringRule && <p className="mt-1 text-xs text-slate-400">Live formula: {activeScoringRule.basis}</p>}
            </>
          ) : (
            <p className="text-slate-400">Ask an administrator to configure one under Scoring Rules.</p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Category Totals" description="Every active classified case category for this branch, current period" />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Total Cases</th>
                <th className="px-4 py-2 font-medium">Rectified Cases</th>
                <th className="px-4 py-2 font-medium">Outstanding Cases</th>
                <th className="px-4 py-2 font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Rectified Amount</th>
                <th className="px-4 py-2 font-medium">Outstanding Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {categoryTotals.map(({ category: c, total, rectified, outstanding, amount, rectifiedAmount, outstandingAmount: catOutstandingAmount }) => (
                <tr key={c.id}>
                  <td className="px-4 py-2 text-slate-900">
                    {c.name} {c.scored && <Badge tone="blue">Scored</Badge>}
                  </td>
                  <td className="px-4 py-2 text-slate-700">{hasPeriodScope ? total : "--"}</td>
                  <td className="px-4 py-2 text-slate-700">{hasPeriodScope ? rectified : "--"}</td>
                  <td className="px-4 py-2 text-slate-700">{hasPeriodScope ? outstanding : "--"}</td>
                  <td className="px-4 py-2 text-slate-700">{hasPeriodScope ? formatNumber(amount) : "--"}</td>
                  <td className="px-4 py-2 text-slate-700">{hasPeriodScope ? formatNumber(rectifiedAmount) : "--"}</td>
                  <td className="px-4 py-2 text-slate-700">{hasPeriodScope ? formatNumber(catOutstandingAmount) : "--"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <FindingsByCategoryChart findings={approvedPeriodFindings} categories={categoriesInScope} openPeriod={periodDisplayMarker} />

      <SourcePerformanceSummary
        db={db}
        sources={sourcesInScope}
        scope={{ branchId: branch.id }}
        openPeriod={openPeriod}
        allPeriods={allPeriodsSelected}
      />

      <MonthlyTrend db={db} scope={{ branchId: branch.id }} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FindingStatusDistribution findings={branchAllFindings} />
        <RiskDistribution findings={branchAllFindings} riskLevels={db.settings.riskLevels} />
      </div>

      <CategoryDistribution findings={branchAllFindings} categories={categoriesInScope} />

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
          <CardHeader title="Recent Activity" description="Submit, approve, return, and rectification events for this branch" />
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
