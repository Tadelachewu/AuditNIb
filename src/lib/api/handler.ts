import { NextResponse } from "next/server";
import { ApplicationError, codeForStatus, isErrorCode, type ApiErrorBody } from "@/lib/errors";
import { toApplicationError } from "@/lib/errors/normalize";
import "@/lib/errors/zodMessages";
import { logger } from "@/lib/logger";
import { captureServerException } from "@/lib/monitoring";
import { REQUEST_ID_HEADER, getRequestContext, resolveRequestId, runWithRequestContext } from "@/lib/requestContext";

/**
 * Central error handling for every API Route Handler.
 *
 *   export const POST = withApiHandler(async (request, ctx) => { ... });
 *
 * - Request ID: taken from the proxy's x-request-id (or generated), bound
 *   to every log line via AsyncLocalStorage, echoed in the response header
 *   and in every error body.
 * - Expected failures: throw an ApplicationError (or return a legacy
 *   `NextResponse.json({ error: "..." }, { status })`) -> the standard
 *   error contract with the right status and a stable code.
 * - Unexpected failures (anything else thrown): logged at ERROR with the
 *   stack, reported to monitoring, and answered with a generic 500 - the
 *   raw exception never reaches the browser.
 * - One access-log line per request (status, duration, error code).
 *
 * Handlers therefore need no try/catch of their own for error reporting.
 */

// Next's route handler context (params is a Promise in this Next version).
type RouteContext = { params: Promise<Record<string, string | string[]>> };
type Handler<C> = (request: Request, context: C) => Promise<Response> | Response;

export function withApiHandler<C = RouteContext>(handler: Handler<C>): (request: Request, context: C) => Promise<Response> {
  return async (request: Request, context: C) => {
    const started = performance.now();
    const url = new URL(request.url);
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    const ctx = { requestId, method: request.method, path: url.pathname };

    return runWithRequestContext(ctx, async () => {
      let response: Response;
      let errorCode: string | undefined;
      try {
        response = await handler(request, context);
        if (response.status >= 400) {
          const normalized = await normalizeLegacyErrorResponse(response, requestId);
          response = normalized.response;
          errorCode = normalized.code;
        }
      } catch (thrown) {
        const appError = toApplicationError(thrown);
        errorCode = appError.code;
        await reportError(appError, thrown);
        response = errorResponse(appError, requestId);
      }

      trySetHeader(response, REQUEST_ID_HEADER, requestId);
      logAccess(response.status, errorCode, performance.now() - started);
      return response;
    });
  };
}

/** Builds the standard error response for an ApplicationError. */
export function errorResponse(err: ApplicationError, requestId: string | null = getRequestContext()?.requestId ?? null): NextResponse<ApiErrorBody> {
  const body: ApiErrorBody = {
    success: false,
    error: {
      code: err.code,
      // 5xx messages are always the catalog's generic text, whatever was passed in.
      message: err.status >= 500 ? genericMessage(err) : err.message,
      details: err.status >= 500 ? null : (err.details ?? null),
    },
    requestId,
  };
  const res = NextResponse.json(body, { status: err.status });
  for (const [k, v] of Object.entries(err.headers ?? {})) res.headers.set(k, v);
  if (requestId) res.headers.set(REQUEST_ID_HEADER, requestId);
  return res;
}

function genericMessage(err: ApplicationError): string {
  // ExternalServiceError/DatabaseError/etc. carry their catalog message,
  // which is written to be user-safe; only a caller-supplied override on a
  // 5xx is discarded (it may contain internals).
  return new ApplicationError(err.code).message;
}

async function reportError(appError: ApplicationError, original: unknown): Promise<void> {
  const cause = original instanceof ApplicationError ? (original.cause ?? original) : original;
  if (appError.expected) {
    // Expected: not an incident. The access line below records it at WARN.
    logger.info({ errorCode: appError.code, statusCode: appError.status }, appError.message);
    return;
  }
  logger.error({ err: cause, errorCode: appError.code, statusCode: appError.status }, "Unhandled error in API route");
  await captureServerException(cause, { errorCode: appError.code });
}

/**
 * Existing handlers return `NextResponse.json({ error: "message", ...extra }, { status })`.
 * Rewrites those into the standard contract (code from `code` if given,
 * else from the status; any extra fields become `details`) while keeping
 * the status and headers (Retry-After, Set-Cookie, ...). Responses already
 * in the contract just get their requestId filled in.
 */
async function normalizeLegacyErrorResponse(response: Response, requestId: string): Promise<{ response: Response; code?: string }> {
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) return { response };
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return { response };
  }
  if (!body || typeof body !== "object") return { response };
  const b = body as Record<string, unknown>;

  if (b.success === false && b.error && typeof b.error === "object") {
    const code = String((b.error as { code?: unknown }).code ?? "");
    if (b.requestId) return { response, code };
    return { response: rebuild(response, { ...b, requestId }), code };
  }

  if (typeof b.error !== "string") return { response };
  const { error: message, code: explicitCode, ...extra } = b;
  const code = isErrorCode(explicitCode) ? explicitCode : codeForStatus(response.status);
  const isServerError = response.status >= 500;
  const contract: ApiErrorBody = {
    success: false,
    error: {
      code,
      message: isServerError ? new ApplicationError(code).message : message,
      details: !isServerError && Object.keys(extra).length > 0 ? extra : null,
    },
    requestId,
  };
  if (isServerError) {
    // A handler-written 5xx message is logged, not trusted as client-safe.
    logger.error({ errorCode: code, statusCode: response.status, handlerMessage: message }, "API route returned a server error");
  } else {
    logger.info({ errorCode: code, statusCode: response.status }, message);
  }
  return { response: rebuild(response, contract), code };
}

function rebuild(original: Response, body: unknown): Response {
  const headers = new Headers(original.headers);
  headers.delete("content-length");
  return NextResponse.json(body, { status: original.status, headers });
}

function trySetHeader(res: Response, k: string, v: string): void {
  try {
    res.headers.set(k, v);
  } catch {
    // Immutable headers (e.g. Response.redirect) - the ID is still in the logs.
  }
}

function logAccess(statusCode: number, errorCode: string | undefined, durationMs: number): void {
  const fields = { statusCode, errorCode, duration: Math.round(durationMs) };
  if (statusCode >= 500) logger.error(fields, "request completed");
  else if (statusCode >= 400) logger.warn(fields, "request completed");
  // Successful reads (incl. the 30-second notification poll) at DEBUG; writes at INFO.
  else if (getRequestContext()?.method === "GET") logger.debug(fields, "request completed");
  else logger.info(fields, "request completed");
}
