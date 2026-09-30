import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { createLogger, scrub } from "@/lib/logger";
import { runWithRequestContext } from "@/lib/requestContext";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      for (const l of String(chunk).split("\n").filter(Boolean)) lines.push(JSON.parse(l));
      cb();
    },
  });
  const log = createLogger(stream);
  log.level = "debug";
  return { log, lines, raw: () => JSON.stringify(lines) };
}

describe("structured logger", () => {
  it("writes structured JSON with level label, timestamp and message", () => {
    const { log, lines } = capture();
    log.warn({ statusCode: 409, errorCode: "CONFLICT", duration: 12 }, "request completed");
    expect(lines[0]).toMatchObject({ level: "warn", message: "request completed", statusCode: 409, errorCode: "CONFLICT", duration: 12 });
    expect(typeof lines[0].time).toBe("string");
  });

  it("adds requestId / userId / method / path from the request context", () => {
    const { log, lines } = capture();
    runWithRequestContext({ requestId: "req-abc-123", method: "POST", path: "/api/x", userId: "u1" }, () => log.info("hi"));
    expect(lines[0]).toMatchObject({ requestId: "req-abc-123", userId: "u1", method: "POST", path: "/api/x" });
  });

  it("redacts secrets at any common depth", () => {
    const { log, raw } = capture();
    log.info(
      {
        password: "hunter2",
        body: { newPassword: "P@ss-1234", token: "tok_live_1", nested: { apiKey: "k-999" } },
        headers: { authorization: "Bearer eyJhbGc", cookie: "nib_control360_session=abc" },
        refreshToken: "rt-1",
      },
      "sensitive"
    );
    const out = raw();
    for (const secret of ["hunter2", "P@ss-1234", "tok_live_1", "Bearer eyJhbGc", "nib_control360_session=abc", "rt-1"]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain("[REDACTED]");
  });

  it("serialises errors without credentials from connection strings", () => {
    const { log, raw } = capture();
    const err = Object.assign(new Error("connect ECONNREFUSED postgresql://admin:S3cr3t@db:5432/app password=hunter2"), { code: "ECONNREFUSED", query: "SELECT secret FROM x" });
    log.error({ err }, "db failed");
    const out = raw();
    expect(out).not.toContain("S3cr3t");
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("SELECT secret"); // arbitrary error fields are not serialised
    expect(out).toContain("ECONNREFUSED");
  });

  it("scrub() removes credentials from free text", () => {
    expect(scrub("redis://user:pw@host:6379 token=abc")).toBe("redis://user:[REDACTED]@host:6379 token=[REDACTED]");
  });
});
