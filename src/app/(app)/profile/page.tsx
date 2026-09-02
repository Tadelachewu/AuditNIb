import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";
import { ProfileClient } from "@/components/profile/ProfileClient";

// Every logged-in user reaches this page regardless of role or
// permissions - it needs no permission key of its own (see src/proxy.ts's
// pageCodeFor(), which never maps "/profile" to a page code), same as
// notifications. See HOW_IT_WORKS.md for how mustChangePassword drives
// src/proxy.ts's redirect here.
export default async function ProfilePage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const db = readDb();
  const user = db.users.find((u) => u.id === session.userId);
  if (!user) redirect("/login");

  const role = db.roles.find((r) => r.code === user.role);
  const district = db.districts.find((d) => d.id === user.districtId);
  const branch = db.branches.find((b) => b.id === user.branchId);
  const department = db.departments.find((d) => d.id === user.departmentId);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">My Profile</h1>
        <p className="mt-1 text-sm text-slate-500">Your account details and self-service settings.</p>
      </div>

      <Card>
        <CardHeader title="Account" description="Set by an administrator - contact one to change any of this." />
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs font-medium text-slate-500">Display Name</dt>
            <dd className="mt-0.5 text-slate-900">{user.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Username</dt>
            <dd className="mt-0.5 font-mono text-slate-900">{user.username}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Role</dt>
            <dd className="mt-0.5 text-slate-900">{role?.name ?? user.role}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Organization Unit</dt>
            <dd className="mt-0.5 text-slate-900">{branch?.name ?? district?.name ?? "Bank-wide"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Department</dt>
            <dd className="mt-0.5 text-slate-900">{department?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Last Login</dt>
            <dd className="mt-0.5 text-slate-900">{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "—"}</dd>
          </div>
        </dl>
      </Card>

      <ProfileClient initialEmail={user.email ?? ""} forced={Boolean(user.mustChangePassword)} />
    </div>
  );
}
