import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/guard";
import { withApiHandler } from "@/lib/api/handler";
import { listInbox, listSent, sendMessage } from "@/lib/communications/service";
import { LIMITS } from "@/lib/communications/types";
import { DEFAULT_PAGE_SIZE, parsePage } from "@/lib/pagination";
import { respond } from "./respond";

/**
 * Communications (docs/communications.md).
 *   GET  ?box=inbox|sent&page=&pageSize=&q=  - one page of the caller's Inbox or Sent.
 *   POST                                      - send a new message or a reply.
 * Administrators are refused (src/lib/communications/rules.ts).
 */
async function handleGET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const page = parsePage(url.searchParams.get("page") ?? undefined);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || DEFAULT_PAGE_SIZE));
  const q = url.searchParams.get("q") ?? undefined;
  const opts = { page, pageSize, q };
  return url.searchParams.get("box") === "sent" ? respond(await listSent(auth.session, opts)) : respond(await listInbox(auth.session, opts));
}

const ids = z.array(z.string().min(1).max(100)).max(5000).default([]);
const sendSchema = z.object({
  subject: z.string().max(LIMITS.subject, `Subject must be at most ${LIMITS.subject} characters`).optional(),
  body: z.string().max(LIMITS.body + 500, `Message text must be at most ${LIMITS.body} characters`),
  bodyHtml: z.string().max(LIMITS.html, "The formatted message is too long").optional(),
  selection: z.object({ toAll: z.boolean().default(false), userIds: ids, roleCodes: ids, districtIds: ids, branchIds: ids }).optional(),
  replyToId: z.string().min(1).optional(),
  replyAll: z.boolean().optional(),
  attachmentIds: z.array(z.string().min(1)).max(LIMITS.attachments, `At most ${LIMITS.attachments} attachments per message`).default([]),
});

async function handlePOST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const parsed = sendSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  return respond(await sendMessage(auth.session, parsed.data), undefined, 201);
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const GET = withApiHandler(handleGET);
export const POST = withApiHandler(handlePOST);
