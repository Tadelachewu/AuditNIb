import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions/registry";
import { SupportClient } from "@/components/support/SupportClient";

// Gated by support.create (the requester side - see registry.ts's own doc
// comment on the "support" page) - not implicit for every logged-in user,
// unlike Profile. src/proxy.ts never maps "/support" to a page code (it
// only auto-gates /admin/<code> and /findings), so this checks inline,
// same as (app)/dashboard/page.tsx does for its own org-scope branches.
export default async function SupportPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (!hasPermission(session.permissions, "support.create")) redirect("/dashboard");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Support</h1>
        <p className="mt-1 text-sm text-slate-600">Send a message and get help from support. Rate the response once you&apos;re satisfied.</p>
      </div>
      <SupportClient />
    </div>
  );
}
