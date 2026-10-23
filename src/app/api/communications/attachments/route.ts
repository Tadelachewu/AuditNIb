import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { withApiHandler } from "@/lib/api/handler";
import { uploadAttachment } from "@/lib/communications/service";
import { LIMITS } from "@/lib/communications/types";
import { respond } from "../respond";

/**
 * POST - upload one attachment for a message about to be sent (multipart,
 * field "file"). One file per request keeps each upload within the app's
 * 25 MB file limit (LIMITS.attachmentBytes); the message then refers to the uploaded files.
 */
async function handlePOST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // A body over the limit (src/proxy.ts / next.config.ts) never reaches the route whole.
    return NextResponse.json({ error: `A file must be at most ${LIMITS.attachmentBytes / (1024 * 1024)} MB` }, { status: 400 });
  }
  const file = form.get("file");
  if (!file || !(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  const content = Buffer.from(await file.arrayBuffer());
  return respond(await uploadAttachment(auth.session, { name: file.name, type: file.type, size: file.size }, content), (a) => ({ attachment: a }), 201);
}

export const POST = withApiHandler(handlePOST);
