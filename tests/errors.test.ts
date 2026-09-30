import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ApplicationError,
  AuthenticationError,
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
  ERROR_CODES,
  NotFoundError,
  RateLimitError,
  ValidationError,
  codeForStatus,
} from "@/lib/errors";
import { toApplicationError } from "@/lib/errors/normalize";
import { FileStorageError } from "@/lib/fileStorage";

describe("error hierarchy", () => {
  it("maps each class to its code and HTTP status", () => {
    expect(new ValidationError()).toMatchObject({ code: "VALIDATION_ERROR", status: 422, expected: true });
    expect(new AuthenticationError()).toMatchObject({ code: "AUTHENTICATION_FAILED", status: 401 });
    expect(new AuthorizationError()).toMatchObject({ code: "AUTHORIZATION_DENIED", status: 403 });
    expect(new NotFoundError("finding")).toMatchObject({ code: "RESOURCE_NOT_FOUND", status: 404, message: "The requested finding was not found." });
    expect(new ConflictError()).toMatchObject({ code: "CONFLICT", status: 409 });
    expect(new BusinessRuleError("FINDING_NOT_READY_FOR_CLOSURE")).toMatchObject({ code: "FINDING_NOT_READY_FOR_CLOSURE", status: 409 });
  });

  it("rate limit errors carry Retry-After", () => {
    const e = new RateLimitError(90);
    expect(e.status).toBe(429);
    expect(e.headers).toEqual({ "Retry-After": "90" });
  });

  it("every catalog code has a sensible status and a user-safe message", () => {
    for (const [code, def] of Object.entries(ERROR_CODES)) {
      expect(code).toMatch(/^[A-Z][A-Z_]+$/);
      expect(def.status).toBeGreaterThanOrEqual(400);
      expect(def.status).toBeLessThan(600);
      expect(def.message.length).toBeGreaterThan(5);
    }
  });

  it("derives a code from a legacy status", () => {
    expect(codeForStatus(400)).toBe("VALIDATION_ERROR");
    expect(codeForStatus(404)).toBe("RESOURCE_NOT_FOUND");
    expect(codeForStatus(429)).toBe("RATE_LIMIT_EXCEEDED");
    expect(codeForStatus(503)).toBe("EXTERNAL_SERVICE_UNAVAILABLE");
    expect(codeForStatus(599)).toBe("INTERNAL_SERVER_ERROR");
  });
});

