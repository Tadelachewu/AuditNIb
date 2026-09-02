import type { Database } from "@/types";
import type { SessionData } from "@/lib/session";
import { computePerformance, findingCaseTotals, transferTotals, averageCaseAgeDays, isHoApproved } from "@/lib/findings";
import { sumAmountByCurrency, sumOutstandingByCurrency } from "@/lib/currency";
import { inDateRange, type DateRange } from "@/lib/dateRange";
import { Card, CardHeader, StatCard } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
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
export function ExecutiveDashboard({ db, dateRange = {} }: { user: SessionData; db: Database; dateRange?: DateRange }) {
  const openPeriod = db.reportingPeriods.find((p) => p.status === "OPEN");
  // Optional Today/Week/Month/Custom filter (TimeRangeFilter), by each
  // finding's own findingDate - never computePerformance()'s scoring
  // (Bank-wide/District/Branch Performance and every ranking below stay
  // period-scored regardless) or the all-time backlog/exceptions status
  // metrics (those describe the current backlog as it stands today, not a
  // reporting window), same split the Reports page's own time filter uses.
  const allFindingsInRange = db.findings.filter((f) => inDateRange(dateRange, f.findingDate));
  const periodFindings = openPeriod ? allFindingsInRange.filter((f) => f.periodId === openPeriod.id) : [];
  const bankPerformance = openPeriod ? computePerformance(db, { periodId: openPeriod.id }) : null;
  const activeScoringRule = db.scoringRules.find((r) => r.active);
  const activeSources = db.sources.filter((s) => s.active);
  const { totalFindings, totalCases, rectifiedFindings, rectifiedCases } = findingCaseTotals(periodFindings);
  // Same isHoApproved() gate as every other dashboard - Total Amount,
  // Outstanding Amount, Source Comparison, etc. shouldn't move before a
  // finding's actually cleared HO approval (RiskDistribution/
  // FindingStatusDistribution below are the deliberate exception - they
  // track the whole in-flight workflow, not just the "official" figures).
  const approvedPeriodFindings = periodFindings.filter(isHoApproved);
  const bankTransfers = openPeriod ? db.findingTransfers.filter((t) => t.fromPeriodId === openPeriod.id) : [];
  const { transferredFindings, transferredCases } = transferTotals(bankTransfers);
  const totalAmount = sumAmountByCurrency(approvedPeriodFindings, "amount");
  const outstandingAmount = sumOutstandingByCurrency(approvedPeriodFindings);
  const resolvedAmount = sumAmountByCurrency(approvedPeriodFindings, "rectifiedAmount");

  const outstanding = db.findings.filter((f) => !["RECTIFIED", "CLOSED", "REJECTED"].includes(f.status));
  const avgOutstandingAgeDays = averageCaseAgeDays(outstanding);
  // Top two tiers of Settings.riskLevels, matched case-insensitively -
  // same convention as HODashboard/BranchDashboard's own High-Risk stat.
  // Previously hard-coded to "HIGH"/"CRITICAL" (uppercase), which never
  // matched the seeded "High"/"Critical" (title case) and so always
  // silently reported zero exceptions regardless of real data.
  const highRiskTiers = new Set(db.settings.riskLevels.slice(-2).map((l) => l.toLowerCase()));
  const exceptions = outstanding.filter((f) => highRiskTiers.has(f.riskLevel.toLowerCase()));

  const { topPercent, bottomPercent } = db.settings.performanceThresholds;

  const districtRanking = db.districts
    .map((d) => ({ district: d, performance: openPeriod ? computePerformance(db, { districtId: d.id, periodId: openPeriod.id }) : null }))
    .filter((r) => r.performance !== null)
    .sort((a, b) => (b.performance ?? 0) - (a.performance ?? 0));
  const topDistricts = districtRanking.filter((r) => r.performance! >= topPercent);
  const bottomDistricts = [...districtRanking].reverse().filter((r) => r.performance! <= bottomPercent);

  const branchRanking = db.branches
    .map((b) => ({ branch: b, performance: openPeriod ? computePerformance(db, { branchId: b.id, periodId: openPeriod.id }) : null }))
    .filter((r) => r.performance !== null)
    .sort((a, b) => (b.performance ?? 0) - (a.performance ?? 0));
  const topBranches = branchRanking.filter((r) => r.performance! >= topPercent);
  const bottomBranches = [...branchRanking].reverse().filter((r) => r.performance! <= bottomPercent);

  // Document_3 §18's IC vs IA comparison, same computation HODashboard
  // uses - Executive Management is exactly the audience for "how do our
  // two finding sources compare bank-wide," not just HO Controller.
  const scoredCategoryIds = new Set(activeScoringRule?.categories ?? []);
  const scoredSourceIds = new Set(activeScoringRule?.sources ?? []);
  const sourceComparison = activeSources.map((s) => {
    // isHoApproved(), same gate as everywhere else on this dashboard.
    const findings = approvedPeriodFindings.filter((f) => f.sourceId === s.id);
    const total = findings.reduce((sum, f) => sum + f.caseCount, 0);
    const rectified = findings.reduce((sum, f) => sum + f.rectifiedCases, 0);
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
        <p className="mt-1 text-sm text-slate-500">Bank-wide summary, view-only</p>
      </div>

      <TimeRangeFilter />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Bank-wide Performance"
          value={bankPerformance !== null ? `${bankPerformance.toFixed(1)}%` : "--"}
          hint={activeScoringRule ? `v${activeScoringRule.version} formula` : "No active scoring rule"}
        />
        <StatCard label="Total Findings" value={openPeriod ? totalFindings : "--"} hint={openPeriod?.code ?? "No open period"} />
        <StatCard label="Total Cases" value={openPeriod ? totalCases : "--"} hint="Sum of case counts, bank-wide" />
        <StatCard label="Outstanding (all periods)" value={outstanding.length} hint="Findings" />
        <StatCard label="High/Critical Exceptions" value={exceptions.length} hint="Outstanding, high or critical risk" />
        <StatCard label="Rectified Findings" value={openPeriod ? rectifiedFindings : "--"} hint="Formally closed" />
        <StatCard label="Rectified Cases" value={openPeriod ? rectifiedCases : "--"} hint="Closed, this period" />
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

      {db.settings.rankingVisibility.districts ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Top Districts" description={`At or above ${topPercent}%, current period`} />
            <div className="divide-y divide-slate-100">
              {topDistricts.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">No data yet.</p>}
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
              {bottomDistricts.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">No data yet.</p>}
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
          <p className="p-4 text-sm text-slate-400">District ranking visibility is disabled by your administrator.</p>
        </Card>
      )}

      {db.settings.rankingVisibility.branches ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Top Branches" description={`At or above ${topPercent}%, current period`} />
            <div className="divide-y divide-slate-100">
              {topBranches.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">No data yet.</p>}
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
              {bottomBranches.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">No data yet.</p>}
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
          <p className="p-4 text-sm text-slate-400">Branch ranking visibility is disabled by your administrator.</p>
        </Card>
      )}

      <SourcePerformanceSummary db={db} sources={activeSources} scope={{}} openPeriod={openPeriod} />

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
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
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

      <FindingsByCategoryChart findings={approvedPeriodFindings} categories={db.categories.filter((c) => c.active)} openPeriod={openPeriod} />

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
    </div>
  );
}
