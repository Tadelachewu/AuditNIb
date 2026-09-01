import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { SourcesManager } from "@/components/admin/SourcesManager";

// Server Component: the initial list is fetched here (readDb(), same as
// every other server-rendered page) instead of the old pattern of a
// "use client" page firing useEffect+apiGet on mount - no loading flash,
// no client-side waterfall. SourcesManager only owns the form/dialog/
// editing UI state; the list itself is a prop, refreshed via
// router.refresh() after a mutation rather than a duplicated client copy.
export default async function SourcesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Redundant with src/proxy.ts's own "sources.view" gate on this route -
  // same defense-in-depth convention src/app/(app)/findings/page.tsx uses.
  if (!hasPermission(user.permissions, permissionKey("sources", "view"))) redirect("/dashboard");

  const db = readDb();

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Finding Sources</h1>
      <p className="mt-1 text-sm text-slate-500">Internal Control, Internal Audit, and future configurable sources.</p>
      <SourcesManager initialSources={db.sources} />
    </div>
  );
}
