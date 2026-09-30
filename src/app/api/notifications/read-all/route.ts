import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { updateDb } from "@/lib/db";
import { withApiHandler } from "@/lib/api/handler";

async function handlePOST() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  await updateDb((current) => {
    const now = new Date().toISOString();
    for (const n of current.notifications) {
      if (n.recipientUserId === auth.session.userId && !n.readAt) n.readAt = now;
    }
    return null;
  });

  return NextResponse.json({ ok: true });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const POST = withApiHandler(handlePOST);
