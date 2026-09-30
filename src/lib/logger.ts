import pino from "pino";
import { getRequestContext } from "@/lib/requestContext";

/**
 * Structured JSON logging (Pino) - one line per event on stdout, for the
 * process manager / log shipper to collect (see docs/PRODUCTION.md).
 *
 * Levels: debug < info < warn < error < fatal. LOG_LEVEL env var, default
 * "info" in production and "debug" in development.
 *
 * Every line automatically carries the current requestId / userId / method
 * / path (from src/lib/requestContext.ts) and an ISO timestamp.
 *
 * Secrets are removed by `redact` BEFORE serialisation - even if a caller
 * passes a whole request body or header object by mistake.
 */

// Any of these keys, at the top level or one/two levels deep, is censored.
const SENSITIVE_KEYS = [
  "password",
  "newPassword",
  "currentPassword",
  "confirmPassword",
  "passwordHash",
  "token",
  "accessToken",
  "refreshToken",
  "resetToken",
  "apiKey",
  "secret",
  "authorization",
  "cookie",
  "set-cookie",
  "smtpPassword",
  "encryptionKey",
  "privateKey",
];
const redactPaths = SENSITIVE_KEYS.flatMap((k) => {
  const key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : `["${k}"]`;
  const dot = key.startsWith("[") ? "" : ".";
  return [key, `*${dot}${key}`, `*.*${dot}${key}`];
});

/** Builds the app logger; `destination` is for tests (defaults to stdout). */
export function createLogger(destination?: pino.DestinationStream) {
  return pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
  base: { service: "nib-control360", env: process.env.APP_ENV ?? process.env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  messageKey: "message",
  formatters: {
    // "level":"error" instead of "level":50 - readable and what log tools expect.
    level: (label) => ({ level: label }),
  },
  mixin() {
    const ctx = getRequestContext();
    return ctx ? { requestId: ctx.requestId, userId: ctx.userId, method: ctx.method, path: ctx.path } : {};
  },
  redact: { paths: redactPaths, censor: "[REDACTED]" },
  serializers: { err: serializeError, error: serializeError },
  }, destination);
}

export const logger = createLogger();

/**
 * Error serializer: name, message, code and stack (server logs only), plus
 * the `cause` chain one level deep. Never includes arbitrary enumerable
 * fields of the error object (Prisma/SMTP errors can carry query text,
 * connection details or credentials there).
 */
function serializeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { message: String(err) };
  const e = err as Error & { code?: unknown; status?: unknown; cause?: unknown };
  return {
    type: e.name,
    message: scrub(e.message),
    code: typeof e.code === "string" || typeof e.code === "number" ? e.code : undefined,
    status: typeof e.status === "number" ? e.status : undefined,
    stack: e.stack ? scrub(e.stack) : undefined,
    cause: e.cause instanceof Error ? { type: e.cause.name, message: scrub(e.cause.message), code: (e.cause as { code?: unknown }).code } : undefined,
  };
}

/** Removes credentials embedded in connection strings / URLs from free text. */
export function scrub(text: string): string {
  return text
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^:/?#@\s]+):([^@/\s]+)@/gi, "$1$2:[REDACTED]@")
    .replace(/(password|passwd|pwd|secret|token|api[_-]?key)(["'\s:=]+)([^\s"',;&]+)/gi, "$1$2[REDACTED]");
}
