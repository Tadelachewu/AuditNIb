import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { readDb, updateDb } from "@/lib/db";
import { getTransporter } from "@/lib/mail";
import { appendAuditLog } from "@/lib/audit";
import { clientIp, ipIsKnown, isRateLimited, recordAttempt } from "@/lib/rateLimit";
import { prisma } from "@/lib/prismaClient";
import { withApiHandler } from "@/lib/api/handler";
import { logger } from "@/lib/logger";
import { hashResetToken } from "@/lib/resetToken";

const schema = z.object({
  identifier: z.string().min(1, "Enter your username or email address"),
});

const PER_IP_RATE_LIMIT = { max: 5, windowMs: 15 * 60 * 1000 };
const PER_EMAIL_RATE_LIMIT = { max: 3, windowMs: 60 * 60 * 1000 };
const TOKEN_TTL_MS = 30 * 60 * 1000;

// Builds the external https:// origin the end user actually typed into their
// browser. Critical for password-reset links: if Next.js is behind an Nginx
// that terminates TLS and proxy-passes to http://127.0.0.1:9005, request.url
// / request.headers.host resolve to the internal upstream. Nginx should be
// sending X-Forwarded-Proto=https + X-Forwarded-Host=<public domain> (the
// same fix we applied earlier for the CSRF cross-origin check), so this
// function trusts those headers FIRST and falls back to what the Node HTTP
// layer sees. The result is always an absolute origin like
// "https://nibprocure.nibbank.com.et" (no trailing slash).
function buildPublicOrigin(request: Request): string {
  try {
    const xProto = (request.headers.get("x-forwarded-proto") ?? "").toLowerCase();
    const xHost = request.headers.get("x-forwarded-host");
    const host = xHost ?? request.headers.get("host") ?? "";

    let proto = "";
    if (xProto === "https" || xProto === "http") proto = xProto;
    else if (host && host.includes("localhost")) proto = "http";
    else proto = "https";

    if (host) return `${proto}://${host}`;

    return new URL(request.url).origin;
  } catch {
    try {
      return new URL(request.url).origin;
    } catch {
      return "";
    }
  }
}

