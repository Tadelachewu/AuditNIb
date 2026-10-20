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

/**
 * "Confirm your password" for high-risk actions (src/lib/reauth.ts): the
 * dialog (ReauthPrompt, mounted in the app layout) registers itself here.
 * It resolves true once the password was confirmed, false when cancelled.
 */
let reauthHandler: (() => Promise<boolean>) | null = null;
export function setReauthHandler(handler: (() => Promise<boolean>) | null): void {
  reauthHandler = handler;
}

async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(NETWORK_MESSAGE, 0, { code: "NETWORK_ERROR" });
  }
}

/**
 * Idempotency-Key (src/lib/idempotency.ts, docs/data-integrity.md): every
 * POST / PATCH / DELETE carries a random key, and a retry of the SAME
 * request (same method, address and body) carries the same key - so the
 * server answers a repeat instead of doing it twice:
 * - a dropped connection is retried automatically (twice), once the server
 *   has shown it supports keys (otherwise a retry could do it twice);
 * - "still processing" (REQUEST_IN_PROGRESS) is asked again a few times;
 * - after a failure with no answer, clicking again within 10 minutes reuses
 *   the key, so the first attempt's result is returned if it did get saved.
 */
let serverSupportsIdempotency = false;
const unansweredKeys = new Map<string, { key: string; at: number }>();
const KEY_REUSE_MS = 10 * 60 * 1000;

function newIdempotencyKey(): string {
  // getRandomValues works on plain http too (randomUUID needs https).
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Identifies "the same request" for reusing its key; null when the body can't be compared. */
function requestFingerprint(url: string, init: RequestInit): string | null {
  const body = init.body;
  let text = "";
  if (typeof body === "string") text = body;
  else if (typeof FormData !== "undefined" && body instanceof FormData) {
    text = [...body.entries()].map(([k, v]) => (typeof v === "string" ? `${k}=${v}` : `${k}=file:${v.name}:${v.size}:${v.lastModified}`)).join("&");
  } else if (body != null) return null;
  return `${init.method} ${url} ${text}`;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function errorCodeOf(res: Response): Promise<string | undefined> {
  const body = (await res.clone().json().catch(() => null)) as { error?: { code?: unknown } } | null;
  return typeof body?.error?.code === "string" ? body.error.code : undefined;
}

/** send() with the Idempotency-Key and its safe retries. */
async function sendWithKey(url: string, init: RequestInit): Promise<{ res: Response; init: RequestInit }> {
  const method = (init.method ?? "GET").toUpperCase();
  if (method === "GET") return { res: await send(url, init), init };

  const fingerprint = requestFingerprint(url, init);
  const earlier = fingerprint ? unansweredKeys.get(fingerprint) : undefined;
  const key = earlier && Date.now() - earlier.at < KEY_REUSE_MS ? earlier.key : newIdempotencyKey();
  if (fingerprint) unansweredKeys.set(fingerprint, { key, at: earlier?.key === key ? earlier.at : Date.now() });
  const keyed: RequestInit = { ...init, headers: { ...(init.headers as Record<string, string> | undefined), "Idempotency-Key": key } };

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await send(url, keyed);
    } catch (err) {
      // No answer: the server may or may not have done it. Retrying with the
      // same key is safe only when the server handles keys.
      if (serverSupportsIdempotency && err instanceof ApiError && err.code === "NETWORK_ERROR" && attempt < 2) {
        await wait(1000 * (attempt + 1));
        continue;
      }
      throw err; // the key stays remembered for a manual retry
    }
    if (res.headers.get("x-idempotency") === "on") serverSupportsIdempotency = true;
    if (res.status === 409 && (await errorCodeOf(res)) === "REQUEST_IN_PROGRESS") {
      if (attempt < 5) {
        await wait(1500);
        continue;
      }
      return { res, init: keyed }; // still running: keep the key for a manual retry
    }
    if (fingerprint) unansweredKeys.delete(fingerprint);
    return { res, init: keyed };
  }
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const sent = await sendWithKey(url, init);
  let res = sent.res;
  // The repeat below (after confirming the password) is the same request: same key.
  init = sent.init;
  if (!res.ok) {
    let err = await toApiError(res);
    // The server wants the password confirmed first: ask, then repeat the
    // same request once. Cancelling leaves the original refusal.
    if (err.code === "REAUTH_REQUIRED" && reauthHandler && (await reauthHandler())) {
      res = await send(url, init);
      if (res.ok) return (await res.json().catch(() => ({}))) as T;
      err = await toApiError(res);
    }
    throw err;
  }
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
