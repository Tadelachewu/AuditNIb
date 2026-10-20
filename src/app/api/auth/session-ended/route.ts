import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { sessionOptions, ABSOLUTE_TIMEOUT_MS, IDLE_TIMEOUT_MS, type SessionData } from "@/lib/session";
import { prisma } from "@/lib/prismaClient";
import { getCurrentUser } from "@/lib/session";

/**
 * Where pages send a user whose session is no longer valid (signed in on
 * another device, idle/absolute timeout, deactivated, password changed).
 *
 * Pages can't delete cookies while rendering, so redirecting them straight
 * to /login left the stale cookie in place - and the proxy sends anyone
 * with a cookie away from /login back to /dashboard, which sent them to
 * /login again: ERR_TOO_MANY_REDIRECTS. A Route Handler CAN clear the
 * cookie, so this ends the loop: clear it, then show the sign-in page.
 */
export async function GET(request: Request) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);

  // A GET any other site can link to: never let it sign out a session that
  // is still valid (a forged "log out" link) - only a dead one is cleared.
  // "Valid" = valid to both the proxy's timeout check (src/proxy.ts) and
  // getCurrentUser(), so the two can never bounce a user between them.
  const proxyTimedOut =
    (session.sessionCreatedAt !== undefined && Date.now() - session.sessionCreatedAt >= ABSOLUTE_TIMEOUT_MS) ||
    (session.lastActivityAt !== undefined && Date.now() - session.lastActivityAt >= IDLE_TIMEOUT_MS);
  if (!proxyTimedOut && (await getCurrentUser())) return NextResponse.redirect(new URL("/dashboard", request.url));

  const url = new URL("/login", request.url);
  url.searchParams.set("reason", "session-ended");

  // Tell the user WHY, when it can be told from the cookie they still hold:
  // a newer sign-in to their account (which they should know about if it
  // wasn't them), or a timeout.
  try {
    if (session.isLoggedIn && session.userId) {
      const now = Date.now();
      const timedOut =
        (session.sessionCreatedAt !== undefined && now - session.sessionCreatedAt >= ABSOLUTE_TIMEOUT_MS) ||
        (session.lastActivityAt !== undefined && now - session.lastActivityAt >= IDLE_TIMEOUT_MS);
      const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { status: true, sessionVersion: true, lastLoginAt: true } });
      const newerSignIn =
        user?.status === "ACTIVE" &&
        user.sessionVersion !== (session.sessionVersion ?? 1) &&
        user.lastLoginAt !== null &&
        session.sessionCreatedAt !== undefined &&
        user.lastLoginAt.getTime() > session.sessionCreatedAt;
      if (newerSignIn) {
        url.searchParams.set("reason", "signed-in-elsewhere");
        url.searchParams.set("at", user.lastLoginAt!.toISOString());
      } else if (timedOut) {
        url.searchParams.set("reason", "timed-out");
      }
    }
  } catch {
    // The generic message is shown.
  }

  session.destroy();
  return NextResponse.redirect(url);
}
