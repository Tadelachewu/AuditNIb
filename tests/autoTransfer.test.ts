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
  forgetAllRuns,
  isIncluded,
  rearmIfRescheduled,
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
    id: `f${++seq}`, reference: `F-${seq}`, status, periodId, branchId: "b1", districtId: "d1", operationArea: "Teller", sourceId: "ic",
    caseCount: 3, amount: 3000, closedCases: 0, closedAmount: 0, rectifiedCases: 0, rectifiedAmount: 0,
    districtVerifiedCases: 0, districtVerifiedAmount: 0, createdAt: "2026-09-10T08:00:00.000Z", ...extra,
  } as unknown as Finding;
  db.findings.push(f);
  return f;
}
// "Teller" x "ic" (the fixtures' operation area and source) is ticked unless a test says otherwise.
const config = (over: Partial<AutoTransferConfig> = {}): AutoTransferConfig => ({ ...DEFAULT_AUTO_TRANSFER_CONFIG, includedAreaSources: [{ operationArea: "Teller", sourceIds: ["ic"] }], ...over });

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

// Sep 2026 is the current period all through October; it is swept on 1 Nov, 00:00 local time.
const SEP_END = new Date(2026, 10, 1).getTime();

describe("rules", () => {
  it("due on the 1st of the month after next (when the period stops being current), plus the delay", () => {
    expect(sweepDueAt(period("x", 2026, 9), { delayHours: 0 })).toBe(new Date(2026, 10, 1).getTime());
    expect(sweepDueAt(period("y", 2026, 9), { delayHours: 2 })).toBe(SEP_END + 2 * H);
    // The period's own dates and submission window don't move it.
    expect(sweepDueAt(period("z", 2026, 9, { submissionEndsAt: new Date(SEP_END + 5 * 24 * H).toISOString() }), { delayHours: 0 })).toBe(SEP_END);
    // Across a year end: Dec 2026 is swept on 1 Feb 2027.
    expect(sweepDueAt(period("d", 2026, 12), { delayHours: 0 })).toBe(new Date(2027, 1, 1).getTime());
  });

  it("next period = the next calendar month, across a year end", () => {
    const periods = [period("dec", 2026, 12), period("jan", 2027, 1)];
    expect(nextPeriod(periods, periods[0])?.id).toBe("jan");
    expect(nextPeriod(db.reportingPeriods, db.reportingPeriods[2])).toBeUndefined();
  });

  it("due periods: no longer current, not handled, oldest first; none when switched off", () => {
    expect(dueSweeps(db.reportingPeriods, [], config(), new Date(2026, 10, 2).getTime()).map((p) => p.id)).toEqual(["sep"]); // 2 Nov: Oct is current
    const now = new Date(2026, 11, 2).getTime(); // 2 Dec: Nov is current, Sep and Oct are behind it
    expect(dueSweeps(db.reportingPeriods, [], config(), now).map((p) => p.id)).toEqual(["sep", "oct"]);
    const handled: AutoTransferRun[] = [{ periodId: "sep", status: "DONE", toPeriodId: "oct", movedCount: 0, keptCount: 0, movedReferences: [], keptReferences: [], ranAt: "", triggeredBy: null }];
    expect(dueSweeps(db.reportingPeriods, handled, config(), now).map((p) => p.id)).toEqual(["oct"]);
    expect(dueSweeps(db.reportingPeriods, [], config({ enabled: false }), now)).toEqual([]);
    expect(dueSweeps(db.reportingPeriods, [], config(), SEP_END - 1)).toEqual([]);
  });

  it("a ticked operation area matches whatever the case or spacing; an unticked one is not transferred", () => {
    const c = config({ includedAreaSources: [{ operationArea: "Card Operations", sourceIds: ["ic"] }] });
    expect(isIncluded({ operationArea: " card  operations ", sourceId: "ic" }, c)).toBe(true);
    expect(isIncluded({ operationArea: "Teller", sourceId: "ic" }, c)).toBe(false);
    // Nothing ticked (a fresh install): nothing is transferred.
    expect(isIncluded({ operationArea: "Teller", sourceId: "ic" }, DEFAULT_AUTO_TRANSFER_CONFIG)).toBe(false);
  });

  it("each operation area has its own ticked sources", () => {
    const c = config({
      includedAreaSources: [
        { operationArea: "Teller", sourceIds: ["ic"] },
        { operationArea: "Vault", sourceIds: ["ic", "ia"] },
        { operationArea: "Loans", sourceIds: [] },
      ],
    });
    expect(isIncluded({ operationArea: "Teller", sourceId: "ic" }, c)).toBe(true);
    expect(isIncluded({ operationArea: "Teller", sourceId: "ia" }, c)).toBe(false);
    expect(isIncluded({ operationArea: "Vault", sourceId: "ia" }, c)).toBe(true);
    expect(isIncluded({ operationArea: "Loans", sourceId: "ic" }, c)).toBe(false);
  });

  it("a database behind on migrations keeps the older list it holds", () => {
    const excluded = config({ includedAreaSources: [], legacy: { excludedOperationAreas: ["Card Operations"] } });
    expect(isIncluded({ operationArea: "card operations", sourceId: "ia" }, excluded)).toBe(false);
    expect(isIncluded({ operationArea: "Teller", sourceId: "ia" }, excluded)).toBe(true);
    const included = config({ includedAreaSources: [], legacy: { includedOperationAreas: ["Teller"] } });
    expect(isIncluded({ operationArea: "teller", sourceId: "ia" }, included)).toBe(true);
    expect(isIncluded({ operationArea: "Vault", sourceId: "ia" }, included)).toBe(false);
  });

  it("keeps unticked operation areas and sources, not-yet-approved, rejected and closed findings", () => {
    const kept = finding("sep", "SENT_TO_BRANCH_MANAGER", { operationArea: "Card" });
    const draft = finding("sep", "DRAFT");
    const review = finding("sep", "HO_REVIEW");
    const rejected = finding("sep", "REJECTED");
    const closed = finding("sep", "CLOSED", { closedCases: 3, closedAmount: 3000 });
    const otherSource = finding("sep", "SENT_TO_BRANCH_MANAGER", { sourceId: "ia" });
    const moved = finding("sep");
    const { runs } = sweepPeriods(db, ["sep"], config(), SEP_END + H);
    expect([kept, draft, review, rejected, closed, otherSource].map((f) => f.periodId)).toEqual(["sep", "sep", "sep", "sep", "sep", "sep"]);
    expect(moved.periodId).toBe("oct");
    expect(runs[0]).toMatchObject({ movedCount: 1, keptCount: 2, keptReferences: [kept.reference, otherSource.reference] });
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
  function fakeStore(cfg: AutoTransferConfig | null, initialRuns: AutoTransferRun[] = []): AutoTransferStore & { saved: AutoTransferRun[] } {
    let runs = [...initialRuns];
    const store = {
      saved: [] as AutoTransferRun[],
      getConfig: async () => cfg,
      saveConfig: async () => cfg!,
      listRuns: async () => [...runs, ...store.saved],
      deleteRuns: async (ids: string[] | "all") => {
        runs = ids === "all" ? [] : runs.filter((r) => !ids.includes(r.periodId));
        store.saved = ids === "all" ? [] : store.saved.filter((r) => !ids.includes(r.periodId));
      },
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

  it("records what started it: the in-app check by default, the scheduler when it calls", async () => {
    finding("sep");
    const store = fakeStore(config());
    const res = await runAutoTransferIfDue({ now: SEP_END + H, force: true, trigger: "scheduler", deps: deps(store) });
    expect(res.runs[0].triggeredBy).toBe("scheduler");
    expect(db.auditLogs.find((l) => l.action === "PERIOD_AUTO_TRANSFER")?.reason).toContain("the scheduler");
    db.reportingPeriods.push(period("dec", 2026, 12));
    finding("nov");
    const inApp = await runAutoTransferIfDue({ now: new Date(2027, 0, 2).getTime(), force: true, deps: deps(store) }); // 2 Jan: Oct and Nov are due
    expect(inApp.runs.map((r) => r.triggeredBy)).toEqual(["in-app", "in-app"]);
  });

  it("does nothing while the period is still current, when off, or when not installed", async () => {
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
    const store = fakeStore(config(), [{ periodId: "sep", status: "SKIPPED_AT_RELEASE", toPeriodId: null, movedCount: 0, keptCount: 0, movedReferences: [], keptReferences: [], ranAt: "", triggeredBy: null }]);
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

  it("re-arms a swept period whose sweep is due later than now, but not one still due", async () => {
    const done: AutoTransferRun = { periodId: "sep", status: "DONE", toPeriodId: "oct", movedCount: 0, keptCount: 0, movedReferences: [], keptReferences: [], ranAt: "", triggeredBy: "in-app" };
    const store = fakeStore(config(), [done]);
    const sep = db.reportingPeriods[0];
    // Edited after it stopped being current (its dates don't change when it is due): keeps its record.
    const edited: ReportingPeriod = { ...sep, endsAt: new Date(SEP_END + H).toISOString(), submissionEndsAt: new Date(SEP_END + H).toISOString() };
    expect(await rearmIfRescheduled(edited, { now: SEP_END + 2 * H, store })).toBe(false);
    // Swept before it stopped being current (e.g. under the older period-end rule), then edited
    // while still current: re-armed, then swept again on the 1st.
    expect(await rearmIfRescheduled(sep, { now: SEP_END - 2 * H, store })).toBe(true);
    expect(await store.listRuns()).toEqual([]);
    const f = finding("sep");
    expect((await runAutoTransferIfDue({ now: SEP_END - H, force: true, deps: deps(store) })).ran).toBe(false);
    const res = await runAutoTransferIfDue({ now: SEP_END + H, force: true, deps: deps(store) });
    expect(res.ran).toBe(true);
    expect(db.findings.find((x) => x.id === f.id)?.periodId).toBe("oct");
  });

  it("Dev Reset forgets every run, so periods are handled afresh", async () => {
    const store = fakeStore(config(), [{ periodId: "sep", status: "DONE", toPeriodId: "oct", movedCount: 1, keptCount: 0, movedReferences: [], keptReferences: [], ranAt: "", triggeredBy: null }]);
    await forgetAllRuns("tx", store);
    expect(await store.listRuns()).toEqual([]);
  });
});
