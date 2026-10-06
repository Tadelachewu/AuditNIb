import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database, Finding, FindingStatus, ReportingPeriod } from "@/types";

// Automatic transfer at period end (src/lib/autoTransfer, docs/auto-transfer.md).

vi.mock("@/lib/db", () => ({ readDb: vi.fn(), updateDb: vi.fn() }));
vi.mock("@/lib/redisClient", () => ({ redis: { set: vi.fn(), del: vi.fn() }, logRedisFailure: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notifyUsers: vi.fn(), usersWithFindingsPermission: vi.fn(() => ["ho"]) }));
vi.mock("@/lib/prismaClient", () => ({ prisma: {} }));

import { notifyUsers } from "@/lib/notifications";
import {
  DEFAULT_AUTO_TRANSFER_CONFIG,
  dueSweeps,
  isExcluded,
  nextPeriod,
  resetAutoTransferThrottle,
  runAutoTransferIfDue,
  sweepDueAt,
  sweepPeriods,
  type AutoTransferConfig,
  type AutoTransferRun,
  type AutoTransferStore,
} from "@/lib/autoTransfer";

const H = 60 * 60 * 1000;
// Sep 2026 ends 30 Sep 23:59; its submission window ends 5 Oct.
const period = (id: string, year: number, month: number, opts: Partial<ReportingPeriod> = {}): ReportingPeriod =>
  ({
    id,
    code: `${year}-${String(month).padStart(2, "0")}`,
    year,
    month,
    status: "OPEN",
    endsAt: new Date(Date.UTC(year, month, 0, 23, 59)).toISOString(),
    submissionEndsAt: new Date(Date.UTC(year, month, 0, 23, 59)).toISOString(),
    ...opts,
  }) as ReportingPeriod;

let db: Database;
let seq = 0;
function finding(periodId: string, status: FindingStatus = "SENT_TO_BRANCH_MANAGER", extra: Partial<Finding> = {}): Finding {
  const f = {
    id: `f${++seq}`, reference: `F-${seq}`, status, periodId, branchId: "b1", districtId: "d1", operationArea: "Teller",
    caseCount: 3, amount: 3000, closedCases: 0, closedAmount: 0, rectifiedCases: 0, rectifiedAmount: 0,
    districtVerifiedCases: 0, districtVerifiedAmount: 0, createdAt: "2026-09-10T08:00:00.000Z", ...extra,
  } as unknown as Finding;
  db.findings.push(f);
  return f;
}
const config = (over: Partial<AutoTransferConfig> = {}): AutoTransferConfig => ({ ...DEFAULT_AUTO_TRANSFER_CONFIG, ...over });

beforeEach(() => {
  seq = 0;
  vi.mocked(notifyUsers).mockClear();
  db = {
    reportingPeriods: [period("sep", 2026, 9), period("oct", 2026, 10), period("nov", 2026, 11)],
    findings: [],
    findingTransfers: [],
    findingTransitions: [],
    findingCases: [],
    rectifications: [],
    findingClosures: [],
    auditLogs: [],
  } as unknown as Database;
});

const SEP_END = Date.UTC(2026, 8, 30, 23, 59);

describe("rules", () => {
  it("due at the later of the period end and its submission window end, plus the delay", () => {
    const p = period("x", 2026, 9, { submissionEndsAt: new Date(SEP_END + 5 * 24 * H).toISOString() });
    expect(sweepDueAt(p, { delayHours: 0 })).toBe(SEP_END + 5 * 24 * H);
    expect(sweepDueAt(period("y", 2026, 9), { delayHours: 2 })).toBe(SEP_END + 2 * H);
  });

  it("next period = the next calendar month, across a year end", () => {
    const periods = [period("dec", 2026, 12), period("jan", 2027, 1)];
    expect(nextPeriod(periods, periods[0])?.id).toBe("jan");
    expect(nextPeriod(db.reportingPeriods, db.reportingPeriods[2])).toBeUndefined();
  });

  it("due periods: ended, not handled, oldest first; none when switched off", () => {
    const now = Date.UTC(2026, 10, 2); // 2 Nov: Sep and Oct have ended
    expect(dueSweeps(db.reportingPeriods, [], config(), now).map((p) => p.id)).toEqual(["sep", "oct"]);
    const handled: AutoTransferRun[] = [{ periodId: "sep", status: "DONE", toPeriodId: "oct", movedCount: 0, keptCount: 0, movedReferences: [], keptReferences: [], ranAt: "" }];
    expect(dueSweeps(db.reportingPeriods, handled, config(), now).map((p) => p.id)).toEqual(["oct"]);
    expect(dueSweeps(db.reportingPeriods, [], config({ enabled: false }), now)).toEqual([]);
    expect(dueSweeps(db.reportingPeriods, [], config(), SEP_END - 1)).toEqual([]);
  });

  it("an excluded operation area matches whatever the case or spacing", () => {
    const c = config({ excludedOperationAreas: ["Card Operations"] });
    expect(isExcluded({ operationArea: " card  operations " }, c)).toBe(true);
    expect(isExcluded({ operationArea: "Teller" }, c)).toBe(false);
  });
});

