import { NextResponse } from "next/server";
import type { SessionData } from "@/lib/session";

/**
 * Password re-confirmation for high-risk actions (docs/session-security.md):
 * resetting a user's password, changing a user's role, editing roles and
 * permissions, saving Settings. Having a session isn't enough for these -
 * the password must have been entered within the last few minutes, so a
 * stolen session (or an unlocked PC) can't take over other accounts.
 *
 * Server: `const refused = requireRecentAuth(auth.session); if (refused) return refused;`
 * Client: nothing per call - src/lib/api-client.ts sees the REAUTH_REQUIRED
 * answer, asks for the password (ReauthPrompt), confirms it through
 * POST /api/auth/reauth and repeats the request.
 */

export const REAUTH_REQUIRED = "REAUTH_REQUIRED";

/** How long one confirmation lasts (SESSION_REAUTH_MINUTES, default 10; 0 switches the requirement off). */
export function reauthWindowMs(): number {
  const raw = process.env.SESSION_REAUTH_MINUTES;
  const minutes = raw === undefined || raw.trim() === "" ? 10 : Number.parseInt(raw, 10);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes * 60_000 : 10 * 60_000;
}

export function hasRecentAuth(session: Pick<SessionData, "reauthAt">, now: number = Date.now()): boolean {
  const windowMs = reauthWindowMs();
  if (windowMs === 0) return true;
  return typeof session.reauthAt === "number" && now - session.reauthAt < windowMs;
}

/** null = go ahead; otherwise the 403 to send (the browser then asks for the password and retries). */
export function requireRecentAuth(session: Pick<SessionData, "reauthAt">): NextResponse | null {
  if (hasRecentAuth(session)) return null;
  return NextResponse.json(
    { success: false, error: { code: REAUTH_REQUIRED, message: "Confirm your password to continue.", details: null } },
    { status: 403 }
  );
}
