import Link from "next/link";
import type { Database } from "@/types";
import type { SessionData } from "@/lib/session";
import { computePerformance, queueStatusesForSession, findingCaseTotals, transferTotals, averageCaseAgeDays } from "@/lib/findings";
import { sumAmountByCurrency, sumOutstandingByCurrency } from "@/lib/currency";
import { Card, CardHeader, StatCard } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { FilterBar } from "@/components/dashboard/FilterBar";
import { RiskDistribution } from "@/components/dashboard/RiskDistribution";
import { FindingStatusDistribution } from "@/components/dashboard/FindingStatusDistribution";
import { MonthlyTrend } from "@/components/dashboard/MonthlyTrend";
import { RankedBarChart } from "@/components/dashboard/charts/RankedBarChart";
import { StackedBarChart } from "@/components/dashboard/charts/StackedBarChart";
import { FindingStatusBadge } from "@/components/findings/FindingStatusBadge";

// master.txt §10: bank + district aggregates, district ranking, IC-vs-IA
// source comparison, reporting-period status, work queue - the Head
// Office Internal Controller's bank-wide view.
export function HODashboard({ user, db }: { user: SessionData; db: Database }) {
  const openPeriod = db.reportingPeriods.find((p) => p.status === "OPEN");
  const activeSources = db.sources.filter((s) => s.active);
  const activeScoringRule = db.scoringRules.find((r) => r.active);

  const periodFindings = openPeriod ? db.findings.filter((f) => f.periodId === openPeriod.id) : [];
  const { totalFindings, totalCases, rectifiedFindings, rectifiedCases } = findingCaseTotals(periodFindings);
  const outstandingFindings = periodFindings.filter((f) => !["RECTIFIED", "CLOSED", "REJECTED"].includes(f.status)).length;
  const bankPerformance = openPeriod ? computePerformance(db, { periodId: openPeriod.id }) : null;
  const totalAmount = sumAmountByCurrency(periodFindings, "amount");
  const outstandingAmount = sumOutstandingByCurrency(periodFindings);
  const resolvedAmount = sumAmountByCurrency(periodFindings, "rectifiedAmount");
  // "How stale is our backlog?" bank-wide - all periods, not just the open
  // one, since a stale finding that got transferred forward is still part
  // of the same outstanding backlog HO needs visibility into.
  const avgOutstandingAgeDays = averageCaseAgeDays(db.findings.filter((f) => !["RECTIFIED", "CLOSED", "REJECTED"].includes(f.status)));

  const districtRanking = db.districts
    .map((d) => {
      const perf = openPeriod ? computePerformance(db, { districtId: d.id, periodId: openPeriod.id }) : null;
      const findings = periodFindings.filter((f) => f.districtId === d.id);
      return { district: d, performance: perf, total: findings.length };
    })
    .sort((a, b) => (b.performance ?? -1) - (a.performance ?? -1));
  const rankedDistricts = districtRanking.filter((r) => r.performance !== null);
  const topDistricts = rankedDistricts.slice(0, 5);
  const bottomDistricts = [...rankedDistricts].reverse().slice(0, 5);

  // Bank-wide, every branch across every district - the district ranking
  // above is one level up; this is the branch-level comparison master.txt
  // §10/§26 asks for separately ("branch comparison" / "top-performing
  // branches"), not just rolled up into its district's number.
  const branchRanking = db.branches
    .map((b) => {
      const perf = openPeriod ? computePerformance(db, { branchId: b.id, periodId: openPeriod.id }) : null;
      const findings = periodFindings.filter((f) => f.branchId === b.id);
      return { branch: b, performance: perf, total: findings.length };
    })
    .sort((a, b) => (b.performance ?? -1) - (a.performance ?? -1));
  const rankedBranches = branchRanking.filter((r) => r.performance !== null);
  const topBranches = rankedBranches.slice(0, 5);
  // Document_3 §25's "Top performers"/"Bottom performers" pairing, applied
  // here too for consistency with the equivalent HO-level widget.
  const bottomBranches = [...rankedBranches].reverse().slice(0, 5);

  // Document_3 §18's IC vs IA table: Total Cases / Other Cases / Rectified
  // / Outstanding / Amount / Rectified Amount, per source. "Other Cases"
  // here means whatever categories the *active scoring rule* currently
  // scores - generalized the same way computePerformance() already avoids
  // hard-coding "Other Case" as a category name (master.txt §9: "do not
  // hard-code these policy decisions").
  const scoredCategoryIds = new Set(activeScoringRule?.categories ?? []);
  const sourceComparison = activeSources.map((s) => {
    const findings = periodFindings.filter((f) => f.sourceId === s.id);
    const total = findings.reduce((sum, f) => sum + f.caseCount, 0);
    const rectified = findings.reduce((sum, f) => sum + f.rectifiedCases, 0);
    const amount = findings.reduce((sum, f) => sum + f.amount, 0);
    const rectifiedAmount = findings.reduce((sum, f) => sum + f.rectifiedAmount, 0);
    const eligibleCases = findings
      .filter((f) => scoredCategoryIds.has(f.categoryId))
      .reduce((sum, f) => sum + f.caseCount, 0);
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

  const isQueued = queueStatusesForSession(user);
  const workQueue = db.findings
    .filter(isQueued)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);

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
        defaultPeriodId={openPeriod?.id}
        hint="Full Findings list with live filtering is at Findings in the sidebar; this dashboard summarizes the currently open period."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Findings" value={openPeriod ? totalFindings : "--"} hint={openPeriod ? openPeriod.code : "No open period"} />
        <StatCard label="Total Cases" value={openPeriod ? totalCases : "--"} hint="Sum of case counts, bank-wide" />
        <StatCard label="Rectified Findings" value={openPeriod ? rectifiedFindings : "--"} hint="Fully rectified or closed" />
        <StatCard label="Rectified Cases" value={openPeriod ? rectifiedCases : "--"} hint="Cumulative, this period" />
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

      {db.settings.rankingVisibility.districts && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Top-Performing Districts" description="Highest performance this period, bank-wide" />
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
            <CardHeader title="Bottom-Performing Districts" description="Lowest performance this period, bank-wide" />
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
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Rank</th>
                  <th className="px-4 py-2 font-medium">District</th>
                  <th className="px-4 py-2 font-medium">Findings</th>
                  <th className="px-4 py-2 font-medium">Performance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {districtRanking.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                      No districts configured yet.
                    </td>
                  </tr>
                )}
                {districtRanking.map((row, i) => (
                  <tr key={row.district.id}>
                    <td className="px-4 py-2 text-slate-400">{i + 1}</td>
                    <td className="px-4 py-2 text-slate-900">{row.district.name}</td>
                    <td className="px-4 py-2 text-slate-700">{openPeriod ? row.total : "--"}</td>
                    <td className="px-4 py-2 text-slate-700">
                      {row.performance !== null ? `${row.performance.toFixed(1)}%` : "--"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card>
          <CardHeader title="District Ranking" />
          <p className="p-4 text-sm text-slate-400">District ranking visibility is disabled by your administrator.</p>
        </Card>
      )}

      {db.settings.rankingVisibility.branches && (
        <>
          <Card>
            <CardHeader title="Branch Comparison" description="Every branch bank-wide, performance this period" />
            <div className="p-4">
              <RankedBarChart
                items={branchRanking.map((r) => ({
                  id: r.branch.id,
                  label: r.branch.name,
                  value: r.performance,
                  href: `/findings?branchId=${r.branch.id}`,
                }))}
                emptyText="No branches configured yet."
              />
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Top-Performing Branches" description="Highest performance this period, bank-wide" />
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
              <CardHeader title="Bottom-Performing Branches" description="Lowest performance this period, bank-wide" />
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
        </>
      )}

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
                    <td className="px-4 py-2 text-slate-700">{openPeriod ? amount.toLocaleString() : "--"}</td>
                    <td className="px-4 py-2 text-slate-700">{openPeriod ? rectifiedAmount.toLocaleString() : "--"}</td>
                    <td className="px-4 py-2 text-slate-700">{openPeriod ? outstandingAmount.toLocaleString() : "--"}</td>
                  </tr>
                )
              )}
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
          <CardHeader title="Recent Activity" description="Submit, approve, return, and rectification events bank-wide" />
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
