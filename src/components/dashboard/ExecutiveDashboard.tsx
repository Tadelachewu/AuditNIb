import { HO_APPROVED_OR_LATER_STATUSES, type Database } from "@/types";
import type { SessionData } from "@/lib/session";
import { computePerformance, findingCaseTotals, findingCaseTotalsInPeriod, transferTotals, averageCaseAgeDays, isHoApproved } from "@/lib/findings";
import { sumAmountByCurrency, sumOutstandingByCurrency, sumAmountByCurrencyInPeriod, sumOutstandingByCurrencyInPeriod } from "@/lib/currency";
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
import { StackedBarChart } from "@/components/dashboard/charts/StackedBarChart";
import { SourcePerformanceSummary } from "@/components/dashboard/SourcePerformanceSummary";
import { CaseBasedPerformance } from "@/components/dashboard/CaseBasedPerformance";
import { FindingsByCategoryChart } from "@/components/dashboard/FindingsByCategoryChart";

// master.txt §10: a concise, read-only bank-wide summary for Executive
// Management - KPIs, top-performer rankings, and an exceptions count
// (high/critical-risk findings still outstanding) rather than the full
// operational widget set the other dashboards carry, matching
// EXECUTIVE_READONLY's view-only permission set (PHASE2.md). "Concise"
// means fewer *operational* widgets (no work queue, no per-branch edit
// links) - it doesn't mean less bank-wide financial/comparative context,
// which is exactly what leadership needs and the widgets below add.
export function ExecutiveDashboard({
  db,
  dateRange = {},
  filters = EMPTY_DASHBOARD_FILTERS,
}: {
  user: SessionData;
  db: Database;
  dateRange?: DateRange;
  filters?: DashboardFilters;
}) {
  // Same FilterBar/period-picker model as HODashboard - both are BANK-
  // scoped with no fixed district/branch, so a period picked here follows
  // the exact same "picking a locked/past period reviews dashboard
  // history" and "All periods" conventions HODashboard's own doc comment
  // explains.
  const allPeriodsSelected = filters.periodId === ALL_PERIODS_VALUE;
  const openPeriod = allPeriodsSelected
    ? undefined
    : filters.periodId
      ? db.reportingPeriods.find((p) => p.id === filters.periodId)
      : db.reportingPeriods.find((p) => p.status === "OPEN");
  const hasPeriodScope = allPeriodsSelected || Boolean(openPeriod);
  // Optional Today/Week/Month/Custom filter (TimeRangeFilter) plus
  // FilterBar's district/branch/source/category/risk/status fields, by
  // each finding's own attributes - never computePerformance()'s scoring
  // formula itself (Bank-wide/District/Branch Performance and every
  // ranking below stay keyed to the full BRD-defined eligible-case set),
  // same split HODashboard's own doc comment explains.
  const allFindingsInRange = applyDashboardFilters(
    db.findings.filter((f) => inDateRange(dateRange, f.findingDate)),
    filters
  );
  const periodFindings = allPeriodsSelected
    ? allFindingsInRange
    : openPeriod
      ? allFindingsInRange.filter((f) => f.periodId === openPeriod.id)
      : [];
  const bankPerformance = hasPeriodScope
    ? computePerformance(db, { periodId: allPeriodsSelected ? undefined : openPeriod?.id })
    : null;
  const activeScoringRule = db.scoringRules.find((r) => r.active);
  const activeSources = db.sources.filter((s) => s.active);
  // Period-residency-aware (see findingCaseTotalsInPeriod()'s doc comment
  // in src/lib/findings.ts) - a finding partially rectified here and then
  // transferred still counts its slice toward this period instead of
  // vanishing from it.
  const { totalFindings, totalCases, rectifiedFindings, rectifiedCases } =
    !allPeriodsSelected && openPeriod ? findingCaseTotalsInPeriod(db, openPeriod.id, allFindingsInRange) : findingCaseTotals(periodFindings);
  // Same isHoApproved() gate as every other dashboard - Total Amount,
  // Outstanding Amount, Source Comparison, etc. shouldn't move before a
  // finding's actually cleared HO approval (FindingStatusDistribution below
  // is the deliberate exception - it tracks the whole in-flight workflow,
  // not just the "official" figures; RiskDistribution applies this same
  // gate internally now too).
  const approvedPeriodFindings = periodFindings.filter(isHoApproved);
  const inScopeFindingIds = new Set(allFindingsInRange.map((f) => f.id));
  const bankTransfers = hasPeriodScope
    ? db.findingTransfers.filter(
        (t) => (allPeriodsSelected || t.fromPeriodId === openPeriod!.id) && inScopeFindingIds.has(t.findingId)
      )
    : [];
  const { transferredFindings, transferredCases } = transferTotals(bankTransfers);
  // Period-residency-aware (see sumAmountByCurrencyInPeriod()'s doc
  // comment in src/lib/currency.ts) - a finding partially rectified here
  // and then transferred must have its amount split between this period
  // and wherever it went, not attributed wholesale to just one of them.
  const approvedAllFindingsInRange = allFindingsInRange.filter(isHoApproved);
  const totalAmount =
    !allPeriodsSelected && openPeriod
      ? sumAmountByCurrencyInPeriod(db, openPeriod.id, approvedAllFindingsInRange, "eligible")
      : sumAmountByCurrency(approvedPeriodFindings, "amount");
  const outstandingAmount =
    !allPeriodsSelected && openPeriod
      ? sumOutstandingByCurrencyInPeriod(db, openPeriod.id, approvedAllFindingsInRange)
      : sumOutstandingByCurrency(approvedPeriodFindings);
  // Resolved Amount counts only formally CLOSED amount, never merely
  // rectified-but-unclosed - same "a controller's sign-off is what makes it
  // official" reasoning as findingCaseTotals()'s own closed-only gate.
  const resolvedAmount =
    !allPeriodsSelected && openPeriod
      ? sumAmountByCurrencyInPeriod(db, openPeriod.id, approvedAllFindingsInRange, "closed")
      : sumAmountByCurrency(approvedPeriodFindings, "closedAmount");

  const outstanding = allFindingsInRange.filter((f) => !["RECTIFIED", "CLOSED", "REJECTED"].includes(f.status));
  const avgOutstandingAgeDays = averageCaseAgeDays(outstanding);
  // Top two tiers of Settings.riskLevels, matched case-insensitively -
  // same convention as HODashboard/BranchDashboard's own High-Risk stat.
  // Previously hard-coded to "HIGH"/"CRITICAL" (uppercase), which never
  // matched the seeded "High"/"Critical" (title case) and so always
  // silently reported zero exceptions regardless of real data. Gated by
  // isHoApproved() on top of `outstanding` - a finding still short of HO
  // approval hasn't cleared review yet and shouldn't count as a live
  // exception before it does, same rule every other "official" figure on
  // this dashboard already follows.
  const highRiskTiers = new Set(db.settings.riskLevels.slice(-2).map((l) => l.toLowerCase()));
  const exceptions = outstanding.filter((f) => isHoApproved(f) && highRiskTiers.has(f.riskLevel.toLowerCase()));

  const { topPercent, bottomPercent } = db.settings.performanceThresholds;

  // A district/branch/source filter narrows which rows these tables even
  // list - a real narrowing of "what am I looking at," not a redefinition
  // of the performance formula (computePerformance() itself is untouched) -
  // same convention as HODashboard/DistrictDashboard's own *InScope lists.
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
    .map((d) => ({
      district: d,
      performance: hasPeriodScope ? computePerformance(db, { districtId: d.id, periodId: allPeriodsSelected ? undefined : openPeriod?.id }) : null,
    }))
    .filter((r) => r.performance !== null)
    .sort((a, b) => (b.performance ?? 0) - (a.performance ?? 0));
  const topDistricts = districtRanking.filter((r) => r.performance! >= topPercent);
  const bottomDistricts = [...districtRanking].reverse().filter((r) => r.performance! <= bottomPercent);

  const branchRanking = branchesInScope
    .map((b) => ({
      branch: b,
      performance: hasPeriodScope ? computePerformance(db, { branchId: b.id, periodId: allPeriodsSelected ? undefined : openPeriod?.id }) : null,
    }))
    .filter((r) => r.performance !== null)
    .sort((a, b) => (b.performance ?? 0) - (a.performance ?? 0));
  const topBranches = branchRanking.filter((r) => r.performance! >= topPercent);
  const bottomBranches = [...branchRanking].reverse().filter((r) => r.performance! <= bottomPercent);

  // Document_3 §18's IC vs IA comparison, same computation HODashboard
  // uses - Executive Management is exactly the audience for "how do our
  // two finding sources compare bank-wide," not just HO Controller.
  const scoredCategoryIds = new Set(activeScoringRule?.categories ?? []);
  const scoredSourceIds = new Set(activeScoringRule?.sources ?? []);
  const sourceComparison = sourcesInScope.map((s) => {
    // isHoApproved(), same gate as everywhere else on this dashboard.
    const findings = approvedPeriodFindings.filter((f) => f.sourceId === s.id);
    const total = findings.reduce((sum, f) => sum + f.caseCount, 0);
    // closedCases, not raw self-reported rectifiedCases - unless it is
    // closed, never count as rectified, same rule as
    // computeEligibleCaseCounts() (src/lib/findings.ts) now applies to the
    // headline Performance %.
    const rectified = findings.reduce((sum, f) => sum + f.closedCases, 0);
    // Eligible = the same category AND source gate computeEligibleCaseCounts
    // enforces (not category-only) - a source the active rule doesn't
    // include contributes 0 eligible cases regardless of category. findings
    // is already isHoApproved()-filtered above, so no separate status check
    // is needed here.
    const eligibleCases = scoredSourceIds.has(s.id)
      ? findings.filter((f) => scoredCategoryIds.has(f.categoryId)).reduce((sum, f) => sum + f.caseCount, 0)
      : 0;
    return { source: s, total, rectified, outstanding: total - rectified, eligibleCases };
  });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Executive Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">Bank-wide summary, view-only</p>
      </div>

      <FilterBar
        periods={db.reportingPeriods}
        districts={db.districts}
        branches={db.branches}
        sources={activeSources}
        categories={db.categories.filter((c) => c.active)}
        riskLevels={db.settings.riskLevels}
        operationAreas={db.settings.operationAreas}
        irregularityTypes={db.settings.irregularityTypes}
        defaultPeriodId={db.reportingPeriods.find((p) => p.status === "OPEN")?.id}
        statusOptions={HO_APPROVED_OR_LATER_STATUSES}
        hint="Filters apply immediately. Performance % always reflects the full scoring formula, not narrowed by source/category/risk/status."
      />

      <TimeRangeFilter />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={ICON.performance}
          label="Bank-wide Performance"
          value={bankPerformance !== null ? `${bankPerformance.toFixed(1)}%` : "--"}
          hint={activeScoringRule ? `v${activeScoringRule.version} formula` : "No active scoring rule"}
        />
        <StatCard
          icon={ICON.totalFindings}
          label="Total Findings"
          value={hasPeriodScope ? totalFindings : "--"}
          hint={allPeriodsSelected ? "All periods" : (openPeriod?.code ?? "No open period")}
        />
        <StatCard icon={ICON.totalCases} label="Total Cases" value={hasPeriodScope ? totalCases : "--"} hint="Sum of case counts, bank-wide" />
        <StatCard icon={ICON.outstanding} label="Outstanding (in scope)" value={outstanding.length} hint="Findings" />
        <StatCard icon={ICON.criticalExceptions} label="High/Critical Exceptions" value={exceptions.length} hint="Outstanding, high or critical risk" />
        <StatCard icon={ICON.rectified} label="Rectified Findings" value={hasPeriodScope ? rectifiedFindings : "--"} hint="Formally closed" />
        <StatCard icon={ICON.rectified} label="Rectified Cases" value={hasPeriodScope ? rectifiedCases : "--"} hint="Closed, this period" />
        <StatCard icon={ICON.outstandingCases} label="Outstanding Cases" value={hasPeriodScope ? totalCases - rectifiedCases : "--"} hint="Total minus rectified, bank-wide" />
        <StatCard icon={ICON.transferred} label="Transferred Findings" value={hasPeriodScope ? transferredFindings : "--"} hint="Out of this period" />
        <StatCard icon={ICON.transferred} label="Transferred Cases" value={hasPeriodScope ? transferredCases : "--"} hint="Out of this period" />
        <StatCard icon={ICON.totalAmount} label="Total Amount" value={hasPeriodScope ? totalAmount : "--"} hint="All findings, bank-wide" />
        <StatCard icon={ICON.resolvedAmount} label="Resolved Amount" value={hasPeriodScope ? resolvedAmount : "--"} hint="Cumulative closed only" />
        <StatCard icon={ICON.outstandingAmount} label="Outstanding Amount" value={hasPeriodScope ? outstandingAmount : "--"} hint="Still owed, bank-wide" />
        <StatCard
          icon={ICON.backlogAge}
          label="Avg. Backlog Age"
          value={avgOutstandingAgeDays !== null ? `${avgOutstandingAgeDays}d` : "--"}
          hint="Outstanding findings in scope"
        />
      </div>

      <CaseBasedPerformance
        db={db}
        scope={{ districtId: filters.districtId || undefined, branchId: filters.branchId || undefined }}
        openPeriod={openPeriod}
        allPeriods={allPeriodsSelected}
      />

      {db.settings.rankingVisibility.districts ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Top Districts" description={`At or above ${topPercent}%, current period`} />
            <div className="divide-y divide-slate-100">
              {topDistricts.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">No data yet.</p>}
              {topDistricts.map((row, i) => (
                <div key={row.district.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="flex items-center gap-2 text-slate-900">
                    <Badge tone={i === 0 ? "green" : "gray"}>#{i + 1}</Badge>
                    {row.district.name}
                  </span>
                  <span className="font-medium text-slate-700">{row.performance!.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Bottom Districts" description={`At or below ${bottomPercent}%, current period`} />
            <div className="divide-y divide-slate-100">
              {bottomDistricts.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">No data yet.</p>}
              {bottomDistricts.map((row) => (
                <div key={row.district.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="flex items-center gap-2 text-slate-900">
                    <Badge tone="red">Rank #{districtRanking.findIndex((r) => r.district.id === row.district.id) + 1}</Badge>
                    {row.district.name}
                  </span>
                  <span className="font-medium text-slate-700">{row.performance!.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : (
        <Card>
          <CardHeader title="District Performance Comparison" />
          <p className="p-4 text-sm text-slate-500">District ranking visibility is disabled by your administrator.</p>
        </Card>
      )}

      {db.settings.rankingVisibility.branches ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Top Branches" description={`At or above ${topPercent}%, current period`} />
            <div className="divide-y divide-slate-100">
              {topBranches.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">No data yet.</p>}
              {topBranches.map((row, i) => (
                <div key={row.branch.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="flex items-center gap-2 text-slate-900">
                    <Badge tone={i === 0 ? "green" : "gray"}>#{i + 1}</Badge>
                    {row.branch.name}
                  </span>
                  <span className="font-medium text-slate-700">{row.performance!.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Bottom Branches" description={`At or below ${bottomPercent}%, current period`} />
            <div className="divide-y divide-slate-100">
              {bottomBranches.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">No data yet.</p>}
              {bottomBranches.map((row) => (
                <div key={row.branch.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="flex items-center gap-2 text-slate-900">
                    <Badge tone="red">Rank #{branchRanking.findIndex((r) => r.branch.id === row.branch.id) + 1}</Badge>
                    {row.branch.name}
                  </span>
                  <span className="font-medium text-slate-700">{row.performance!.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : (
        <Card>
          <CardHeader title="Branch Performance Comparison" />
          <p className="p-4 text-sm text-slate-500">Branch ranking visibility is disabled by your administrator.</p>
        </Card>
      )}

      <SourcePerformanceSummary
        db={db}
        sources={sourcesInScope}
        scope={{ districtId: filters.districtId || undefined, branchId: filters.branchId || undefined }}
        openPeriod={openPeriod}
        allPeriods={allPeriodsSelected}
      />

      <Card>
        <CardHeader
          title="Source Comparison"
          description={`Internal Control vs. Internal Audit (and any other active source), current period${
            activeScoringRule ? ` — "Eligible Cases" = v${activeScoringRule.version}'s scored categories` : ""
          }`}
        />
        <div className="p-4">
          <StackedBarChart
            segments={[
              { key: "rectified", label: "Rectified", color: "#0ca30c" },
              { key: "outstanding", label: "Outstanding", color: "#898781" },
            ]}
            rows={sourceComparison.map(({ source: s, rectified, outstanding: outstandingCount }) => ({
              id: s.id,
              label: s.name,
              values: { rectified, outstanding: outstandingCount },
            }))}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Total Cases</th>
                <th className="px-4 py-2 font-medium">Eligible Cases</th>
                <th className="px-4 py-2 font-medium">Rectified Cases</th>
                <th className="px-4 py-2 font-medium">Outstanding Cases</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sourceComparison.map(({ source: s, total, eligibleCases, rectified, outstanding: outstandingCount }) => (
                <tr key={s.id}>
                  <td className="px-4 py-2 text-slate-900">{s.name}</td>
                  <td className="px-4 py-2 text-slate-700">{openPeriod ? total : "--"}</td>
                  <td className="px-4 py-2 text-slate-700">{openPeriod ? eligibleCases : "--"}</td>
                  <td className="px-4 py-2 text-slate-700">{openPeriod ? rectified : "--"}</td>
                  <td className="px-4 py-2 text-slate-700">{openPeriod ? outstandingCount : "--"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <FindingsByCategoryChart
        findings={approvedPeriodFindings}
        categories={categoriesInScope}
        openPeriod={hasPeriodScope ? (openPeriod ?? { id: ALL_PERIODS_VALUE }) : undefined}
      />

      <MonthlyTrend db={db} scope={{ districtId: filters.districtId || undefined, branchId: filters.branchId || undefined }} />

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
    </div>
  );
}
