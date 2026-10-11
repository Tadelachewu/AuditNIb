import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@/lib/redisClient", () => ({ redis: {}, logRedisFailure: vi.fn() }));

import { bindingProblem, clientSeen, describeUserAgent, userAgentHash } from "@/lib/sessionBinding";
import { hasRecentAuth, requireRecentAuth, REAUTH_REQUIRED } from "@/lib/reauth";

// Stolen-cookie protections - docs/session-security.md.

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0";
const headers = (h: Record<string, string>) => ({ get: (name: string) => h[name.toLowerCase()] ?? null });

afterEach(() => vi.unstubAllEnvs());

describe("device binding", () => {
  const session = { uaHash: userAgentHash(CHROME), ip: "10.1.2.3" };

  it("the same browser is accepted; another browser is refused", () => {
    expect(bindingProblem(session, { userAgent: CHROME, ip: "10.1.2.3" })).toBeNull();
    expect(bindingProblem(session, { userAgent: FIREFOX, ip: "10.1.2.3" })).toBe("browser");
  });

  it("can be switched off", () => {
    vi.stubEnv("SESSION_BIND_USER_AGENT", "false");
    expect(bindingProblem(session, { userAgent: FIREFOX, ip: "10.1.2.3" })).toBeNull();
  });

  it("the network is only checked when asked for: off (default), subnet or exact", () => {
    const elsewhere = { userAgent: CHROME, ip: "41.5.6.7" };
    const sameSubnet = { userAgent: CHROME, ip: "10.1.2.99" };
    expect(bindingProblem(session, elsewhere)).toBeNull();
    vi.stubEnv("SESSION_BIND_IP", "subnet");
    expect(bindingProblem(session, sameSubnet)).toBeNull();
    expect(bindingProblem(session, elsewhere)).toBe("network");
    vi.stubEnv("SESSION_BIND_IP", "exact");
    expect(bindingProblem(session, sameSubnet)).toBe("network");
  });

  it("an older cookie without the values, or an unknown address, is never a mismatch", () => {
    vi.stubEnv("SESSION_BIND_IP", "exact");
    expect(bindingProblem({}, { userAgent: FIREFOX, ip: "41.5.6.7" })).toBeNull();
    expect(bindingProblem(session, { userAgent: CHROME, ip: "" })).toBeNull();
  });

  it("the address comes from the proxy only when the proxy is trusted", () => {
    const h = headers({ "user-agent": CHROME, "x-forwarded-for": "9.9.9.9, 10.1.2.3" });
    expect(clientSeen(h)).toEqual({ ip: "", userAgent: CHROME });
    vi.stubEnv("TRUST_PROXY", "true");
    expect(clientSeen(h).ip).toBe("10.1.2.3");
  });

  it("describes a browser coarsely for the owner", () => {
    expect(describeUserAgent(CHROME)).toBe("Chrome on Windows");
    expect(describeUserAgent(FIREFOX)).toBe("Firefox on Linux");
    expect(describeUserAgent("")).toBe("an unknown browser");
  });
});

describe("password confirmation for high-risk actions", () => {
  const NOW = 1_800_000_000_000;

  it("lasts 10 minutes by default", () => {
    expect(hasRecentAuth({ reauthAt: NOW - 9 * 60_000 }, NOW)).toBe(true);
    expect(hasRecentAuth({ reauthAt: NOW - 11 * 60_000 }, NOW)).toBe(false);
    expect(hasRecentAuth({}, NOW)).toBe(false);
  });

  it("the window is configurable, and 0 switches the requirement off", () => {
    vi.stubEnv("SESSION_REAUTH_MINUTES", "2");
    expect(hasRecentAuth({ reauthAt: NOW - 3 * 60_000 }, NOW)).toBe(false);
    vi.stubEnv("SESSION_REAUTH_MINUTES", "0");
    expect(hasRecentAuth({}, NOW)).toBe(true);
  });

  it("refuses with 403 REAUTH_REQUIRED, which the browser turns into the password dialog", async () => {
    expect(requireRecentAuth({ reauthAt: Date.now() })).toBeNull();
    const res = requireRecentAuth({})!;
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe(REAUTH_REQUIRED);
  });

  it("guards every high-risk admin change", () => {
    const guarded = (file: string) => readFileSync(file, "utf8").split("requireRecentAuth(auth.session)").length - 1;
    expect(guarded("src/app/api/admin/users/[id]/route.ts")).toBe(1); // password reset, role or email change
    expect(guarded("src/app/api/admin/roles/route.ts")).toBe(1); // create a role
    expect(guarded("src/app/api/admin/roles/[id]/route.ts")).toBe(2); // edit, delete
    expect(guarded("src/app/api/admin/settings/route.ts")).toBe(1); // save Settings
  });
});

describe("signing out and signing in", () => {
  it("sign-out ends the session on the server, not only in this browser", () => {
    expect(readFileSync("src/app/api/auth/logout/route.ts", "utf8")).toMatch(/u\.sessionVersion = \(u\.sessionVersion \?\? 1\) \+ 1/);
  });

  it("sign-in binds the session to the browser and records where it came from", () => {
    const login = readFileSync("src/app/api/auth/login/route.ts", "utf8");
    expect(login).toContain("session.uaHash =");
    expect(login).toContain("session.reauthAt = now");
    expect(login).toContain("previousLogin");
  });
});

describe("content security policy", () => {
  it("pages get a per-request nonce and no 'unsafe-inline' scripts", () => {
    const proxy = readFileSync("src/proxy.ts", "utf8");
    expect(proxy).toContain("'nonce-${nonce}' 'strict-dynamic'");
    // The policy line itself (a template string) - not the comment explaining what it replaces.
    expect(proxy).not.toMatch(/^\s*`script-src[^\n]*'unsafe-inline'/m);
    expect(readFileSync("src/app/layout.tsx", "utf8")).toContain("<script nonce={nonce}");
  });
});
