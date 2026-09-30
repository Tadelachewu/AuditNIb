import { cookies } from "next/headers";
import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import { prisma } from "@/lib/prismaClient";
import type { OrgScope } from "@/types";

export interface SessionData {
  isLoggedIn: boolean;
  userId?: string;
  username?: string;
  name?: string;
  role?: string;
  roleName?: string;
  // Which role-specific dashboard to render (see src/app/(app)/dashboard/page.tsx)
  // is decided from this, not from the role code, so custom roles route
  // sensibly too.
  orgScope?: OrgScope;
  // Resolved from the user's RoleDefinition at login time (see
  // src/app/api/auth/login/route.ts) and carried in the encrypted cookie so
  // src/proxy.ts can authorize requests without a filesystem read. This
  // means a permission change to a role only takes effect for a user's
  // *next* login, same trade-off already made for `status` (see PHASE1.md).
  permissions?: string[];
  districtId?: string | null;
  branchId?: string | null;
  // Mirrors User.mustChangePassword at login time, same "resolved at login,
  // carried in the cookie" pattern as `permissions` - src/proxy.ts runs at
  // the Edge and can't read the JSON db, so this has to travel in the
  // session like everything else it gates on. Updated in-place (without a
  // re-login) by POST /api/auth/change-password the moment it succeeds.
  mustChangePassword?: boolean;
  // Snapshot of User.sessionVersion at login time - src/lib/guard.ts's
  // requireUser() compares this against the current DB value on every
  // request and force-logs-out on a mismatch. See User.sessionVersion's
  // own doc comment for why (revoking a stateless session cookie on
  // password change without a server-side session store).
  sessionVersion?: number;
  // Epoch ms at which this session was originally issued (login / password
  // change / session reissue). Compared against the absolute timeout on
  // every guarded request to force a relogin even with continuous activity.
  sessionCreatedAt?: number;
  // Epoch ms at which this session last saw a guarded request. Compared
  // against the idle timeout to sign out an inactive user; updated (and the
  // cookie re-sent) on each request that passes all other checks.
  lastActivityAt?: number;
}

const password = process.env.IRON_SESSION_PASSWORD;
if (!password || password.length < 32) {
  throw new Error(
    "IRON_SESSION_PASSWORD env var must be set to a random string of at least 32 characters. See .env.example."
  );
}

const _parseIntEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = parseInt(raw, 10);
  if (!isFinite(n) || n <= 0) return fallback;
  return n;
};

const IDLE_TIMEOUT_MINUTES = _parseIntEnv("SESSION_IDLE_TIMEOUT_MINUTES", 30);
const ABSOLUTE_TIMEOUT_HOURS = _parseIntEnv("SESSION_ABSOLUTE_TIMEOUT_HOURS", 8);
export const IDLE_TIMEOUT_MS = IDLE_TIMEOUT_MINUTES * 60 * 1000;
export const ABSOLUTE_TIMEOUT_MS = ABSOLUTE_TIMEOUT_HOURS * 60 * 60 * 1000;
const ABSOLUTE_TIMEOUT_SECONDS = ABSOLUTE_TIMEOUT_HOURS * 60 * 60;

const isSecureContext =
  process.env.SESSION_COOKIE_SECURE === "true" ||
  (process.env.SESSION_COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production");

export const sessionOptions: SessionOptions = {
  password,
  cookieName: "nib_control360_session",
  cookieOptions: {
    secure: isSecureContext,
    sameSite: "lax",
    httpOnly: true,
    // Browser-level cap — the cookie is dropped by the UA after this many
    // seconds even if neither of the server-side checks below ever fires.
    // Uses the absolute (not idle) window as a safety net; the idle check
    // below is what normally terminates the session first.
    //
    // Note: deliberately NOT setting the iron-session `ttl` option (which
    // enforces seal-level expiry at decrypt time) because (a) proxy.ts's
    // middleware decrypt runs *before* the application-level checks and
    // both layers need to agree on session liveness, and (b) the
    // absolute-timeout check in getCurrentUser() already enforces the
    // same wall-clock cap. Relying on cookie Max-Age alone at the browser
    // layer keeps two (not three) places enforcing expiry, and avoids any
    // unit / refresh-time misalignment between seal ttl and cookie
    // Max-Age.
    maxAge: ABSOLUTE_TIMEOUT_SECONDS,
  },
};

export const defaultSession: SessionData = { isLoggedIn: false };

/** Use inside Server Components, Server Actions, and Route Handlers. */
export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  if (session.isLoggedIn === undefined) {
    session.isLoggedIn = false;
  }
  return session;
}

