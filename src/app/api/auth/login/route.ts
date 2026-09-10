import { NextResponse } from "next/server";
import { z } from "zod";
import { readDb, updateDb } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { appendAuditLog } from "@/lib/audit";
import { toSafeUser } from "@/lib/sanitize";
import {
  isRateLimited,
  recordAttempt,
  clearRateLimit,
  checkLockout,
  recordFailureForLockout,
  clearLockout,
  computeBackoffMs,
  sleep,
  clientIp,
} from "@/lib/rateLimit";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// security/ChatBot_VA_Report_Analysis.md's VA-017 ("Weak Authentication
// Rate Limiting Controls") class: this endpoint originally had no
// brute-force protection at all, then only a single flat rate limit. Four
// independent layers now, all keyed by IP and/or username:
//
//   - Rate limit, per IP:            5 attempts / 15 min
//   - Rate limit, per username+IP:   5 attempts / 15 min
//   - Lockout,    per username:      hard-locked 15 min after 5 failures
//   - Lockout,    per IP:            hard-locked 30 min after 10 failures
//
// Lockouts are checked before rate limits on every request - a caller
// that's already locked out gets an immediate 429 with Retry-After instead
// of re-consuming rate-limit budget. On top of all four, every failed
// attempt is slowed by an exponential backoff (1s, 2s, 4s, 8s, capped)
// before responding, driven by the per-username lockout's own failure
// count - so a scripted loop is throttled in real time even before any
// limit is actually hit. Only failed attempts count against any of this -
// a correct password on the first try never touches any counter.
const PER_IP_RATE_LIMIT = { max: 5, windowMs: 15 * 60 * 1000 };
const PER_ACCOUNT_RATE_LIMIT = { max: 5, windowMs: 15 * 60 * 1000 };
const ACCOUNT_LOCKOUT = { maxFailures: 5, windowMs: 15 * 60 * 1000, lockoutMs: 15 * 60 * 1000 };
const IP_LOCKOUT = { maxFailures: 10, windowMs: 30 * 60 * 1000, lockoutMs: 30 * 60 * 1000 };

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
  }
  const { username, password } = parsed.data;

  const ip = clientIp(request);
  const usernameKey = `login-user:${username.toLowerCase()}`;
  const ipKey = `login-ip:${ip}`;
  const accountKey = `login-account:${ip}:${username.toLowerCase()}`;

  const [accountLockout, ipLockout] = await Promise.all([checkLockout(usernameKey), checkLockout(ipKey)]);
  if (accountLockout.locked || ipLockout.locked) {
    const retryAfterSeconds = Math.max(accountLockout.retryAfterSeconds, ipLockout.retryAfterSeconds);
    return NextResponse.json(
      { error: "Too many failed attempts. This account/source is temporarily locked." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
    );
  }

  const [ipRateLimit, accountRateLimit] = await Promise.all([
    isRateLimited(ipKey, PER_IP_RATE_LIMIT),
    isRateLimited(accountKey, PER_ACCOUNT_RATE_LIMIT),
  ]);
  if (ipRateLimit.limited || accountRateLimit.limited) {
    const retryAfterSeconds = Math.max(ipRateLimit.retryAfterSeconds, accountRateLimit.retryAfterSeconds);
    return NextResponse.json(
      { error: "Too many login attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
    );
  }

  const db = await readDb();
  const user = db.users.find((u) => u.username.toLowerCase() === username.toLowerCase());

  if (!user || !verifyPassword(password, user.passwordHash)) {
    await Promise.all([recordAttempt(ipKey, PER_IP_RATE_LIMIT), recordAttempt(accountKey, PER_ACCOUNT_RATE_LIMIT)]);
    const [accountFailure] = await Promise.all([
      recordFailureForLockout(usernameKey, ACCOUNT_LOCKOUT),
      recordFailureForLockout(ipKey, IP_LOCKOUT),
    ]);
    await sleep(computeBackoffMs(accountFailure.failures));
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }
  await Promise.all([clearRateLimit(accountKey), clearLockout(usernameKey)]);
  if (user.status !== "ACTIVE") {
    return NextResponse.json({ error: "This account has been deactivated" }, { status: 403 });
  }

  // Forced rotation for initial/admin-reset credentials: a temporary
  // password is only good for 24h from when it was set (see
  // User.passwordExpiresAt's own doc comment) - once expired, login is
  // blocked outright rather than letting the user in on a password an
  // admin chose and may still know, however long ago that was.
  if (user.mustChangePassword && user.passwordExpiresAt && new Date(user.passwordExpiresAt).getTime() < Date.now()) {
    return NextResponse.json(
      { error: "Temporary password has expired. Contact an administrator to reset it." },
      { status: 403 }
    );
  }

  const role = db.roles.find((r) => r.code === user.role);
  if (!role || role.status !== "ACTIVE") {
    return NextResponse.json({ error: "Your role has been deactivated. Contact an administrator." }, { status: 403 });
  }

  const loginTime = new Date().toISOString();
  await updateDb((current) => {
    const u = current.users.find((x) => x.id === user.id);
    if (u) u.lastLoginAt = loginTime;
    appendAuditLog(current, {
      userId: user.id,
      userName: user.name,
      action: "LOGIN",
      entityType: "User",
      entityId: user.id,
    });
  });

  const session = await getSession();
  session.isLoggedIn = true;
  session.userId = user.id;
  session.username = user.username;
  session.name = user.name;
  session.role = user.role;
  session.roleName = role.name;
  session.orgScope = role.orgScope;
  // Resolved from whatever's actually stored on the role, same as any
  // other role - ADMIN's permissions can be narrowed (see PATCH
  // .../api/admin/roles/[id]), so forcing every permission here would make
  // that narrowing silently ineffective. One consequence: adding a new
  // page/action to the registry no longer auto-grants it to ADMIN - an
  // existing Administrator (who still holds roles.manage, always
  // guaranteed) needs to check the new box the same as for any role.
  session.permissions = role.permissions;
  session.districtId = user.districtId ?? null;
  session.branchId = user.branchId ?? null;
  session.mustChangePassword = user.mustChangePassword ?? false;
  session.sessionVersion = user.sessionVersion ?? 1;
  await session.save();

  return NextResponse.json({ user: toSafeUser({ ...user, lastLoginAt: loginTime }) });
}
