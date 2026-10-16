import { redirect } from "next/navigation";
import { getCurrentUser, SESSION_ENDED_PATH } from "@/lib/session";
import { canSendCommunications, canUseCommunications } from "@/lib/communications/rules";
import { ThreadClient } from "@/components/communications/ThreadClient";

// One conversation (docs/communications.md). Who may see which message is
// checked by the API (sender and recipients only).
export default async function CommunicationPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentUser();
  if (!session) redirect(SESSION_ENDED_PATH);
  if (!canUseCommunications(session)) redirect("/dashboard");
  const { id } = await params;
  return <ThreadClient id={id} canSend={canSendCommunications(session)} />;
}
