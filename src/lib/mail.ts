import nodemailer, { type Transporter } from "nodemailer";
import { isEmailEnabled } from "@/lib/notificationEvents";
import type { Database, Notification, NotificationSettings } from "@/types";
import { logger } from "@/lib/logger";

/**
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

// Where a notification's own entityType/entityId (or, for SupportThread,
// which of the two support notification types this is) actually opens in
// the app - so the emailed copy isn't a dead end the recipient has to go
// hunt for themselves. Falls back to the dashboard for entity types with
// no per-record detail page (e.g. ReportingPeriod - there's no
// /admin/reporting-periods/[id], just the one list).
function notificationPath(notification: Notification): string {
  if (notification.entityType === "Finding") return `/findings/${notification.entityId}`;
  if (notification.entityType === "SupportThread") {
    // SUPPORT_MESSAGE goes to support.respond holders (the admin inbox);
    // SUPPORT_REPLY goes back to the thread's own owner (their own page) -
    // see src/lib/notifications.ts's own notify calls for this split.
    return notification.type === "SUPPORT_MESSAGE" ? "/admin/support" : "/support";
  }
  if (notification.entityType === "ReportingPeriod") return "/admin/reporting-periods";
  return "/dashboard";
}

/**
 * Mirrors an in-app Notification as a real email to its recipient, using
 * the notification's own title/message verbatim - no separate templating
 * system needed since that copy is already written for a human to read.
 * Called fire-and-forget (never awaited) from src/lib/notifications.ts,
 * which itself runs synchronously inside updateDb() mutators across the
 * whole app, so this must never throw and never block the caller: a down
 * or misconfigured mail server can never break the finding/period action
 * that triggered the notification.
 *
 * Includes a link back into the app (notificationPath() above) so the
 * email isn't just a heads-up the recipient then has to go find manually -
 * built from APP_BASE_URL (see .env.example), since this runs deep inside
 * an updateDb() mutator with no incoming Request to read a Host header
 * from (unlike /api/auth/forgot-password's own buildPublicOrigin()).
 * Silently omitted, same "fails open" convention as everything else in
 * this file, when that env var isn't set.
 */
export function sendNotificationEmail(db: Database, recipientUserId: string, notification: Notification): void {
  try {
    // Admin → Settings → Email Events: this event switched off for email
    // (the in-app notification was still created by the caller).
    if (!isEmailEnabled(db.settings.notification.emailEvents, notification.type)) return;

    const recipient = db.users.find((u) => u.id === recipientUserId);
    if (!recipient?.email) return;

    const transporter = getTransporter(db.settings.notification);
    if (!transporter) return;

    const baseUrl = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "");
    const link = baseUrl ? `${baseUrl}${notificationPath(notification)}` : null;

    transporter
      .sendMail({
        from: db.settings.notification.fromAddress,
        to: recipient.email,
        subject: notification.title,
        text: link ? `${notification.message}\n\nOpen in NIB Control360: ${link}` : notification.message,
        html: link
          ? `<p>${notification.message}</p><p><a href="${link}">Open in NIB Control360</a></p>`
          : `<p>${notification.message}</p>`,
      })
      .catch((err) => logger.error({ err, event: "email.send_failed", notificationType: notification.type }, "Failed to send notification email"));
  } catch (err) {
    logger.error({ err, event: "email.send_failed" }, "Failed to send notification email");
  }
}
