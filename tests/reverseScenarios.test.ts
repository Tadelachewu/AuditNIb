import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database, Finding, FindingStatus } from "@/types";

// Every scenario in docs/reverse-findings.md ("All scenarios"), by its ID.
// Reverse undoes only the finding's CURRENT period; previous periods never change.

let db: Database;
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  readDb: vi.fn(async () => structuredClone(db)),
  updateDb: vi.fn(async (fn: (d: Database) => unknown) => fn(db)),
}));
vi.mock("@/lib/monitoring", () => ({ captureServerException: vi.fn(async () => {}) }));
vi.mock("@/lib/notifications", () => ({
  notifyUsers: vi.fn(),
  notifyFindingsPermissionHolders: vi.fn(),
  usersWithFindingsPermission: vi.fn(() => []),
}));

import { getCurrentUser } from "@/lib/session";
import { canReverse, reverseFinding } from "@/lib/findingReverse";
import { findingsResidentInPeriod, transferFinding } from "@/lib/findings";
import { getWeeklyExecutiveSummary } from "@/lib/reportTemplates";
import { findingStatusCode, findingStatusLabel } from "@/types";
import { POST as reverseRoute } from "@/app/api/findings/[id]/reverse/route";
import { POST as rectifyRoute } from "@/app/api/findings/[id]/rectify/route";
import { POST as verifyRoute } from "@/app/api/findings/[id]/verify-rectification/route";
import { POST as closeRoute } from "@/app/api/findings/[id]/close/route";
import { POST as transferRoute } from "@/app/api/findings/[id]/transfer/route";

// ---------- fixture ----------

const PERIODS = ["p8", "p9", "p10", "p11"];
function fixture(): Database {
  return {
    reportingPeriods: PERIODS.map((id, i) => ({
      id, code: `2026-0${8 + i}`.replace("2026-010", "2026-10").replace("2026-011", "2026-11"), year: 2026, month: 8 + i, status: "OPEN",
      startsAt: new Date(Date.UTC(2026, 7 + i, 1)).toISOString(),
    })),
    categories: [{ id: "c1", code: "OTHER_CASE", name: "Other Case", active: true }],
    districts: [{ id: "d1", code: "D01", name: "Addis", status: "ACTIVE" }],
    branches: [{ id: "b1", code: "B001", name: "Bole", districtId: "d1", status: "ACTIVE" }],
    findings: [],
    findingTransitions: [],
    rectifications: [],
    findingTransfers: [],
    findingClosures: [],
    findingCases: [],
    auditLogs: [],
    notifications: [],
    users: [],
    roles: [],
    settings: { reportTemplateSources: {}, hoApproval: { required: false } },
  } as unknown as Database;
}

const actor = { userId: "u1", userName: "HO" };
let seq = 0;