/**
 * Returns the logged-in session, or null if there isn't one - the single
 * source of truth every Server Component page AND src/lib/guard.ts's
 * requireUser() both call, so a stale session is rejected identically
 * everywhere, not just on API routes.
 *
 * "Logged in" here means more than "the cookie decrypts and says so": a
 * single, cheap, indexed lookup of just this one user's sessionVersion and
 * status is compared against what the cookie itself carries. A mismatch
 * means either the password changed (see User.sessionVersion's own doc
 * comment) or the account was deactivated since this cookie was issued -
 * in both cases the session is destroyed and treated as logged out here,
 * rather than staying valid (and, before this check existed, actually
 * rendering pages with live data) until it naturally expired.
 *
 * Additionally, two time-based expiration checks are applied before the
 * DB lookup:
 *
 *   1. Absolute expiry: if `now - sessionCreatedAt >= ABSOLUTE_TIMEOUT_MS`
 *      the session is destroyed regardless of activity — users must log in
 *      again to continue.
 *
 *   2. Idle expiry: if `now - lastActivityAt >= IDLE_TIMEOUT_MS` the user
 *      is signed out; activity resets the window.
 *
 * On success the session's lastActivityAt is refreshed and the cookie is
 * re-saved (best-effort; the save is skipped silently when called from a
 * Server Component — same caveat as the destroy() block below). This also
 * refreshes the cookie's Max-Age, giving the idle window a true sliding
 * expiration at the browser level for callers that can write cookies.
 */
export async function getCurrentUser(): Promise<SessionData | null> {
  const session = await getSession();
  if (!session.isLoggedIn || !session.userId) return null;

  const now = Date.now();

  // Sessions issued before the timestamp fields were added (or issued by a
  // version that set them as undefined / 0) won't have createdAt or
  // lastActivityAt. Instead of immediately killing them (which would
  // force a relogin storm on deploy and interact badly with the proxy's
  // own "isLoggedIn && isPublicPath → /dashboard" redirect creating a
  // loop), gracefully populate them with "now" on the first successful
  // pass. The idle/absolute windows then start counting from this point,
  // same as a login-time issuance. This is only possible if the session
  // also passes the sessionVersion + ACTIVE check, so there is no
  // security trade-off — a session that survives those checks with
  // missing timestamps was genuinely valid; we're just not retroactively
  // enforcing timestamps against cookies baked before the feature.
  const createdAtMissing = !session.sessionCreatedAt;
  const lastActiveMissing = !session.lastActivityAt;
  const createdAt = session.sessionCreatedAt ?? now;
  const lastActive = session.lastActivityAt ?? now;

  const absoluteExpired = !createdAtMissing && now - createdAt >= ABSOLUTE_TIMEOUT_MS;
  const idleExpired = !lastActiveMissing && now - lastActive >= IDLE_TIMEOUT_MS;

  if (absoluteExpired || idleExpired) {
    try {
      session.destroy();
    } catch {
      // Expected when called from a Server Component - see below.
    }
    return null;
  }

  const current = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { sessionVersion: true, status: true },
  });
  if (!current || current.status !== "ACTIVE" || current.sessionVersion !== (session.sessionVersion ?? 1)) {
    try {
      session.destroy();
    } catch {
      // Expected when called from a Server Component - see below.
    }
    return null;
  }

  // All checks passed: bump lastActivityAt and persist so the idle window
  // slides forward on every request. For the backfill case above we also
  // write sessionCreatedAt=now the first time, so a previously-timestampless
  // session now has both fields anchored at the time we first saw it.
  // `.save()` — like `.destroy()` above — throws inside Server Components
  // because Next.js forbids writing Set-Cookie from a page render.
  // Swallow it in that case; idle refreshes still happen from every API
  // route / Server Action (which go through requireUser() in guard.ts,
  // inside a Route Handler where save works), and the absolute timeout
  // plus browser cookie maxAge act as safety nets even if no
  // idle-refreshing call is ever made.
  if (createdAtMissing) session.sessionCreatedAt = now;
  session.lastActivityAt = now;
  try {
    await session.save();
  } catch {
    // Called from a Server Component page render — no-op here, refreshed
    // on the next API call instead.
  }

  return session;
}

/**
 * Send a user with an invalid session here (not straight to /login): it
 * clears the stale cookie first - see src/app/api/auth/session-ended/route.ts.
 */
export const SESSION_ENDED_PATH = "/api/auth/session-ended";
