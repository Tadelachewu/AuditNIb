import { ERROR_CODES, isErrorCode, type ErrorCode } from "@/lib/errors";

/**
 * The browser's single way to call this app's API. Every failure becomes an
 * ApiError carrying the server's stable `code`, a user-safe `message`,
 * optional `details` (field errors, row lists, ...) and the `requestId` to
 * quote to support - so components never parse error bodies themselves.
 *
 *   try { await apiSend("/api/x", "POST", body) }
 *   catch (err) { setError(errorMessage(err)) }          // inline / field UI
 *   ...or toast.error(errorMessage(err)) for transient row actions.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | "NETWORK_ERROR" | (string & {});
  readonly details: unknown;
  readonly requestId: string | null;

  constructor(message: string, status: number, opts: { code?: string; details?: unknown; requestId?: string | null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = opts.code ?? "INTERNAL_SERVER_ERROR";
    this.details = opts.details ?? null;
    this.requestId = opts.requestId ?? null;
  }

  /** Field -> messages, when the server returned a VALIDATION_ERROR with field detail. */
  get fieldErrors(): Record<string, string[]> {
    const d = this.details as { fieldErrors?: Record<string, string[]> } | null;
    return d?.fieldErrors ?? {};
  }
}

const NETWORK_MESSAGE = "Can't reach the server. Check your connection and try again.";

/** Reads any failed response (standard contract, legacy `{ error }`, or non-JSON) into an ApiError. */
export async function toApiError(res: Response): Promise<ApiError> {
  const headerId = res.headers.get("x-request-id");
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const err = body?.error;
  if (err && typeof err === "object") {
    const e = err as { code?: unknown; message?: unknown; details?: unknown };
    const code = typeof e.code === "string" ? e.code : undefined;
    return new ApiError(safeMessage(e.message, code, res.status), res.status, {
      code,
      details: e.details,
      requestId: (typeof body?.requestId === "string" ? body.requestId : null) ?? headerId,
    });
  }
  if (typeof err === "string") {
    const extra = Object.fromEntries(Object.entries(body!).filter(([k]) => k !== "error"));
    return new ApiError(err, res.status, { details: Object.keys(extra).length ? extra : null, requestId: headerId });
  }
  return new ApiError(safeMessage(undefined, undefined, res.status), res.status, { requestId: headerId });
}

function safeMessage(message: unknown, code: string | undefined, status: number): string {
  if (typeof message === "string" && message.trim()) return message;
  if (isErrorCode(code)) return ERROR_CODES[code].message;
  return status >= 500 ? ERROR_CODES.INTERNAL_SERVER_ERROR.message : `Request failed (${status})`;
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(NETWORK_MESSAGE, 0, { code: "NETWORK_ERROR" });
  }
  if (!res.ok) throw await toApiError(res);
  return (await res.json().catch(() => ({}))) as T;
}

/**
 * `background: true` = an automatic poll (not something the user did): it
 * doesn't count as activity for the session idle timeout, and if it finds
 * the session has ended the page goes to sign-in right away instead of
 * sitting there until the next click.
 */
export async function apiGet<T>(url: string, init: { signal?: AbortSignal; background?: boolean } = {}): Promise<T> {
  try {
    return await request<T>(url, {
      cache: "no-store",
      signal: init.signal,
      headers: init.background ? { "x-background-request": "1" } : undefined,
    });
  } catch (err) {
    if (init.background && err instanceof ApiError && err.status === 401 && typeof window !== "undefined") {
      // Full page load on purpose: the route clears the stale cookie, then shows sign-in.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/api/auth/session-ended");
    }
    throw err;
  }
}

export async function apiSend<T>(url: string, method: "POST" | "PATCH" | "DELETE", data?: unknown): Promise<T> {
  return request<T>(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
}

/** Multipart upload (files). */
export async function apiUpload<T>(url: string, form: FormData, method: "POST" | "PATCH" = "POST"): Promise<T> {
  return request<T>(url, { method, body: form });
}

/**
 * The user-facing text for any caught error. Unknown (non-API) errors get a
 * generic message - their raw text is never shown. A server error's
 * request ID is appended so the user can quote it to support.
 */
export function errorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (err instanceof ApiError) {
    return err.status >= 500 && err.requestId ? `${err.message} (Reference: ${err.requestId.slice(0, 8)})` : err.message;
  }
  return fallback;
}