/** A finding sent to the branch in `periodId` with `cases` cases of 1,000 each. */
function addFinding(cases: number, periodId = "p9", status: FindingStatus = "SENT_TO_BRANCH_MANAGER"): Finding {
  const f = {
    id: `f${++seq}`, reference: `F-${seq}`, status, periodId, branchId: "b1", districtId: "d1", categoryId: "c1", sourceId: "s1",
    createdBy: "u1", currency: "ETB", findingDate: "2026-09-10", createdAt: "2026-09-10T08:00:00.000Z",
    caseCount: cases, amount: cases * 1000,
    rectifiedCases: 0, rectifiedAmount: 0, districtVerifiedCases: 0, districtVerifiedAmount: 0, closedCases: 0, closedAmount: 0,
    lastReminderAt: "2026-09-15T08:00:00.000Z",
  } as unknown as Finding;
  db.findings.push(f);
  return f;
}
/** Branch records `cases` rectified in the finding's current period. */
function rectify(f: Finding, cases: number, caseIds?: string[]): string {
  const id = `r${++seq}`;
  db.rectifications.push({ id, findingId: f.id, periodId: f.periodId, rectifiedCases: cases, rectifiedAmount: cases * 1000, submittedBy: "u1", submittedByName: "BM", createdAt: `2026-09-1${seq % 10}T09:00:00.000Z`, caseIds });
  f.rectifiedCases += cases;
  f.rectifiedAmount += cases * 1000;
  for (const c of db.findingCases) if (caseIds?.includes(c.id)) Object.assign(c, { status: "RECTIFIED", rectificationId: id, rectifiedAt: `2026-09-1${seq % 10}T09:00:00.000Z` });
  return id;
}
/** District verifies everything rectified so far. */
function verify(f: Finding) {
  f.districtVerifiedCases = f.rectifiedCases;
  f.districtVerifiedAmount = f.rectifiedAmount;
}
/** HO closes `cases` in the finding's current period. */
function close(f: Finding, cases: number, at = "2026-09-20T09:00:00.000Z") {
  db.findingClosures.push({ id: `c${++seq}`, findingId: f.id, periodId: f.periodId, closedCases: cases, closedAmount: cases * 1000, submittedBy: "u1", submittedByName: "HO", createdAt: at });
  f.closedCases += cases;
  f.closedAmount += cases * 1000;
  f.status = f.closedCases >= f.caseCount ? "CLOSED" : f.status;
}
/** Rectify + verify + close in one go. */
function closeCases(f: Finding, cases: number, at?: string) {
  rectify(f, cases);
  verify(f);
  close(f, cases, at);
}
function transfer(f: Finding, toPeriodId: string) {
  transferFinding(db, f, { toPeriodId, reason: "carry over", ...actor });
}
/** Itemized cases (one row per case, 1,000 each). */
function itemize(f: Finding) {
  for (let i = 1; i <= f.caseCount; i++) db.findingCases.push({ id: `${f.id}-case${i}`, findingId: f.id, seq: i, amount: 1000, status: "OUTSTANDING", createdAt: f.createdAt });
}
const slice = (f: Finding, periodId: string) => {
  const s = findingsResidentInPeriod(db, periodId, [f])[0]?.slice;
  return s ? { cases: s.eligibleCases, closed: s.closedCases } : { cases: 0, closed: 0 };
};
const totals = (f: Finding) => ({ rectified: f.rectifiedCases, verified: f.districtVerifiedCases, closed: f.closedCases });

// ---------- routes ----------

