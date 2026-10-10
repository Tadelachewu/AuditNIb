/**
 * Email queue (docs/email-queue.md) - types and constants. Client-safe.
 *
 * Notification emails are written to the email_outbox table in the same
 * transaction as the notification that caused them, then delivered by the
 * worker with retries. Forgot-password and the Settings test email stay
 * synchronous (src/lib/mail.ts) - the user needs their result at once.
 */

/**
 * PENDING  waiting for its (next) attempt - the outbox schedules it
 * QUEUED   handed to BullMQ, waiting for a worker (BullMQ driver only)
 * SENDING  a worker holds it right now
 */
export type OutboxStatus = "PENDING" | "QUEUED" | "SENDING" | "SENT" | "FAILED" | "CANCELLED";

/** How due emails reach the mail server: the built-in Postgres worker, or BullMQ on Redis. */
export type EmailQueueDriver = "postgres" | "bullmq";

/** An email decided on inside an updateDb() mutator, inserted when that transaction commits. */
export interface QueuedEmail {
  id: string;
  kind: "NOTIFICATION";
  notificationId: string;
  notificationType: string;
  recipientUserId: string;
  toAddress: string;
  fromAddress: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  /** Unique - the same email can never be queued twice. */
  dedupeKey: string;
  priority: number;
  maxAttempts: number;
  /** ISO time after which it is no longer worth sending. */
  expiresAt: string;
}

/** A claimed outbox row, as the worker sees it. */
export interface OutboxRow {
  id: string;
  notificationType: string | null;
  toAddress: string;
  fromAddress: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  /** Already counts this attempt. */
  attempts: number;
  maxAttempts: number;
  expiresAt: string | null;
}

export interface EmailQueueState {
  paused: boolean;
  pausedReason: string | null;
  pausedAt: string | null;
  pausedBy: string | null;
  lastRunAt: string | null;
  lastRunBy: string | null;
}

/** What one attempt to send ended as. */
export type SendOutcome =
  | { kind: "sent"; messageId: string | null }
  /** Worth retrying: connection, timeout, 4xx, throttling. */
  | { kind: "transient"; error: string }
  /** The mail server refused this message for good (5xx, bad address). */
  | { kind: "permanent"; error: string }
  /** Our own credentials / configuration - every email would fail the same way. */
  | { kind: "config"; error: string };

export interface ProcessResult {
  /** Why nothing was processed, when that is the case. */
  skipped?: "not-installed" | "paused" | "breaker" | "not-configured" | "busy";
  /** BullMQ driver: emails handed to the queue in this pass. */
  handedOff?: number;
  /** BullMQ driver: Redis was unreachable, so this pass was delivered by the Postgres worker. */
  redisFallback?: boolean;
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
}

/** Admin view (GET /api/admin/email-queue). */
export interface EmailQueueStatus {
  installed: boolean;
  configured: boolean;
  configProblem: string | null;
  workerMode: "inprocess" | "external";
  driver: EmailQueueDriver;
  /** BullMQ driver only: is Redis reachable, and what BullMQ holds. */
  redis: { ok: boolean; waiting: number; active: number; delayed: number } | null;
  state: EmailQueueState;
  counts: Record<OutboxStatus, number>;
  sentToday: number;
  /** ISO time the oldest email still waiting was queued. */
  oldestPendingAt: string | null;
  failed: {
    id: string;
    toAddress: string;
    subject: string;
    notificationType: string | null;
    attempts: number;
    lastError: string | null;
    createdAt: string;
  }[];
  /** Emails sent today, newest first (at most SENT_TODAY_LIMIT; `sentToday` is the full count). */
  sent: {
    id: string;
    toAddress: string;
    subject: string;
    notificationType: string | null;
    attempts: number;
    /** When it was queued (the action happened). */
    createdAt: string;
    /** When the mail server accepted it. */
    sentAt: string;
  }[];
}

/** How many of today's sent emails the admin view lists. */
export const SENT_TODAY_LIMIT = 100;
