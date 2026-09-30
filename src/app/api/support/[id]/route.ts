import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { hasPermission, hasAnyPermission } from "@/lib/permissions/registry";
import { readDb } from "@/lib/db";
import { withApiHandler } from "@/lib/api/handler";

// The thread's own owner needs support.create (the requester side); anyone
// else needs support.view or support.respond (either one - the inbox list
// is gated by support.view alone, so opening a thread it lists must not
// additionally require support.respond, which only gates posting a reply).
async function handleGET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = await readDb();
  const thread = db.supportThreads.find((t) => t.id === id);
  if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 });

  const isOwner = thread.userId === auth.session.userId;
  const allowed = isOwner
    ? hasPermission(auth.session.permissions, "support.create")
    : hasAnyPermission(auth.session.permissions, ["support.view", "support.respond"]);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const messages = db.supportMessages
    .filter((m) => m.threadId === id)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return NextResponse.json({ thread, messages });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const GET = withApiHandler(handleGET);