const session = () => ({
  isLoggedIn: true, userId: "u1", name: "HO", orgScope: "BANK",
  permissions: ["findings.reopen", "findings.rectify", "findings.verify-rectification", "findings.close", "findings.transfer"],
});
const post = (body: unknown = {}) =>
  new Request("http://localhost/api/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = (f: Finding) => ({ params: Promise.resolve({ id: f.id }) });
const api = {
  reverse: (f: Finding, reason = "closure was wrong") => reverseRoute(post({ reason }), ctx(f)),
  rectify: (f: Finding, cases: number) => rectifyRoute(post({ rectifiedCases: cases, rectifiedAmount: cases * 1000 }), ctx(f)),
  verify: (f: Finding) => verifyRoute(post(), ctx(f)),
  close: (f: Finding) => closeRoute(post(), ctx(f)),
  transfer: (f: Finding, toPeriodId: string) => transferRoute(post({ toPeriodId, reason: "carry over" }), ctx(f)),
};
/** Rectify, verify and close `cases` through the real routes. */
async function closeViaRoutes(f: Finding, cases: number) {
  expect((await api.rectify(f, cases)).status).toBe(200);
  expect((await api.verify(f)).status).toBe(200);
  expect((await api.close(f)).status).toBe(200);
}

beforeEach(() => {
  db = fixture();
  seq = 0;
  vi.mocked(getCurrentUser).mockResolvedValue(session() as never);
});

// ---------- N: not reversible ----------

describe("N - not reversible (button hidden)", () => {
  it.each(["DRAFT", "SUBMITTED", "DISTRICT_REVIEW", "HO_REVIEW", "PENDING_BANK_APPROVAL", "RETURNED", "REJECTED"] as FindingStatus[])(
    "N1 - %s: never reached the branch",
    (status) => {
      const f = addFinding(2, "p9", status);
      expect(canReverse(db, f)).toBe(false);
    }
  );

  it.each(["SENT_TO_BRANCH_MANAGER", "REVERSED"] as FindingStatus[])("N2 - %s with nothing done", (status) => {
    const f = addFinding(2, "p9", status);
    expect(canReverse(db, f)).toBe(false);
  });

  it("N3 - rectified and verified but nothing closed", () => {
    const f = addFinding(2, "p9", "PARTIALLY_RECTIFIED");
    rectify(f, 1);
    verify(f);
    expect(canReverse(db, f)).toBe(false);
  });

  it("N4 - Rectification Returned, nothing closed", () => {
    const f = addFinding(2, "p9", "RECTIFICATION_RETURNED");
    rectify(f, 1);
    expect(canReverse(db, f)).toBe(false);
  });

  it("N5 - transferred, closed only in a previous period", () => {
    const f = addFinding(2);
    closeCases(f, 1);
    transfer(f, "p10");
    expect(f.closedCases).toBe(1);
    expect(canReverse(db, f)).toBe(false);
  });

  it("the API refuses it too (FINDING_NOT_REVERSIBLE) and changes nothing", async () => {
    const f = addFinding(2);
    closeCases(f, 1);
    transfer(f, "p10");
    const before = structuredClone(db);
    const res = await api.reverse(f);
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).toContain("FINDING_NOT_REVERSIBLE");
    expect(db).toEqual(before);
  });
});

// ---------- A: never transferred ----------

describe("A - never transferred: reversed in its own (originally reported) period", () => {
  it("A1 - closed: everything back to 0, status Sent to Branch Manager/R, history kept", async () => {
    const f = addFinding(2);
    closeCases(f, 2);
    expect(f.status).toBe("CLOSED");
    expect(canReverse(db, f)).toBe(true);

    const res = await api.reverse(f, "closed by mistake");

    expect(res.status).toBe(200);
    expect(f).toMatchObject({ status: "REVERSED", periodId: "p9", amount: 2000, caseCount: 2 });
    expect(totals(f)).toEqual({ rectified: 0, verified: 0, closed: 0 });
    expect(f.closedAmount + f.rectifiedAmount + f.districtVerifiedAmount).toBe(0);
    expect(slice(f, "p9")).toEqual({ cases: 2, closed: 0 });
    expect(db.findingClosures).toHaveLength(0);
    expect(db.rectifications).toHaveLength(0);
    expect(db.findingTransitions[0]).toMatchObject({ action: "REVERSE", fromStatus: "CLOSED", toStatus: "REVERSED", reason: "closed by mistake" });
    const audit = db.auditLogs.find((l) => l.action === "FINDING_REVERSED")!;
    expect(audit.reason).toBe("closed by mistake");
    expect(audit.oldValue).toMatchObject({ status: "CLOSED", periodId: "p9", closedCases: 2 });
    expect(canReverse(db, f)).toBe(false);
  });

  it("A2 - partially closed: every closure AND rectification in the period is removed", () => {
    const f = addFinding(3, "p9", "PARTIALLY_RECTIFIED");
    closeCases(f, 1); // closed
    rectify(f, 1); // rectified + verified, not closed
    verify(f);
    expect(totals(f)).toEqual({ rectified: 2, verified: 2, closed: 1 });

    reverseFinding(db, f, actor, "wrong");

    expect(f.status).toBe("REVERSED");
    expect(totals(f)).toEqual({ rectified: 0, verified: 0, closed: 0 });
    expect(db.rectifications).toHaveLength(0);
    expect(slice(f, "p9")).toEqual({ cases: 3, closed: 0 });
  });

  it("A3 - partially closed, then Rectification Returned: the return stays in history", () => {
    const f = addFinding(2, "p9", "PARTIALLY_RECTIFIED");
    closeCases(f, 1);
    rectify(f, 1);
    db.findingTransitions.unshift({ id: "t-ret", findingId: f.id, fromStatus: "RECTIFIED", toStatus: "RECTIFICATION_RETURNED", action: "RETURN_RECTIFICATION", userId: "u1", userName: "DC", reason: "wrong evidence", createdAt: "2026-09-21T00:00:00.000Z" });
    f.status = "RECTIFICATION_RETURNED";

    reverseFinding(db, f, actor, "wrong");

    expect(f.status).toBe("REVERSED");
    expect(totals(f)).toEqual({ rectified: 0, verified: 0, closed: 0 });
    expect(db.findingTransitions.some((t) => t.id === "t-ret" && t.reason === "wrong evidence")).toBe(true);
  });

  it("A4 - itemized: every case goes back to Outstanding", () => {
    const f = addFinding(2);
    itemize(f);
    rectify(f, 2, [`${f.id}-case1`, `${f.id}-case2`]);
    verify(f);
    close(f, 2);

    reverseFinding(db, f, actor, "wrong");

    expect(db.findingCases.map((c) => c.status)).toEqual(["OUTSTANDING", "OUTSTANDING"]);
    expect(db.findingCases.every((c) => c.rectificationId === undefined && c.rectifiedAt === undefined)).toBe(true);
  });
});

