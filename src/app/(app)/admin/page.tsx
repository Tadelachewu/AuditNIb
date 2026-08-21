import Link from "next/link";
import { readDb } from "@/lib/db";
import { findBranchManager, findBranchController } from "@/lib/org";
import { ROLE_LABELS } from "@/types";
import { StatCard, Card, CardHeader } from "@/components/ui/Card";

export default async function AdminDashboardPage() {
  const db = readDb();

  const activeUsers = db.users.filter((u) => u.status === "ACTIVE").length;
  const activeDistricts = db.districts.filter((d) => d.status === "ACTIVE").length;
  const activeBranches = db.branches.filter((b) => b.status === "ACTIVE").length;
  const openPeriods = db.reportingPeriods.filter((p) => p.status === "OPEN").length;
  const lockedPeriods = db.reportingPeriods.filter((p) => p.status === "LOCKED").length;
  const activeScoringRule = db.scoringRules.find((r) => r.active);
  const activeBranchList = db.branches.filter((b) => b.status === "ACTIVE");
  const branchesMissingManager = activeBranchList.filter((b) => !findBranchManager(db, b.id)).length;
  const branchesMissingController = activeBranchList.filter((b) => !findBranchController(db, b.id)).length;

  const usersByRole = db.users.reduce<Record<string, number>>((acc, u) => {
    acc[u.role] = (acc[u.role] ?? 0) + 1;
    return acc;
  }, {});

  const recentAudit = db.auditLogs.slice(0, 8);

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Admin Dashboard</h1>
      <p className="mt-1 text-sm text-slate-500">Bank-wide configuration and user administration.</p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Active Users" value={activeUsers} hint={`${db.users.length} total`} />
        <StatCard label="Districts" value={activeDistricts} hint={`${db.districts.length} total`} />
        <StatCard label="Branches" value={activeBranches} hint={`${db.branches.length} total`} />
        <StatCard label="Open Periods" value={openPeriods} hint={`${lockedPeriods} locked`} />
        <StatCard
          label="Active Scoring Rule"
          value={activeScoringRule ? `v${activeScoringRule.version}` : "None"}
        />
      </div>

      {(branchesMissingManager > 0 || branchesMissingController > 0) && (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {branchesMissingManager > 0 && <p>{branchesMissingManager} active branch(es) have no Branch Manager assigned.</p>}
          {branchesMissingController > 0 && (
            <p>{branchesMissingController} active branch(es) have no Branch Internal Controller assigned.</p>
          )}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Users by Role" />
          <div className="divide-y divide-slate-100 px-4">
            {Object.entries(ROLE_LABELS).map(([role, label]) => (
              <div key={role} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-600">{label}</span>
                <span className="font-medium text-slate-900">{usersByRole[role] ?? 0}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Quick Links" />
          <div className="flex flex-col gap-0.5 px-2 py-2">
            {[
              ["Users", "/admin/users"],
              ["Districts", "/admin/districts"],
              ["Branches", "/admin/branches"],
              ["Sources", "/admin/sources"],
              ["Classified Categories", "/admin/categories"],
              ["Scoring Rules", "/admin/scoring-rules"],
              ["Scoring Adjustments", "/admin/scoring-adjustments"],
              ["Reporting Periods", "/admin/reporting-periods"],
              ["Settings", "/admin/settings"],
              ["Audit Log", "/admin/audit-log"],
            ].map(([label, href]) => (
              <Link
                key={href}
                href={href}
                className="rounded-md px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50 hover:text-blue-900"
              >
                {label}
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Recent Activity" description="Latest administrative and authentication events" />
        <div className="divide-y divide-slate-100 px-4">
          {recentAudit.length === 0 && <p className="py-3 text-sm text-slate-400">No activity yet.</p>}
          {recentAudit.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-slate-600">
                <span className="font-medium text-slate-900">{entry.userName}</span> {entry.action.toLowerCase()}{" "}
                {entry.entityType.toLowerCase()}
              </span>
              <span className="text-xs text-slate-400">{new Date(entry.timestamp).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
