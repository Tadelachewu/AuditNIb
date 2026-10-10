import { prisma } from "@/lib/prismaClient";
import type { Prisma } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import { STUCK_AFTER_MS, type RowUpdate } from "./rules";
import { SENT_TODAY_LIMIT, type EmailQueueState, type EmailQueueStatus, type OutboxRow, type OutboxStatus, type QueuedEmail } from "./types";

/**
 * Storage of the email queue - its own two tables (email_outbox,
 * email_queue_state), nothing else. The worker depends on this interface,
 * not on Prisma, so it is tested without a database.
 */
export interface EmailQueueStore {
  /** false = the tables don't exist yet (migration not applied): callers fall back to sending directly. */
  isInstalled(): Promise<boolean>;
  /** Adds queued emails inside the caller's open transaction (`tx`), so they commit with what caused them. */
  insert(emails: QueuedEmail[], tx: unknown): Promise<void>;
  /** Releases rows a dead worker left SENDING and cancels expired ones. */
  recover(now: number): Promise<void>;
  /** Takes up to `limit` due rows for this worker (never a row another worker holds) and counts the attempt. */
  claim(workerId: string, limit: number): Promise<OutboxRow[]>;
  apply(id: string, update: RowUpdate): Promise<void>;
  // BullMQ driver ----------------------------------------------------------
  /** Marks up to `limit` due rows QUEUED (handed to BullMQ) and returns them. The attempt is counted when a worker takes it. */
  handOff(workerId: string, limit: number): Promise<{ id: string; priority: number }[]>;
  /** A BullMQ worker takes one QUEUED row (-> SENDING, attempt counted). null = it is no longer QUEUED: skip. */
  claimQueued(id: string, workerId: string): Promise<OutboxRow | null>;
  /** QUEUED rows back to PENDING (hand-off failed, or the job is gone from Redis). */
  releaseQueued(ids: string[], reason: string, nextAttemptAt?: number): Promise<void>;
  /** Ids of rows QUEUED since before `before` - to check against Redis. */
  staleQueued(before: number, limit: number): Promise<string[]>;
  /** Marks rows as just checked, so they aren't checked again on every pass. */
  touchQueued(ids: string[]): Promise<void>;
  getState(): Promise<EmailQueueState>;
  setPaused(paused: boolean, reason: string | null, by: string): Promise<EmailQueueState>;
  recordRun(by: string): Promise<void>;
  /** Blanks the bodies of old sent emails and deletes very old finished rows. */
  cleanup(now: number): Promise<void>;
}

const SINGLETON = "singleton";
const EMPTY_STATE: EmailQueueState = { paused: false, pausedReason: null, pausedAt: null, pausedBy: null, lastRunAt: null, lastRunBy: null };

/** Bodies of sent emails are blanked after this; finished rows are deleted after RETENTION_DELETE_MS. */
const RETENTION_BLANK_MS = 7 * 86_400_000;
const RETENTION_DELETE_MS = 90 * 86_400_000;

function isMissingTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2021";
}

function toState(r: { paused: boolean; pausedReason: string | null; pausedAt: Date | null; pausedBy: string | null; lastRunAt: Date | null; lastRunBy: string | null }): EmailQueueState {
  return {
    paused: r.paused,
    pausedReason: r.pausedReason,
    pausedAt: r.pausedAt?.toISOString() ?? null,
    pausedBy: r.pausedBy,
    lastRunAt: r.lastRunAt?.toISOString() ?? null,
    lastRunBy: r.lastRunBy,
  };
}

// Whether the tables exist - asked once, then remembered. A "no" is asked
// again after a minute, so applying the migration needs no restart.
let installed: boolean | null = null;
let installedCheckedAt = 0;
let warnedMissing = false;

interface ClaimedRow {
  id: string;
  notification_type: string | null;
  to_address: string;
  from_address: string;
  subject: string;
  body_text: string;
  body_html: string;
  attempts: number;
  max_attempts: number;
  expires_at: Date | null;
}

function toOutboxRow(r: ClaimedRow): OutboxRow {
  return {
    id: r.id,
    notificationType: r.notification_type,
    toAddress: r.to_address,
    fromAddress: r.from_address,
    subject: r.subject,
    bodyText: r.body_text,
    bodyHtml: r.body_html,
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
  };
}

