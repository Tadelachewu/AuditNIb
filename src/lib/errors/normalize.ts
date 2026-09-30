import { ZodError } from "zod";
import { ApplicationError, BadRequestError, DatabaseError, ExternalServiceError, InternalServerError, NotFoundError, ConflictError, ValidationError } from "@/lib/errors";

/**
 * Turns ANY thrown value into an ApplicationError, so the central handler
 * only ever deals with one type. Library errors are recognised by shape
 * (name / code) rather than by importing each library's runtime classes.
 * Nothing from the original error (SQL, table/column names, connection
 * strings, stack, file paths) is copied into the client-facing message -
 * the original is kept as `cause` for the server logs only.
 */
export function toApplicationError(err: unknown): ApplicationError {
  if (err instanceof ApplicationError) return err;

  if (err instanceof ZodError) {
    return fromZodError(err);
  }

  if (isObject(err)) {
    const name = String(err.name ?? "");
    const code = typeof err.code === "string" ? err.code : "";

    // Prisma (duck-typed: PrismaClientKnownRequestError etc.)
    if (name.startsWith("PrismaClient") || /^P\d{4}$/.test(code)) {
      return fromPrismaError(name, code, err);
    }

    // Malformed JSON body (request.json())
    if (err instanceof SyntaxError && /JSON/i.test(String(err.message))) {
      return new BadRequestError("The request body is not valid JSON.", { cause: err });
    }

    // Local encrypted file storage (src/lib/fileStorage.ts)
    if (name === "FileStorageError") {
      return /integrity/i.test(String(err.message))
        ? new InternalServerError({ code: "FILE_INTEGRITY_FAILED", cause: err })
        : new ExternalServiceError("FILE_STORAGE_UNAVAILABLE", { cause: err });
    }

    // Timeouts / network failures (fetch AbortSignal.timeout, sockets, SMTP)
    if (name === "TimeoutError" || code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
      return new ExternalServiceError("UPSTREAM_TIMEOUT", { cause: err });
    }
    if (["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH"].includes(code)) {
      return new ExternalServiceError("EXTERNAL_SERVICE_UNAVAILABLE", { cause: err });
    }
  }

  return new InternalServerError({ cause: err });
}

export function fromZodError(err: ZodError, message = "Some of the information provided is invalid."): ValidationError {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  // Keep the single-message UX the app already has: the first issue's text.
  return new ValidationError(err.issues[0]?.message ?? message, fieldErrors, { cause: err });
}

function fromPrismaError(name: string, code: string, err: Record<string, unknown>): ApplicationError {
  switch (code) {
    case "P2002": // unique constraint
      return new ConflictError("A record with the same unique value already exists.");
    case "P2003": // foreign key
    case "P2014": // relation violation
      return new ConflictError("This record is still referenced by other data.");
    case "P2025": // record not found
      return new NotFoundError("record");
    case "P2034": // write conflict / deadlock - transaction rolled back
      return new ConflictError("The data was changed by someone else at the same time. Please try again.");
  }
  // Connection / initialisation / timeouts / engine panics -> unavailable.
  if (name === "PrismaClientInitializationError" || /^P1\d{3}$/.test(code) || name === "PrismaClientRustPanicError") {
    return new DatabaseError({ cause: err });
  }
  return new InternalServerError({ cause: err });
}

function isObject(v: unknown): v is Record<string, unknown> & { message?: unknown } {
  return typeof v === "object" && v !== null;
}
