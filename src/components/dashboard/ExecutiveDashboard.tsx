import type { Database } from "@/types";
import type { SessionData } from "@/lib/session";
import { computePerformance, findingCaseTotals, transferTotals, averageCaseAgeDays } from "@/lib/findings";
import { sumAmountByCurrency, sumOutstandingByCurrency } from "@/lib/currency";
import { Card, CardHeader, StatCard } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { RiskDistribution } from "@/components/dashboard/RiskDistribution";
import { FindingStatusDistribution } from "@/components/dashboard/FindingStatusDistribution";
import { MonthlyTrend } from "@/components/dashboard/MonthlyTrend";
import { StackedBarChart } from "@/components/dashboard/charts/StackedBarChart";

// master.txt §10: a concise, read-only bank-wide summary for Executive
// Management - KPIs, top-performer rankings, and an exceptions count
// (high/critical-risk findings still outstanding) rather than the full
// operational widget set the other dashboards carry, matching
// EXECUTIVE_READONLY's view-only permission set (PHASE2.md). "Concise"
// means fewer *operational* widgets (no work queue, no per-branch edit
// links) - it doesn't mean less bank-wide financial/comparative context,
// which is exactly what leadership needs and the widgets below add.
export function ExecutiveDashboard({ db }: { user: SessionData; db: Database }) {
  const openPeriod = db.reportingPeriods.find((p) => p.status === "OPEN");
  const periodFindings = openPeriod ? db.findings.filter((f) => f.periodId === openPeriod.id) : [];
  const bankPerformance = openPeriod ? computePerformance(db, { periodId: openPeriod.id }) : null;
  const activeScoringRule = db.scoringRules.find((r) => r.active);
  const activeSources = db.sources.filter((s) => s.active);
  const { totalFindings, totalCases, rectifiedFindings, rectifiedCases } = findingCaseTotals(periodFindings);
  const bankTransfers = openPeriod ? db.findingTransfers.filter((t) => t.fromPeriodId === openPeriod.id) : [];
  const { transferredFindings, transferredCases } = transferTotals(bankTransfers);
  const totalAmount = sumAmountByCurrency(periodFindings, "amount");
  const outstandingAmount = sumOutstandingByCurrency(periodFindings);
  const resolvedAmount = sumAmountByCurrency(periodFindings, "rectifiedAmount");

  const outstanding = db.findings.filter((f) => !["RECTIFIED", "CLOSED", "REJECTED"].includes(f.status));
  const avgOutstandingAgeDays = averageCaseAgeDays(outstanding);
  // Top two tiers of Settings.riskLevels, matched case-insensitively -
  // same convention as HODashboard/BranchDashboard's own High-Risk stat.
  // Previously hard-coded to "HIGH"/"CRITICAL" (uppercase), which never
  // matched the seeded "High"/"Critical" (title case) and so always
  // silently reported zero exceptions regardless of real data.
  const highRiskTiers = new Set(db.settings.riskLevels.slice(-2).map((l) => l.toLowerCase()));
  const exceptions = outstanding.filter((f) => highRiskTiers.has(f.riskLevel.toLowerCase()));

  const districtRanking = db.districts
    .map((d) => ({ district: d, performance: openPeriod ? computePerformance(db, { districtId: d.id, periodId: openPeriod.id }) : null }))
    .filter((r) => r.performance !== null)
    .sort((a, b) => (b.performance ?? 0) - (a.performance ?? 0));
  const topDistricts = districtRanking.slice(0, 5);
  const bottomDistricts = [...districtRanking].reverse().slice(0, 5);

  const branchRanking = db.branches
    .map((b) => ({ branch: b, performance: openPeriod ? computePerformance(db, { branchId: b.id, periodId: openPeriod.id }) : null }))
    .filter((r) => r.performance !== null)
    .sort((a, b) => (b.performance ?? 0) - (a.performance ?? 0));
  const topBranches = branchRanking.slice(0, 5);
  const bottomBranches = [...branchRanking].reverse().slice(0, 5);

  // Document_3 §18's IC vs IA comparison, same computation HODashboard
  // uses - Executive Management is exactly the audience for "how do our
  // two finding sources compare bank-wide," not just HO Controller.
  const scoredCategoryIds = new Set(activeScoringRule?.categories ?? []);
  const sourceComparison = activeSources.map((s) => {
    const findings = periodFindings.filter((f) => f.sourceId === s.id);
    const total = findings.reduce((sum, f) => sum + f.caseCount, 0);
    const rectified = findings.reduce((sum, f) => sum + f.rectifiedCases, 0);
    const eligibleCases = findings.filter((f) => scoredCategoryIds.has(f.categoryId)).reduce((sum, f) => sum + f.caseCount, 0);
    return { source: s, total, rectified, outstanding: total - rectified, eligibleCases };
  });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Executive Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">Bank-wide summary, view-only</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Bank-wide Performance"
          value={bankPerformance !== null ? `${bankPerformance.toFixed(1)}%` : "--"}
          hint={activeScoringRule ? `v${activeScoringRule.version} formula` : "No active scoring rule"}
        />
        <StatCard label="Open Findings" value={openPeriod ? totalFindings : "--"} hint={openPeriod?.code ?? "No open period"} />
        <StatCard label="Open Cases" value={openPeriod ? totalCases : "--"} hint="Sum of case counts, bank-wide" />
        <StatCard label="Outstanding (all periods)" value={outstanding.length} hint="Findings" />
        <StatCard label="High/Critical Exceptions" value={exceptions.length} hint="Outstanding, high or critical risk" />
        <StatCard label="Rectified Findings" value={openPeriod ? rectifiedFindings : "--"} hint="Fully rectified or closed" />
        <StatCard label="Rectified Cases" value={openPeriod ? rectifiedCases : "--"} hint="Cumulative, this period" />
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

      {db.settings.rankingVisibility.districts ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Top Districts" description="By performance, current period" />
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
            <CardHeader title="Bottom Districts" description="By performance, current period" />
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
            <CardHeader title="Top Branches" description="By performance, current period" />
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
            <CardHeader title="Bottom Branches" description="By performance, current period" />
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <MonthlyTrend db={db} scope={{}} />
        <FindingStatusDistribution findings={db.findings} />
        <RiskDistribution findings={db.findings} riskLevels={db.settings.riskLevels} />
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
