import { redirect } from "next/navigation";
import { getCurrentUser, SESSION_ENDED_PATH } from "@/lib/session";
import { canSendCommunications, canUseCommunications } from "@/lib/communications/rules";
import { CommunicationsClient } from "@/components/communications/CommunicationsClient";

// Communications (docs/communications.md). src/proxy.ts doesn't map this
// path to a page code, so access is checked here: Communications > View, and
// never an administrator.
export default async function CommunicationsPage() {
  const session = await getCurrentUser();
  if (!session) redirect(SESSION_ENDED_PATH);
  if (!canUseCommunications(session)) redirect("/dashboard");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Communications</h1>
        <p className="mt-1 text-sm text-slate-600">Messages to and from colleagues across the bank - with PDF, Word or Excel attachments. Every new message is also emailed.</p>
      </div>
      <CommunicationsClient canSend={canSendCommunications(session)} />
    </div>
  );
}
