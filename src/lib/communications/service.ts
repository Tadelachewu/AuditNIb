import { v4 as uuid } from "uuid";
import { prisma } from "@/lib/prismaClient";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { ADMIN_ROLE_CODE, notifyUsers } from "@/lib/notifications";
import { isRateLimited, recordAttempt } from "@/lib/rateLimit";
import { deleteStoredFile, newStoredName, readStoredFile, writeStoredFile } from "@/lib/fileStorage";
import type { SessionData } from "@/lib/session";
import {
  attachmentProblem,
  canSendCommunications,
  canUseCommunications,
  canWithdraw,
  eligibleRecipients,
  emailText,
  messageProblem,
  previewOf,
  replyRecipients,
  replySubject,
  resolveToAndCc,
} from "./rules";
import { emailHtml, forwardHeaderHtml, htmlToText, originalBodyHtml, sanitizeMessageHtml } from "./richText";
import { messageWords } from "./plainText";
import { formatDateTime } from "@/lib/format";
import { ATTACHMENT_TYPES, LIMITS, type AttachmentInfo, type Directory, type InboxItem, type MessageView, type RecipientSelection, type SentItem, type ThreadView } from "./types";

/**
 * Communications workflow (docs/communications.md). Messages live in their
 * own tables (prisma), not in readDb()'s in-memory Database - only the
 * notifications (bell + email) and the audit log go through updateDb(), in
 * the same transaction as the message rows.
 */

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

const SEND_LIMIT = { max: 20, windowMs: 10 * 60 * 1000 };
const SEND_ALL_LIMIT = { max: 3, windowMs: 60 * 60 * 1000 };
const UPLOAD_LIMIT = { max: 30, windowMs: 10 * 60 * 1000 };
/** An attachment uploaded but never sent is removed after this long. */
const PENDING_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const RECIPIENT_NAMES_SHOWN = 50;

type Session = SessionData;

const NOT_ALLOWED = "Communications isn't available for your account";

// ---------------------------------------------------------------------------
// Sending

export interface SendInput {
  subject?: string;
  /** Plain text (used as it is when there is no bodyHtml). */
  body: string;
  /** The formatted message from the editor; sanitised here, and the plain text is derived from it. */
  bodyHtml?: string;
  /** A new message: who it goes to (To), and who gets a copy (Cc - never "Everyone"). */
  selection?: RecipientSelection;
  cc?: RecipientSelection;
  /** A reply: the message replied to, and whether to everyone on it. */
  replyToId?: string;
  replyAll?: boolean;
  /** A forward: the message forwarded (one the sender can read). */
  forwardOfId?: string;
  /** Attachments uploaded beforehand (POST /api/communications/attachments). */
  attachmentIds: string[];
}

