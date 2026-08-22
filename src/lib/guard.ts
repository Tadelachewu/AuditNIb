import { NextResponse } from "next/server";
import { getSession, type SessionData } from "@/lib/session";
import { hasAnyPermission } from "@/lib/permissions/registry";

type Ok = { ok: true; session: SessionData };
type Err = { ok: false; response: NextResponse };

/**
 * Server/API-side authorization check. The UI hides links and routes for
 * permissions a user doesn't hold, and src/proxy.ts redirects at the edge,
 * but those are convenience only - every mutating or data-returning API
 * route must call this (or requirePermission) itself, since the client can
 * never be trusted to enforce access control.
 */
export async function requireUser(): Promise<Ok | Err> {
  const session = await getSession();
  if (!session.isLoggedIn || !session.userId) {
    return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
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
