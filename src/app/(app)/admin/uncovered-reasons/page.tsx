import { redirect } from "next/navigation";
import { SESSION_ENDED_PATH } from "@/lib/session";
import { getCurrentUser } from "@/lib/session";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { UncoveredReasonsManager } from "@/components/admin/UncoveredReasonsManager";

// Same pattern as /admin/sources: a Server Component that checks access;
// the manager's table is server-paged (useServerList).
export default async function UncoveredReasonsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_ENDED_PATH);
  // Redundant with src/proxy.ts's own "uncovered-reasons.view" gate on this
  // route - same defense-in-depth convention every /admin page here uses.
  if (!hasPermission(user.permissions, permissionKey("uncovered-reasons", "view"))) redirect("/dashboard");

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Uncovered Branch Reasons</h1>
      <p className="mt-1 text-sm text-slate-600">
        The canned reasons offered on the Uncovered Branches report when recording why a branch has no findings this
        period.
      </p>
      <UncoveredReasonsManager />
    </div>
  );
}
