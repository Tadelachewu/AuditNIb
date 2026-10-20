import { beforeEach, describe, expect, it, vi } from "vitest";

// Race conditions / TOCTOU (src/lib/db.ts, docs/data-integrity.md): the real
// readDb() / updateDb() / write-diff code against an in-memory Prisma
// stand-in whose advisory lock behaves like Postgres's (one holder at a time,
// released when the transaction ends).

type Row = Record<string, unknown> & { id: string };
const { tables, table, lock, fakePrisma } = vi.hoisted(() => {
  const tables = new Map<string, Map<string, Row>>();
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name)!;
  };
  const delegate = (name: string) => ({
    findMany: async () => [...table(name).values()].map((r) => ({ ...r })),
    findUnique: async ({ where }: { where: { id: string } }) => (table(name).get(where.id) ? { ...table(name).get(where.id)! } : null),
    create: async ({ data }: { data: Row }) => void table(name).set(data.id, { ...data }),
    update: async ({ where, data }: { where: { id: string }; data: Row }) => void table(name).set(where.id, { ...table(name).get(where.id)!, ...data }),
    upsert: async ({ where, create, update }: { where: { id: string }; create: Row; update: Row }) =>
      void table(name).set(where.id, { ...(table(name).get(where.id) ?? create), ...update }),
    delete: async ({ where }: { where: { id: string } }) => void table(name).delete(where.id),
  });
  const client = new Proxy({} as Record<string, unknown>, { get: (_t, prop: string) => delegate(prop) });

  const lock = { held: null as Promise<void> | null, acquisitions: 0 };
  const fakePrisma = new Proxy({} as Record<string, unknown>, {
    get(_t, prop: string) {
      if (prop === "$transaction") {
        return async (fn: (tx: unknown) => Promise<unknown>) => {
          let release = () => {};
          const tx = new Proxy({} as Record<string, unknown>, {
            get(_x, p: string) {
              if (p === "$executeRaw") {
                return async () => {
                  while (lock.held) await lock.held;
                  lock.acquisitions++;
                  lock.held = new Promise<void>((r) => (release = () => { lock.held = null; r(); }));
                  return 1;
                };
              }
              return delegate(p);
            },
          });
          try {
            return await fn(tx);
          } finally {
            release();
          }
        };
      }
      return (client as Record<string, unknown>)[prop];
    },
  });
  return { tables, table, lock, fakePrisma };
});
vi.mock("@/lib/prismaClient", () => ({ prisma: fakePrisma }));
vi.mock("@/lib/emailQueue/service", () => ({ prepareQueuedEmails: async () => ({ afterCommit: () => {} }) }));

import { readDb, updateDb } from "@/lib/db";
import { runWithRequestContext } from "@/lib/requestContext";
import { ConflictError } from "@/lib/errors";

const now = new Date("2026-10-20T08:00:00Z");
beforeEach(() => {
  tables.clear();
  lock.acquisitions = 0;
  table("settings").set("singleton", {
    id: "singleton", currencies: [], riskLevels: [], operationAreas: [], priorityLevels: [], irregularityTypes: [],
    notification: { provider: "NONE" }, rankingVisibility: {}, performanceThresholds: {}, hoApproval: {}, rectificationReminders: {},
    similarFindingFields: [], requiredFindingFields: {}, allowOtherValueFields: {}, reportTemplateSources: {}, permissionRegistrySyncedKeys: [],
    updatedAt: now, updatedBy: null,
  });
  for (const [id, name] of [["d1", "Addis"], ["d2", "Hawassa"]]) {
    table("district").set(id, { id, code: id.toUpperCase(), name, status: "ACTIVE", createdAt: now, updatedAt: now });
  }
});

const name = (id: string) => table("district").get(id)!.name;
const rename = (id: string, suffix: string) => (db: Awaited<ReturnType<typeof readDb>>) => {
  const d = db.districts.find((x) => x.id === id)!;
  d.name += suffix;
};
/** A request: its own context, like withApiHandler() gives every API call. */
const request = <T>(method: string, fn: () => Promise<T>) => runWithRequestContext({ requestId: Math.random().toString(36), method, path: "/api/x" }, fn);

describe("one change at a time", () => {
  it("simultaneous changes each build on the previous one - none is lost", async () => {
    await Promise.all(Array.from({ length: 5 }, (_, i) => updateDb(rename("d1", String(i)), { staleCheck: false })));
    expect(name("d1")).toBe("Addis01234");
    // Every change took the database lock before reading.
    expect(lock.acquisitions).toBe(5);
  });

  it("a failing change doesn't block the next one", async () => {
    await expect(updateDb(() => { throw new Error("boom"); })).rejects.toThrow("boom");
    await updateDb(rename("d1", "!"));
    expect(name("d1")).toBe("Addis!");
  });
});

describe("a change based on a stale check is refused (TOCTOU)", () => {
  it("someone else changed the row after this request checked it -> 409 Conflict, nothing written", async () => {
    await request("POST", async () => {
      await readDb(); // the route checks its rules on this read...
      await request("POST", () => updateDb(rename("d1", " (theirs)"))); // ...another user changes it meanwhile
      const attempt = updateDb(rename("d1", " (mine)"));
      await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    });
    expect(name("d1")).toBe("Addis (theirs)");
  });

  it("the second of two identical actions is refused instead of applied twice", async () => {
    // Both requests read (and "check") first, then both write - the classic double click / two tabs.
    let readsDone = 0;
    let bothRead = () => {};
    const gate = new Promise<void>((r) => (bothRead = r));
    const action = () =>
      request("POST", async () => {
        await readDb();
        if (++readsDone === 2) bothRead();
        await gate;
        return updateDb(rename("d1", "+"));
      });
    const results = await Promise.allSettled([action(), action()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected" && r.reason instanceof ConflictError)).toHaveLength(1);
    expect(name("d1")).toBe("Addis+");
  });

  it("a change to a different row than the one that changed goes through", async () => {
    await request("POST", async () => {
      await readDb();
      await request("POST", () => updateDb(rename("d2", " (theirs)")));
      await updateDb(rename("d1", " (mine)"));
    });
    expect([name("d1"), name("d2")]).toEqual(["Addis (mine)", "Hawassa (theirs)"]);
  });

  it("a request's second change is checked against its own first one, not refused", async () => {
    await request("PATCH", async () => {
      await readDb();
      await updateDb(rename("d1", "1"));
      await updateDb(rename("d1", "2"));
    });
    expect(name("d1")).toBe("Addis12");
  });

  it("GET requests and jobs (staleCheck: false) aren't checked", async () => {
    await request("GET", async () => {
      await readDb();
      await request("POST", () => updateDb(rename("d1", "a")));
      await updateDb(rename("d1", "b"));
    });
    await request("POST", async () => {
      await readDb();
      await request("POST", () => updateDb(rename("d1", "c")));
      await updateDb(rename("d1", "d"), { staleCheck: false });
    });
    expect(name("d1")).toBe("Addisabcd");
  });
});
