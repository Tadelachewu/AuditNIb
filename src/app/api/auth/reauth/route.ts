import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/guard";
import { prisma } from "@/lib/prismaClient";
import { updateDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { verifyPassword } from "@/lib/auth";
import { appendAuditLog } from "@/lib/audit";
import { checkLockout, recordFailureForLockout, clearLockout, isRateLimited, recordAttempt, clearRateLimit } from "@/lib/rateLimit";
import { withApiHandler } from "@/lib/api/handler";

/**
 * Confirms the signed-in user's password again, before a high-risk action
 * (src/lib/reauth.ts). On success the session is marked as freshly
 * confirmed for a few minutes. Wrong passwords are rate-limited and lock
 * this check out, exactly like changing the password.
 */
const schema = z.object({ password: z.string().min(1, "Password is required").max(200) });

const ACCOUNT_LOCKOUT = { maxFailures: 5, windowMs: 15 * 60 * 1000, lockoutMs: 15 * 60 * 1000 };
const RATE_LIMIT = { max: 5, windowMs: 15 * 60 * 1000 };

async function handlePOST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });

  const key = `reauth:${auth.session.userId}`;
  const lockout = await checkLockout(key);
  if (lockout.locked) {
    return NextResponse.json({ error: "Too many incorrect attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(lockout.retryAfterSeconds) } });
  }
  const limited = await isRateLimited(key, RATE_LIMIT);
  if (limited.limited) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
  }

  const user = await prisma.user.findUnique({ where: { id: auth.session.userId! }, select: { id: true, name: true, passwordHash: true } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
    await Promise.all([recordAttempt(key, RATE_LIMIT), recordFailureForLockout(key, ACCOUNT_LOCKOUT)]);
    await updateDb((current) => {
      appendAuditLog(current, { userId: user.id, userName: user.name, action: "REAUTH_FAILED", entityType: "User", entityId: user.id });
    });
    return NextResponse.json({ error: "Incorrect password" }, { status: 400 });
  }
  await Promise.all([clearRateLimit(key), clearLockout(key)]);

  const session = await getSession();
  session.reauthAt = Date.now();
  await session.save();
  return NextResponse.json({ ok: true });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const POST = withApiHandler(handlePOST);
