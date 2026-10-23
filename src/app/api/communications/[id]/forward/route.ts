import { requireUser } from "@/lib/guard";
import { withApiHandler } from "@/lib/api/handler";
import { forwardDraft } from "@/lib/communications/service";
import { respond } from "../../respond";

// Forward (docs/communications.md): the New message form's starting point -
// "Fwd:" subject, the original quoted, its files copied as the forwarder's
// pending attachments. POST because it creates those copies.
async function handlePOST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  return respond(await forwardDraft(auth.session, id));
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const POST = withApiHandler(handlePOST);
