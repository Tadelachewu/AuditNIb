import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { withApiHandler } from "@/lib/api/handler";
import { unreadCount } from "@/lib/communications/service";

/** GET - unread messages in the caller's Inbox, for the sidebar badge (0 for administrators). */
async function handleGET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ unread: await unreadCount(auth.session) });
}

export const GET = withApiHandler(handleGET);