describe("sweep", () => {
  it("moves outstanding findings to the next period, as System, method AUTOMATIC", () => {
    const a = finding("sep");
    const b = finding("sep", "PARTIALLY_RECTIFIED", { closedCases: 1, closedAmount: 1000 });
    const { runs } = sweepPeriods(db, ["sep"], config(), SEP_END + H);
    expect([a.periodId, b.periodId]).toEqual(["oct", "oct"]);
    expect(a.status).toBe("TRANSFERRED");
    expect(db.findingTransfers.every((t) => t.method === "AUTOMATIC" && t.createdByName.startsWith("System"))).toBe(true);
    expect(runs[0]).toMatchObject({ periodId: "sep", status: "DONE", toPeriodId: "oct", movedCount: 2, keptCount: 0 });
  });

  it("keeps excluded operation areas, not-yet-approved, rejected and closed findings", () => {
    const kept = finding("sep", "SENT_TO_BRANCH_MANAGER", { operationArea: "Card" });
    const draft = finding("sep", "DRAFT");
    const review = finding("sep", "HO_REVIEW");
    const rejected = finding("sep", "REJECTED");
    const closed = finding("sep", "CLOSED", { closedCases: 3, closedAmount: 3000 });
    const moved = finding("sep");
    const { runs } = sweepPeriods(db, ["sep"], config({ excludedOperationAreas: ["Card"] }), SEP_END + H);
    expect([kept, draft, review, rejected, closed].map((f) => f.periodId)).toEqual(["sep", "sep", "sep", "sep", "sep"]);
    expect(moved.periodId).toBe("oct");
    expect(runs[0]).toMatchObject({ movedCount: 1, keptCount: 1, keptReferences: [kept.reference] });
  });

  it("unclosed rectification goes back to the branch, as with any transfer", () => {
    const f = finding("sep", "RECTIFIED", { rectifiedCases: 3, rectifiedAmount: 3000, districtVerifiedCases: 3, districtVerifiedAmount: 3000 });
    sweepPeriods(db, ["sep"], config(), SEP_END + H);
    expect(f).toMatchObject({ periodId: "oct", rectifiedCases: 0, districtVerifiedCases: 0 });
  });

  it("missed months cascade oldest first: Sep -> Oct -> Nov in one run", () => {
    const f = finding("sep");
    const { runs } = sweepPeriods(db, ["oct", "sep"], config(), Date.UTC(2026, 10, 2));
    expect(f.periodId).toBe("nov");
    expect(runs.map((r) => r.periodId)).toEqual(["sep", "oct"]);
  });

  it("a locked next period still receives the findings (a lock only blocks submission)", () => {
    db.reportingPeriods[1].status = "LOCKED";
    const f = finding("sep");
    sweepPeriods(db, ["sep"], config(), SEP_END + H);
    expect(f.periodId).toBe("oct");
  });

  it("no next period yet: nothing moves, the run waits, admins are told once", () => {
    const f = finding("nov");
    const first = sweepPeriods(db, ["nov"], config(), Date.UTC(2026, 11, 2));
    expect(f.periodId).toBe("nov");
    expect(first.runs[0]).toMatchObject({ status: "WAITING_NO_NEXT", movedCount: 0 });
    expect(notifyUsers).toHaveBeenCalledTimes(1);
    sweepPeriods(db, ["nov"], config(), Date.UTC(2026, 11, 3), new Map([["nov", first.runs[0]]]));
    expect(notifyUsers).toHaveBeenCalledTimes(1); // not again
  });

  it("notifies once per period (admins) and once per branch, never per finding", () => {
    finding("sep");
    finding("sep");
    finding("sep", "SENT_TO_BRANCH_MANAGER", { branchId: "b2" } as Partial<Finding>);
    sweepPeriods(db, ["sep"], config(), SEP_END + H);
    expect(notifyUsers).toHaveBeenCalledTimes(3); // 1 summary + branches b1, b2
  });

  it("records one audit entry per swept period", () => {
    finding("sep");
    sweepPeriods(db, ["sep"], config(), SEP_END + H);
    expect(db.auditLogs.some((l) => l.action === "PERIOD_AUTO_TRANSFER" && l.entityId === "sep")).toBe(true);
  });
});

