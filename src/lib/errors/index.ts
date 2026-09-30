/**
 * Application error model - the one vocabulary every layer uses.
 *
 * Isomorphic on purpose (no server-only imports): Route Handlers throw
 * these, the central handler (src/lib/api/handler.ts) turns them into the
 * API error contract, and the browser API client (src/lib/api-client.ts)
 * reads the same codes back. See docs/error-handling.md.
 *
 *   EXPECTED   (ApplicationError subclasses) -> controlled response, the
 *              `message` IS shown to the user, logged at WARN/INFO.
 *   UNEXPECTED (anything else)                -> logged at ERROR, sent to
 *              monitoring, the user only ever sees a generic message.
 */

/** Stable, machine-readable error codes. Never rename one - clients depend on them. */
export const ERROR_CODES = {
  // Generic (one per HTTP class)
  VALIDATION_ERROR: { status: 422, message: "Some of the information provided is invalid." },
  BAD_REQUEST: { status: 400, message: "The request could not be understood." },
  AUTHENTICATION_FAILED: { status: 401, message: "Please sign in to continue." },
  AUTHORIZATION_DENIED: { status: 403, message: "You don't have permission to do that." },
  RESOURCE_NOT_FOUND: { status: 404, message: "The requested item was not found." },
  CONFLICT: { status: 409, message: "This conflicts with the current state of the data." },
  PAYLOAD_TOO_LARGE: { status: 413, message: "The request is too large." },
  RATE_LIMIT_EXCEEDED: { status: 429, message: "Too many attempts. Please wait and try again." },
  INTERNAL_SERVER_ERROR: { status: 500, message: "Something went wrong. Please try again." },
  BAD_GATEWAY: { status: 502, message: "An upstream service returned an invalid response." },
  EXTERNAL_SERVICE_UNAVAILABLE: { status: 503, message: "A required service is temporarily unavailable. Please try again later." },
  DATABASE_ERROR: { status: 503, message: "The database is temporarily unavailable. Please try again." },
  UPSTREAM_TIMEOUT: { status: 504, message: "A required service took too long to respond. Please try again." },

  // Security / request integrity
  CROSS_ORIGIN_REJECTED: { status: 403, message: "Cross-origin request rejected." },
  SESSION_EXPIRED: { status: 401, message: "Your session has expired. Please sign in again." },

  // Business rules (meaningful, specific)
  BUSINESS_RULE_VIOLATION: { status: 409, message: "This action isn't allowed in the current state." },
  FINDING_NOT_READY_FOR_CLOSURE: { status: 409, message: "Nothing is ready to close - rectifications must be recorded and verified first." },
  PERIOD_LOCKED: { status: 409, message: "The reporting period is locked." },
  FINDING_NOT_REOPENABLE: { status: 409, message: "Only a closed or partially closed finding can be reopened." },
  LOCKOUT_PREVENTED: { status: 409, message: "This change would leave nobody able to undo it." },
  IMPORT_FILE_INVALID: { status: 422, message: "The import file has problems. Nothing was imported." },
  IMPORT_DUPLICATES_FOUND: { status: 409, message: "Some rows already exist. Choose whether to import the rest or cancel." },
  IMPORT_NOT_REVERSIBLE: { status: 409, message: "This import can't be changed in its current state." },
  FILE_STORAGE_UNAVAILABLE: { status: 503, message: "File storage is temporarily unavailable. Please try again later or contact support." },
  FILE_INTEGRITY_FAILED: { status: 500, message: "The stored file could not be verified. Please contact support." },
  EMAIL_DELIVERY_FAILED: { status: 502, message: "The email could not be sent. Check the email settings and server logs." },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof ERROR_CODES;

/** The one API error contract every failing API response uses. */
export interface ApiErrorBody {
  success: false;
  error: {
    code: ErrorCode | (string & {});
    message: string;
    details: unknown;
  };
  requestId: string | null;
}

export function isErrorCode(v: unknown): v is ErrorCode {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(ERROR_CODES, v);
}

/** Default code for an HTTP status (used for legacy `{ error: "..." }` responses without a code). */
export function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      // Almost every 400 in this app is a failed Zod/input check.
      return "VALIDATION_ERROR";
    case 401:
      return "AUTHENTICATION_FAILED";
    case 403:
      return "AUTHORIZATION_DENIED";
    case 404:
      return "RESOURCE_NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 413:
      return "PAYLOAD_TOO_LARGE";
    case 422:
      return "VALIDATION_ERROR";
    case 429:
      return "RATE_LIMIT_EXCEEDED";
    case 502:
      return "BAD_GATEWAY";
    case 503:
      return "EXTERNAL_SERVICE_UNAVAILABLE";
    case 504:
      return "UPSTREAM_TIMEOUT";
    default:
      return status >= 500 ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST";
  }
}

