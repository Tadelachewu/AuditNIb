import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { withApiHandler } from "@/lib/api/handler";
import { attachmentDisposition } from "@/lib/fileStorage";
import { deletePendingAttachment, downloadAttachment } from "@/lib/communications/service";
import { respond } from "../../respond";

type Params = { params: Promise<{ attachmentId: string }> };

/** GET - download (sender and recipients only; decrypted on the fly, always as a download, audit-logged). */
async function handleGET(_request: Request, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { attachmentId } = await params;
  const result = await downloadAttachment(auth.session, attachmentId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  const { fileName, mimeType, content } = result.value;
  return new NextResponse(new Uint8Array(content), {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": attachmentDisposition(fileName),
      "Content-Length": String(content.length),
      "Cache-Control": "private, no-store",
    },
  });
}

/** DELETE - remove an attachment uploaded but not sent yet. */
async function handleDELETE(_request: Request, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { attachmentId } = await params;
  return respond(await deletePendingAttachment(auth.session, attachmentId), () => ({ ok: true }));
}

export const GET = withApiHandler(handleGET);
export const DELETE = withApiHandler(handleDELETE);
