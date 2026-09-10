import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { appendAuditLog } from "@/lib/audit";
import { validatePasswordFull } from "@/lib/passwordValidation";
import { checkLockout, recordFailureForLockout, clearLockout, isRateLimited, recordAttempt, clearRateLimit } from "@/lib/rateLimit";

const schema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

// Same shape of protection as login (see that route's own doc comment) -
// keyed by userId alone rather than IP+username, since the caller is
// already authenticated here; this only ever throttles someone who knows a
// valid session but is guessing at the *current* password (e.g. a stolen,
// still-logged-in session cookie, or the account's own user forgetting it).
const ACCOUNT_LOCKOUT = { maxFailures: 5, windowMs: 15 * 60 * 1000, lockoutMs: 15 * 60 * 1000 };
const RATE_LIMIT = { max: 5, windowMs: 15 * 60 * 1000 };

// The one self-service action every user has regardless of role or
// permissions - changing your own password requires no permission key,
// just proof you know the current one. This is what clears
// mustChangePassword (see User.mustChangePassword's doc comment), whether
// that flag came from initial account creation or an admin's reset.
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { currentPassword, newPassword } = parsed.data;

  const lockoutKey = `change-password:${auth.session.userId}`;
  const lockout = await checkLockout(lockoutKey);
  if (lockout.locked) {
    return NextResponse.json(
      { error: "Too many incorrect attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(lockout.retryAfterSeconds) } }
    );
  }
  const rateLimit = await isRateLimited(lockoutKey, RATE_LIMIT);
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const db = await readDb();
  const existing = db.users.find((u) => u.id === auth.session.userId);
  if (!existing) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (!verifyPassword(currentPassword, existing.passwordHash)) {
    await Promise.all([recordAttempt(lockoutKey, RATE_LIMIT), recordFailureForLockout(lockoutKey, ACCOUNT_LOCKOUT)]);
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
  }
  await Promise.all([clearRateLimit(lockoutKey), clearLockout(lockoutKey)]);

  // A forced change (mustChangePassword) is also this account's first real
  // use - require a recovery email be on file before letting them settle
  // into the account, since there'd otherwise be no way to reach them (or
  // for them to self-serve a future reset) at all. The Email card is
  // already on the same /profile page, right above this form.
  if (existing.mustChangePassword && !existing.email) {
    return NextResponse.json(
      { error: "Set your email address first (see the Email section above) before changing your password." },
      { status: 400 }
    );
  }

  const strength = await validatePasswordFull(newPassword);
  if (!strength.valid) {
    return NextResponse.json({ error: strength.error }, { status: 400 });
  }

  const nextSessionVersion = (existing.sessionVersion ?? 1) + 1;
  await updateDb((current) => {
    const u = current.users.find((x) => x.id === existing.id)!;
    u.passwordHash = hashPassword(newPassword);
    u.mustChangePassword = false;
    u.passwordExpiresAt = null;
    u.sessionVersion = nextSessionVersion;
    u.updatedAt = new Date().toISOString();
    // Never log password material itself - just that the event happened.
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "CHANGE_PASSWORD",
      entityType: "User",
      entityId: u.id,
    });
  });

  // Rebuilt from scratch, not just patched in place - sessionVersion has to
  // change here too (see User.sessionVersion's own doc comment), and the
  // cleanest way to guarantee the cookie's whole session state is
  // consistent with the just-updated DB row is to destroy it and
  // re-populate every field the login route itself sets, rather than only
  // touching mustChangePassword as before. This is also what makes every
  // *other* still-logged-in session for this account stop working on its
  // next request - only this one, freshly reissued, carries the new
  // sessionVersion.
  const role = db.roles.find((r) => r.code === existing.role);
  const session = await getSession();
  session.destroy();
  session.isLoggedIn = true;
  session.userId = existing.id;
  session.username = existing.username;
  session.name = existing.name;
  session.role = existing.role;
  session.roleName = role?.name;
  session.orgScope = role?.orgScope;
  session.permissions = role?.permissions;
  session.districtId = existing.districtId ?? null;
  session.branchId = existing.branchId ?? null;
  session.mustChangePassword = false;
  session.sessionVersion = nextSessionVersion;
  await session.save();

  return NextResponse.json({ ok: true });
}