interface ApplicationErrorOptions {
  /** User-safe message; defaults to the code's catalog message. */
  message?: string;
  /** User-safe structured detail (field errors, row list, ...). Never internals. */
  details?: unknown;
  /** Overrides the code's default HTTP status. */
  status?: number;
  /** Extra response headers (e.g. Retry-After). */
  headers?: Record<string, string>;
  /** The underlying error - logged server-side, never sent to the client. */
  cause?: unknown;
}

/** Base class for every EXPECTED failure. Its message and details are client-safe by contract. */
export class ApplicationError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;
  readonly headers?: Record<string, string>;
  /** Unexpected-class errors (5xx) are logged at ERROR and reported to monitoring. */
  readonly expected: boolean;

  constructor(code: ErrorCode, opts: ApplicationErrorOptions = {}) {
    super(opts.message ?? ERROR_CODES[code].message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.status = opts.status ?? ERROR_CODES[code].status;
    this.details = opts.details ?? null;
    this.headers = opts.headers;
    this.expected = this.status < 500;
  }
}

/** Field-level problems: `details.fieldErrors` maps field -> messages. */
export class ValidationError extends ApplicationError {
  constructor(message?: string, fieldErrors?: Record<string, string[]>, opts: Omit<ApplicationErrorOptions, "message" | "details"> = {}) {
    super("VALIDATION_ERROR", { ...opts, message, details: fieldErrors ? { fieldErrors } : null });
  }
}

export class BadRequestError extends ApplicationError {
  constructor(message?: string, opts: Omit<ApplicationErrorOptions, "message"> = {}) {
    super("BAD_REQUEST", { ...opts, message });
  }
}

export class AuthenticationError extends ApplicationError {
  constructor(code: "AUTHENTICATION_FAILED" | "SESSION_EXPIRED" = "AUTHENTICATION_FAILED", message?: string) {
    super(code, { message });
  }
}

export class AuthorizationError extends ApplicationError {
  constructor(message?: string, code: "AUTHORIZATION_DENIED" | "CROSS_ORIGIN_REJECTED" = "AUTHORIZATION_DENIED") {
    super(code, { message });
  }
}

export class NotFoundError extends ApplicationError {
  constructor(what = "item", message?: string) {
    super("RESOURCE_NOT_FOUND", { message: message ?? `The requested ${what} was not found.` });
  }
}

export class ConflictError extends ApplicationError {
  constructor(message?: string, details?: unknown) {
    super("CONFLICT", { message, details });
  }
}

export class RateLimitError extends ApplicationError {
  constructor(retryAfterSeconds: number, message?: string) {
    super("RATE_LIMIT_EXCEEDED", { message, headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))) } });
  }
}

/** A domain rule was broken - use a specific business code (e.g. FINDING_NOT_READY_FOR_CLOSURE). */
export class BusinessRuleError extends ApplicationError {
  constructor(code: ErrorCode = "BUSINESS_RULE_VIOLATION", message?: string, details?: unknown) {
    super(code, { message, details });
  }
}

/** A dependency (SMTP, file storage, upstream API) failed. 5xx: logged + monitored. */
export class ExternalServiceError extends ApplicationError {
  constructor(
    code: "EXTERNAL_SERVICE_UNAVAILABLE" | "BAD_GATEWAY" | "UPSTREAM_TIMEOUT" | "FILE_STORAGE_UNAVAILABLE" | "EMAIL_DELIVERY_FAILED" = "EXTERNAL_SERVICE_UNAVAILABLE",
    opts: Omit<ApplicationErrorOptions, "status"> = {}
  ) {
    super(code, opts);
  }
}

export class DatabaseError extends ApplicationError {
  constructor(opts: Omit<ApplicationErrorOptions, "message"> = {}) {
    super("DATABASE_ERROR", opts);
  }
}

/** A known internal failure; the message is still generic to the client. */
export class InternalServerError extends ApplicationError {
  constructor(opts: Omit<ApplicationErrorOptions, "message"> & { code?: "INTERNAL_SERVER_ERROR" | "FILE_INTEGRITY_FAILED" } = {}) {
    super(opts.code ?? "INTERNAL_SERVER_ERROR", opts);
  }
}

export function isApplicationError(e: unknown): e is ApplicationError {
  return e instanceof ApplicationError;
}