describe("toApplicationError (central mapping)", () => {
  it("passes ApplicationErrors through untouched", () => {
    const e = new ConflictError("x");
    expect(toApplicationError(e)).toBe(e);
  });

  it("maps Zod errors to VALIDATION_ERROR with field details", () => {
    const r = z.object({ name: z.string().min(2, "Name is too short") }).safeParse({ name: "a" });
    const e = toApplicationError(r.error);
    expect(e).toBeInstanceOf(ValidationError);
    expect(e.message).toBe("Name is too short");
    expect(e.details).toEqual({ fieldErrors: { name: ["Name is too short"] } });
  });

  const prisma = (code: string, name = "PrismaClientKnownRequestError") => Object.assign(new Error(`Invalid \`prisma.user.create()\` invocation: SELECT * FROM "users"`), { name, code });

  it("maps Prisma errors without leaking query text", () => {
    expect(toApplicationError(prisma("P2002"))).toMatchObject({ code: "CONFLICT", status: 409 });
    expect(toApplicationError(prisma("P2025"))).toMatchObject({ code: "RESOURCE_NOT_FOUND", status: 404 });
    expect(toApplicationError(prisma("P2034"))).toMatchObject({ code: "CONFLICT" });
    expect(toApplicationError(prisma("P1001"))).toMatchObject({ code: "DATABASE_ERROR", status: 503 });
    expect(toApplicationError(Object.assign(new Error("Can't reach database server at db:5432"), { name: "PrismaClientInitializationError" }))).toMatchObject({ code: "DATABASE_ERROR" });
    const unknown = toApplicationError(prisma("P2099"));
    expect(unknown).toMatchObject({ code: "INTERNAL_SERVER_ERROR", status: 500 });
    for (const code of ["P2002", "P2025", "P1001", "P2099"]) {
      expect(toApplicationError(prisma(code)).message).not.toMatch(/SELECT|users|prisma/i);
    }
  });

  it("maps file storage failures without exposing configuration", () => {
    const cfg = toApplicationError(new FileStorageError("File storage isn't configured: set FILE_ENCRYPTION_KEY in the server's .env"));
    expect(cfg).toMatchObject({ code: "FILE_STORAGE_UNAVAILABLE", status: 503 });
    expect(cfg.message).not.toMatch(/FILE_ENCRYPTION_KEY|\.env/);
    expect(toApplicationError(new FileStorageError("Stored file failed its integrity check"))).toMatchObject({ code: "FILE_INTEGRITY_FAILED", status: 500 });
  });

  it("maps malformed JSON, timeouts and network failures", () => {
    let syntax: unknown;
    try {
      JSON.parse("{bad");
    } catch (e) {
      syntax = e;
    }
    expect(toApplicationError(syntax)).toMatchObject({ code: "BAD_REQUEST", status: 400 });
    expect(toApplicationError(Object.assign(new Error("timeout"), { name: "TimeoutError" }))).toMatchObject({ code: "UPSTREAM_TIMEOUT", status: 504 });
    expect(toApplicationError(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }))).toMatchObject({ code: "UPSTREAM_TIMEOUT" });
    expect(toApplicationError(Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:25"), { code: "ECONNREFUSED" }))).toMatchObject({ code: "EXTERNAL_SERVICE_UNAVAILABLE", status: 503 });
  });

  it("maps anything else to a generic INTERNAL_SERVER_ERROR", () => {
    const e = toApplicationError(new TypeError("Cannot read properties of undefined (reading 'secretKey')"));
    expect(e).toMatchObject({ code: "INTERNAL_SERVER_ERROR", status: 500, expected: false });
    expect(e.message).toBe("Something went wrong. Please try again.");
    expect(toApplicationError("a string")).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(toApplicationError(undefined)).toBeInstanceOf(ApplicationError);
  });
});

describe("environment validation", () => {
  it("accepts a valid configuration, and blank optional values from .env.example", async () => {
    const { envProblems } = await import("@/lib/env");
    const base = { DATABASE_URL: "postgresql://u:p@h/db", REDIS_URL: "redis://h:6379", IRON_SESSION_PASSWORD: "x".repeat(32) };
    expect(envProblems({ ...base, LOG_LEVEL: "", SENTRY_DSN: "", SENTRY_TRACES_SAMPLE_RATE: "" })).toEqual([]);
  });

  it("names the bad variable but never echoes its value", async () => {
    const { envProblems } = await import("@/lib/env");
    const problems = envProblems({ DATABASE_URL: "mysql://root:TopSecret@db/x", REDIS_URL: "redis://h", IRON_SESSION_PASSWORD: "short-secret" });
    expect(problems.join("\n")).toMatch(/DATABASE_URL/);
    expect(problems.join("\n")).toMatch(/IRON_SESSION_PASSWORD/);
    expect(problems.join("\n")).not.toMatch(/TopSecret|short-secret/);
  });

  it("requires the file encryption key in production", async () => {
    const { envProblems } = await import("@/lib/env");
    const base = { NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@h/db", REDIS_URL: "redis://h:6379", IRON_SESSION_PASSWORD: "x".repeat(32) };
    expect(envProblems(base).join()).toMatch(/FILE_ENCRYPTION_KEY/);
  });
});

describe("friendly Zod messages", () => {
  it("replaces Zod's technical defaults, keeps schema-specific messages", async () => {
    await import("@/lib/errors/zodMessages");
    const schema = z.object({ email: z.string(), fullName: z.string().min(3), role: z.enum(["A", "B"]), note: z.string().min(1, "Note please") });
    const r = schema.safeParse({ fullName: "ab", role: "C", note: "" });
    const msgs = r.success ? [] : r.error.issues.map((i) => i.message);
    expect(msgs).toEqual(["Email is required.", "Full name must be at least 3 characters.", "Role has an invalid value.", "Note please"]);
    expect(msgs.join()).not.toMatch(/nonoptional|expected|received/i);
  });
});
