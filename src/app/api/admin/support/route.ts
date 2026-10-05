import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { readDb } from "@/lib/db";
import { withApiHandler } from "@/lib/api/handler";
import { listPageJson } from "@/lib/serverList";

// The admin inbox - every user's threads, not just the caller's own (see
// GET /api/support for that). Gated by support.view OR support.respond -
// a respond-only role must still be able to list threads to find one to
// act on; posting a reply (see [id]/messages/route.ts) stays respond-only.
async function handleGET(request: Request) {
  const auth = await requirePermission("support.view", "support.respond");
  if (!auth.ok) return auth.response;

  const db = await readDb();
  const threads = [...db.supportThreads].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  const usersById = new Map(db.users.map((u) => [u.id, u]));

  const enriched = threads.map((t) => {
    const user = usersById.get(t.userId);
    return {
      ...t,
      userName: user?.name ?? "Unknown user",
      userRole: user?.role ?? null,
    };
  });

  // ?page=... -> one page of the inbox (most recently active first).
  const paged = listPageJson(request, "threads", enriched, { fields: { updatedAt: (t) => t.updatedAt } });
  if (paged) return NextResponse.json(paged);
  return NextResponse.json({ threads: enriched });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const GET = withApiHandler(handleGET);
