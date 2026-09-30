import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { sessionOptions, type SessionData } from "@/lib/session";

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
  session.destroy();
  const url = new URL("/login", request.url);
  url.searchParams.set("reason", "session-ended");
  return NextResponse.redirect(url);
}