// ---------- B: transferred ----------

describe("B - transferred: reversed in the current period only", () => {
  it("B1 - nothing closed before the transfer, fully closed in the current period", () => {
    const f = addFinding(2);
    transfer(f, "p10");
    closeCases(f, 2);
    expect(slice(f, "p9")).toEqual({ cases: 0, closed: 0 });

    reverseFinding(db, f, actor, "wrong");

    expect(f).toMatchObject({ status: "REVERSED", periodId: "p10" });
    expect(totals(f)).toEqual({ rectified: 0, verified: 0, closed: 0 });
    expect(slice(f, "p9")).toEqual({ cases: 0, closed: 0 });
    expect(slice(f, "p10")).toEqual({ cases: 2, closed: 0 });
    expect(db.findingTransfers).toHaveLength(1);
  });

  it("B2 - part closed in the previous period, the rest closed in the current one (the doc's Example)", () => {
    const f = addFinding(2);
    closeCases(f, 1);
    transfer(f, "p10");
    closeCases(f, 1);
    expect(f.status).toBe("CLOSED");
    const p9Before = slice(f, "p9");
    expect(p9Before).toEqual({ cases: 1, closed: 1 });

    reverseFinding(db, f, actor, "wrong");

    expect(slice(f, "p9")).toEqual(p9Before);
    expect(slice(f, "p10")).toEqual({ cases: 1, closed: 0 });
    expect(f.status).toBe("REVERSED");
    expect(totals(f)).toEqual({ rectified: 1, verified: 1, closed: 1 });
    expect(f.caseCount - f.rectifiedCases).toBe(1); // left to rectify = what 2026-10 holds
    expect(db.findingClosures.map((c) => c.periodId)).toEqual(["p9"]);
    expect(db.rectifications.map((r) => r.periodId)).toEqual(["p9"]);
    expect(db.findingTransfers).toHaveLength(1);
  });

  it("B3 - current period only partially closed", () => {
    const f = addFinding(3);
    closeCases(f, 1);
    transfer(f, "p10");
    closeCases(f, 1);
    expect(f.status).toBe("TRANSFERRED");

    reverseFinding(db, f, actor, "wrong");

    expect(slice(f, "p9")).toEqual({ cases: 1, closed: 1 });
    expect(slice(f, "p10")).toEqual({ cases: 2, closed: 0 });
    expect(totals(f)).toEqual({ rectified: 1, verified: 1, closed: 1 });
  });

  it("B4 - rectified (not closed) before the transfer, closed after it", () => {
    const f = addFinding(2);
    rectify(f, 1); // in 2026-09, never closed there
    transfer(f, "p10"); // carries both cases (nothing closed)
    rectify(f, 1);
    verify(f);
    close(f, 2);

    reverseFinding(db, f, actor, "wrong");

    expect(slice(f, "p9")).toEqual({ cases: 0, closed: 0 });
    expect(slice(f, "p10")).toEqual({ cases: 2, closed: 0 });
    expect(totals(f)).toEqual({ rectified: 0, verified: 0, closed: 0 });
    // The 2026-09 rectification stays as history.
    expect(db.rectifications.map((r) => r.periodId)).toEqual(["p9"]);
  });

  it("B5 - several hops: only the last period is reversed", () => {
    const f = addFinding(3, "p8");
    closeCases(f, 1);
    transfer(f, "p9");
    closeCases(f, 1);
    transfer(f, "p10");
    closeCases(f, 1);

    reverseFinding(db, f, actor, "wrong");

    expect(slice(f, "p8")).toEqual({ cases: 1, closed: 1 });
    expect(slice(f, "p9")).toEqual({ cases: 1, closed: 1 });
    expect(slice(f, "p10")).toEqual({ cases: 1, closed: 0 });
    expect(totals(f)).toEqual({ rectified: 2, verified: 2, closed: 2 });
  });

  it("B6 - return trip: every closure credited to the current period is removed, the other period untouched", () => {
    const f = addFinding(3);
    closeCases(f, 1); // 2026-09, first visit
    transfer(f, "p10");
    closeCases(f, 1); // 2026-10
    transfer(f, "p9"); // back
    closeCases(f, 1); // 2026-09, second visit

    reverseFinding(db, f, actor, "wrong");

    expect(slice(f, "p10")).toEqual({ cases: 1, closed: 1 });
    expect(slice(f, "p9")).toEqual({ cases: 2, closed: 0 });
    expect(totals(f)).toEqual({ rectified: 1, verified: 1, closed: 1 });
    expect(f.caseCount - f.rectifiedCases).toBe(2); // = what 2026-09 holds
  });

  it("B7 - itemized: cases closed in a previous period stay Rectified", () => {
    const f = addFinding(2);
    itemize(f);
    rectify(f, 1, [`${f.id}-case1`]);
    verify(f);
    close(f, 1);
    transfer(f, "p10");
    rectify(f, 1, [`${f.id}-case2`]);
    verify(f);
    close(f, 1);

    reverseFinding(db, f, actor, "wrong");

    expect(db.findingCases.map((c) => [c.seq, c.status])).toEqual([[1, "RECTIFIED"], [2, "OUTSTANDING"]]);
  });
});

