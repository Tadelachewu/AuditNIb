import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp, ipIsKnown, UNKNOWN_IP } from "@/lib/rateLimit";
import { hashResetToken } from "@/lib/resetToken";
import { isImportBatchInScope } from "@/lib/findings-scope";
import { isDemoPassword, validatePasswordStrength } from "@/lib/passwordValidation";
import { BCRYPT_COST, DUMMY_PASSWORD_HASH, hashPassword, needsRehash, verifyPassword } from "@/lib/auth";
import type { Database, Finding } from "@/types";
import type { SessionData } from "@/lib/session";

// Checks for the fixes in docs/auth-security-review.md.

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? routeFiles(p) : name === "route.ts" ? [p] : [];
  });
}

describe("every API route checks who is calling (review L2)", () => {
  // Public on purpose: they ARE the sign-in flow.
  const PUBLIC = new Set(["auth/forgot-password", "auth/logout", "auth/reset-password", "auth/session-ended", "auth/login"]);
  const root = join(process.cwd(), "src/app/api");
  it.each(routeFiles(root).map((f) => [relative(root, f).replace(/\\/g, "/").replace(/\/route\.ts$/, ""), f]))("%s", (name, file) => {
    if (PUBLIC.has(name)) return;
    expect(readFileSync(file, "utf8")).toMatch(/requirePermission|requireUser|getCurrentUser|requireToggleOrEditPermission/);
  });
});

describe("client IP (review H2)", () => {
  afterEach(() => {
    delete process.env.TRUST_PROXY;
    delete process.env.TRUST_PROXY_HOPS;
  });
  const req = (xff: string) => new Request("http://x", { headers: { "x-forwarded-for": xff } });

  it("without TRUST_PROXY the IP is unknown, and per-IP limits don't apply", () => {
    expect(clientIp(req("1.2.3.4"))).toBe(UNKNOWN_IP);
    expect(ipIsKnown(UNKNOWN_IP)).toBe(false);
  });

  it("behind one proxy, the address the proxy added (right-most) is used, not a faked left-most one", () => {
    process.env.TRUST_PROXY = "true";
    expect(clientIp(req("6.6.6.6, 10.0.0.9"))).toBe("10.0.0.9");
    expect(clientIp(req("10.0.0.9"))).toBe("10.0.0.9");
  });

  it("TRUST_PROXY_HOPS counts proxies from the right", () => {
    process.env.TRUST_PROXY = "true";
    process.env.TRUST_PROXY_HOPS = "2";
    expect(clientIp(req("6.6.6.6, 41.1.1.1, 10.0.0.1"))).toBe("41.1.1.1");
  });
});

describe("reset tokens are stored hashed (review M2)", () => {
  it("SHA-256 hex, stable, and never the raw token", () => {
    const h = hashResetToken("abc");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hashResetToken("abc"));
    expect(h).not.toBe("abc");
  });
});

describe("import history / files are scoped (review M4)", () => {
  const f = (id: string, branchId: string) => ({ id, branchId, districtId: "d1" }) as Finding;
  const db = { findings: [f("a", "b1"), f("b", "b1"), f("c", "b2")] } as unknown as Database;
  const branch = { orgScope: "BRANCH", branchId: "b1" } as SessionData;
  const batch = (...ids: string[]) => ({ rows: ids.map((findingId) => ({ findingId })) });

  it("bank-wide users see every import", () => {
    expect(isImportBatchInScope(db, { orgScope: "BANK" } as SessionData, batch("a", "c"))).toBe(true);
  });
  it("a branch user sees an import only of their own branch's findings", () => {
    expect(isImportBatchInScope(db, branch, batch("a", "b"))).toBe(true);
    expect(isImportBatchInScope(db, branch, batch("a", "c"))).toBe(false);
  });
  it("a reversed import (findings gone) stays bank-level", () => {
    expect(isImportBatchInScope(db, branch, batch("gone"))).toBe(false);
  });
});

describe("demo passwords (review H3)", () => {
  it("are recognised and can never be chosen as a new password", () => {
    expect(isDemoPassword("Admin@123")).toBe(true);
    expect(validatePasswordStrength("Admin@123").valid).toBe(false);
    expect(validatePasswordStrength("Manager@123").valid).toBe(false);
  });
});

describe("password hashing (review L1)", () => {
  it("hashes at cost 12, verifies, and flags older cost-10 hashes for upgrade", async () => {
    const h = await hashPassword("Correct-Horse-9!");
    expect(h.startsWith(`$2b$${BCRYPT_COST}$`) || h.startsWith(`$2a$${BCRYPT_COST}$`)).toBe(true);
    expect(await verifyPassword("Correct-Horse-9!", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(needsRehash(h)).toBe(false);
    expect(needsRehash("$2b$10$enQPCFRyKe5TuzYQGnX5UeN/VkGTm0dcGG3Fj8p/uLWROCmOAvFke")).toBe(true);
  }, 20_000);

  it("the dummy hash (for unknown usernames) is a real hash at the same cost", async () => {
    expect(needsRehash(DUMMY_PASSWORD_HASH)).toBe(false);
    expect(await verifyPassword("anything", DUMMY_PASSWORD_HASH)).toBe(false);
  }, 20_000);
});

describe("rate limits keep working when Redis is down (review M1)", () => {
  it("falls back to memory instead of switching off", async () => {
    vi.resetModules();
    vi.doMock("@/lib/redisClient", () => {
      const fail = async () => {
        throw new Error("redis down");
      };
      return {
        redis: { get: fail, pttl: fail, incr: fail, pexpire: fail, del: fail, set: fail },
        logRedisFailure: () => {},
      };
    });
    const rl = await import("@/lib/rateLimit");
    const opts = { maxFailures: 3, windowMs: 60_000, lockoutMs: 60_000 };
    for (let i = 0; i < 3; i++) await rl.recordFailureForLockout("t:user", opts);
    expect((await rl.checkLockout("t:user")).locked).toBe(true);
    await rl.clearLockout("t:user");
    expect((await rl.checkLockout("t:user")).locked).toBe(false);

    const limit = { max: 2, windowMs: 60_000 };
    await rl.recordAttempt("t:ip", limit);
    await rl.recordAttempt("t:ip", limit);
    expect((await rl.isRateLimited("t:ip", limit)).limited).toBe(true);
    vi.doUnmock("@/lib/redisClient");
  });
});
