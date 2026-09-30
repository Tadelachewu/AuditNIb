import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { requireUser } from "@/lib/guard";
import { hasPermission } from "@/lib/permissions/registry";
import { readDb, updateDb } from "@/lib/db";
import { notifyUsers, usersWithSupportRespondPermission } from "@/lib/notifications";
import { withApiHandler } from "@/lib/api/handler";

const messageSchema = z.object({
  body: z.string().trim().min(1, "Message cannot be empty"),
});

async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const parsed = messageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { body } = parsed.data;

  const db = await readDb();
  const thread = db.supportThreads.find((t) => t.id === id);
  if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 });

  const isOwner = thread.userId === auth.session.userId;
  const allowed = isOwner
    ? hasPermission(auth.session.permissions, "support.create")
    : hasPermission(auth.session.permissions, "support.respond");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (thread.status !== "OPEN") {
    return NextResponse.json({ error: "This thread is resolved. Send a new message to start a new thread." }, { status: 409 });
  }

  const created = await updateDb((current) => {
    const t = current.supportThreads.find((x) => x.id === id)!;
    const now = new Date().toISOString();
    const message = {
      id: uuid(),
      threadId: t.id,
      senderId: auth.session.userId!,
      senderName: auth.session.name!,
      senderIsSupport: !isOwner,
      body,
      createdAt: now,
    };
    current.supportMessages.push(message);
    t.updatedAt = now;
    // A follow-up from the thread's own owner (e.g. after a below-5 rating)
    // reopens the satisfaction loop - clear any prior rating so the UI
    // shows this as awaiting a fresh response again.
    if (isOwner) t.rating = null;

    if (isOwner) {
      const recipients = usersWithSupportRespondPermission(current);
      if (recipients.length > 0) {
        notifyUsers(current, recipients, {
          type: "SUPPORT_MESSAGE",
          title: `New support message from ${auth.session.name}`,
          message: body.slice(0, 140),
          entityType: "SupportThread",
          entityId: t.id,
        });
      }
    } else {
      notifyUsers(current, [t.userId], {
        type: "SUPPORT_REPLY",
        title: "Support replied to your message",
        message: body.slice(0, 140),
        entityType: "SupportThread",
        entityId: t.id,
      });
    }

    return message;
  });

  return NextResponse.json({ message: created }, { status: 201 });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const POST = withApiHandler(handlePOST);
