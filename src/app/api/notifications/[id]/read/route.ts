import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { updateDb } from "@/lib/db";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const updated = updateDb((current) => {
    const n = current.notifications.find((x) => x.id === id && x.recipientUserId === auth.session.userId);
    if (n && !n.readAt) n.readAt = new Date().toISOString();
    return n ?? null;
  });

  if (!updated) return NextResponse.json({ error: "Notification not found" }, { status: 404 });
  return NextResponse.json({ notification: updated });
}
