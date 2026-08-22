import Link from "next/link";
import { redirect } from "next/navigation";
import { readDb } from "@/lib/db";
import { findBranchManager, findBranchController } from "@/lib/org";
import { getCurrentUser } from "@/lib/session";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { StatCard, Card, CardHeader } from "@/components/ui/Card";

const QUICK_LINKS: { label: string; href: string; pageCode: string }[] = [
  { label: "Users", href: "/admin/users", pageCode: "users" },
  { label: "Districts", href: "/admin/districts", pageCode: "districts" },
  { label: "Branches", href: "/admin/branches", pageCode: "branches" },
  { label: "Sources", href: "/admin/sources", pageCode: "sources" },
  { label: "Classified Categories", href: "/admin/categories", pageCode: "categories" },
  { label: "Scoring Rules", href: "/admin/scoring-rules", pageCode: "scoring-rules" },
  { label: "Scoring Adjustments", href: "/admin/scoring-adjustments", pageCode: "scoring-adjustments" },
  { label: "Reporting Periods", href: "/admin/reporting-periods", pageCode: "reporting-periods" },
  { label: "Roles & Permissions", href: "/admin/roles", pageCode: "roles" },
  { label: "Settings", href: "/admin/settings", pageCode: "settings" },
  { label: "Audit Log", href: "/admin/audit-log", pageCode: "audit-log" },
];

export default async function AdminDashboardPage() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.permissions, permissionKey("admin-dashboard", "view"))) {
    redirect("/dashboard");
  }

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
  const visibleLinks = QUICK_LINKS.filter((link) => hasPermission(user.permissions, permissionKey(link.pageCode, "view")));

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
            {db.roles.map((role) => (
              <div key={role.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-600">
                  {role.name}
                  {role.status === "INACTIVE" && <span className="ml-2 text-xs text-slate-400">(inactive)</span>}
                </span>
                <span className="font-medium text-slate-900">{usersByRole[role.code] ?? 0}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Quick Links" />
          <div className="flex flex-col gap-0.5 px-2 py-2">
            {visibleLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50 hover:text-blue-900"
              >
                {link.label}
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
