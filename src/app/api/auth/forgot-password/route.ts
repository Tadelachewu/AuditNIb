import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { readDb, updateDb } from "@/lib/db";
import { getTransporter } from "@/lib/mail";
import { appendAuditLog } from "@/lib/audit";
import { clientIp, isRateLimited, recordAttempt } from "@/lib/rateLimit";
import { prisma } from "@/lib/prismaClient";

const schema = z.object({
  identifier: z.string().min(1, "Enter your username or email address"),
});

const PER_IP_RATE_LIMIT = { max: 5, windowMs: 15 * 60 * 1000 };
const PER_EMAIL_RATE_LIMIT = { max: 3, windowMs: 60 * 60 * 1000 };
const TOKEN_TTL_MS = 30 * 60 * 1000;

function safeOrigin(request: Request): string {
  try {
    const proto = request.headers.get("x-forwarded-proto") ?? "";
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
    if (proto && host) return `${proto}://${host}`;
    if (host) {
      const u = new URL(request.url);
      return `${u.protocol}//${host}`;
    }
    return new URL(request.url).origin;
  } catch {
    try {
      return new URL(request.url).origin;
    } catch {
      return "";
    }
  }
}

export async function POST(request: Request) {
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
  const ipLimit = await isRateLimited(ipKey, PER_IP_RATE_LIMIT);
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

  const db = await readDb();
  const user = db.users.find(
    (u) =>
      u.status === "ACTIVE" &&
      (u.username.toLowerCase() === normalizedId ||
        (u.email && u.email.toLowerCase() === normalizedId))
  );

  await recordAttempt(ipKey, PER_IP_RATE_LIMIT);
  await recordAttempt(emailKey, PER_EMAIL_RATE_LIMIT);

  if (!user || !user.email) {
    return NextResponse.json({
      ok: true,
      message:
        "If an active account matches that username or email, a password reset link has been sent.",
    });
  }

  const tokenRaw = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  const origin = safeOrigin(request);
  const resetUrl = origin ? `${origin}/reset-password?token=${encodeURIComponent(tokenRaw)}` : "";

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
          token: tokenRaw,
          expiresAt,
          issuedIp: ip,
          issuedUa: request.headers.get("user-agent") ?? null,
        },
      });
    });
  } catch (err) {
    console.error("[forgot-password] Failed to create reset token:", err);
    return NextResponse.json({ error: "Failed to process request" }, { status: 500 });
  }

  await updateDb((current) => {
    appendAuditLog(current, {
      userId: user.id,
      userName: user.name,
      action: "PASSWORD_RESET_REQUESTED",
      entityType: "User",
      entityId: user.id,
    });
  });

  const transporter = getTransporter(db.settings.notification);
  if (transporter && resetUrl) {
    const subject = `Reset your ${db.settings.notification.fromAddress ? "NIB Control360" : "password"}`;
    const text = [
      `Hi ${user.name},`,
      "",
      "You (or someone using your username/email) requested a password reset for your NIB Control360 account.",
      "",
      resetUrl,
      "",
      "This link is valid for 30 minutes and can only be used once. If you didn't request this, you can safely ignore this email — your password won't be changed.",
      "",
      "Thanks,",
      "NIB Control360",
    ].join("\n");
    const html = `
      <div style="font-family: system-ui, Arial, sans-serif; line-height: 1.5;">
        <p>Hi ${user.name},</p>
        <p>You (or someone using your username/email) requested a password reset for your NIB Control360 account.</p>
        <p><a href="${resetUrl}" style="font-weight: 600;">${resetUrl}</a></p>
        <p>This link is valid for 30 minutes and can only be used once. If you didn't request this, you can safely ignore this email &mdash; your password won't be changed.</p>
        <p>Thanks,<br/>NIB Control360</p>
      </div>`;

    transporter
      .sendMail({
        from: db.settings.notification.fromAddress || `"NIB Control360" <no-reply@localhost>`,
        to: user.email,
        subject,
        text,
        html,
      })
      .catch((err) => console.error("[forgot-password] Failed to send reset email:", err));
  }

  return NextResponse.json({
    ok: true,
    message:
      "If an active account matches that username or email, a password reset link has been sent.",
    emailSent: Boolean(transporter && resetUrl),
  });
}