export const prismaEmailQueueStore: EmailQueueStore = {
  async isInstalled() {
    if (installed === true) return true;
    if (installed === false && Date.now() - installedCheckedAt < 60_000) return false;
    installedCheckedAt = Date.now();
    try {
      const rows = await prisma.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('email_outbox') IS NOT NULL AS ok`;
      installed = rows[0]?.ok === true;
    } catch {
      installed = false;
    }
    if (!installed && !warnedMissing) {
      warnedMissing = true;
      logger.warn(
        { event: "email_queue.not_installed" },
        "Email queue tables are missing - apply prisma/migrations/20261010120000_email_outbox (docs/email-queue.md). Until then emails are sent directly, without retries."
      );
    }
    return installed;
  },

  async insert(emails, tx) {
    if (emails.length === 0) return;
    await (tx as Prisma.TransactionClient).emailOutbox.createMany({
      data: emails.map((e) => ({
        id: e.id,
        kind: e.kind,
        notificationId: e.notificationId,
        notificationType: e.notificationType,
        recipientUserId: e.recipientUserId,
        toAddress: e.toAddress,
        fromAddress: e.fromAddress,
        subject: e.subject,
        bodyText: e.bodyText,
        bodyHtml: e.bodyHtml,
        dedupeKey: e.dedupeKey,
        priority: e.priority,
        maxAttempts: e.maxAttempts,
        expiresAt: new Date(e.expiresAt),
      })),
      skipDuplicates: true,
    });
  },

  async recover(now) {
    const stuckBefore = new Date(now - STUCK_AFTER_MS);
    const at = new Date(now);
    await prisma.emailOutbox.updateMany({
      where: { status: "SENDING", lockedAt: { lt: stuckBefore } },
      data: { status: "PENDING", lockedAt: null, lockedBy: null, lastError: "The worker stopped while sending - retried" },
    });
    await prisma.emailOutbox.updateMany({
      where: { status: "PENDING", expiresAt: { lt: at } },
      data: { status: "CANCELLED", lastError: "Expired before it could be sent" },
    });
  },

  async claim(workerId, limit) {
    // One statement: pick due rows nobody else holds (SKIP LOCKED) and mark
    // them ours - two workers can never take the same email.
    const rows = await prisma.$queryRaw<ClaimedRow[]>`
      UPDATE email_outbox
         SET status = 'SENDING', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1
       WHERE id IN (
             SELECT id FROM email_outbox
              WHERE status = 'PENDING' AND next_attempt_at <= now()
              ORDER BY priority DESC, created_at ASC
              LIMIT ${limit}
                FOR UPDATE SKIP LOCKED)
      RETURNING id, notification_type, to_address, from_address, subject, body_text, body_html, attempts, max_attempts, expires_at`;
    return rows.map(toOutboxRow);
  },

  async handOff(workerId, limit) {
    const rows = await prisma.$queryRaw<{ id: string; priority: number }[]>`
      UPDATE email_outbox
         SET status = 'QUEUED', locked_at = now(), locked_by = ${workerId}
       WHERE id IN (
             SELECT id FROM email_outbox
              WHERE status = 'PENDING' AND next_attempt_at <= now()
              ORDER BY priority DESC, created_at ASC
              LIMIT ${limit}
                FOR UPDATE SKIP LOCKED)
      RETURNING id, priority`;
    return rows.map((r) => ({ id: r.id, priority: Number(r.priority) }));
  },

  async claimQueued(id, workerId) {
    const rows = await prisma.$queryRaw<ClaimedRow[]>`
      UPDATE email_outbox
         SET status = 'SENDING', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1
       WHERE id = ${id} AND status = 'QUEUED'
      RETURNING id, notification_type, to_address, from_address, subject, body_text, body_html, attempts, max_attempts, expires_at`;
    return rows[0] ? toOutboxRow(rows[0]) : null;
  },

  async releaseQueued(ids, reason, nextAttemptAt) {
    if (ids.length === 0) return;
    await prisma.emailOutbox.updateMany({
      where: { id: { in: ids }, status: "QUEUED" },
      data: { status: "PENDING", lockedAt: null, lockedBy: null, lastError: reason, ...(nextAttemptAt ? { nextAttemptAt: new Date(nextAttemptAt) } : {}) },
    });
  },

  async staleQueued(before, limit) {
    const rows = await prisma.emailOutbox.findMany({ where: { status: "QUEUED", lockedAt: { lt: new Date(before) } }, orderBy: { lockedAt: "asc" }, take: limit, select: { id: true } });
    return rows.map((r) => r.id);
  },

  async touchQueued(ids) {
    if (ids.length === 0) return;
    await prisma.emailOutbox.updateMany({ where: { id: { in: ids }, status: "QUEUED" }, data: { lockedAt: new Date() } });
  },

  async apply(id, update) {
    const unlock = { lockedAt: null, lockedBy: null };
    if (update.status === "SENT") {
      await prisma.emailOutbox.update({ where: { id }, data: { ...unlock, status: "SENT", sentAt: new Date(), smtpMessageId: update.messageId, lastError: null } });
    } else if (update.status === "PENDING") {
      await prisma.emailOutbox.update({
        where: { id },
        data: {
          ...unlock,
          status: "PENDING",
          nextAttemptAt: new Date(update.nextAttemptAt),
          lastError: update.error,
          ...(update.refundAttempt ? { attempts: { decrement: 1 } } : {}),
        },
      });
    } else {
      await prisma.emailOutbox.update({ where: { id }, data: { ...unlock, status: update.status, lastError: update.error } });
    }
  },

  async getState() {
    try {
      const row = await prisma.emailQueueState.findUnique({ where: { id: SINGLETON } });
      return row ? toState(row) : { ...EMPTY_STATE };
    } catch (err) {
      if (isMissingTable(err)) return { ...EMPTY_STATE };
      throw err;
    }
  },

  async setPaused(paused, reason, by) {
    const data = paused ? { paused: true, pausedReason: reason, pausedAt: new Date(), pausedBy: by } : { paused: false, pausedReason: null, pausedAt: null, pausedBy: null };
    const row = await prisma.emailQueueState.upsert({ where: { id: SINGLETON }, create: { id: SINGLETON, ...data }, update: data });
    return toState(row);
  },

  async recordRun(by) {
    const data = { lastRunAt: new Date(), lastRunBy: by };
    await prisma.emailQueueState.upsert({ where: { id: SINGLETON }, create: { id: SINGLETON, ...data }, update: data });
  },

  async cleanup(now) {
    await prisma.emailOutbox.updateMany({
      where: { status: "SENT", sentAt: { lt: new Date(now - RETENTION_BLANK_MS) }, NOT: { bodyText: "" } },
      data: { bodyText: "", bodyHtml: "" },
    });
    await prisma.emailOutbox.deleteMany({ where: { status: { in: ["SENT", "CANCELLED"] }, createdAt: { lt: new Date(now - RETENTION_DELETE_MS) } } });
    await prisma.emailOutbox.deleteMany({ where: { status: "FAILED", createdAt: { lt: new Date(now - 2 * RETENTION_DELETE_MS) } } });
  },
};

// ---------------------------------------------------------------------------
// Admin (Settings -> Email Queue)

const STATUSES: OutboxStatus[] = ["PENDING", "QUEUED", "SENDING", "SENT", "FAILED", "CANCELLED"];

export async function queueCounts(): Promise<Pick<EmailQueueStatus, "counts" | "sentToday" | "oldestPendingAt" | "failed" | "sent">> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [grouped, sentToday, oldest, failed, sent] = await Promise.all([
    prisma.emailOutbox.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.emailOutbox.count({ where: { status: "SENT", sentAt: { gte: startOfDay } } }),
    prisma.emailOutbox.findFirst({ where: { status: { in: ["PENDING", "QUEUED", "SENDING"] } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.emailOutbox.findMany({
      where: { status: "FAILED" },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, toAddress: true, subject: true, notificationType: true, attempts: true, lastError: true, createdAt: true },
    }),
    prisma.emailOutbox.findMany({
      where: { status: "SENT", sentAt: { gte: startOfDay } },
      orderBy: { sentAt: "desc" },
      take: SENT_TODAY_LIMIT,
      select: { id: true, toAddress: true, subject: true, notificationType: true, attempts: true, createdAt: true, sentAt: true },
    }),
  ]);
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<OutboxStatus, number>;
  for (const g of grouped) if (g.status in counts) counts[g.status as OutboxStatus] = g._count._all;
  return {
    counts,
    sentToday,
    oldestPendingAt: oldest?.createdAt.toISOString() ?? null,
    failed: failed.map((f) => ({ ...f, createdAt: f.createdAt.toISOString() })),
    sent: sent.map((e) => ({ ...e, createdAt: e.createdAt.toISOString(), sentAt: (e.sentAt ?? e.createdAt).toISOString() })),
  };
}

/** Puts failed emails back in the queue with a fresh set of attempts and expiry. Returns how many. */
export async function requeueFailed(id: string | "all", expiresAt: Date): Promise<number> {
  const result = await prisma.emailOutbox.updateMany({
    where: { status: "FAILED", ...(id === "all" ? {} : { id }) },
    data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), expiresAt, lastError: null, lockedAt: null, lockedBy: null },
  });
  return result.count;
}

/** Cancels emails that haven't been sent (waiting or failed). Returns how many. */
export async function cancelQueued(id: string): Promise<number> {
  const result = await prisma.emailOutbox.updateMany({
    where: { id, status: { in: ["PENDING", "QUEUED", "FAILED"] } },
    data: { status: "CANCELLED", lastError: "Cancelled by an administrator" },
  });
  return result.count;
}
