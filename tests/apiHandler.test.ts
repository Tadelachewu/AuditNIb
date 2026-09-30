import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/monitoring", () => ({ captureServerException: vi.fn(async () => {}) }));

import { withApiHandler } from "@/lib/api/handler";
import { captureServerException } from "@/lib/monitoring";
import { BusinessRuleError, RateLimitError, ValidationError } from "@/lib/errors";
import { getRequestContext } from "@/lib/requestContext";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ctx = { params: Promise.resolve({}) };
const req = (headers: Record<string, string> = {}, method = "POST") => new Request("http://localhost/api/test", { method, headers });

// Anything that must never reach a client.
const LEAKS = [/secret/i, /SELECT /, /postgres(ql)?:\/\//i, /password/i, /\bat .*\.(ts|js):\d+/, /node_modules/, /FILE_ENCRYPTION_KEY/, /stack/i];
function assertNoLeaks(text: string) {
  for (const re of LEAKS) expect(text, `response leaked ${re}`).not.toMatch(re);
}

beforeEach(() => vi.mocked(captureServerException).mockClear());

describe("withApiHandler - error contract", () => {
  it("expected error -> controlled response with code, details and request ID", async () => {
    const h = withApiHandler(async () => {
      throw new ValidationError("Name is required", { name: ["Name is required"] });
    });
    const res = await h(req({ "x-request-id": "abc12345-req" }), ctx);
    expect(res.status).toBe(422);
    expect(res.headers.get("x-request-id")).toBe("abc12345-req");
    expect(await res.json()).toEqual({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Name is required", details: { fieldErrors: { name: ["Name is required"] } } },
      requestId: "abc12345-req",
    });
    expect(captureServerException).not.toHaveBeenCalled();
  });

  it("business rule error keeps its specific code", async () => {
    const res = await withApiHandler(async () => {
      throw new BusinessRuleError("FINDING_NOT_READY_FOR_CLOSURE", "Awaiting district verification");
    })(req(), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("FINDING_NOT_READY_FOR_CLOSURE");
  });

  it("rate limit -> 429 with Retry-After", async () => {
    const res = await withApiHandler(async () => {
      throw new RateLimitError(120);
    })(req(), ctx);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("120");
    expect((await res.json()).error.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("unexpected exception -> generic 500, logged + monitored, nothing leaked", async () => {
    const res = await withApiHandler(async () => {
      throw new Error("connect failed postgres://admin:secret@db:5432 while running SELECT * FROM users; password=hunter2");
    })(req(), ctx);
    expect(res.status).toBe(500);
    const text = await res.text();
    assertNoLeaks(text);
    const body = JSON.parse(text);
    expect(body.error).toEqual({ code: "INTERNAL_SERVER_ERROR", message: "Something went wrong. Please try again.", details: null });
    expect(body.requestId).toMatch(UUID);
    expect(captureServerException).toHaveBeenCalledTimes(1);
  });

  it("database outage -> 503 DATABASE_ERROR, no connection details", async () => {
    const res = await withApiHandler(async () => {
      throw Object.assign(new Error("Can't reach database server at `db.internal:5432` postgresql://u:secret@db"), { name: "PrismaClientInitializationError" });
    })(req(), ctx);
    expect(res.status).toBe(503);
    const text = await res.text();
    assertNoLeaks(text);
    expect(JSON.parse(text).error.code).toBe("DATABASE_ERROR");
  });

  it("timeout from a dependency -> 504", async () => {
    const res = await withApiHandler(async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    })(req(), ctx);
    expect(res.status).toBe(504);
    expect((await res.json()).error.code).toBe("UPSTREAM_TIMEOUT");
  });
});

describe("withApiHandler - legacy { error } responses", () => {
  it("rewrites them into the contract, keeping status and headers", async () => {
    const res = await withApiHandler(async () =>
      NextResponse.json({ error: "Too many attempts" }, { status: 429, headers: { "Retry-After": "30" } })
    )(req({ "x-request-id": "legacy-0001" }), ctx);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(await res.json()).toEqual({
      success: false,
      error: { code: "RATE_LIMIT_EXCEEDED", message: "Too many attempts", details: null },
      requestId: "legacy-0001",
    });
  });

  it("uses an explicit code and moves extra fields into details", async () => {
    const res = await withApiHandler(async () =>
      NextResponse.json({ error: "Can't reverse", code: "IMPORT_NOT_REVERSIBLE", blockers: ["B001-2026-09-00001: has comments"] }, { status: 409 })
    )(req(), ctx);
    const body = await res.json();
    expect(body.error.code).toBe("IMPORT_NOT_REVERSIBLE");
    expect(body.error.details).toEqual({ blockers: ["B001-2026-09-00001: has comments"] });
  });

  it("never passes a handler-written 5xx message through", async () => {
    const res = await withApiHandler(async () => NextResponse.json({ error: "ENOENT: /var/app/storage/key.pem secret" }, { status: 500 }))(req(), ctx);
    const text = await res.text();
    assertNoLeaks(text);
    expect(JSON.parse(text).error.message).toBe("Something went wrong. Please try again.");
  });

  it("leaves successful responses untouched but adds the request ID header", async () => {
    const res = await withApiHandler(async () => NextResponse.json({ ok: true, items: [1] }))(req({}, "GET"), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, items: [1] });
    expect(res.headers.get("x-request-id")).toMatch(UUID);
  });
});

describe("request ID propagation", () => {
  it("makes the ID available to code deep in the request (logs)", async () => {
    let seen: string | undefined;
    await withApiHandler(async () => {
      seen = getRequestContext()?.requestId;
      return NextResponse.json({ ok: true });
    })(req({ "x-request-id": "deep-ctx-001" }), ctx);
    expect(seen).toBe("deep-ctx-001");
  });

  it("replaces an unsafe incoming ID (log injection) with a fresh UUID", async () => {
    const res = await withApiHandler(async () => NextResponse.json({ ok: true }))(req({ "x-request-id": `evil id level=fatal "forged" ${"x".repeat(80)}` }), ctx);
    expect(res.headers.get("x-request-id")).toMatch(UUID);
  });
});
