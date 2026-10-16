import { requireUser } from "@/lib/guard";
import { withApiHandler } from "@/lib/api/handler";
import { withdrawMessage } from "@/lib/communications/service";
import { respond } from "../../respond";

/** POST - the sender takes the message back (within 10 minutes, while nobody has opened it). */
async function handlePOST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  return respond(await withdrawMessage(auth.session, id), () => ({ ok: true }));
}

export const POST = withApiHandler(handlePOST);
