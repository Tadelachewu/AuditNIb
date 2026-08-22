import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { Card } from "@/components/ui/Card";
import { BranchDashboard } from "@/components/dashboard/BranchDashboard";

export default async function DashboardPage() {
  const user = (await getCurrentUser())!;
  const db = readDb();

  // Which dashboard to render is decided from the role's orgScope, not its
  // code, so a custom branch-scoped role gets the Branch dashboard too -
  // see PHASE4.md. District/HO/Executive dashboards land in later phases;
  // ADMIN and any other bank-wide role fall through to the generic landing
  // below until then.
  //
  // Every dashboard is also its own permission - "branch-dashboard.view" -
  // same as every admin page (see PHASE5.md). orgScope alone decides which
  // dashboard *would* apply to this role; the permission decides whether
  // they're actually allowed to see it, so an admin can revoke a branch-
  // scoped role's dashboard access without touching their org scope.
  const canViewBranchDashboard = hasPermission(user.permissions, permissionKey("branch-dashboard", "view"));
  if (user.orgScope === "BRANCH" && user.role !== "ADMIN") {
    if (canViewBranchDashboard) {
      return <BranchDashboard user={user} db={db} />;
    }
    return (
      <Card className="mx-auto max-w-lg p-4">
        <p className="text-sm text-slate-600">
          Your role doesn&apos;t currently have dashboard access. Ask an administrator to grant{" "}
          <span className="font-medium text-slate-900">Branch Dashboard → View</span> under Roles &amp; Permissions.
        </p>
      </Card>
    );
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
          District, HO and Executive dashboards ship next, one at a time (see PHASE4.md). This release covers
          authentication, organization/user foundations, the Administration console, and the Branch dashboard.
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
