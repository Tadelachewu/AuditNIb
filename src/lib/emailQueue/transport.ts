import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "@/lib/logger";
import type { NotificationSettings } from "@/types";
import { classifyError, emailConfigProblem } from "./rules";
import type { OutboxRow, SendOutcome } from "./types";

/**
 * SMTP delivery for the email queue: ONE pooled, rate-limited transporter
 * shared by every send (a bulk action no longer opens a connection per
 * email), rebuilt only when the SMTP settings change.
 */
export interface EmailTransport {
  send(row: OutboxRow, settings: NotificationSettings): Promise<SendOutcome>;
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

/** Connections kept open to the mail server, and emails per second across them. */
export const POOL_SIZE = () => intEnv("EMAIL_POOL_SIZE", 3, 1, 20);
export const RATE_PER_SECOND = () => intEnv("EMAIL_RATE_PER_SEC", 10, 1, 200);

let pooled: { key: string; transporter: Transporter } | null = null;

function pooledTransporter(settings: NotificationSettings): Transporter {
  const user = process.env.SMTP_USER!;
  const key = [settings.smtpHost, settings.smtpPort, user, POOL_SIZE(), RATE_PER_SECOND()].join("|");
  if (pooled?.key === key) return pooled.transporter;
  pooled?.transporter.close();
  const transporter = nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpPort === 465,
    auth: { user, pass: process.env.SMTP_PASSWORD! },
    pool: true,
    maxConnections: POOL_SIZE(),
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: RATE_PER_SECOND(),
    // Bounded waits: a slow or unreachable server fails fast and is retried later.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  pooled = { key, transporter };
  return transporter;
}

/** The address' domain, for a stable Message-ID (lets mail servers drop a rare duplicate). */
function domainOf(address: string): string {
  const match = /@([A-Za-z0-9.-]+)/.exec(address);
  return match ? match[1] : "localhost";
}

export const smtpEmailTransport: EmailTransport = {
  async send(row, settings) {
    const problem = emailConfigProblem(settings);
    if (problem) return { kind: "config", error: problem };
    try {
      const info = await pooledTransporter(settings).sendMail({
        from: row.fromAddress || settings.fromAddress,
        to: row.toAddress,
        subject: row.subject,
        text: row.bodyText,
        html: row.bodyHtml,
        messageId: `<${row.id}@${domainOf(row.fromAddress || settings.fromAddress)}>`,
      });
      return { kind: "sent", messageId: typeof info?.messageId === "string" ? info.messageId : null };
    } catch (err) {
      const outcome = classifyError(err);
      // Full detail (may name hosts) stays in the server log; the row keeps the sanitized text.
      logger.warn({ err, event: "email.attempt_failed", outboxId: row.id, notificationType: row.notificationType, outcome: outcome.kind }, "Email attempt failed");
      return outcome;
    }
  },
};
