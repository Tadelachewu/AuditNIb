import { NextResponse } from "next/server";
import { getSession, type SessionData } from "@/lib/session";
import type { Role } from "@/types";

type Ok = { ok: true; session: SessionData };
type Err = { ok: false; response: NextResponse };

/**
 * Server/API-side authorization check. The UI hides links and routes for
 * roles that shouldn't see them, but that is a convenience only - every
 * mutating or data-returning API route must call this (or requireRole)
 * itself, since the client can never be trusted to enforce access control.
 */
export async function requireUser(): Promise<Ok | Err> {
  const session = await getSession();
  if (!session.isLoggedIn || !session.userId) {
    return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  return { ok: true, session };
}

export async function requireRole(...roles: Role[]): Promise<Ok | Err> {
  const result = await requireUser();
  if (!result.ok) return result;
  if (!roles.includes(result.session.role as Role)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return result;
}
