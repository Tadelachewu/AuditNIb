import { requireUser } from "@/lib/guard";
import { withApiHandler } from "@/lib/api/handler";
import { openThread, removeFromInbox } from "@/lib/communications/service";
import { respond } from "../respond";

type Params = { params: Promise<{ id: string }> };

/** GET - the conversation this message belongs to (marks it read). DELETE - remove it from the caller's own Inbox. */
async function handleGET(_request: Request, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  return respond(await openThread(auth.session, id));
}

async function handleDELETE(_request: Request, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  return respond(await removeFromInbox(auth.session, id), () => ({ ok: true }));
}

export const GET = withApiHandler(handleGET);
export const DELETE = withApiHandler(handleDELETE);
