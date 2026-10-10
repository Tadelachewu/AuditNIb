import nodemailer, { type Transporter } from "nodemailer";
import type { NotificationSettings } from "@/types";
import { logger } from "@/lib/logger";

/**
 * For the two emails sent synchronously, where the user needs the result at
 * once: forgot-password and the Settings test email. Notification emails
 * don't use this - they go through the email queue (src/lib/emailQueue).
 *
 * Builds an SMTP transporter from Settings.notification (host/port - not
 * secret, admin-editable in the UI) plus SMTP_USER/SMTP_PASSWORD (secret,
 * env-only, same convention as IRON_SESSION_PASSWORD). Returns null - with
 * a console warning, never a thrown error - whenever sending isn't fully
 * configured, so every caller can treat "no transporter" as "skip
 * silently" instead of special-casing each missing piece itself.
 */
export function getTransporter(settings: NotificationSettings): Transporter | null {
  if (settings.provider === "NONE") return null;

  if (settings.provider === "GRAPH") {
    logger.warn({ event: "email.provider_unsupported" }, "Notification provider is GRAPH, which isn't implemented yet - no email sent. See EMAIL_SETUP.md.");
    return null;
  }

  const host = settings.smtpHost;
  const port = settings.smtpPort;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  if (!host || !port || !user || !pass) {
    logger.warn({ event: "email.smtp_incomplete" }, "SMTP provider selected but host/port/SMTP_USER/SMTP_PASSWORD aren't all configured - no email sent. See EMAIL_SETUP.md.");
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    // Bounded waits: a slow or unreachable SMTP server fails fast instead of
    // holding sockets open (sending is fire-and-forget for notifications).
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}
