import Link from "next/link";
import type { Database } from "@/types";
import type { SessionData } from "@/lib/session";
import { findBranchManager, findBranchSubManager, findBranchController } from "@/lib/org";
import { computePerformance, queueStatusesForSession, findingCaseTotals, transferTotals } from "@/lib/findings";
import { sumAmountByCurrency, sumOutstandingByCurrency } from "@/lib/currency";
import { Card, CardHeader, StatCard } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { FilterBar } from "@/components/dashboard/FilterBar";
import { RiskDistribution } from "@/components/dashboard/RiskDistribution";
import { FindingStatusDistribution } from "@/components/dashboard/FindingStatusDistribution";
import { CategoryDistribution } from "@/components/dashboard/CategoryDistribution";
import { MonthlyTrend } from "@/components/dashboard/MonthlyTrend";
import { FindingStatusBadge } from "@/components/findings/FindingStatusBadge";

// Per master.txt §10: "Selected month; category totals; total/rectified/
// outstanding; Other Case summary; performance; monthly trend; risk
// distribution; recent activity; relevant work queues."
export function BranchDashboard({ user, db }: { user: SessionData; db: Database }) {
  const branch = db.branches.find((b) => b.id === user.branchId);
  const district = db.districts.find((d) => d.id === user.districtId);
  const openPeriod = db.reportingPeriods.find((p) => p.status === "OPEN");
  const activeCategories = db.categories.filter((c) => c.active);
  const otherCase = db.categories.find((c) => c.code === "OTHER_CASE");
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

  // "Selected month" - this page doesn't wire the FilterBar's period picker
  // to a real query yet (see PHASE6.md), so the currently open period
  // stands in as the implicit default.
  const periodFindings = openPeriod ? db.findings.filter((f) => f.branchId === branch.id && f.periodId === openPeriod.id) : [];
  const { totalFindings, totalCases, rectifiedFindings, rectifiedCases } = findingCaseTotals(periodFindings);
  const outstandingFindings = periodFindings.filter((f) => !["RECTIFIED", "CLOSED", "REJECTED"].includes(f.status)).length;
  const performance = openPeriod ? computePerformance(db, { branchId: branch.id, periodId: openPeriod.id }) : null;
  const totalAmount = sumAmountByCurrency(periodFindings, "amount");
  const outstandingAmount = sumOutstandingByCurrency(periodFindings);
  const resolvedAmount = sumAmountByCurrency(periodFindings, "rectifiedAmount");

  const otherCaseFindings = otherCase ? periodFindings.filter((f) => f.categoryId === otherCase.id) : [];
  const otherCaseTotal = otherCaseFindings.reduce((sum, f) => sum + f.caseCount, 0);
  const otherCaseRectified = otherCaseFindings.reduce((sum, f) => sum + f.rectifiedCases, 0);

  const categoryTotals = activeCategories.map((c) => {
    const findings = periodFindings.filter((f) => f.categoryId === c.id);
    const total = findings.reduce((sum, f) => sum + f.caseCount, 0);
    const rectified = findings.reduce((sum, f) => sum + f.rectifiedCases, 0);
    const amount = findings.reduce((sum, f) => sum + f.amount, 0);
    const rectifiedAmount = findings.reduce((sum, f) => sum + f.rectifiedAmount, 0);
    return { category: c, total, rectified, outstanding: total - rectified, amount, rectifiedAmount, outstandingAmount: amount - rectifiedAmount };
  });

  // High-risk = the top two tiers of Settings.riskLevels, matched
  // case-insensitively since it's admin-configurable free text - same
  // convention as HODashboard's own High-Risk Findings stat.
  const highRiskTiers = new Set(db.settings.riskLevels.slice(-2).map((l) => l.toLowerCase()));
  const highRiskFindings = periodFindings.filter(
    (f) => !["RECTIFIED", "CLOSED", "REJECTED"].includes(f.status) && highRiskTiers.has(f.riskLevel.toLowerCase())
  ).length;

  // Same convention as DistrictDashboard/HODashboard: a transfer moves
  // periodId forward, so a transferred finding is no longer in
  // periodFindings for its *source* period - counted from FindingTransfer
  // records instead, scoped to this branch.
  const branchTransfers = openPeriod
    ? db.findingTransfers.filter(
        (t) => t.fromPeriodId === openPeriod.id && db.findings.some((f) => f.id === t.findingId && f.branchId === branch.id)
      )
    : [];
  const { transferredFindings, transferredCases } = transferTotals(branchTransfers);

  const isQueued = queueStatusesForSession(user);
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
    .map((b) => ({ branch: b, performance: openPeriod ? computePerformance(db, { branchId: b.id, periodId: openPeriod.id }) : null }))
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
        defaultPeriodId={openPeriod?.id}
        fixedDistrict={district ? { id: district.id, name: district.name } : undefined}
        fixedBranch={{ id: branch.id, name: branch.name }}
        hint="Full Findings list with live filtering is at Findings in the sidebar; this dashboard summarizes the currently open period."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Findings" value={openPeriod ? totalFindings : "--"} hint={openPeriod ? openPeriod.code : "No open period"} />
        <StatCard label="Total Cases" value={openPeriod ? totalCases : "--"} hint="Sum of case counts" />
        <StatCard label="Rectified Findings" value={openPeriod ? rectifiedFindings : "--"} hint="Fully rectified or closed" />
        <StatCard label="Rectified Cases" value={openPeriod ? rectifiedCases : "--"} hint="Cumulative, this period" />
        <StatCard label="Outstanding" value={openPeriod ? outstandingFindings : "--"} hint="Findings" />
        <StatCard label="Transferred Findings" value={openPeriod ? transferredFindings : "--"} hint="Out of this period" />
        <StatCard label="Transferred Cases" value={openPeriod ? transferredCases : "--"} hint="Out of this period" />
        <StatCard label="High Risk" value={openPeriod ? highRiskFindings : "--"} hint="Open, top risk tiers" />
        <StatCard
          label="Performance"
          value={performance !== null ? `${performance.toFixed(1)}%` : "--"}
          hint={activeScoringRule ? `v${activeScoringRule.version} formula` : "No active scoring rule"}
        />
        <StatCard label="Total Amount" value={openPeriod ? totalAmount : "--"} hint="All findings" />
        <StatCard label="Resolved Amount" value={openPeriod ? resolvedAmount : "--"} hint="Cumulative rectified" />
        <StatCard label="Outstanding Amount" value={openPeriod ? outstandingAmount : "--"} hint="Still owed" />
      </div>

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
          description={otherCase ? "The BRD's primary scored category" : "No \"Other Case\" category configured"}
        />
        <div className="px-4 py-3 text-sm text-slate-600">
          {otherCase ? (
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
            <p className="text-slate-400">Ask an administrator to configure it under Classified Categories.</p>
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
                  <td className="px-4 py-2 text-slate-700">{openPeriod ? total : "--"}</td>
                  <td className="px-4 py-2 text-slate-700">{openPeriod ? rectified : "--"}</td>
                  <td className="px-4 py-2 text-slate-700">{openPeriod ? outstanding : "--"}</td>
                  <td className="px-4 py-2 text-slate-700">{openPeriod ? amount.toLocaleString() : "--"}</td>
                  <td className="px-4 py-2 text-slate-700">{openPeriod ? rectifiedAmount.toLocaleString() : "--"}</td>
                  <td className="px-4 py-2 text-slate-700">{openPeriod ? catOutstandingAmount.toLocaleString() : "--"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <MonthlyTrend db={db} scope={{ branchId: branch.id }} />
        <FindingStatusDistribution findings={db.findings.filter((f) => f.branchId === branch.id)} />
        <RiskDistribution findings={db.findings.filter((f) => f.branchId === branch.id)} riskLevels={db.settings.riskLevels} />
      </div>

      <CategoryDistribution findings={db.findings.filter((f) => f.branchId === branch.id)} categories={activeCategories} />

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
                <span className="text-xs text-slate-400">{new Date(t.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
