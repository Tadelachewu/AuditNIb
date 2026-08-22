import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { Card } from "@/components/ui/Card";

export default async function DashboardPage() {
  const user = (await getCurrentUser())!;
  const db = readDb();
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
          Role-specific findings dashboards (branch, district, HO and executive views) ship in a later phase of the
          build. This release covers authentication, organization/user foundations, and the Administration console.
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
