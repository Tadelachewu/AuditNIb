import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { withApiHandler } from "@/lib/api/handler";

const rateSchema = z.object({
  rating: z.number().int().min(1).max(5),
});

// Only the thread's own owner rates it (support.create - the requester
// side), never support.view/support.respond alone - a 5-star rating closes
// the thread; anything below leaves it OPEN so the owner's next message
// (see [id]/messages/route.ts) reopens the notify/respond cycle.
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("support.create");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const parsed = rateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { rating } = parsed.data;

  const db = await readDb();
  const thread = db.supportThreads.find((t) => t.id === id);
  if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  if (thread.userId !== auth.session.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updated = await updateDb((current) => {
    const t = current.supportThreads.find((x) => x.id === id)!;
    t.rating = rating;
    t.status = rating === 5 ? "RESOLVED" : "OPEN";
    t.updatedAt = new Date().toISOString();
    return t;
  });

  return NextResponse.json({ thread: updated });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const POST = withApiHandler(handlePOST);
