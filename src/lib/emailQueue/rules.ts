import { isEmailEnabled } from "@/lib/notificationEvents";
import type { Database, Notification, NotificationSettings } from "@/types";
import type { OutboxRow, QueuedEmail, SendOutcome } from "./types";

/**
 * Pure rules of the email queue (docs/email-queue.md): is email configured,
 * what an email looks like, when to retry and when to give up. No storage,
 * no SMTP - unit-tested in tests/emailQueue.test.ts.
 */

/** Attempts before an email is FAILED: the first try plus five retries, spread over about 5.5 hours (EMAIL_MAX_ATTEMPTS overrides, 1-7). */
export const DEFAULT_MAX_ATTEMPTS = 6;
/** Wait before retry N (after attempt N failed). */
export const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 4 * 60 * 60_000, 12 * 60 * 60_000];
/** A notification email older than this is cancelled instead of sent. */
export const EXPIRY_MS = 72 * 60 * 60_000;
/** A row left SENDING this long belongs to a worker that died - it is released. */
export const STUCK_AFTER_MS = 10 * 60_000;
/** BullMQ driver: a row handed to the queue this long ago is checked against Redis (job lost -> back to PENDING). */
export const QUEUED_CHECK_AFTER_MS = 2 * 60_000;
/** Consecutive transient failures that open the circuit breaker, and for how long. */
export const BREAKER_THRESHOLD = 5;
export const BREAKER_PAUSE_MS = 2 * 60_000;

/**
 * Why email can't be sent with these settings (null = it can). The one
 * definition used by the enqueue decision, the worker and src/lib/mail.ts.
 */
export function emailConfigProblem(settings: NotificationSettings | undefined, env: Record<string, string | undefined> = process.env): string | null {
  if (!settings || settings.provider === "NONE") return "Email delivery is switched off (provider: None)";
  if (settings.provider === "GRAPH") return "The GRAPH provider isn't implemented yet";
  if (!settings.smtpHost || !settings.smtpPort) return "SMTP host / port aren't set";
  if (!env.SMTP_USER || !env.SMTP_PASSWORD) return "SMTP_USER / SMTP_PASSWORD aren't set in the environment";
  return null;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Where a notification opens in the app (so the email isn't a dead end). */
export function notificationPath(notification: Pick<Notification, "entityType" | "entityId" | "type">): string {
  if (notification.entityType === "Finding") return `/findings/${notification.entityId}`;
  if (notification.entityType === "SupportThread") return notification.type === "SUPPORT_MESSAGE" ? "/admin/support" : "/support";
  if (notification.entityType === "ReportingPeriod") return "/admin/reporting-periods";
  return "/dashboard";
}

/** The email's text and HTML bodies. User-typed text (reasons, comments) is escaped in the HTML. */
export function renderNotificationEmail(notification: Notification, baseUrl: string | undefined): { subject: string; text: string; html: string } {
  const base = baseUrl?.trim().replace(/\/+$/, "");
  const link = base ? `${base}${notificationPath(notification)}` : null;
  const paragraphs = escapeHtml(notification.message).replace(/\r?\n/g, "<br>");
  return {
    // A header can't contain line breaks.
    subject: notification.title.replace(/[\r\n]+/g, " ").slice(0, 200),
    text: link ? `${notification.message}\n\nOpen in NIB Control360: ${link}` : notification.message,
    html: link ? `<p>${paragraphs}</p><p><a href="${escapeHtml(link)}">Open in NIB Control360</a></p>` : `<p>${paragraphs}</p>`,
  };
}

export function maxAttemptsFrom(env: Record<string, string | undefined> = process.env): number {
  const n = Number.parseInt(env.EMAIL_MAX_ATTEMPTS ?? "", 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), BACKOFF_MS.length + 1) : DEFAULT_MAX_ATTEMPTS;
}

/** Support conversations go ahead of bulk workflow mail. */
export function priorityOf(notificationType: string): number {
  return notificationType === "SUPPORT_MESSAGE" || notificationType === "SUPPORT_REPLY" ? 5 : 0;
}

/**
 * The email to queue for a notification, or null when none is due: the event
 * is switched off (Settings -> Email Events), the recipient has no address,
 * or email isn't configured.
 */
export function emailForNotification(
  db: Pick<Database, "settings" | "users">,
  recipientUserId: string,
  notification: Notification,
  env: Record<string, string | undefined> = process.env,
  now: number = Date.now()
): QueuedEmail | null {
  const settings = db.settings?.notification;
  if (emailConfigProblem(settings, env)) return null;
  if (!isEmailEnabled(settings.emailEvents, notification.type)) return null;
  const recipient = db.users.find((u) => u.id === recipientUserId);
  const toAddress = recipient?.email?.trim();
  if (!toAddress) return null;

  const { subject, text, html } = renderNotificationEmail(notification, env.APP_BASE_URL);
  return {
    id: notification.id,
    kind: "NOTIFICATION",
    notificationId: notification.id,
    notificationType: notification.type,
    recipientUserId,
    toAddress,
    fromAddress: settings.fromAddress,
    subject,
    bodyText: text,
    bodyHtml: html,
    dedupeKey: `notification:${notification.id}`,
    priority: priorityOf(notification.type),
    maxAttempts: maxAttemptsFrom(env),
    expiresAt: new Date(now + EXPIRY_MS).toISOString(),
  };
}

/** Wait before the next try, after `attempts` tries failed - with +/-20% jitter so retries don't arrive in one wave. */
export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const base = BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1];
  return Math.round(base * (0.8 + random() * 0.4));
}