// ---------- C: after a reversal ----------

describe("C - after a reversal", () => {
  it("C1 - the branch rectifies, district verifies, HO closes again; Reverse is offered again", async () => {
    const f = addFinding(2);
    closeCases(f, 2);
    await api.reverse(f);
    expect(canReverse(db, f)).toBe(false);

    await closeViaRoutes(f, 2);

    expect(f.status).toBe("CLOSED");
    expect(db.findingClosures.map((c) => c.periodId)).toEqual(["p9"]);
    expect(slice(f, "p9")).toEqual({ cases: 2, closed: 2 });
    expect(canReverse(db, f)).toBe(true);
  });

  it("C1 - no gap: the current period can't rectify more than it holds", async () => {
    const f = addFinding(2);
    closeCases(f, 1);
    transfer(f, "p10");
    closeCases(f, 1);
    await api.reverse(f);

    expect((await api.rectify(f, 2)).status).toBe(400);
    await closeViaRoutes(f, 1);
    expect(f.status).toBe("CLOSED");
    expect(slice(f, "p9")).toEqual({ cases: 1, closed: 1 });
    expect(slice(f, "p10")).toEqual({ cases: 1, closed: 1 });
  });

  it("C2 - transferred before being closed again: a later Reverse affects only the new period", async () => {
    const f = addFinding(2);
    closeCases(f, 1);
    transfer(f, "p10");
    closeCases(f, 1);
    await api.reverse(f);

    expect((await api.transfer(f, "p11")).status).toBe(200);
    await closeViaRoutes(f, 1);
    const p9 = slice(f, "p9");
    const p10 = slice(f, "p10");
    expect(slice(f, "p11")).toEqual({ cases: 1, closed: 1 });

    expect((await api.reverse(f)).status).toBe(200);

    expect(slice(f, "p9")).toEqual(p9);
    expect(slice(f, "p10")).toEqual(p10);
    expect(slice(f, "p11")).toEqual({ cases: 1, closed: 0 });
  });

  it("C3 - reversed again after a re-closure", async () => {
    const f = addFinding(2);
    closeCases(f, 2);
    await api.reverse(f, "first");
    await closeViaRoutes(f, 2);

    expect((await api.reverse(f, "second")).status).toBe(200);

    expect(totals(f)).toEqual({ rectified: 0, verified: 0, closed: 0 });
    expect(db.findingTransitions.filter((t) => t.action === "REVERSE").map((t) => t.reason)).toEqual(["second", "first"]);
    expect(db.auditLogs.filter((l) => l.action === "FINDING_REVERSED")).toHaveLength(2);
  });

  it("C4 - locked periods make no difference to Reverse or the follow-up work", async () => {
    const f = addFinding(2);
    closeCases(f, 1);
    transfer(f, "p10");
    closeCases(f, 1);
    for (const p of db.reportingPeriods) p.status = "LOCKED";

    expect((await api.reverse(f)).status).toBe(200);
    await closeViaRoutes(f, 1);
    expect(f.status).toBe("CLOSED");
    expect(slice(f, "p9")).toEqual({ cases: 1, closed: 1 });
  });
});

