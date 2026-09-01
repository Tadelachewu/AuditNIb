import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { UncoveredReasonsManager } from "@/components/admin/UncoveredReasonsManager";

// Same Server Component + prop-driven client manager pattern as
// /admin/sources - see that page's own comment for the reasoning.
export default async function UncoveredReasonsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Redundant with src/proxy.ts's own "uncovered-reasons.view" gate on this
  // route - same defense-in-depth convention every /admin page here uses.
  if (!hasPermission(user.permissions, permissionKey("uncovered-reasons", "view"))) redirect("/dashboard");

  const db = readDb();

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Uncovered Branch Reasons</h1>
      <p className="mt-1 text-sm text-slate-500">
        The canned reasons offered on the Uncovered Branches report when recording why a branch has no findings this
        period.
      </p>
      <UncoveredReasonsManager initialReasons={db.uncoveredReasons} />
    </div>
  );
}
