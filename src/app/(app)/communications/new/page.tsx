import { redirect } from "next/navigation";
import { getCurrentUser, SESSION_ENDED_PATH } from "@/lib/session";
import { canSendCommunications } from "@/lib/communications/rules";
import { ComposeForm } from "@/components/communications/ComposeForm";
import { StickyBack } from "@/components/ui/StickyBack";

// New message (docs/communications.md): Communications > Send, never an administrator.
export default async function NewCommunicationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getCurrentUser();
  if (!session) redirect(SESSION_ENDED_PATH);
  if (!canSendCommunications(session)) redirect("/communications");
  // Forward: the message being forwarded (the form loads it - access checked on the server).
  const forward = (await searchParams).forward;
  const forwardId = typeof forward === "string" && forward ? forward : undefined;

  return (
    <div className="flex flex-col gap-5">
      <StickyBack href="/communications" />
      <h1 className="text-lg font-semibold text-slate-900">{forwardId ? "Forward message" : "New message"}</h1>
      <ComposeForm forwardId={forwardId} />
    </div>
  );
}
