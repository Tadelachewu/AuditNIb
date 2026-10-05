import { redirect } from "next/navigation";
import { SESSION_ENDED_PATH } from "@/lib/session";
import { getCurrentUser } from "@/lib/session";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { SourcesManager } from "@/components/admin/SourcesManager";

// Server Component: checks access and passes the permissions down. The
// table itself is server-paged - SourcesManager asks /api/admin/sources for
// one page at a time (useServerList).
export default async function SourcesPage() {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_ENDED_PATH);
  // Redundant with src/proxy.ts's own "sources.view" gate on this route -
  // same defense-in-depth convention src/app/(app)/findings/page.tsx uses.
  if (!hasPermission(user.permissions, permissionKey("sources", "view"))) redirect("/dashboard");

  const permissions = {
    canCreate: hasPermission(user.permissions, permissionKey("sources", "create")),
    canEdit: hasPermission(user.permissions, permissionKey("sources", "edit")),
    canToggle: hasPermission(user.permissions, permissionKey("sources", "toggle-status")),
    canDelete: hasPermission(user.permissions, permissionKey("sources", "delete")),
  };

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Finding Sources</h1>
      <p className="mt-1 text-sm text-slate-600">Internal Control, Internal Audit, and future configurable sources.</p>
      <SourcesManager permissions={permissions} />
    </div>
  );
}