/**
 * Sorts an SMTP / nodemailer error into retry, give up, or "our
 * configuration is wrong". The returned text is safe to store and show
 * (codes only - no hostnames or credentials; the full error is logged).
 */
export function classifyError(err: unknown): Exclude<SendOutcome, { kind: "sent" }> {
  const e = (typeof err === "object" && err !== null ? err : {}) as { code?: unknown; responseCode?: unknown; command?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  const response = typeof e.responseCode === "number" ? e.responseCode : 0;
  const label = [code, response || ""].filter(Boolean).join(" ") || "unknown error";

  if (code === "EAUTH" || response === 530 || response === 534 || response === 535) {
    return { kind: "config", error: `The mail server refused the sign-in (${label}) - check SMTP_USER / SMTP_PASSWORD` };
  }
  // 5xx = the server will never accept this message; EENVELOPE = bad sender / recipient.
  if (code === "EENVELOPE" || (response >= 500 && response < 600)) {
    return { kind: "permanent", error: `Rejected by the mail server (${label})` };
  }
  return { kind: "transient", error: `Temporary failure (${label})` };
}

export type RowUpdate =
  | { status: "SENT"; messageId: string | null }
  | { status: "PENDING"; nextAttemptAt: number; error: string; refundAttempt: boolean }
  | { status: "FAILED"; error: string }
  | { status: "CANCELLED"; error: string };

/** What happens to a claimed row after one attempt. */
export function rowUpdateFor(row: Pick<OutboxRow, "attempts" | "maxAttempts">, outcome: SendOutcome, now: number, random: () => number = Math.random): RowUpdate {
  if (outcome.kind === "sent") return { status: "SENT", messageId: outcome.messageId };
  if (outcome.kind === "permanent") return { status: "FAILED", error: outcome.error };
  // Our own configuration is wrong: not this email's fault, so the attempt isn't counted.
  if (outcome.kind === "config") return { status: "PENDING", nextAttemptAt: now, error: outcome.error, refundAttempt: true };
  if (row.attempts >= row.maxAttempts) return { status: "FAILED", error: `${outcome.error} - gave up after ${row.attempts} attempts` };
  return { status: "PENDING", nextAttemptAt: now + backoffMs(row.attempts, random), error: outcome.error, refundAttempt: false };
}

/** Past its expiry: cancelled, never sent late. */
export function isExpired(row: Pick<OutboxRow, "expiresAt">, now: number): boolean {
  return row.expiresAt !== null && new Date(row.expiresAt).getTime() < now;
}
