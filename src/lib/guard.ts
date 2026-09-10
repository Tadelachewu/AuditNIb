import { NextResponse } from "next/server";
import { getSession, type SessionData } from "@/lib/session";
import { hasAnyPermission } from "@/lib/permissions/registry";
import { prisma } from "@/lib/prismaClient";

type Ok = { ok: true; session: SessionData };
type Err = { ok: false; response: NextResponse };

// A function, not a shared constant - NextResponse wraps a body stream, and
// reusing one instance across multiple requests/responses is unsafe (the
// stream can only be consumed once).
function notAuthenticated(): Err {
  return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
}

/**
 * Server/API-side authorization check. The UI hides links and routes for
 * permissions a user doesn't hold, and src/proxy.ts redirects at the edge,
 * but those are convenience only - every mutating or data-returning API
 * route must call this (or requirePermission) itself, since the client can
 * never be trusted to enforce access control.
 *
 * Also revokes an already-issued session cookie the moment it goes stale:
 * a single, cheap, indexed lookup of just this one user's sessionVersion
 * and status (not a full readDb() - most routes already do one of those
 * separately for their own data needs, but requireUser() shouldn't force
 * that cost on the ones that don't) compared against what the cookie
 * itself carries. A mismatch means either the password changed since this
 * cookie was issued (see User.sessionVersion's own doc comment) or the
 * account was deactivated after the cookie was issued - in both cases the
 * session is destroyed and treated as logged out, rather than staying
 * valid until it naturally expires.
 */
export async function requireUser(): Promise<Ok | Err> {
  const session = await getSession();
  if (!session.isLoggedIn || !session.userId) {
    return notAuthenticated();
  }

  const current = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { sessionVersion: true, status: true },
  });
  if (!current || current.status !== "ACTIVE" || current.sessionVersion !== (session.sessionVersion ?? 1)) {
    session.destroy();
    return notAuthenticated();
  }

  return { ok: true, session };
}

/**
 * Requires the caller's session to hold at least one of the given
 * permission keys (see src/lib/permissions/registry.ts), e.g.
 * requirePermission("users.create"). Permissions are resolved from the
 * user's role at login time and carried in the session cookie.
 */
export async function requirePermission(...keys: string[]): Promise<Ok | Err> {
  const result = await requireUser();
  if (!result.ok) return result;
  if (!hasAnyPermission(result.session.permissions, keys)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return result;
}

/**
 * Several admin PATCH endpoints double as both "toggle active/inactive"
 * (one field: `toggleField`) and a general edit (any other field). Those
 * are two different action-level permissions - "<page>.toggle-status" vs
 * "<page>.edit" - even though they share one route handler. Pass the
 * parsed request body; this infers which permission applies and checks it.
 */
export async function requireToggleOrEditPermission(
  pageCode: string,
  body: Record<string, unknown>,
  toggleField = "status"
): Promise<Ok | Err> {
  const keys = Object.keys(body);
  const isToggleOnly = keys.length > 0 && keys.every((k) => k === toggleField);
  return requirePermission(isToggleOnly ? `${pageCode}.toggle-status` : `${pageCode}.edit`);
}
