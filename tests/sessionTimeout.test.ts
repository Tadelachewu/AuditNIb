import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Session timeouts and "signed out" cases of getCurrentUser() (src/lib/session.ts).
// The cookie session, request headers and the users table are faked.
const state = vi.hoisted(() => ({
  session: {} as Record<string, unknown>,
  headers: {} as Record<string, string>,
  user: null as null | Record<string, unknown>,
  destroyed: 0,
  saved: 0,
}));

// The user's current database row (role, permissions, scope) - see TC15-17.
function dbUser() {
  return {
    name: "Abebe",
    role: "BRANCH_CONTROLLER",
    districtId: "d1",
    branchId: "b1",
    roleRef: { name: "Branch Controller", orgScope: "BRANCH", permissions: ["findings.view"], status: "ACTIVE" },
  };
}

vi.mock("iron-session", () => ({
  getIronSession: vi.fn(async () => {
    const s = state.session as Record<string, unknown>;
    s.destroy = () => {
      state.destroyed++;
    };
    s.save = async () => {
      state.saved++;
    };
    return s;
  }),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({})),
  headers: vi.fn(async () => ({ get: (k: string) => state.headers[k] ?? null })),
}));
vi.mock("@/lib/prismaClient", () => ({
  prisma: { user: { findUnique: vi.fn(async () => (state.user ? { ...dbUser(), ...state.user } : null)) } },
}));

import { getCurrentUser, IDLE_TIMEOUT_MS, ABSOLUTE_TIMEOUT_MS, BACKGROUND_REQUEST_HEADER } from "@/lib/session";

const NOW = new Date("2026-10-05T10:00:00Z").getTime();
const MIN = 60 * 1000;

function signedIn(over: Record<string, unknown> = {}) {
  const u = dbUser();
  state.session = {
    isLoggedIn: true,
    userId: "u1",
    sessionVersion: 3,
    sessionCreatedAt: NOW - 60 * MIN,
    lastActivityAt: NOW - 1 * MIN,
    // Same as the database row unless a test says otherwise.
    name: u.name,
    role: u.role,
    roleName: u.roleRef.name,
    orgScope: u.roleRef.orgScope,
    permissions: u.roleRef.permissions,
    districtId: u.districtId,
    branchId: u.branchId,
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  state.headers = {};
  state.user = { sessionVersion: 3, status: "ACTIVE" };
  state.destroyed = 0;
  state.saved = 0;
});
afterEach(() => vi.useRealTimers());

describe("session timeouts (getCurrentUser)", () => {
  it("TC1 an active session within both windows stays signed in, and the idle window slides forward", async () => {
    signedIn();
    expect(await getCurrentUser()).not.toBeNull();
    expect(state.session.lastActivityAt).toBe(NOW);
    expect(state.saved).toBe(1);
    expect(state.destroyed).toBe(0);
  });

  it("TC2 idle just under the limit is still signed in", async () => {
    signedIn({ lastActivityAt: NOW - IDLE_TIMEOUT_MS + 1000 });
    expect(await getCurrentUser()).not.toBeNull();
  });

  it("TC3 idle for exactly the limit signs out", async () => {
    signedIn({ lastActivityAt: NOW - IDLE_TIMEOUT_MS });
    expect(await getCurrentUser()).toBeNull();
    expect(state.destroyed).toBe(1);
  });

  it("TC4 idle longer than the limit signs out", async () => {
    signedIn({ lastActivityAt: NOW - IDLE_TIMEOUT_MS - 5 * MIN });
    expect(await getCurrentUser()).toBeNull();
    expect(state.destroyed).toBe(1);
  });

  it("TC5 the absolute limit signs out even a user who is active right now", async () => {
    signedIn({ sessionCreatedAt: NOW - ABSOLUTE_TIMEOUT_MS, lastActivityAt: NOW - 1000 });
    expect(await getCurrentUser()).toBeNull();
    expect(state.destroyed).toBe(1);
  });

  it("TC6 just under the absolute limit is still signed in", async () => {
    signedIn({ sessionCreatedAt: NOW - ABSOLUTE_TIMEOUT_MS + 1000 });
    expect(await getCurrentUser()).not.toBeNull();
  });

  it("TC7 a background poll (notification bell) does not count as activity", async () => {
    const lastActive = NOW - 10 * MIN;
    signedIn({ lastActivityAt: lastActive });
    state.headers[BACKGROUND_REQUEST_HEADER] = "1";
    expect(await getCurrentUser()).not.toBeNull();
    expect(state.session.lastActivityAt).toBe(lastActive); // idle window not refreshed
    expect(state.saved).toBe(0);
  });

  it("TC8 an open tab that only polls is still signed out once idle time runs out", async () => {
    signedIn({ lastActivityAt: NOW - IDLE_TIMEOUT_MS });
    state.headers[BACKGROUND_REQUEST_HEADER] = "1";
    expect(await getCurrentUser()).toBeNull();
  });

  it("TC9 activity keeps the session alive past the idle limit counted from sign-in", async () => {
    signedIn({ sessionCreatedAt: NOW, lastActivityAt: NOW });
    for (let i = 0; i < 4; i++) {
      vi.setSystemTime(NOW + (i + 1) * (IDLE_TIMEOUT_MS - MIN)); // a click just before each idle limit
      expect(await getCurrentUser()).not.toBeNull();
    }
  });

  it("TC10 signed in elsewhere (newer session version) signs out", async () => {
    signedIn();
    state.user = { sessionVersion: 4, status: "ACTIVE" };
    expect(await getCurrentUser()).toBeNull();
    expect(state.destroyed).toBe(1);
  });

  it("TC11 a deactivated user is signed out", async () => {
    signedIn();
    state.user = { sessionVersion: 3, status: "INACTIVE" };
    expect(await getCurrentUser()).toBeNull();
  });

  it("TC12 a deleted user is signed out", async () => {
    signedIn();
    state.user = null;
    expect(await getCurrentUser()).toBeNull();
  });

  it("TC13 no session cookie = not signed in", async () => {
    state.session = { isLoggedIn: false };
    expect(await getCurrentUser()).toBeNull();
    expect(state.destroyed).toBe(0);
  });

  it("TC14 an old cookie without timestamps is kept and its windows start now", async () => {
    signedIn({ sessionCreatedAt: undefined, lastActivityAt: undefined });
    expect(await getCurrentUser()).not.toBeNull();
    expect(state.session.sessionCreatedAt).toBe(NOW);
    expect(state.session.lastActivityAt).toBe(NOW);
  });

  it("TC15 a role / permission change applies on the next request (no new sign-in needed)", async () => {
    signedIn({ role: "BRANCH_CONTROLLER", permissions: ["findings.view", "findings.close"], branchId: "b1" });
    const user = await getCurrentUser();
    expect(user?.permissions).toEqual(["findings.view"]); // "findings.close" was removed from the role
  });

  it("TC16 a user moved to another branch gets the new branch's scope at once", async () => {
    signedIn({ branchId: "b1" });
    state.user = { sessionVersion: 3, status: "ACTIVE", branchId: "b2" };
    expect((await getCurrentUser())?.branchId).toBe("b2");
  });

  it("TC17 a user whose role was deactivated is signed out", async () => {
    signedIn();
    state.user = { sessionVersion: 3, status: "ACTIVE", roleRef: { ...dbUser().roleRef, status: "INACTIVE" } };
    expect(await getCurrentUser()).toBeNull();
  });
});
