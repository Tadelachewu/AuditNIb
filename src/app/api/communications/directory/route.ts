import { requireUser } from "@/lib/guard";
import { withApiHandler } from "@/lib/api/handler";
import { directory } from "@/lib/communications/service";
import { respond } from "../respond";

/** GET - who a message can be sent to: users (active, not administrators), and roles / districts / branches to pick groups by. */
async function handleGET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  return respond(await directory(auth.session));
}

export const GET = withApiHandler(handleGET);
