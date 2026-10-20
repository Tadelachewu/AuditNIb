import { beforeEach, describe, expect, it } from "vitest";
import { sealData } from "iron-session";
import { sessionOptions } from "@/lib/session";
import { withIdempotency, type IdempotencyStore, type StoredKey } from "@/lib/idempotency";
import { getRequestContext, runWithRequestContext } from "@/lib/requestContext";

// Idempotency-Key (src/lib/idempotency.ts, docs/data-integrity.md) with an
// in-memory key store: a repeated request is answered, not processed again.

type Row = StoredKey & { userId: string; ageMs: number };
let rows: Map<string, Row>;
const store: IdempotencyStore = {
  isInstalled: async () => true,
  claim: async (id, userId, _m, _p, requestHash) => {
    if (rows.has(id)) return false;
    rows.set(id, { userId, requestHash, status: "IN_PROGRESS", committed: false, responseStatus: null, responseBody: null, ageMs: 0 });
    return true;
  },
  get: async (id) => rows.get(id) ?? null,
  takeOver: async (id, olderThanMs) => {
    const r = rows.get(id);
    if (!r || r.status !== "IN_PROGRESS" || r.committed || r.ageMs <= olderThanMs) return false;
    r.ageMs = 0;
    return true;
  },
  markCommitted: async (id) => void (rows.get(id)!.committed = true),
  complete: async (id, status, body) => void Object.assign(rows.get(id)!, { status: "COMPLETED", responseStatus: status, responseBody: body }),
  release: async (id) => {
    const r = rows.get(id);
    if (!r || r.status !== "IN_PROGRESS" || r.committed) return false;
    rows.delete(id);
    return true;
  },
  purgeOlderThan: async () => {},
};

let cookie: string;
beforeEach(async () => {
  rows = new Map();
  const seal = await sealData({ isLoggedIn: true, userId: "u1" }, { password: sessionOptions.password });
  cookie = `${sessionOptions.cookieName}=${encodeURIComponent(seal)}`;
});

const req = (opts: { key?: string; body?: string; method?: string; path?: string; who?: string } = {}) =>
  new Request(`http://localhost${opts.path ?? "/api/support"}`, {
    method: opts.method ?? "POST",
    headers: { "content-type": "application/json", cookie: opts.who ?? cookie, ...(opts.key ? { "idempotency-key": opts.key } : {}) },
    body: opts.body ?? '{"body":"hello"}',
  });

/** The route: counts how often it really ran; "commits" a change like updateDb() would. */
let ran: number;
const route = (status = 201) => async () => {
  ran++;
  await getRequestContext()?.inTransaction?.({});
  return Response.json({ id: `thread-${ran}` }, { status });
};
const call = (r: Request, handle: () => Promise<Response>) =>
  runWithRequestContext({ requestId: "r", method: r.method, path: new URL(r.url).pathname }, () => withIdempotency(r, handle, store));

const KEY = "k".repeat(24);
beforeEach(() => (ran = 0));

describe("Idempotency-Key", () => {
  it("a repeat gets the first reply back and is NOT processed again", async () => {
    const first = await call(req({ key: KEY }), route());
    const again = await call(req({ key: KEY }), route());
    expect(ran).toBe(1);
    expect(again.status).toBe(201);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(await again.json()).toEqual(await first.json());
  });

  it("while the first is still running, a repeat gets 409 REQUEST_IN_PROGRESS", async () => {
    let finish = () => {};
    const slow = async () => {
      ran++;
      await new Promise<void>((r) => (finish = r));
      return Response.json({ ok: true }, { status: 201 });
    };
    const first = call(req({ key: KEY }), slow);
    await new Promise((r) => setTimeout(r, 10));
    const again = await call(req({ key: KEY }), route());
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("REQUEST_IN_PROGRESS");
    finish();
    expect((await first).status).toBe(201);
    expect(ran).toBe(1);
  });

  it("the same key with a different body is refused (422)", async () => {
    await call(req({ key: KEY }), route());
    const other = await call(req({ key: KEY, body: '{"body":"something else"}' }), route());
    expect(other.status).toBe(422);
    expect((await other.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(ran).toBe(1);
  });

  it("a refused request saved nothing, so the same key may run again (e.g. after confirming the password)", async () => {
    const refused = await call(req({ key: KEY }), async () => Response.json({ error: "Confirm your password" }, { status: 403 }));
    expect(refused.status).toBe(403);
    const retried = await call(req({ key: KEY }), route());
    expect(retried.status).toBe(201);
    expect(ran).toBe(1);
  });

  it("a request that crashed after its change was saved is never run again", async () => {
    await expect(
      call(req({ key: KEY }), async () => {
        await getRequestContext()?.inTransaction?.({}); // the change committed...
        throw new Error("server stopped"); // ...then the reply was lost
      })
    ).rejects.toThrow();
    const retried = await call(req({ key: KEY }), route());
    expect(retried.status).toBe(409);
    expect((await retried.json()).error.code).toBe("REQUEST_ALREADY_PROCESSED");
    expect(ran).toBe(0);
  });

  it("a request that failed before saving anything frees its key, so a retry runs", async () => {
    await expect(call(req({ key: KEY }), async () => { throw new Error("failed"); })).rejects.toThrow();
    expect(rows.size).toBe(0);
    expect((await call(req({ key: KEY }), route())).status).toBe(201);
    expect(ran).toBe(1);
  });

  it("a live request is not taken over; a dead one (older than 2 minutes, nothing saved) is", async () => {
    let finish = () => {};
    const first = call(req({ key: KEY }), async () => {
      await new Promise<void>((r) => (finish = r));
      return Response.json({}, { status: 201 });
    });
    await new Promise((r) => setTimeout(r, 10));
    expect((await call(req({ key: KEY }), route())).status).toBe(409);
    [...rows.values()][0].ageMs = 3 * 60 * 1000;
    expect((await call(req({ key: KEY }), route())).status).toBe(201);
    finish();
    await first;
  });

  it("keys are per user: another user's identical key is a separate request", async () => {
    await call(req({ key: KEY }), route());
    const seal = await sealData({ isLoggedIn: true, userId: "u2" }, { password: sessionOptions.password });
    const other = await call(req({ key: KEY, who: `${sessionOptions.cookieName}=${encodeURIComponent(seal)}` }), route());
    expect(other.headers.get("idempotent-replayed")).toBeNull();
    expect(ran).toBe(2);
  });

  it("no key, GET, sign-in routes, scheduler routes and signed-out requests just run", async () => {
    await call(req(), route());
    await call(req(), route());
    await call(req({ key: KEY, path: "/api/auth/login" }), route());
    await call(req({ key: KEY, path: "/api/auth/login" }), route());
    await call(req({ key: KEY, path: "/api/system/auto-transfer" }), route());
    await call(req({ key: KEY, path: "/api/system/auto-transfer" }), route());
    await call(req({ key: KEY, who: "" }), route());
    await call(req({ key: KEY, who: "" }), route());
    expect(ran).toBe(8);
    expect(rows.size).toBe(0);
  });
});
