import type { Database } from "@/types";
import type { SessionData } from "@/lib/session";
import { findBranchManager, findBranchController } from "@/lib/org";
import { Card, CardHeader, StatCard } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { FilterBar } from "@/components/dashboard/FilterBar";
import { EmptyWidget } from "@/components/dashboard/EmptyWidget";

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
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Findings" value="--" hint="No findings recorded yet" />
        <StatCard label="Rectified" value="--" hint="No findings recorded yet" />
        <StatCard label="Outstanding" value="--" hint="No findings recorded yet" />
        <StatCard label="Performance" value="--" hint={activeScoringRule ? `v${activeScoringRule.version} formula` : "No active scoring rule"} />
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
                Total / Rectified / Outstanding: <span className="font-medium text-slate-900">-- / -- / --</span>
              </p>
              {activeScoringRule && (
                <p className="mt-1 text-xs text-slate-400">
                  Live formula: {activeScoringRule.basis}
                </p>
              )}
            </>
          ) : (
            <p className="text-slate-400">Ask an administrator to configure it under Classified Categories.</p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Category Totals" description="Every active classified case category for this branch" />
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
              {activeCategories.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2 text-slate-900">
                    {c.name} {c.scored && <Badge tone="blue">Scored</Badge>}
                  </td>
                  <td className="px-4 py-2 text-slate-400">--</td>
                  <td className="px-4 py-2 text-slate-400">--</td>
                  <td className="px-4 py-2 text-slate-400">--</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <EmptyWidget
          title="Monthly Performance Trend"
          description="A month-over-month performance line once findings and rectifications are recorded."
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
        <EmptyWidget
          title="Work Queue"
          description="Findings awaiting your action - returned items, corrective actions due, weekly rectification updates."
        />
        <EmptyWidget
          title="Recent Activity"
          description="Submit, approve, return, and rectification events for this branch."
        />
      </div>
    </div>
  );
}
