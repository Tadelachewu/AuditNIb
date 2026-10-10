import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ readDb: vi.fn(), updateDb: vi.fn() }));
vi.mock("@/lib/prismaClient", () => ({ prisma: {} }));
vi.mock("@/lib/redisClient", () => ({ redis: { set: vi.fn(), del: vi.fn() }, logRedisFailure: vi.fn() }));

import { calendarDaysBetween, isRunDue, localDateKey, nextRunAt, overdueFindings, parseSendAt, resolveConfig } from "@/lib/reminders/rules";
import { getReminderStatus, resetReminderThrottle, runRemindersIfDue, type ReminderDeps } from "@/lib/reminders/service";
import type { ReminderStore } from "@/lib/reminders/store";
import type { ReminderConfig, ReminderRun } from "@/lib/reminders/types";
import type { Database, Finding } from "@/types";

// Rectification reminders on a schedule - docs/rectification-reminders.md.
// Dates are built in local time, like the rules themselves.

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
/** Monday 12 October 2026, 09:00. */
const NOW = at(2026, 10, 12, 9, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const config = (over: Partial<ReminderConfig> = {}): ReminderConfig => ({ enabled: true, thresholdDays: 5, sendAt: "08:00", days: [1, 2, 3, 4, 5], ...over });

function finding(id: string, over: Partial<Finding> = {}): Finding {
  return {
    id,
    reference: id.toUpperCase(),
    branchId: "b1",
    status: "SENT_TO_BRANCH_MANAGER",
    caseCount: 2,
    amount: 200,
    rectifiedCases: 0,
    rectifiedAmount: 0,
    updatedAt: iso(at(2026, 10, 1)),
    ...over,
  } as Finding;
}

const step = (findingId: string, action: string, when: number) => ({ id: `${findingId}-${action}-${when}`, findingId, action, createdAt: iso(when) });

function makeDb(findings: Finding[], transitions: ReturnType<typeof step>[] = [], reminders: Record<string, unknown> = { enabled: true, thresholdDays: 5 }): Database {
  return {
    findings,
    findingTransitions: transitions,
    notifications: [],
    users: [
      { id: "bm", email: "", status: "ACTIVE", role: "BRANCH_MANAGER", branchId: "b1" },
      { id: "bc", email: "", status: "ACTIVE", role: "BRANCH_CONTROLLER", branchId: "b1" },
      { id: "other", email: "", status: "ACTIVE", role: "BRANCH_MANAGER", branchId: "b2" },
    ],
    roles: [
      { code: "BRANCH_MANAGER", status: "ACTIVE", orgScope: "BRANCH", permissions: ["findings.rectify"] },
      { code: "BRANCH_CONTROLLER", status: "ACTIVE", orgScope: "BRANCH", permissions: ["findings.rectify"] },
    ],
    settings: { rectificationReminders: reminders, notification: { provider: "NONE", fromAddress: "" } },
  } as unknown as Database;
}

describe("the schedule", () => {
  it("fills in the defaults for older settings", () => {
    expect(resolveConfig({ enabled: true, thresholdDays: 7 })).toEqual({ enabled: true, thresholdDays: 7, sendAt: "08:00", days: [1, 2, 3, 4, 5] });
    expect(resolveConfig({ enabled: true, thresholdDays: 3, sendAt: "25:00", days: [6, 6, 9] }).sendAt).toBe("08:00");
    expect(resolveConfig({ enabled: true, thresholdDays: 3, days: [6, 6, 9, 0] }).days).toEqual([0, 6]);
    expect(parseSendAt("07:30")).toBe(450);
    expect(parseSendAt("7:30")).toBeNull();
  });

  it("is due once the send time has passed on a ticked weekday, and only once a day", () => {
    expect(isRunDue(config(), false, at(2026, 10, 12, 7, 59))).toBe(false);
    expect(isRunDue(config(), false, at(2026, 10, 12, 8, 0))).toBe(true);
    // Missed the send time (server was down): still due until midnight.
    expect(isRunDue(config(), false, at(2026, 10, 12, 23, 50))).toBe(true);
    expect(isRunDue(config(), true, at(2026, 10, 12, 9, 0))).toBe(false);
    expect(isRunDue(config({ enabled: false }), false, NOW)).toBe(false);
  });

  it("skips the weekend unless those days are ticked", () => {
    const saturday = at(2026, 10, 10, 9, 0);
    expect(isRunDue(config(), false, saturday)).toBe(false);
    expect(isRunDue(config({ days: [1, 2, 3, 4, 5, 6] }), false, saturday)).toBe(true);
  });

  it("works out the next run", () => {
    expect(nextRunAt(config(), false, at(2026, 10, 12, 7, 0))).toBe(at(2026, 10, 12, 8, 0));
    expect(nextRunAt(config(), false, NOW)).toBe(NOW); // due now
    expect(nextRunAt(config(), true, NOW)).toBe(at(2026, 10, 13, 8, 0));
    // Friday after the run -> Monday.
    expect(nextRunAt(config(), true, at(2026, 10, 16, 9, 0))).toBe(at(2026, 10, 19, 8, 0));
    expect(nextRunAt(config({ days: [] }), false, NOW)).toBeNull();
    expect(nextRunAt(config({ enabled: false }), false, NOW)).toBeNull();
  });

  it("counts calendar days, not hours", () => {
    expect(calendarDaysBetween(at(2026, 10, 11, 23, 59), at(2026, 10, 12, 0, 1))).toBe(1);
    expect(calendarDaysBetween(at(2026, 10, 7, 17, 0), at(2026, 10, 12, 8, 0))).toBe(5);
    expect(localDateKey(NOW)).toBe("2026-10-12");
  });
});

describe("which findings are overdue", () => {
  const ids = (db: Database, c = config()) => overdueFindings(db, c, NOW).map((o) => o.finding.id);

  it("reminds after the threshold, counted from the last progress step", () => {
    const db = makeDb(
      [finding("old"), finding("recent"), finding("exact")],
      [step("old", "QUEUE_BRANCH_MANAGER", at(2026, 10, 1)), step("recent", "QUEUE_BRANCH_MANAGER", at(2026, 10, 9)), step("exact", "QUEUE_BRANCH_MANAGER", at(2026, 10, 7, 17, 0))]
    );
    expect(ids(db)).toEqual(["old", "exact"]);
    expect(overdueFindings(db, config(), NOW)[0].days).toBe(11);
  });

  it("only branch work restarts the count - not verification, a partial close or an adjustment", () => {
    const sent = step("f", "QUEUE_BRANCH_MANAGER", at(2026, 10, 1));
    const noise = ["DISTRICT_VERIFY_RECTIFICATION", "PARTIAL_CLOSE", "ADJUSTMENT_APPLIED"].map((a) => step("f", a, at(2026, 10, 11)));
    // updatedAt is yesterday (those steps touch it), yet it is still overdue.
    expect(ids(makeDb([finding("f", { status: "PARTIALLY_RECTIFIED", rectifiedCases: 1, updatedAt: iso(at(2026, 10, 11)) })], [sent, ...noise]))).toEqual(["f"]);
    for (const action of ["RECTIFY", "RESUBMIT_RECTIFICATION", "RETURN_RECTIFICATION", "REVERSE", "TRANSFER"]) {
      expect(ids(makeDb([finding("f")], [sent, step("f", action, at(2026, 10, 11))]))).toEqual([]);
    }
  });

  it("only findings waiting for the branch", () => {
    const sent = (id: string) => step(id, "QUEUE_BRANCH_MANAGER", at(2026, 10, 1));
    const db = makeDb(
      [
        finding("with-branch"),
        finding("returned", { status: "RECTIFICATION_RETURNED" }),
        finding("rectified", { status: "RECTIFIED", rectifiedCases: 2, rectifiedAmount: 200 }),
        finding("closed", { status: "CLOSED" }),
        finding("review", { status: "DISTRICT_REVIEW" }),
        finding("moved-done", { status: "TRANSFERRED", rectifiedCases: 2, rectifiedAmount: 200 }),
        finding("moved-open", { status: "TRANSFERRED" }),
      ],
      ["with-branch", "returned", "rectified", "closed", "review", "moved-done", "moved-open"].map(sent)
    );
    expect(ids(db)).toEqual(["with-branch", "returned", "moved-open"]);
  });

  it("reminds the same finding again only after the threshold has passed again", () => {
    const sent = step("f", "QUEUE_BRANCH_MANAGER", at(2026, 9, 1));
    expect(ids(makeDb([finding("f", { lastReminderAt: iso(at(2026, 10, 8, 8, 0)) })], [sent]))).toEqual([]);
    // Reminded 5 days ago at 08:00:20; today's run is at 08:00:05 - calendar days, so it is not skipped.
    expect(overdueFindings(makeDb([finding("f", { lastReminderAt: iso(at(2026, 10, 7, 8, 0) + 20_000) })], [sent]), config(), at(2026, 10, 12, 8, 0) + 5_000)).toHaveLength(1);
  });

  it("falls back to the last change when no step is recorded", () => {
    expect(ids(makeDb([finding("legacy", { updatedAt: iso(at(2026, 9, 20)) }), finding("fresh", { updatedAt: iso(at(2026, 10, 10)) })]))).toEqual(["legacy"]);
  });
});

// ---------------------------------------------------------------------------
// The run, against an in-memory store

function harness(db: Database, opts: { ran?: string[]; installed?: boolean; lockFree?: boolean; now?: number } = {}) {
  const runs: ReminderRun[] = (opts.ran ?? []).map((id) => ({ id, runDate: id, ranAt: iso(NOW), triggeredBy: "scheduler", remindedFindings: 0, notifiedUsers: 0, findingReferences: [] }));
  let current = db;
  const store: ReminderStore = {
    isInstalled: async () => opts.installed ?? true,
    ranOn: async (date) => runs.some((r) => r.id === date),
    listRuns: async (limit) => [...runs].reverse().slice(0, limit),
    saveRun: async (run) => {
      if (runs.some((r) => r.id === run.id)) return false;
      runs.push(run);
      return true;
    },
    deleteAll: async () => void runs.splice(0),
  };
  const deps: ReminderDeps = {
    store,
    readDb: async () => current,
    // Like the real one: the mutation is kept only if the transaction (alsoWrite) succeeds.
    updateDb: async (mutator, o) => {
      const copy: Database = JSON.parse(JSON.stringify(current));
      const result = mutator(copy);
      if (o?.alsoWrite) await o.alsoWrite({}, result);
      current = copy;
      return result;
    },
    lock: { acquire: async () => opts.lockFree ?? true, release: async () => {} },
    now: () => opts.now ?? NOW,
  };
  return { deps, runs, db: () => current };
}

const overdueDb = () => makeDb([finding("f1"), finding("f2"), finding("fresh")], [step("f1", "QUEUE_BRANCH_MANAGER", at(2026, 10, 1)), step("f2", "QUEUE_BRANCH_MANAGER", at(2026, 10, 2)), step("fresh", "QUEUE_BRANCH_MANAGER", at(2026, 10, 10))]);

describe("the daily run", () => {
  beforeEach(() => resetReminderThrottle());

  it("notifies the branch's rectifiers once, stamps the findings and records the run", async () => {
    const h = harness(overdueDb());
    const result = await runRemindersIfDue({ trigger: "scheduler", deps: h.deps });
    expect(result).toMatchObject({ ran: true, run: { id: "2026-10-12", triggeredBy: "scheduler", remindedFindings: 2, notifiedUsers: 2, findingReferences: ["F1", "F2"] } });
    const db = h.db();
    // 2 findings x the 2 rectifiers of branch b1; nobody from branch b2.
    expect(db.notifications.map((n) => [n.type, n.recipientUserId]).sort()).toEqual([
      ["RECTIFICATION_REMINDER", "bc"],
      ["RECTIFICATION_REMINDER", "bc"],
      ["RECTIFICATION_REMINDER", "bm"],
      ["RECTIFICATION_REMINDER", "bm"],
    ]);
    expect(db.findings.map((f) => Boolean(f.lastReminderAt))).toEqual([true, true, false]);
    expect(h.runs).toHaveLength(1);
  });

  it("never runs a day twice - a second call sends nothing", async () => {
    const h = harness(overdueDb());
    await runRemindersIfDue({ trigger: "scheduler", deps: h.deps });
    expect(await runRemindersIfDue({ trigger: "scheduler", deps: h.deps })).toEqual({ ran: false, skipped: "already-ran" });
    expect(await runRemindersIfDue({ trigger: "in-app", deps: h.deps })).toEqual({ ran: false, skipped: "already-ran" });
    expect(h.db().notifications).toHaveLength(4);
  });

  it("two callers at the same moment: the loser's whole run is rolled back", async () => {
    const h = harness(overdueDb());
    // Both pass the "ran today?" check before either saves.
    const racing = { ...h.deps, store: { ...h.deps.store, ranOn: async () => false } };
    const [a, b] = await Promise.all([runRemindersIfDue({ trigger: "scheduler", deps: racing }), runRemindersIfDue({ trigger: "scheduler", deps: racing })]);
    expect([a.ran, b.ran].sort()).toEqual([false, true]);
    expect(h.runs).toHaveLength(1);
    expect(h.db().notifications).toHaveLength(4);
  });

  it("doesn't run before the send time, on an unticked day, when switched off, or while another server holds the lock", async () => {
    const run = (db: Database, o: Parameters<typeof harness>[1] = {}) => runRemindersIfDue({ trigger: "scheduler", deps: harness(db, o).deps });
    expect(await run(overdueDb(), { now: at(2026, 10, 12, 7, 30) })).toEqual({ ran: false, skipped: "not-due" });
    expect(await run(overdueDb(), { now: at(2026, 10, 11, 9, 0) })).toEqual({ ran: false, skipped: "not-due" }); // Sunday
    expect(await run(makeDb([finding("f1")], [], { enabled: false, thresholdDays: 5 }))).toEqual({ ran: false, skipped: "disabled" });
    expect(await run(overdueDb(), { lockFree: false })).toEqual({ ran: false, skipped: "busy" });
    expect(await run(overdueDb(), { installed: false })).toEqual({ ran: false, skipped: "not-installed" });
  });

  it("the signed-in backup is throttled per server; the scheduler is not", async () => {
    const h = harness(overdueDb(), { now: at(2026, 10, 12, 7, 0) });
    expect((await runRemindersIfDue({ trigger: "in-app", deps: h.deps })).skipped).toBe("not-due");
    expect((await runRemindersIfDue({ trigger: "in-app", deps: h.deps })).skipped).toBe("throttled");
    expect((await runRemindersIfDue({ trigger: "scheduler", deps: h.deps })).skipped).toBe("not-due");
  });

  it("an admin's Run now ignores the time and the day's run, but not a recent reminder", async () => {
    const h = harness(overdueDb(), { now: at(2026, 10, 11, 6, 0) }); // Sunday, before the send time
    const first = await runRemindersIfDue({ trigger: "manual", deps: h.deps });
    expect(first).toMatchObject({ ran: true, run: { triggeredBy: "manual", remindedFindings: 2 } });
    expect(first.run!.id).toMatch(/^2026-10-11-manual-/);
    // Again straight away: it runs, but everything was just reminded.
    expect(await runRemindersIfDue({ trigger: "manual", deps: h.deps })).toMatchObject({ ran: true, run: { remindedFindings: 0 } });
    expect(h.db().notifications).toHaveLength(4);
  });

  it("a run with nothing overdue is still recorded (so the day isn't checked again)", async () => {
    const h = harness(makeDb([finding("fresh")], [step("fresh", "QUEUE_BRANCH_MANAGER", at(2026, 10, 10))]));
    expect(await runRemindersIfDue({ trigger: "scheduler", deps: h.deps })).toMatchObject({ ran: true, run: { remindedFindings: 0, notifiedUsers: 0 } });
    expect(h.runs).toHaveLength(1);
  });

  it("status: due now, overdue count, last run and the next run", async () => {
    const h = harness(overdueDb());
    expect(await getReminderStatus(h.deps)).toMatchObject({ installed: true, ranToday: false, dueNow: true, overdueNow: 2, runs: [] });
    await runRemindersIfDue({ trigger: "scheduler", deps: h.deps });
    const after = await getReminderStatus(h.deps);
    expect(after).toMatchObject({ ranToday: true, dueNow: false, overdueNow: 0 });
    expect(after.nextRunAt).toBe(iso(at(2026, 10, 13, 8, 0)));
    expect(after.runs[0]).toMatchObject({ remindedFindings: 2, triggeredBy: "scheduler" });
  });
});
