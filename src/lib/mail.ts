import nodemailer, { type Transporter } from "nodemailer";
import type { Database, Notification, NotificationSettings } from "@/types";

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
    console.warn("[mail] Notification provider is GRAPH, which isn't implemented yet - no email sent. See EMAIL_SETUP.md.");
    return null;
  }

  const host = settings.smtpHost;
  const port = settings.smtpPort;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  if (!host || !port || !user || !pass) {
    console.warn("[mail] SMTP provider selected but host/port/SMTP_USER/SMTP_PASSWORD aren't all configured - no email sent. See EMAIL_SETUP.md.");
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
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
 */
export function sendNotificationEmail(db: Database, recipientUserId: string, notification: Notification): void {
  try {
    const recipient = db.users.find((u) => u.id === recipientUserId);
    if (!recipient?.email) return;

    const transporter = getTransporter(db.settings.notification);
    if (!transporter) return;

    transporter
      .sendMail({
        from: db.settings.notification.fromAddress,
        to: recipient.email,
        subject: notification.title,
        text: notification.message,
        html: `<p>${notification.message}</p>`,
      })
      .catch((err) => console.error("[mail] Failed to send notification email:", err));
  } catch (err) {
    console.error("[mail] Failed to send notification email:", err);
  }
}