describe("service", () => {
  function fakeStore(cfg: AutoTransferConfig | null, runs: AutoTransferRun[] = []): AutoTransferStore & { saved: AutoTransferRun[] } {
    const store = {
      saved: [] as AutoTransferRun[],
      getConfig: async () => cfg,
      saveConfig: async () => cfg!,
      listRuns: async () => [...runs, ...store.saved],
      saveRuns: async (r: AutoTransferRun[], tx?: unknown) => {
        if (tx !== "tx") throw new Error("runs must be saved inside the sweep's transaction");
        store.saved.push(...r);
      },
    };
    return store;
  }
  const deps = (store: AutoTransferStore, lockFree = true) => ({
    store,
    readDb: async () => db,
    // Like the real updateDb: work on a copy, then commit it and alsoWrite
    // together - if alsoWrite fails, nothing is committed.
    updateDb: async <T,>(fn: (d: Database) => T, opts: { alsoWrite?: (tx: unknown, result: T) => Promise<void> } = {}) => {
      const copy = structuredClone(db);
      const result = fn(copy);
      await opts.alsoWrite?.("tx", result);
      db = copy;
      return result;
    },
    lock: { acquire: async () => lockFree, release: async () => {} },
  });
  beforeEach(() => resetAutoTransferThrottle());

  it("sweeps what's due and records it; a second call does nothing", async () => {
    finding("sep");
    const store = fakeStore(config());
    const first = await runAutoTransferIfDue({ now: SEP_END + H, force: true, deps: deps(store) });
    expect(first.ran).toBe(true);
    expect(db.findings[0].periodId).toBe("oct");
    const second = await runAutoTransferIfDue({ now: SEP_END + 2 * H, force: true, deps: deps(store) });
    expect(second.ran).toBe(false);
    expect(db.findingTransfers).toHaveLength(1);
  });

  it("does nothing before the period ends, when off, or when not installed", async () => {
    const f = finding("sep");
    expect((await runAutoTransferIfDue({ now: SEP_END - H, force: true, deps: deps(fakeStore(config())) })).ran).toBe(false);
    expect((await runAutoTransferIfDue({ now: SEP_END + H, force: true, deps: deps(fakeStore(config({ enabled: false }))) })).ran).toBe(false);
    expect((await runAutoTransferIfDue({ now: SEP_END + H, force: true, deps: deps(fakeStore(null)) })).ran).toBe(false);
    expect(f.periodId).toBe("sep");
  });

  it("does nothing while another server holds the lock", async () => {
    const f = finding("sep");
    const res = await runAutoTransferIfDue({ now: SEP_END + H, force: true, deps: deps(fakeStore(config()), false) });
    expect(res.ran).toBe(false);
    expect(f.periodId).toBe("sep");
  });

  it("periods already handled at install are never swept", async () => {
    const f = finding("sep");
    const store = fakeStore(config(), [{ periodId: "sep", status: "SKIPPED_AT_RELEASE", toPeriodId: null, movedCount: 0, keptCount: 0, movedReferences: [], keptReferences: [], ranAt: "" }]);
    await runAutoTransferIfDue({ now: SEP_END + H, force: true, deps: deps(store) });
    expect(f.periodId).toBe("sep");
  });

  it("is throttled per server unless forced", async () => {
    finding("sep");
    const store = fakeStore(config());
    await runAutoTransferIfDue({ now: SEP_END - 60_000, deps: deps(store) }); // checks: nothing due yet
    const throttled = await runAutoTransferIfDue({ now: SEP_END + 60_000, deps: deps(store) }); // due, but only 2 min later
    expect(throttled.ran).toBe(false);
    const later = await runAutoTransferIfDue({ now: SEP_END + 6 * 60_000, deps: deps(store) }); // after the interval
    expect(later.ran).toBe(true);
  });

  it("never throws: a failure is logged and retried later", async () => {
    const broken = { ...fakeStore(config()), getConfig: async () => Promise.reject(new Error("db down")) };
    await expect(runAutoTransferIfDue({ now: SEP_END + H, force: true, deps: deps(broken) })).resolves.toEqual({ ran: false, runs: [] });
  });

  it("atomic: if recording the run fails, the moved findings roll back too (never moved without a record)", async () => {
    finding("sep");
    const store = fakeStore(config());
    store.saveRuns = async () => {
      throw new Error("write failed");
    };
    const res = await runAutoTransferIfDue({ now: SEP_END + H, force: true, deps: deps(store) });
    expect(res.ran).toBe(false);
    expect(db.findings[0].periodId).toBe("sep");
    expect(db.findingTransfers).toHaveLength(0);
  });
});