function isValidEmailForSending(email: string): boolean {
  // Fast structural check (zod already validated this if user typed email
  // into the form; but when a user matches by username we still have to
  // trust the DB value). A bare-minimum non-empty@non-empty with no spaces
  // is enough to avoid calling nodemailer with garbage.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function handlePOST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }
  const { identifier } = parsed.data;

  const ip = clientIp(request);
  const ipKey = `forgot-password:ip:${ip}`;
  // Per-IP only when the IP is known (see ipIsKnown() in src/lib/rateLimit.ts).
  const ipKnown = ipIsKnown(ip);
  const ipLimit = ipKnown ? await isRateLimited(ipKey, PER_IP_RATE_LIMIT) : { limited: false, retryAfterSeconds: 0 };
  if (ipLimit.limited) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } }
    );
  }

  const normalizedId = identifier.trim().toLowerCase();
  const emailKey = `forgot-password:id:${normalizedId}`;
  const emailLimit = await isRateLimited(emailKey, PER_EMAIL_RATE_LIMIT);
  if (emailLimit.limited) {
    return NextResponse.json(
      { error: "Too many requests for this address. Try again later." },
      { status: 429, headers: { "Retry-After": String(emailLimit.retryAfterSeconds) } }
    );
  }

  if (ipKnown) await recordAttempt(ipKey, PER_IP_RATE_LIMIT);
  await recordAttempt(emailKey, PER_EMAIL_RATE_LIMIT);

  const db = await readDb();

  // After the "email mandatory" migration (20260921110000_users_email_mandatory)
  // every ACTIVE user is guaranteed to have a non-empty email on the DB
  // column. We still check !== "" defensively because older deployments
  // running the migration will backfill NULLs with
  // username@legacy.nib-control360.local (deliberately non-deliverable
  // placeholders the admin must replace via Admin -> Users).
  const user = db.users.find(
    (u) =>
      u.status === "ACTIVE" &&
      (u.username.toLowerCase() === normalizedId ||
        u.email.toLowerCase() === normalizedId)
  );

  const transporter = getTransporter(db.settings.notification);
  const smtpConfigured = Boolean(transporter);

  // User-enumeration-blind: always return the same success message whether
  // or not a match was found. Matchers that DO hit can tell what happened
  // from extra flags: smtpConfigured=false + noEmailOnFile (rare after the
  // mandatory migration) vs the normal 200 success.
  if (!user) {
    return NextResponse.json({
      ok: true,
      smtpConfigured,
      message:
        "If an active account matches that username or email, a password reset link has been sent.",
    });
  }

  const hasUsableEmail = Boolean(user.email) && isValidEmailForSending(user.email);
  if (!hasUsableEmail) {
    logger.warn({ event: "password_reset.undeliverable_email", targetUserId: user.id }, "Password reset matched a user whose email is not deliverable - an admin must correct it in Admin -> Users");
    return NextResponse.json({
      ok: true,
      smtpConfigured,
      noDeliverableEmail: true,
      message:
        "If an active account matches that username or email, a password reset link has been sent.",
    });
  }

  if (!smtpConfigured) {
    logger.warn({ event: "password_reset.smtp_not_configured", targetUserId: user.id }, "Password reset requested but SMTP is not configured (Admin -> Settings -> Notification Delivery); a reset token row was still created");
  }

  const tokenRaw = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  const publicOrigin = buildPublicOrigin(request);
  const resetUrl = `${publicOrigin}/reset-password?token=${encodeURIComponent(tokenRaw)}`;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.passwordResetToken.create({
        data: {
          id: uuid(),
          userId: user.id,
          // Only a SHA-256 hash is stored (security review M2): someone who can
          // read this table (a backup, a query) can't use a live link.
          token: hashResetToken(tokenRaw),
          expiresAt,
          issuedIp: ip,
          issuedUa: request.headers.get("user-agent") ?? null,
        },
      });
    });
  } catch (err) {
    logger.error({ err, event: "password_reset.persist_failed" }, "Failed to persist reset token row");
    return NextResponse.json({ error: "Failed to process request" }, { status: 500 });
  }

  await updateDb((current) => {
    appendAuditLog(current, {
      userId: user.id,
      userName: user.name,
      action: "PASSWORD_RESET_REQUESTED",
      entityType: "User",
      entityId: user.id,
      newValue: { emailTarget: user.email, smtpConfigured },
    });
  });

  let emailSentSuccessfully = false;
  let smtpErrorMessage: string | null = null;
  if (transporter && publicOrigin) {
    const fromAddress =
      db.settings.notification.fromAddress?.trim() ||
      (publicOrigin.includes("localhost")
        ? `"NIB Control360" <no-reply@localhost>`
        : `"NIB Control360" <no-reply@${publicOrigin.replace(/^https?:\/\//, "").split("/")[0]}>`);
    try {
      const info = await transporter.sendMail({
        from: fromAddress,
        to: user.email,
        replyTo: fromAddress,
        subject: "Reset your NIB Control360 password",
        text: [
          `Hi ${user.name},`,
          "",
          "You (or someone using your username/email) requested a password reset for your NIB Control360 account.",
          "",
          "Click or copy this link into your browser to set a new password:",
          resetUrl,
          "",
          "This link is valid for 30 minutes and can only be used once. If you didn't request this, you can safely ignore this email — your password won't be changed and no one else can access your account.",
          "",
          "Thanks,",
          "NIB Control360",
        ].join("\n"),
        html: `
          <div style="font-family: system-ui, Arial, sans-serif; line-height: 1.5; max-width: 560px;">
            <p>Hi ${user.name},</p>
            <p>You (or someone using your username/email) requested a password reset for your NIB Control360 account.</p>
            <p>Click the button below to set a new password, or copy the link into your browser:</p>
            <p style="margin: 1.25rem 0;">
              <a href="${resetUrl}"
                 style="display:inline-block; padding: 0.6rem 1.1rem; border-radius: 0.375rem; background: #1e3a8a; color: #fff; text-decoration: none; font-weight: 600;">
                Reset my password
              </a>
            </p>
            <p style="word-break: break-all; color: #475569; font-size: 0.875rem;">${resetUrl}</p>
            <p>This link is valid for <strong>30 minutes</strong> and can only be used <strong>once</strong>.</p>
            <p>If you didn&apos;t request this, you can safely ignore this email &mdash; your password won&apos;t be changed and no one else can access your account.</p>
            <p>Thanks,<br/>NIB Control360</p>
          </div>`,
      });
      emailSentSuccessfully = true;
      const accepted: string[] = (info as unknown as { accepted?: string[] })?.accepted ?? [];
      logger.info(
        { event: "password_reset.email_queued", targetUserId: user.id, accepted: accepted.includes(user.email) },
        "Password reset email queued via SMTP relay"
      );
    } catch (err) {
      logger.error({ err, event: "password_reset.email_failed", targetUserId: user.id }, "Failed to send password reset email - check Admin -> Settings -> Notification Delivery");
      smtpErrorMessage =
        "The password reset link could not be emailed right now. Ask your NIB Control360 administrator to check the outbound SMTP configuration in Admin → Settings → Notification Delivery.";
    }
  }

  // NOTE: even when SMTP isn't configured, we still return the user-blind
  // success message - but tack on extra machine-readable flags so the
  // forgot-password page UI can alert an admin who lands here that the
  // reset link didn't leave the server.
  return NextResponse.json({
    ok: true,
    message:
      "If an active account matches that username or email, a password reset link has been sent.",
    smtpConfigured,
    emailSent: emailSentSuccessfully,
    smtpError: smtpErrorMessage,
    sentTo: emailSentSuccessfully ? user.email : undefined,
  });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const POST = withApiHandler(handlePOST);
