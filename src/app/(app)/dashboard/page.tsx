import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { Card } from "@/components/ui/Card";
import { BranchDashboard } from "@/components/dashboard/BranchDashboard";
import { DistrictDashboard } from "@/components/dashboard/DistrictDashboard";
import { HODashboard } from "@/components/dashboard/HODashboard";
import { ExecutiveDashboard } from "@/components/dashboard/ExecutiveDashboard";

function noAccessCard(pageLabel: string) {
  return (
    <Card className="mx-auto max-w-lg p-4">
      <p className="text-sm text-slate-600">
        Your role doesn&apos;t currently have dashboard access. Ask an administrator to grant{" "}
        <span className="font-medium text-slate-900">{pageLabel} → View</span> under Roles &amp; Permissions.
      </p>
    </Card>
  );
}

export default async function DashboardPage() {
  const user = (await getCurrentUser())!;
  const db = readDb();

  // Which dashboard to render is decided from the role's orgScope, not its
  // code, so a custom branch/district-scoped role gets the right dashboard
  // too (see PHASE4.md) - except EXECUTIVE_READONLY, which is BANK-scoped
  // like HO_CONTROLLER but gets its own concise view instead of HO's
  // operational one, so it's checked first.
  //
  // Every dashboard is also its own permission - "<x>-dashboard.view" -
  // same as every admin page (see PHASE5.md). orgScope alone decides which
  // dashboard *would* apply to this role; the permission decides whether
  // they're actually allowed to see it, so an admin can revoke a role's
  // dashboard access without touching their org scope.
  const has = (code: string) => hasPermission(user.permissions, permissionKey(code, "view"));

  if (user.role === "EXECUTIVE_READONLY") {
    return has("executive-dashboard") ? <ExecutiveDashboard user={user} db={db} /> : noAccessCard("Executive Dashboard");
  }

  if (user.orgScope === "BRANCH" && user.role !== "ADMIN") {
    return has("branch-dashboard") ? <BranchDashboard user={user} db={db} /> : noAccessCard("Branch Dashboard");
  }

  if (user.orgScope === "DISTRICT" && user.role !== "ADMIN") {
    return has("district-dashboard") ? <DistrictDashboard user={user} db={db} /> : noAccessCard("District Dashboard");
  }

  if (user.orgScope === "BANK" && user.role !== "ADMIN") {
    return has("ho-dashboard") ? <HODashboard user={user} db={db} /> : noAccessCard("HO Dashboard");
  }

  const openPeriod = db.reportingPeriods.find((p) => p.status === "OPEN");
  const district = db.districts.find((d) => d.id === user.districtId);
  const branch = db.branches.find((b) => b.id === user.branchId);
  const canViewAdminDashboard = hasPermission(user.permissions, permissionKey("admin-dashboard", "view"));

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-lg font-semibold text-slate-900">Welcome, {user.name}</h1>
      <p className="mt-1 text-sm text-slate-500">
        Signed in as <span className="font-medium text-slate-700">{user.roleName}</span>
        {district && <> · {district.name}</>}
        {branch && <> · {branch.name}</>}
      </p>

      <Card className="mt-6 p-4">
        <p className="text-sm text-slate-600">
          Current reporting period:{" "}
          <span className="font-medium text-slate-900">{openPeriod ? openPeriod.code : "None open"}</span>
        </p>
        <p className="mt-3 text-sm text-slate-500">
          Administrators use the Admin Dashboard below rather than a role dashboard - Branch, District, HO and
          Executive dashboards are all available to their respective roles (see PHASE7.md).
        </p>
        {canViewAdminDashboard && (
          <Link href="/admin" className="mt-4 inline-block text-sm font-medium text-blue-800 hover:underline">
            Go to Admin Dashboard →
          </Link>
        )}
      </Card>
    </div>
  );
}
