import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { withApiHandler } from "@/lib/api/handler";
import { uploadAttachment } from "@/lib/communications/service";
import { respond } from "../respond";

/**
 * POST - upload one attachment for a message about to be sent (multipart,
 * field "file"). One file per request keeps each upload within the app's
 * 10 MB request limit; the message then refers to the uploaded files.
 */
async function handlePOST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // The request parser refuses a body over about 10 MB before this route sees it.
    return NextResponse.json({ error: "A file must be at most 10 MB" }, { status: 400 });
  }
  const file = form.get("file");
  if (!file || !(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  const content = Buffer.from(await file.arrayBuffer());
  return respond(await uploadAttachment(auth.session, { name: file.name, type: file.type, size: file.size }, content), (a) => ({ attachment: a }), 201);
}

export const POST = withApiHandler(handlePOST);