// ---------- effect on figures ----------

describe("effect on figures", () => {
  it("current period drops its closures; previous periods unchanged; lifetime drops by the current period's part", () => {
    const f = addFinding(3);
    closeCases(f, 1);
    transfer(f, "p10");
    closeCases(f, 2);
    expect(f.closedCases).toBe(3);

    reverseFinding(db, f, actor, "wrong");

    expect(slice(f, "p10")).toEqual({ cases: 2, closed: 0 }); // total cases unchanged
    expect(slice(f, "p9")).toEqual({ cases: 1, closed: 1 });
    expect(f.closedCases).toBe(1); // lifetime: 3 - 2
  });

  it("Weekly Executive Summary: the removed closures also drop out of past weekly snapshots", () => {
    const f = addFinding(2);
    closeCases(f, 2, "2026-09-16T09:00:00.000Z");
    const week = () => getWeeklyExecutiveSummary(db, "2026-09-20", "2026-09-13")[0].rows[0];
    expect(week()).toMatchObject({ rectified: 2, currentBalance: 0, thisWeekPct: 100 });

    reverseFinding(db, f, actor, "wrong");

    expect(week()).toMatchObject({ rectified: 0, currentBalance: 2, thisWeekPct: 0 });
  });

  it("status shows as SENT TO BRANCH MANAGER/R (and SENT_TO_BRANCH_MANAGER/R in CSV); still official and outstanding", async () => {
    const f = addFinding(2);
    closeCases(f, 2);
    reverseFinding(db, f, actor, "wrong");
    expect(findingStatusLabel(f.status)).toBe("SENT TO BRANCH MANAGER/R");
    expect(findingStatusCode(f.status)).toBe("SENT_TO_BRANCH_MANAGER/R");
    const { isHoApproved } = await import("@/lib/findings");
    expect(isHoApproved(f)).toBe(true);
  });

  it("the rectification-reminder timer starts again", () => {
    const f = addFinding(2);
    closeCases(f, 2);
    expect(f.lastReminderAt).toBeDefined();
    reverseFinding(db, f, actor, "wrong");
    expect(f.lastReminderAt).toBeUndefined();
  });
});