interface RawClient {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

/** Whether a column added by a later migration exists yet (re-checked each minute until it does). */
function columnCheck(table: string, column: string): () => Promise<boolean> {
  let installed: boolean | null = null;
  let checkedAt = 0;
  return async () => {
    if (installed === true) return true;
    if (installed === false && Date.now() - checkedAt < 60_000) return false;
    checkedAt = Date.now();
    try {
      const rows = await (prisma as unknown as RawClient).$queryRaw<{ ok: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = ${table} AND column_name = ${column}) AS ok`;
      installed = rows[0]?.ok === true;
    } catch {
      installed = false;
    }
    return installed;
  };
}
/** The Cc column (migration 20261023120000_communication_cc). */
const ccInstalled = columnCheck("communication_recipients", "is_cc");
/** The Forward link (migration 20261025120000_communication_forwarded). */
const forwardInstalled = columnCheck("communications", "forwarded_from_id");

/** Of these messages, the forwards ("Forwarded" label) and where each came from (null: the original is gone). */
async function forwardedIds(ids: string[]): Promise<Map<string, { senderName: string; createdAt: string } | null>> {
  if (ids.length === 0 || !(await forwardInstalled())) return new Map();
  const rows = await (prisma as unknown as RawClient).$queryRaw<{ id: string; sender_name: string | null; created_at: Date | null }[]>`
    SELECT c.id, o.sender_name, o.created_at FROM communications c LEFT JOIN communications o ON o.id = c.forwarded_from_id
    WHERE c.id = ANY(${ids}::text[]) AND c.forwarded_from_id IS NOT NULL`;
  return new Map(rows.map((r) => [r.id, r.sender_name && r.created_at ? { senderName: r.sender_name, createdAt: r.created_at.toISOString() } : null]));
}

export async function sendMessage(session: Session, input: SendInput): Promise<Result<{ id: string; recipients: number }>> {
  if (!canSendCommunications(session)) return fail(403, NOT_ALLOWED);
  const senderId = session.userId!;
  const senderName = session.name ?? "";
  // A formatted message: only the allowed formatting survives, and the plain
  // text (search, previews, limits, plain-text email) comes from what's left.
  const bodyHtml = input.bodyHtml?.trim() ? sanitizeMessageHtml(input.bodyHtml) : null;
  const body = bodyHtml !== null ? htmlToText(bodyHtml) : input.body.trim();
  const db = await readDb();

  let subject: string;
  let recipients: { id: string; name: string }[];
  let threadId: string;
  let parentId: string | null = null;
  let toAll = false;
  /** Cc'd recipients (a subset of `recipients`). Someone in both To and Cc is To. */
  let ccIds: string[] = [];
  /** A forward: the message it forwards. */
  let forwardedFromId: string | null = null;
  const id = uuid();

  if (input.replyToId) {
    const original = await prisma.communication.findUnique({ where: { id: input.replyToId }, include: { recipients: { select: { userId: true } } } });
    const isSender = original?.senderId === senderId;
    const isRecipient = Boolean(original?.recipients.some((r) => r.userId === senderId));
    if (!original || (!isSender && (!isRecipient || original.withdrawnAt))) return fail(404, "Message not found");
    if (original.withdrawnAt) return fail(409, "This message was withdrawn - it can't be replied to");
    const who = replyRecipients(db, { senderId: original.senderId, toAll: original.toAll, recipientIds: original.recipients.map((r) => r.userId) }, senderId, Boolean(input.replyAll));
    if ("error" in who) return fail(400, who.error);
    recipients = who;
    subject = replySubject(original.subject);
    threadId = original.threadId;
    parentId = original.id;
  } else {
    subject = (input.subject ?? "").trim();
    if (!input.selection) return fail(400, "Choose who the message goes to");
    ({ recipients, ccIds } = resolveToAndCc(db, input.selection, input.cc, senderId));
    toAll = input.selection.toAll;
    threadId = id;
    if (input.forwardOfId) {
      // Only a message the sender may read (its sender, or a recipient while it isn't withdrawn).
      const original = await prisma.communication.findUnique({ where: { id: input.forwardOfId }, include: { recipients: { where: { userId: senderId }, select: { userId: true } } } });
      if (!original || (original.senderId !== senderId && (original.recipients.length === 0 || original.withdrawnAt))) return fail(404, "The forwarded message wasn't found");
      forwardedFromId = original.id;
    }
  }
  const problem = messageProblem(subject, body, messageWords({ html: bodyHtml ?? "", text: body }));
  if (problem) return fail(400, problem);
  if (recipients.length === 0) return fail(400, "Nobody to send to - choose at least one active user");

  const attachmentIds = [...new Set(input.attachmentIds)];
  if (attachmentIds.length > LIMITS.attachments) return fail(400, `At most ${LIMITS.attachments} attachments per message`);
  const attachments = attachmentIds.length
    ? await prisma.communicationAttachment.findMany({ where: { id: { in: attachmentIds }, uploadedBy: senderId, communicationId: null } })
    : [];
  if (attachments.length !== attachmentIds.length) return fail(400, "An attachment is missing or was already sent - attach it again");
  // All the files together, not each one.
  if (attachments.reduce((sum, a) => sum + a.size, 0) > LIMITS.attachmentBytes) {
    return fail(400, `Attachments together must be at most ${LIMITS.attachmentBytes / (1024 * 1024)} MB`);
  }

  const sendKey = `communications-send:${senderId}`;
  const allKey = `communications-send-all:${senderId}`;
  const limited = await isRateLimited(sendKey, SEND_LIMIT);
  if (limited.limited) return fail(429, `You've sent many messages in a short time - try again in ${Math.ceil(limited.retryAfterSeconds / 60)} minute(s)`);
  if (toAll) {
    const allLimited = await isRateLimited(allKey, SEND_ALL_LIMIT);
    if (allLimited.limited) return fail(429, `Messages to all users are limited to ${SEND_ALL_LIMIT.max} an hour - try again in ${Math.ceil(allLimited.retryAfterSeconds / 60)} minute(s)`);
  }

  const now = new Date();
  const isReply = parentId !== null;
  const isForward = forwardedFromId !== null;
  const names = attachments.map((a) => a.fileName);
  await updateDb(
    (current) => {
      notifyUsers(
        current,
        recipients.map((r) => r.id),
        {
          type: isReply ? "COMMUNICATION_REPLY" : "COMMUNICATION",
          title: isReply ? `${senderName} replied: ${subject}` : isForward ? `${senderName} forwarded: ${subject}` : `${senderName}: ${subject}`,
          message: previewOf(body),
          entityType: "Communication",
          entityId: id,
          emailMessage: emailText(senderName, body, names),
          emailHtml: bodyHtml ? emailHtml(senderName, bodyHtml, names) : undefined,
        }
      );
      appendAuditLog(current, {
        userId: senderId,
        userName: senderName,
        action: isReply ? "COMMUNICATION_REPLIED" : "COMMUNICATION_SENT",
        entityType: "Communication",
        entityId: id,
        newValue: { subject, toAll, recipients: recipients.length, attachments: names, threadId, ...(isForward ? { forwardedFromId } : {}) },
      });
    },
    {
      // The message, its recipients and its attachments commit with the notifications and emails.
      alsoWrite: async (tx) => {
        await tx.communication.create({
          data: { id, threadId, parentId, senderId, senderName, subject, body, bodyHtml: bodyHtml || null, toAll, createdAt: now },
        });
        await tx.communicationRecipient.createMany({
          data: recipients.map((r) => ({ id: uuid(), communicationId: id, userId: r.id, userName: r.name })),
        });
        // Cc (column is_cc, migration 20261023120000_communication_cc). Before that
        // migration a Cc'd person still receives the message - shown as To.
        if (ccIds.length > 0 && (await ccInstalled())) {
          await (tx as unknown as RawClient).$executeRaw`UPDATE communication_recipients SET is_cc = true WHERE communication_id = ${id} AND user_id = ANY(${ccIds}::text[])`;
        }
        // Forward (column forwarded_from_id, migration 20261025120000_communication_forwarded).
        // Before that migration a forward is sent unlabelled.
        if (forwardedFromId && (await forwardInstalled())) {
          await (tx as unknown as RawClient).$executeRaw`UPDATE communications SET forwarded_from_id = ${forwardedFromId} WHERE id = ${id}`;
        }
        if (attachments.length > 0) {
          await tx.communicationAttachment.updateMany({ where: { id: { in: attachments.map((a) => a.id) } }, data: { communicationId: id } });
        }
      },
    }
  );
  await recordAttempt(sendKey, SEND_LIMIT);
  if (toAll) await recordAttempt(allKey, SEND_ALL_LIMIT);
  return { ok: true, value: { id, recipients: recipients.length } };
}

// ---------------------------------------------------------------------------
// Lists

const textFilter = (q: string | undefined) =>
  q?.trim()
    ? {
        OR: [
          { subject: { contains: q.trim(), mode: "insensitive" as const } },
          { senderName: { contains: q.trim(), mode: "insensitive" as const } },
          { body: { contains: q.trim(), mode: "insensitive" as const } },
        ],
      }
    : {};

export async function listInbox(session: Session, opts: { page: number; pageSize: number; q?: string }): Promise<Result<{ items: InboxItem[]; total: number }>> {
  if (!canUseCommunications(session)) return fail(403, NOT_ALLOWED);
  const where = { userId: session.userId!, removedAt: null, communication: { withdrawnAt: null, ...textFilter(opts.q) } };
  const [rows, total] = await Promise.all([
    prisma.communicationRecipient.findMany({
      where,
      include: { communication: { include: { _count: { select: { attachments: true } } } } },
      orderBy: { communication: { createdAt: "desc" } },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
    }),
    prisma.communicationRecipient.count({ where }),
  ]);
  const forwards = await forwardedIds(rows.map((r) => r.communication.id));
  return {
    ok: true,
    value: {
      total,
      items: rows.map((r) => ({
        id: r.communication.id,
        threadId: r.communication.threadId,
        subject: r.communication.subject,
        preview: previewOf(r.communication.body, 140),
        senderName: r.communication.senderName,
        createdAt: r.communication.createdAt.toISOString(),
        readAt: r.readAt?.toISOString() ?? null,
        attachmentCount: r.communication._count.attachments,
        isReply: r.communication.parentId !== null,
        forwarded: forwards.has(r.communication.id),
      })),
    },
  };
}

async function readCounts(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const groups = await prisma.communicationRecipient.groupBy({ by: ["communicationId"], where: { communicationId: { in: ids }, readAt: { not: null } }, _count: { _all: true } });
  return new Map(groups.map((g) => [g.communicationId, g._count._all]));
}

export async function listSent(session: Session, opts: { page: number; pageSize: number; q?: string }): Promise<Result<{ items: SentItem[]; total: number }>> {
  if (!canUseCommunications(session)) return fail(403, NOT_ALLOWED);
  const where = { senderId: session.userId!, ...textFilter(opts.q) };
  const [rows, total] = await Promise.all([
    prisma.communication.findMany({
      where,
      include: {
        _count: { select: { recipients: true, attachments: true } },
        recipients: { select: { userName: true }, orderBy: { userName: "asc" }, take: 3 },
      },
      orderBy: { createdAt: "desc" },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
    }),
    prisma.communication.count({ where }),
  ]);
  const [reads, forwards] = await Promise.all([readCounts(rows.map((r) => r.id)), forwardedIds(rows.map((r) => r.id))]);
  return {
    ok: true,
    value: {
      total,
      items: rows.map((r) => ({
        id: r.id,
        threadId: r.threadId,
        subject: r.subject,
        preview: previewOf(r.body, 140),
        toAll: r.toAll,
        recipientCount: r._count.recipients,
        readCount: reads.get(r.id) ?? 0,
        recipientNames: r.recipients.map((x) => x.userName),
        createdAt: r.createdAt.toISOString(),
        withdrawnAt: r.withdrawnAt?.toISOString() ?? null,
        attachmentCount: r._count.attachments,
        forwarded: forwards.has(r.id),
      })),
    },
  };
}

export async function unreadCount(session: Session): Promise<number> {
  if (!canUseCommunications(session)) return 0;
  return prisma.communicationRecipient.count({ where: { userId: session.userId!, readAt: null, removedAt: null, communication: { withdrawnAt: null } } });
}

// ---------------------------------------------------------------------------
// A conversation

/**
 * The conversation a message belongs to, as this viewer may see it: the
 * messages they sent or received (a withdrawn one only to its sender).
 * Opening it marks the viewer's received messages - and their bell
 * notifications - as read.
 */
export async function openThread(session: Session, messageId: string): Promise<Result<ThreadView>> {
  if (!canUseCommunications(session)) return fail(403, NOT_ALLOWED);
  const viewerId = session.userId!;
  const opened = await prisma.communication.findUnique({ where: { id: messageId }, select: { threadId: true } });
  if (!opened) return fail(404, "Message not found");

  const messages = await prisma.communication.findMany({
    where: { threadId: opened.threadId },
    include: { attachments: { orderBy: { createdAt: "asc" } }, _count: { select: { recipients: true } } },
    orderBy: { createdAt: "asc" },
  });
  const mine = await prisma.communicationRecipient.findMany({ where: { userId: viewerId, communicationId: { in: messages.map((m) => m.id) } } });
  const received = new Set(mine.map((r) => r.communicationId));
  const visible = messages.filter((m) => m.senderId === viewerId || (received.has(m.id) && !m.withdrawnAt));
  if (!visible.some((m) => m.id === messageId)) return fail(404, "Message not found");

  const reads = await readCounts(visible.filter((m) => m.senderId === viewerId).map((m) => m.id));
  const names = new Map<string, { to: string[]; cc: string[]; ccCount: number }>();
  const withCc = await ccInstalled();
  const forwards = await forwardedIds(visible.map((m) => m.id));
  for (const m of visible) {
    if (withCc) {
      const rows = await (prisma as unknown as RawClient).$queryRaw<{ name: string; cc: boolean }[]>`
        (SELECT user_name AS name, false AS cc FROM communication_recipients WHERE communication_id = ${m.id} AND is_cc = false ORDER BY user_name LIMIT ${RECIPIENT_NAMES_SHOWN})
        UNION ALL
        (SELECT user_name AS name, true AS cc FROM communication_recipients WHERE communication_id = ${m.id} AND is_cc = true ORDER BY user_name LIMIT ${RECIPIENT_NAMES_SHOWN})`;
      const counted = await (prisma as unknown as RawClient).$queryRaw<{ n: bigint | number }[]>`SELECT count(*) AS n FROM communication_recipients WHERE communication_id = ${m.id} AND is_cc = true`;
      names.set(m.id, { to: rows.filter((r) => !r.cc).map((r) => r.name), cc: rows.filter((r) => r.cc).map((r) => r.name), ccCount: Number(counted[0]?.n ?? 0) });
    } else {
      const rows = await prisma.communicationRecipient.findMany({ where: { communicationId: m.id }, select: { userName: true }, orderBy: { userName: "asc" }, take: RECIPIENT_NAMES_SHOWN });
      names.set(m.id, { to: rows.map((r) => r.userName), cc: [], ccCount: 0 });
    }
  }

  const toMark = mine.filter((r) => !r.readAt && visible.some((m) => m.id === r.communicationId)).map((r) => r.communicationId);
  if (toMark.length > 0) {
    const now = new Date();
    await prisma.communicationRecipient.updateMany({ where: { userId: viewerId, communicationId: { in: toMark }, readAt: null }, data: { readAt: now } });
    await prisma.notification.updateMany({ where: { recipientUserId: viewerId, entityType: "Communication", entityId: { in: toMark }, readAt: null }, data: { readAt: now } });
  }

  const now = Date.now();
  const view: MessageView[] = visible.map((m) => {
    const readCount = reads.get(m.id) ?? 0;
    const createdAt = m.createdAt.toISOString();
    const withdrawnAt = m.withdrawnAt?.toISOString() ?? null;
    return {
      id: m.id,
      threadId: m.threadId,
      parentId: m.parentId,
      senderId: m.senderId,
      senderName: m.senderName,
      subject: m.subject,
      body: m.body,
      // Sanitised again on the way out, so nothing stored can ever render unsafely.
      bodyHtml: m.bodyHtml ? sanitizeMessageHtml(m.bodyHtml) : null,
      toAll: m.toAll,
      forwarded: forwards.has(m.id),
      forwardedFrom: forwards.get(m.id) ?? null,
      createdAt,
      withdrawnAt,
      recipientCount: m._count.recipients,
      recipientNames: names.get(m.id)?.to ?? [],
      ccNames: names.get(m.id)?.cc ?? [],
      ccCount: names.get(m.id)?.ccCount ?? 0,
      attachments: m.attachments.map(toAttachmentInfo),
      mine: m.senderId === viewerId,
      canWithdraw: canWithdraw({ senderId: m.senderId, createdAt, withdrawnAt }, viewerId, readCount, now),
      readCount,
    };
  });
  return { ok: true, value: { threadId: opened.threadId, subject: visible[0].subject, messages: view, openedId: messageId } };
}

function toAttachmentInfo(a: { id: string; fileName: string; mimeType: string; size: number }): AttachmentInfo {
  return { id: a.id, fileName: a.fileName, mimeType: a.mimeType, size: a.size };
}

// ---------------------------------------------------------------------------
// Withdraw / remove

/** The sender takes a message back (within LIMITS.withdrawMinutes, unread). Its waiting emails are cancelled. */
export async function withdrawMessage(session: Session, messageId: string): Promise<Result<null>> {
  if (!canUseCommunications(session)) return fail(403, NOT_ALLOWED);
  const message = await prisma.communication.findUnique({ where: { id: messageId } });
  if (!message || message.senderId !== session.userId) return fail(404, "Message not found");
  const reads = (await readCounts([message.id])).get(message.id) ?? 0;
  if (!canWithdraw({ senderId: message.senderId, createdAt: message.createdAt.toISOString(), withdrawnAt: message.withdrawnAt?.toISOString() ?? null }, session.userId!, reads)) {
    return fail(409, reads > 0 ? "Someone has already opened this message - it can't be withdrawn" : `A message can only be withdrawn within ${LIMITS.withdrawMinutes} minutes of sending it`);
  }
  const notifications = await prisma.notification.findMany({ where: { entityType: "Communication", entityId: message.id }, select: { id: true } });
  const notificationIds = notifications.map((n) => n.id);
  await updateDb(
    (current) => {
      // The bell entries go; the emails that haven't left yet are cancelled below.
      current.notifications = current.notifications.filter((n) => !(n.entityType === "Communication" && n.entityId === message.id));
      appendAuditLog(current, {
        userId: session.userId!,
        userName: session.name ?? "",
        action: "COMMUNICATION_WITHDRAWN",
        entityType: "Communication",
        entityId: message.id,
        newValue: { subject: message.subject },
      });
    },
    {
      alsoWrite: async (tx) => {
        await tx.communication.update({ where: { id: message.id }, data: { withdrawnAt: new Date() } });
        if (notificationIds.length > 0) {
          await tx.emailOutbox.updateMany({
            where: { notificationId: { in: notificationIds }, status: { in: ["PENDING", "QUEUED", "FAILED"] } },
            data: { status: "CANCELLED", lastError: "Message withdrawn by its sender" },
          });
        }
      },
    }
  );
  return { ok: true, value: null };
}

/** A recipient removes a message from their own Inbox (nobody else's copy changes). */
export async function removeFromInbox(session: Session, messageId: string): Promise<Result<null>> {
  if (!canUseCommunications(session)) return fail(403, NOT_ALLOWED);
  const result = await prisma.communicationRecipient.updateMany({ where: { communicationId: messageId, userId: session.userId!, removedAt: null }, data: { removedAt: new Date() } });
  if (result.count === 0) return fail(404, "Message not found");
  return { ok: true, value: null };
}

// ---------------------------------------------------------------------------
// Attachments

/** Stores one file for a message about to be sent (one request per file keeps each upload within the per-file limit, LIMITS.attachmentBytes). */
export async function uploadAttachment(session: Session, file: { name: string; type: string; size: number }, content: Buffer): Promise<Result<AttachmentInfo>> {
  if (!canSendCommunications(session)) return fail(403, NOT_ALLOWED);
  const key = `communications-upload:${session.userId}`;
  const limited = await isRateLimited(key, UPLOAD_LIMIT);
  if (limited.limited) return fail(429, `Too many uploads - try again in ${Math.ceil(limited.retryAfterSeconds / 60)} minute(s)`);
  const problem = attachmentProblem(file, content);
  if (problem) return fail(400, problem);

  await removeStalePending(session.userId!);
  const storagePath = newStoredName(ATTACHMENT_TYPES[file.type].extension);
  writeStoredFile("communications", storagePath, content);
  try {
    const row = await prisma.communicationAttachment.create({
      data: { id: uuid(), communicationId: null, uploadedBy: session.userId!, fileName: file.name.slice(0, 255), mimeType: file.type, size: file.size, storagePath, createdAt: new Date() },
    });
    await recordAttempt(key, UPLOAD_LIMIT);
    return { ok: true, value: toAttachmentInfo(row) };
  } catch (err) {
    deleteStoredFile("communications", storagePath);
    throw err;
  }
}

/** Removes an attachment the user uploaded but hasn't sent (e.g. picked by mistake). */
export async function deletePendingAttachment(session: Session, attachmentId: string): Promise<Result<null>> {
  if (!canUseCommunications(session)) return fail(403, NOT_ALLOWED);
  const row = await prisma.communicationAttachment.findFirst({ where: { id: attachmentId, uploadedBy: session.userId!, communicationId: null } });
  if (!row) return fail(404, "Attachment not found");
  await prisma.communicationAttachment.delete({ where: { id: row.id } });
  deleteStoredFile("communications", row.storagePath);
  return { ok: true, value: null };
}

async function removeStalePending(userId: string): Promise<void> {
  const stale = await prisma.communicationAttachment.findMany({ where: { uploadedBy: userId, communicationId: null, createdAt: { lt: new Date(Date.now() - PENDING_UPLOAD_TTL_MS) } } });
  if (stale.length === 0) return;
  await prisma.communicationAttachment.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  for (const s of stale) deleteStoredFile("communications", s.storagePath);
}

/** A file of a message the viewer sent or received (and that isn't withdrawn, unless they sent it). Recorded in the audit log. */
export async function downloadAttachment(session: Session, attachmentId: string): Promise<Result<{ fileName: string; mimeType: string; content: Buffer }>> {
  if (!canUseCommunications(session)) return fail(403, NOT_ALLOWED);
  const viewerId = session.userId!;
  const row = await prisma.communicationAttachment.findUnique({ where: { id: attachmentId }, include: { communication: true } });
  if (!row) return fail(404, "Attachment not found");
  const message = row.communication;
  if (!message) {
    if (row.uploadedBy !== viewerId) return fail(404, "Attachment not found");
  } else if (message.senderId !== viewerId) {
    const isRecipient = await prisma.communicationRecipient.count({ where: { communicationId: message.id, userId: viewerId } });
    if (!isRecipient || message.withdrawnAt) return fail(404, "Attachment not found");
  }
  const content = readStoredFile("communications", row.storagePath);
  if (!content) return fail(404, "The file is missing from storage");
  await updateDb((current) => {
    appendAuditLog(current, {
      userId: viewerId,
      userName: session.name ?? "",
      action: "COMMUNICATION_ATTACHMENT_DOWNLOAD",
      entityType: "Communication",
      entityId: message?.id ?? row.id,
      newValue: { fileName: row.fileName, subject: message?.subject ?? null },
    });
  });
  return { ok: true, value: { fileName: row.fileName, mimeType: row.mimeType, content } };
}

// ---------------------------------------------------------------------------
// Recipient picker

/** Everyone a message can be sent to, plus the roles, districts and branches to pick whole groups by. */
export async function directory(session: Session): Promise<Result<Directory>> {
  if (!canSendCommunications(session)) return fail(403, NOT_ALLOWED);
  const db = await readDb();
  const users = eligibleRecipients(db, session.userId!);
  const roleName = new Map(db.roles.map((r) => [r.code, r.name]));
  const districtName = new Map(db.districts.map((d) => [d.id, d.name]));
  const branchName = new Map(db.branches.map((b) => [b.id, b.name]));
  return {
    ok: true,
    value: {
      users: users
        .map((u) => ({
          id: u.id,
          name: u.name,
          roleCode: u.role,
          districtId: u.districtId ?? null,
          branchId: u.branchId ?? null,
          roleName: roleName.get(u.role) ?? u.role,
          districtName: u.districtId ? (districtName.get(u.districtId) ?? null) : null,
          branchName: u.branchId ? (branchName.get(u.branchId) ?? null) : null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      // Every active role except Administrator (administrators never receive
      // messages) - including a role nobody holds yet, which shows 0 people.
      roles: db.roles
        .filter((r) => r.status === "ACTIVE" && r.code !== ADMIN_ROLE_CODE)
        .map((r) => ({ code: r.code, name: r.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      districts: db.districts.filter((d) => d.status === "ACTIVE").map((d) => ({ id: d.id, name: d.name })).sort((a, b) => a.name.localeCompare(b.name)),
      branches: db.branches.filter((b) => b.status === "ACTIVE").map((b) => ({ id: b.id, name: b.name, districtId: b.districtId })).sort((a, b) => a.name.localeCompare(b.name)),
    },
  };
}

// ---------------------------------------------------------------------------
// Forward

/** What the New message form starts with when forwarding a message. */
export interface ForwardDraft {
  subject: string;
  bodyHtml: string;
  /** The original's files, copied as this user's pending attachments (removable before sending). */
  attachments: AttachmentInfo[];
}

/**
 * Forward a message the viewer can read (its sender, or a recipient while it
 * isn't withdrawn): the same subject, the original message as the body, and its files copied
 * as the forwarder's own pending attachments - so the normal Send (its
 * recipients, limits and checks) does the rest. Files that can't be read or
 * wouldn't fit the limits are left out.
 */
/** Names for a forward's header: the first 20, then "and N more". */
function names(rows: { userName: string }[]): string {
  const shown = rows.slice(0, 20).map((r) => r.userName).join(", ");
  return rows.length > 20 ? `${shown} and ${rows.length - 20} more` : shown;
}

export async function forwardDraft(session: Session, messageId: string): Promise<Result<ForwardDraft>> {
  if (!canSendCommunications(session)) return fail(403, NOT_ALLOWED);
  const viewerId = session.userId!;
  const m = await prisma.communication.findUnique({ where: { id: messageId }, include: { attachments: { orderBy: { createdAt: "asc" } } } });
  if (!m) return fail(404, "Message not found");
  if (m.senderId !== viewerId) {
    const isRecipient = await prisma.communicationRecipient.count({ where: { communicationId: m.id, userId: viewerId } });
    if (!isRecipient || m.withdrawnAt) return fail(404, "Message not found");
  }

  // Copy the files (each a new stored copy, so removing one from the forward never touches the original).
  await removeStalePending(viewerId);
  const attachments: AttachmentInfo[] = [];
  let bytes = 0;
  for (const a of m.attachments) {
    if (attachments.length >= LIMITS.attachments || bytes + a.size > LIMITS.attachmentBytes) break;
    const content = readStoredFile("communications", a.storagePath);
    if (!content) continue;
    const storagePath = newStoredName(ATTACHMENT_TYPES[a.mimeType]?.extension ?? a.storagePath.split(".").pop() ?? "bin");
    writeStoredFile("communications", storagePath, content);
    try {
      const row = await prisma.communicationAttachment.create({
        data: { id: uuid(), communicationId: null, uploadedBy: viewerId, fileName: a.fileName, mimeType: a.mimeType, size: a.size, storagePath, createdAt: new Date() },
      });
      attachments.push(toAttachmentInfo(row));
      bytes += a.size;
    } catch (err) {
      deleteStoredFile("communications", storagePath);
      throw err;
    }
  }

  // Its To / Cc for the header (Cc: column is_cc, once installed).
  const people = (await ccInstalled())
    ? await (prisma as unknown as RawClient).$queryRaw<{ userName: string; cc: boolean }[]>`
        SELECT user_name AS "userName", is_cc AS cc FROM communication_recipients WHERE communication_id = ${m.id} ORDER BY user_name`
    : (await prisma.communicationRecipient.findMany({ where: { communicationId: m.id }, select: { userName: true }, orderBy: { userName: "asc" } })).map((r) => ({ userName: r.userName, cc: false }));

  return {
    ok: true,
    value: {
      // The same subject, and the original message itself as the body
      // (formatting kept; a plain-text message as paragraphs).
      subject: m.subject.slice(0, LIMITS.subject),
      // Where it came from (From / Sent / To / Cc / Subject), then the original.
      bodyHtml:
        forwardHeaderHtml({
          senderName: m.senderName,
          sentAt: formatDateTime(m.createdAt.toISOString()),
          to: m.toAll ? "All users" : names(people.filter((r) => !r.cc)),
          cc: people.some((r) => r.cc) ? names(people.filter((r) => r.cc)) : null,
          subject: m.subject,
        }) + originalBodyHtml({ bodyHtml: m.bodyHtml ? sanitizeMessageHtml(m.bodyHtml) : null, body: m.body }),
      attachments,
    },
  };
}
