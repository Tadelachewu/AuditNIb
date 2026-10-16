import { redirect } from "next/navigation";
import { getCurrentUser, SESSION_ENDED_PATH } from "@/lib/session";
import { canSendCommunications } from "@/lib/communications/rules";
import { ComposeForm } from "@/components/communications/ComposeForm";

// New message (docs/communications.md): Communications > Send, never an administrator.
export default async function NewCommunicationPage() {
  const session = await getCurrentUser();
  if (!session) redirect(SESSION_ENDED_PATH);
  if (!canSendCommunications(session)) redirect("/communications");

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold text-slate-900">New message</h1>
      <ComposeForm />
    </div>
  );
}
