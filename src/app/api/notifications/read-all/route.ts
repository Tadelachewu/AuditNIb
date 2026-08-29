import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { updateDb } from "@/lib/db";

export async function POST() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  updateDb((current) => {
    const now = new Date().toISOString();
    for (const n of current.notifications) {
      if (n.recipientUserId === auth.session.userId && !n.readAt) n.readAt = now;
    }
    return null;
  });

  return NextResponse.json({ ok: true });
}
