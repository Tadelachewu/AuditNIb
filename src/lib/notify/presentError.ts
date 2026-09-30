import { ApiError } from "@/lib/api-client";
import { notifications, SAFE_SYSTEM_MESSAGES, type Notice } from "@/lib/notify/catalog";

/**
 * How the UI should present a failed operation - decided by the error's
 * CODE, not by the backend. The backend never knows about toasts; this is
 * the one frontend mapping from API error codes to presentation.
 *
 *   field       VALIDATION_ERROR with field details -> show next to the fields
 *   auth        AUTHENTICATION_FAILED / SESSION_EXPIRED -> back to sign-in
 *   permission  AUTHORIZATION_DENIED -> permission message
 *   notFound    RESOURCE_NOT_FOUND -> "no longer exists"
 *   business    any other 4xx (business rule, conflict, validation w/o
 *               fields, rate limit) -> the server's safe message
 *   system      5xx / network / unknown -> the action's own failure text
 *               (or a safe generic), plus a support reference
 *
 * Raw exception text (non-ApiError, or any 5xx message) is never used.
 */
export type ErrorPresentation =
  | { kind: "field"; message: string; fieldErrors: Record<string, string[]> }
  | { kind: "auth"; message: string }
  | { kind: "permission"; message: string }
  | { kind: "notFound"; message: string }
  | { kind: "business"; message: string; code: string }
  | { kind: "system"; message: string; code: string; reference: string | null };

export function presentError(err: unknown, failure?: Notice): ErrorPresentation {
  if (!(err instanceof ApiError)) {
    return { kind: "system", message: failure?.message ?? SAFE_SYSTEM_MESSAGES.UNKNOWN_ERROR, code: "UNKNOWN_ERROR", reference: null };
  }
  const code = String(err.code);

  if (code === "NETWORK_ERROR") {
    return { kind: "system", message: SAFE_SYSTEM_MESSAGES.NETWORK_ERROR, code, reference: null };
  }
  if (code === "AUTHENTICATION_FAILED" || code === "SESSION_EXPIRED") {
    return { kind: "auth", message: notifications.auth.sessionExpired.message };
  }
  if (code === "AUTHORIZATION_DENIED" || code === "CROSS_ORIGIN_REJECTED") {
    return { kind: "permission", message: notifications.generic.noPermission.message };
  }
  if (code === "RESOURCE_NOT_FOUND") {
    return { kind: "notFound", message: err.message || notifications.generic.notFound.message };
  }
  if (err.status >= 500 || err.status === 0) {
    return {
      kind: "system",
      message: failure?.message ?? SAFE_SYSTEM_MESSAGES[code] ?? SAFE_SYSTEM_MESSAGES.INTERNAL_SERVER_ERROR,
      code,
      reference: err.requestId ? err.requestId.slice(0, 8) : null,
    };
  }
  if (code === "VALIDATION_ERROR" && Object.keys(err.fieldErrors).length > 0) {
    return { kind: "field", message: notifications.generic.fixFields.message, fieldErrors: err.fieldErrors };
  }
  // Expected 4xx: the server's message is user-safe by contract (src/lib/errors).
  return { kind: "business", message: err.message || failure?.message || SAFE_SYSTEM_MESSAGES.UNKNOWN_ERROR, code };
}
