import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { notifyUsers, usersWithSupportRespondPermission } from "@/lib/notifications";
import { withApiHandler } from "@/lib/api/handler";

// support.create is the requester side of Support - see registry.ts's own
// doc comment on the "support" page for the full three-action split.
async function handleGET() {
  const auth = await requirePermission("support.create");
  if (!auth.ok) return auth.response;

  const db = await readDb();
  const threads = db.supportThreads
    .filter((t) => t.userId === auth.session.userId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return NextResponse.json({ threads });
}

const createSchema = z.object({
  body: z.string().trim().min(1, "Message cannot be empty"),
});

async function handlePOST(request: Request) {
  const auth = await requirePermission("support.create");
  if (!auth.ok) return auth.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { body } = parsed.data;
  const subject = body.length > 80 ? `${body.slice(0, 80)}...` : body;

  const created = await updateDb((current) => {
    const now = new Date().toISOString();
    const thread = {
      id: uuid(),
      userId: auth.session.userId!,
      subject,
      status: "OPEN" as const,
      rating: null,
      createdAt: now,
      updatedAt: now,
    };
    current.supportThreads.push(thread);

    const message = {
      id: uuid(),
      threadId: thread.id,
      senderId: auth.session.userId!,
      senderName: auth.session.name!,
      senderIsSupport: false,
      body,
      createdAt: now,
    };
    current.supportMessages.push(message);

    const recipients = usersWithSupportRespondPermission(current);
    if (recipients.length > 0) {
      notifyUsers(current, recipients, {
        type: "SUPPORT_MESSAGE",
        title: `New support message from ${auth.session.name}`,
        message: body.slice(0, 140),
        entityType: "SupportThread",
        entityId: thread.id,
      });
    }

    return { thread, message };
  });

  return NextResponse.json(created, { status: 201 });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const GET = withApiHandler(handleGET);
export const POST = withApiHandler(handlePOST);
