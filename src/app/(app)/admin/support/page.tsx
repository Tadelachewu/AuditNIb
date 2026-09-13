import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { hasPermission, hasAnyPermission } from "@/lib/permissions/registry";
import { AdminSupportClient } from "@/components/support/AdminSupportClient";

// Gated by support.view OR support.respond - src/proxy.ts's pageCodeFor()
// deliberately excludes this path from its blanket "<code>.view" rule so
// that exception lives here instead (see its own comment). A respond-only
// role must still reach the inbox to find threads to act on; support.view
// alone still works too, for a read-only "see what's been asked" role.
export default async function AdminSupportPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (!hasAnyPermission(session.permissions, ["support.view", "support.respond"])) redirect("/admin");

  const canRespond = hasPermission(session.permissions, "support.respond");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Support Inbox</h1>
        <p className="mt-1 text-sm text-slate-500">Support messages from every user.</p>
      </div>
      <AdminSupportClient canRespond={canRespond} />
    </div>
  );
}
