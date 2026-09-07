import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { parseDateRange } from "@/lib/dateRange";
import { parseDashboardFilters } from "@/lib/dashboardFilters";
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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = (await getCurrentUser())!;
  const db = readDb();
  const params = await searchParams;
  const dateRange = parseDateRange(params);
  const filters = parseDashboardFilters(params);

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
    return has("executive-dashboard") ? (
      <ExecutiveDashboard user={user} db={db} dateRange={dateRange} />
    ) : (
      noAccessCard("Executive Dashboard")
    );
  }

  if (user.orgScope === "BRANCH" && user.role !== "ADMIN") {
    return has("branch-dashboard") ? (
      <BranchDashboard user={user} db={db} dateRange={dateRange} filters={filters} />
    ) : (
      noAccessCard("Branch Dashboard")
    );
  }

  if (user.orgScope === "DISTRICT" && user.role !== "ADMIN") {
    return has("district-dashboard") ? (
      <DistrictDashboard user={user} db={db} dateRange={dateRange} filters={filters} />
    ) : (
      noAccessCard("District Dashboard")
    );
  }

  if (user.orgScope === "BANK" && user.role !== "ADMIN") {
    return has("ho-dashboard") ? (
      <HODashboard user={user} db={db} dateRange={dateRange} filters={filters} />
    ) : (
      noAccessCard("HO Dashboard")
    );
  }

  // Only ADMIN reaches this point (every other role/orgScope combination
  // is handled by one of the branches above). /admin already renders the
  // exact same content (see its own page.tsx, sharing AdminDashboard) -
  // redirecting instead of rendering it a second time here removes the
  // duplicate page outright rather than just duplicating the JSX, and the
  // sidebar's plain "Dashboard" link is hidden for ADMIN (see
  // hideForRoles in src/lib/nav.ts) so there's nothing left pointing at a
  // page that only ever bounces elsewhere.
  if (!has("admin-dashboard")) return noAccessCard("Admin Dashboard");
  redirect("/admin");
}
