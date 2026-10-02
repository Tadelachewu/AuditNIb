import { NextResponse } from "next/server";
import { z } from "zod";
import { readDb, updateDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { appendAuditLog } from "@/lib/audit";
import { PASSWORD_MIN_LENGTH, validatePasswordFull } from "@/lib/passwordValidation";
import { prisma } from "@/lib/prismaClient";
import { isRateLimited, recordAttempt } from "@/lib/rateLimit";
import { withApiHandler } from "@/lib/api/handler";
import { logger } from "@/lib/logger";

const schema = z.object({
  token: z.string().min(1, "Reset token is required"),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH, `New password must be at least ${PASSWORD_MIN_LENGTH} characters`),
});

const PER_TOKEN_RATE_LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };

async function handlePOST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }
  const { token, newPassword } = parsed.data;

  const tokenKey = `reset-password:token:${token.slice(0, 8)}`;
  const tokenLimit = await isRateLimited(tokenKey, PER_TOKEN_RATE_LIMIT);
  if (tokenLimit.limited) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(tokenLimit.retryAfterSeconds) } }
    );
  }
  await recordAttempt(tokenKey, PER_TOKEN_RATE_LIMIT);

  const strength = await validatePasswordFull(newPassword);
  if (!strength.valid) {
    return NextResponse.json({ error: strength.error }, { status: 400 });
  }

  const now = new Date();
  const resetRow = await prisma.passwordResetToken.findUnique({
    where: { token },
  });

  if (
    !resetRow ||
    resetRow.usedAt !== null ||
    new Date(resetRow.expiresAt).getTime() < now.getTime()
  ) {
    return NextResponse.json(
      { error: "This password reset link is invalid or has expired. Request a new one." },
      { status: 400 }
    );
  }

  const db = await readDb();
  const user = db.users.find((u) => u.id === resetRow.userId && u.status === "ACTIVE");
  if (!user) {
    return NextResponse.json(
      { error: "Account not found or deactivated" },
      { status: 400 }
    );
  }

  const nextSessionVersion = (user.sessionVersion ?? 1) + 1;

  try {
    await prisma.$transaction([
      prisma.passwordResetToken.update({
        where: { id: resetRow.id },
        data: { usedAt: now },
      }),
    ]);
  } catch (err) {
    logger.error({ err, event: "password_reset.consume_failed" }, "Failed to consume reset token");
    return NextResponse.json({ error: "Failed to process request" }, { status: 500 });
  }

  await updateDb((current) => {
    const u = current.users.find((x) => x.id === user.id)!;
    u.passwordHash = hashPassword(newPassword);
    u.mustChangePassword = false;
    u.passwordExpiresAt = null;
    u.sessionVersion = nextSessionVersion;
    u.updatedAt = new Date().toISOString();
    appendAuditLog(current, {
      userId: user.id,
      userName: user.name,
      action: "PASSWORD_RESET",
      entityType: "User",
      entityId: user.id,
    });
  });

  return NextResponse.json({ ok: true });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const POST = withApiHandler(handlePOST);
