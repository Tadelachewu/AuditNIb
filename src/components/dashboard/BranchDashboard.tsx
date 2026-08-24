import Link from "next/link";
import type { Database } from "@/types";
import type { SessionData } from "@/lib/session";
import { findBranchManager, findBranchController } from "@/lib/org";
import { computePerformance, queueStatusesForSession } from "@/lib/findings";
import { Card, CardHeader, StatCard } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { FilterBar } from "@/components/dashboard/FilterBar";
import { EmptyWidget } from "@/components/dashboard/EmptyWidget";
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
  const totalFindings = periodFindings.length;
  const rectifiedFindings = periodFindings.filter((f) => f.status === "RECTIFIED" || f.status === "CLOSED").length;
  const outstandingFindings = periodFindings.filter((f) => !["RECTIFIED", "CLOSED", "REJECTED"].includes(f.status)).length;
  const performance = openPeriod ? computePerformance(db, { branchId: branch.id, periodId: openPeriod.id }) : null;

  const otherCaseFindings = otherCase ? periodFindings.filter((f) => f.categoryId === otherCase.id) : [];
  const otherCaseTotal = otherCaseFindings.reduce((sum, f) => sum + f.caseCount, 0);
  const otherCaseRectified = otherCaseFindings.reduce((sum, f) => sum + f.rectifiedCases, 0);

  const categoryTotals = activeCategories.map((c) => {
    const findings = periodFindings.filter((f) => f.categoryId === c.id);
    const total = findings.reduce((sum, f) => sum + f.caseCount, 0);
    const rectified = findings.reduce((sum, f) => sum + f.rectifiedCases, 0);
    return { category: c, total, rectified, outstanding: total - rectified };
  });

  const queueStatuses = queueStatusesForSession(user);
  const workQueue = db.findings
    .filter((f) => f.branchId === branch.id && queueStatuses.includes(f.status))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);

  const branchFindingIds = new Set(db.findings.filter((f) => f.branchId === branch.id).map((f) => f.id));
  const recentActivity = db.findingTransitions
    .filter((t) => branchFindingIds.has(t.findingId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">
          {branch.name} <span className="font-mono text-sm font-normal text-slate-400">({branch.code})</span>
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {district?.name ?? "Unknown district"} · Manager: {manager?.name ?? "Unassigned"} · Controller:{" "}
          {controller?.name ?? "Unassigned"}
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
        <StatCard label="Rectified" value={openPeriod ? rectifiedFindings : "--"} hint="Findings" />
        <StatCard label="Outstanding" value={openPeriod ? outstandingFindings : "--"} hint="Findings" />
        <StatCard
          label="Performance"
          value={performance !== null ? `${performance.toFixed(1)}%` : "--"}
          hint={activeScoringRule ? `v${activeScoringRule.version} formula` : "No active scoring rule"}
        />
      </div>

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
                <th className="px-4 py-2 font-medium">Total</th>
                <th className="px-4 py-2 font-medium">Rectified</th>
                <th className="px-4 py-2 font-medium">Outstanding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {categoryTotals.map(({ category: c, total, rectified, outstanding }) => (
                <tr key={c.id}>
                  <td className="px-4 py-2 text-slate-900">
                    {c.name} {c.scored && <Badge tone="blue">Scored</Badge>}
                  </td>
                  <td className="px-4 py-2 text-slate-700">{openPeriod ? total : "--"}</td>
                  <td className="px-4 py-2 text-slate-700">{openPeriod ? rectified : "--"}</td>
                  <td className="px-4 py-2 text-slate-700">{openPeriod ? outstanding : "--"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <EmptyWidget
          title="Monthly Performance Trend"
          description="A month-over-month performance line once multiple periods have findings history."
        />
        <EmptyWidget title="Risk Distribution" description="A breakdown of open findings by risk level.">
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {db.settings.riskLevels.map((r) => (
              <Badge key={r} tone="gray">
                {r}
              </Badge>
            ))}
          </div>
        </EmptyWidget>
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
