import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mail", () => ({ sendNotificationEmail: vi.fn() }));

import { createAdjustment, deleteAdjustment, editAdjustment, reviewAdjustment, submitAdjustment, withdrawAdjustment } from "@/lib/adjustments/service";
import { eligibilityProblem, isRevolvingArea, resolveChange, type AdjustmentInput } from "@/lib/adjustments/rules";
import type { AdjustmentConfig, FindingAdjustment } from "@/lib/adjustments/types";
import { findingsResidentInPeriod, originalPeriodShare, queueStatusesForSession, reportedInPeriod } from "@/lib/findings";
import { adjustmentDashboardTotals } from "@/lib/adjustments/dashboard";
import type { Database, Finding, FindingCase } from "@/types";

// Revolving findings - docs/revolving-findings.md §9 (automated cases).

const NOW = new Date("2026-10-15T09:00:00Z");
const config: AdjustmentConfig = { revolvingOperationAreas: ["Dormant Accounts"], updatedAt: null, updatedBy: null };

const session = (userId: string, orgScope: "BANK" | "DISTRICT" | "BRANCH", permissions: string[]) =>
  ({ userId, name: userId.toUpperCase(), orgScope, districtId: "d1", branchId: "b1", permissions: permissions.map((p) => `findings.${p}`) }) as never;
const branchCtl = session("bc", "BRANCH", ["create", "submit", "view"]);
const otherBranchCtl = session("bc2", "BRANCH", ["create", "submit", "view"]);
const district = session("dc", "DISTRICT", ["district-review", "view"]);
const ho = session("ho", "BANK", ["ho-review", "view"]);
const bankRegistrant = session("hor", "BANK", ["create", "submit", "view"]);
const approver = session("ap", "BANK", ["bank-approval", "view"]);

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    reference: "F-1",
    periodId: "p10",
    districtId: "d1",
    branchId: "b1",
    operationArea: "dormant accounts",
    currency: "ETB",
    caseCount: 3,
    amount: 300,
    registeredCaseCount: 3,
    registeredAmount: 300,
    status: "SENT_TO_BRANCH_MANAGER",
    registeredByBankScope: false,
    rectifiedCases: 0,
    rectifiedAmount: 0,
    closedCases: 0,
    closedAmount: 0,
    districtVerifiedCases: 0,
    districtVerifiedAmount: 0,
    createdBy: "bc",
    updatedAt: "2026-10-01T00:00:00Z",
    ...over,
  } as Finding;
}

function makeDb(f: Finding = finding(), cases: FindingCase[] = [], hoApprovalRequired = true): Database {
  return {
    findings: [f],
    findingCases: cases,
    findingAdjustments: [],
    findingTransitions: [],
    findingTransfers: [],
    findingClosures: [],
    auditLogs: [],
    notifications: [],
    users: [],
    roles: [],
    reportingPeriods: [
      { id: "p9", code: "2026-09", status: "OPEN", startsAt: "2026-09-01T00:00:00Z", endsAt: "2026-09-30T23:59:59Z", submissionStartsAt: "2026-09-01T00:00:00Z", submissionEndsAt: "2026-10-10T00:00:00Z" },
      { id: "p10", code: "2026-10", status: "OPEN", startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-31T23:59:59Z", submissionStartsAt: "2026-10-01T00:00:00Z", submissionEndsAt: "2026-11-10T00:00:00Z" },
    ],
    settings: { hoApproval: { required: hoApprovalRequired, approverUserIds: ["ap"] } },
  } as unknown as Database;
}

const input = (over: Partial<Parameters<typeof resolveChange>[2]> = {}) => ({ addedCases: 2, amountChange: 200, reason: "Two more dormant accounts found", ...over });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("eligibility (R1, R2, R8, R14)", () => {
  it("a listed area (case-insensitive) in the current period is eligible", () => {
    expect(isRevolvingArea(config, " DORMANT  accounts ".trim())).toBe(true);
    expect(eligibilityProblem(makeDb(), config, branchCtl, finding())).toBeNull();
  });

  it("refuses an area that isn't listed", () => {
    expect(eligibilityProblem(makeDb(), config, branchCtl, finding({ operationArea: "Loans" }))).toMatch(/aren't enabled/);
  });

  it("refuses a finding left in an older period", () => {
    const f = finding({ periodId: "p9" });
    expect(eligibilityProblem(makeDb(f), config, branchCtl, f)).toMatch(/current period/);
  });

  it("refuses closed, draft and in-review findings", () => {
    for (const status of ["CLOSED", "DRAFT", "DISTRICT_REVIEW"] as const) {
      const f = finding({ status });
      expect(eligibilityProblem(makeDb(f), config, branchCtl, f)).toMatch(/outstanding/);
    }
  });

  it("refuses a bank-wide user on a branch-registered finding, and the reverse", () => {
    expect(eligibilityProblem(makeDb(), config, bankRegistrant, finding())).toMatch(/branch \/ district/);
    const f = finding({ registeredByBankScope: true });
    expect(eligibilityProblem(makeDb(f), config, branchCtl, f)).toMatch(/bank-wide/);
  });

  it("allows only one open adjustment per finding", () => {
    const db = makeDb();
    createAdjustment(db, config, branchCtl, "f1", input(), { submit: false });
    expect(eligibilityProblem(db, config, branchCtl, db.findings[0])).toMatch(/already has an adjustment/);
  });
});

describe("validation (R3, R5, R7)", () => {
  const check = (f: Finding, i: ReturnType<typeof input>, cases: FindingCase[] = []) => resolveChange(makeDb(f, cases), f, i);

  it("refuses negative cases and no change", () => {
    expect(check(finding(), input({ addedCases: -1 }))).toMatchObject({ ok: false });
    expect(check(finding(), input({ addedCases: 0, amountChange: 0 }))).toMatchObject({ ok: false, problem: expect.stringMatching(/Nothing to change/) });
  });

  it("allows a decrease, but never below what's rectified", () => {
    const f = finding({ rectifiedCases: 1, rectifiedAmount: 120 });
    expect(check(f, input({ addedCases: 0, amountChange: -150 }))).toMatchObject({ ok: true, change: { newAmount: 150 } });
    expect(check(f, input({ addedCases: 0, amountChange: -200 }))).toMatchObject({ ok: false, problem: expect.stringMatching(/below what's already rectified/) });
  });

  it("keeps some amount outstanding while cases are outstanding", () => {
    const f = finding({ rectifiedCases: 1, rectifiedAmount: 100 });
    expect(check(f, input({ addedCases: 0, amountChange: -200 }))).toMatchObject({ ok: false, problem: expect.stringMatching(/above zero/) });
  });

  it("an increase on a fully rectified finding needs a case to carry it", () => {
    const f = finding({ status: "RECTIFIED", rectifiedCases: 3, rectifiedAmount: 300 });
    expect(check(f, input({ addedCases: 0, amountChange: 50 }))).toMatchObject({ ok: false, problem: expect.stringMatching(/add a case/) });
    expect(check(f, input({ addedCases: 1, amountChange: 50 }))).toMatchObject({ ok: true });
  });

  it("itemized: one amount per added case; only outstanding cases change", () => {
    const cases = [
      { id: "c1", findingId: "f1", seq: 1, amount: 100, status: "RECTIFIED", createdAt: "" },
      { id: "c2", findingId: "f1", seq: 2, amount: 200, status: "OUTSTANDING", createdAt: "" },
    ] as FindingCase[];
    const f = finding({ caseCount: 2, amount: 300, rectifiedCases: 1, rectifiedAmount: 100 });
    expect(check(f, input({ addedCases: 2, newCaseAmounts: [50] }), cases)).toMatchObject({ ok: false, problem: expect.stringMatching(/each added case/) });
    expect(check(f, input({ addedCases: 0, caseAmountChanges: [{ caseId: "c1", to: 90 }] }), cases)).toMatchObject({ ok: false, problem: expect.stringMatching(/already rectified/) });
    expect(check(f, input({ addedCases: 1, newCaseAmounts: [50], caseAmountChanges: [{ caseId: "c2", to: 150 }] }), cases)).toMatchObject({
      ok: true,
      change: { amountChange: 0, newCaseCount: 3, newAmount: 300 },
    });
  });
});

describe("routing (R11-R13)", () => {
  it("branch requester: District -> HO -> applied; the requester can't review their own", () => {
    const db = makeDb();
    const adj = createAdjustment(db, config, branchCtl, "f1", input(), { submit: true });
    expect(adj.status).toBe("DISTRICT_REVIEW");
    expect(() => reviewAdjustment(db, { ...(branchCtl as object), permissions: ["findings.district-review"] } as never, "f1", adj.id, "APPROVE")).toThrow(/you requested/);
    expect(() => reviewAdjustment(db, ho, "f1", adj.id, "APPROVE")).toThrow(/District reviewer/);
    reviewAdjustment(db, district, "f1", adj.id, "APPROVE");
    expect(adj.status).toBe("HO_REVIEW");
    reviewAdjustment(db, ho, "f1", adj.id, "APPROVE");
    expect(adj.status).toBe("APPROVED");
  });

  it("bank requester: bank-wide approval, or approved at once when it isn't required", () => {
    const f = finding({ registeredByBankScope: true });
    const db = makeDb(f);
    const adj = createAdjustment(db, config, bankRegistrant, "f1", input(), { submit: true });
    expect(adj.status).toBe("PENDING_BANK_APPROVAL");
    expect(() => reviewAdjustment(db, ho, "f1", adj.id, "APPROVE")).toThrow(/bank-wide approver/);
    reviewAdjustment(db, approver, "f1", adj.id, "APPROVE");
    expect(adj.status).toBe("APPROVED");

    const db2 = makeDb(finding({ registeredByBankScope: true }), [], false);
    expect(createAdjustment(db2, config, bankRegistrant, "f1", input(), { submit: true }).status).toBe("APPROVED");
    expect(db2.findings[0].caseCount).toBe(5);
  });

  it("return -> edit -> resubmit goes back through District review", () => {
    const db = makeDb();
    const adj = createAdjustment(db, config, branchCtl, "f1", input(), { submit: true });
    expect(() => reviewAdjustment(db, district, "f1", adj.id, "RETURN", "no")).toThrow(/reason/);
    reviewAdjustment(db, district, "f1", adj.id, "RETURN", "Attach the account list");
    expect(adj.status).toBe("RETURNED");
    editAdjustment(db, config, branchCtl, "f1", adj.id, input({ addedCases: 1, amountChange: 100 }), { submit: true });
    expect(adj).toMatchObject({ status: "DISTRICT_REVIEW", addedCases: 1 });
  });

  it("reject is final; withdraw and edit only before a reviewer acts", () => {
    const db = makeDb();
    const adj = createAdjustment(db, config, branchCtl, "f1", input(), { submit: true });
    editAdjustment(db, config, branchCtl, "f1", adj.id, input({ amountChange: 250 }), { submit: false });
    expect(adj).toMatchObject({ status: "DISTRICT_REVIEW", amountChange: 250 });
    reviewAdjustment(db, district, "f1", adj.id, "APPROVE");
    expect(() => editAdjustment(db, config, branchCtl, "f1", adj.id, input(), { submit: false })).toThrow(/already acted/);
    expect(() => withdrawAdjustment(db, branchCtl, "f1", adj.id)).toThrow(/already acted/);
    reviewAdjustment(db, ho, "f1", adj.id, "REJECT", "Not a revolving case");
    expect(adj.status).toBe("REJECTED");
    expect(db.findings[0].caseCount).toBe(3);

    const second = createAdjustment(db, config, branchCtl, "f1", input(), { submit: false });
    expect(() => withdrawAdjustment(db, otherBranchCtl, "f1", second.id)).toThrow(/requested/);
    withdrawAdjustment(db, branchCtl, "f1", second.id);
    expect(second.status).toBe("WITHDRAWN");
  });

  it("submit needs the submission window; a draft can be saved any time", () => {
    const db = makeDb();
    db.reportingPeriods[1].submissionEndsAt = "2026-10-14T00:00:00Z";
    const adj = createAdjustment(db, config, branchCtl, "f1", input(), { submit: false });
    expect(adj.status).toBe("DRAFT");
    expect(() => submitAdjustment(db, config, branchCtl, "f1", adj.id)).toThrow(/submission window/);
  });

  it("a de-listed area stops drafts; ones already in review can finish", () => {
    const db = makeDb();
    const draft = createAdjustment(db, config, branchCtl, "f1", input(), { submit: false });
    const delisted = { ...config, revolvingOperationAreas: [] };
    expect(() => submitAdjustment(db, delisted, branchCtl, "f1", draft.id)).toThrow(/no longer enabled/);
    withdrawAdjustment(db, branchCtl, "f1", draft.id);
    const pending = createAdjustment(db, config, branchCtl, "f1", input(), { submit: true });
    reviewAdjustment(db, district, "f1", pending.id, "APPROVE");
    reviewAdjustment(db, ho, "f1", pending.id, "APPROVE");
    expect(pending.status).toBe("APPROVED");
  });
});

describe("apply (§3)", () => {
  function approve(db: Database, i: AdjustmentInput = input()): FindingAdjustment {
    const adj = createAdjustment(db, config, branchCtl, "f1", i, { submit: true });
    reviewAdjustment(db, district, "f1", adj.id, "APPROVE");
    reviewAdjustment(db, ho, "f1", adj.id, "APPROVE");
    return adj;
  }

  it("changes the current figures, never the originals; history and audit written", () => {
    const db = makeDb();
    const adj = approve(db);
    expect(db.findings[0]).toMatchObject({ caseCount: 5, amount: 500, registeredCaseCount: 3, registeredAmount: 300 });
    expect(adj.applied).toMatchObject({ before: { caseCount: 3, amount: 300 }, after: { caseCount: 5, amount: 500 } });
    expect(db.findingTransitions[0]).toMatchObject({ action: "ADJUSTMENT_APPLIED" });
    expect(db.auditLogs.map((l) => l.action)).toContain("FINDING_ADJUSTMENT_APPROVED");
  });

  it("a Rectified finding with added cases becomes Partially Rectified", () => {
    const db = makeDb(finding({ status: "RECTIFIED", rectifiedCases: 3, rectifiedAmount: 300 }));
    approve(db, input({ addedCases: 1, amountChange: 80 }));
    expect(db.findings[0]).toMatchObject({ status: "PARTIALLY_RECTIFIED", caseCount: 4, amount: 380 });
  });

  it("itemized: new case rows numbered after the existing ones, changed amounts applied", () => {
    const cases = [
      { id: "c1", findingId: "f1", seq: 1, amount: 100, status: "OUTSTANDING", createdAt: "" },
      { id: "c2", findingId: "f1", seq: 2, amount: 200, status: "OUTSTANDING", createdAt: "" },
    ] as FindingCase[];
    const db = makeDb(finding({ caseCount: 2, amount: 300, registeredCaseCount: 2 }), cases);
    approve(db, { addedCases: 1, newCaseAmounts: [70], caseAmountChanges: [{ caseId: "c2", to: 230 }], reason: "One more ATM mismatch" });
    expect(db.findingCases.map((c) => [c.seq, c.amount])).toEqual([[1, 100], [2, 230], [3, 70]]);
    expect(db.findings[0]).toMatchObject({ caseCount: 3, amount: 400 });
  });

  it("re-checks on approval: a finding closed meanwhile can't take it", () => {
    const db = makeDb();
    const adj = createAdjustment(db, config, branchCtl, "f1", input(), { submit: true });
    reviewAdjustment(db, district, "f1", adj.id, "APPROVE");
    Object.assign(db.findings[0], { status: "CLOSED", rectifiedCases: 3, rectifiedAmount: 300, closedCases: 3, closedAmount: 300 });
    expect(() => reviewAdjustment(db, ho, "f1", adj.id, "APPROVE")).toThrow(/no longer outstanding/);
    reviewAdjustment(db, ho, "f1", adj.id, "REJECT", "Finding already closed");
    expect(db.findings[0].caseCount).toBe(3);
  });
});

describe("figures (§4)", () => {
  it("original-period report: added cases in the submitted month, closures FIFO", () => {
    const f = finding({ periodId: "p10", caseCount: 5, amount: 500, closedCases: 4, closedAmount: 400 });
    const db = makeDb(f);
    db.findingTransfers.push({ id: "t1", findingId: "f1", fromPeriodId: "p9", toPeriodId: "p10", casesTransferred: 3, amountTransferred: 300, createdAt: "2026-10-01T00:00:00Z" } as never);
    db.findingAdjustments.push({ id: "a1", findingId: "f1", periodId: "p10", status: "APPROVED", addedCases: 2, amountChange: 200, approvedAt: "2026-10-12T00:00:00Z" } as FindingAdjustment);
    expect(originalPeriodShare(db, f, "p9")).toEqual({ cases: 3, closed: 3, amount: 300 });
    expect(originalPeriodShare(db, f, "p10")).toEqual({ cases: 2, closed: 1, amount: 200 });
    expect(reportedInPeriod(db, f, "p10")).toEqual({ cases: 2, amount: 200 });
  });

  it("period split: added cases join the stay where the finding is at approval; totals = current", () => {
    const f = finding({ periodId: "p10", caseCount: 5, amount: 500 });
    const db = makeDb(f);
    db.findingTransfers.push({ id: "t1", findingId: "f1", fromPeriodId: "p9", toPeriodId: "p10", casesTransferred: 2, amountTransferred: 200, createdAt: "2026-10-01T00:00:00Z" } as never);
    db.findingAdjustments.push({ id: "a1", findingId: "f1", periodId: "p10", status: "APPROVED", addedCases: 2, amountChange: 200, approvedAt: "2026-10-12T00:00:00Z" } as FindingAdjustment);
    const share = (p: string) => findingsResidentInPeriod(db, p, [f])[0]?.slice.eligibleCases ?? 0;
    expect([share("p9"), share("p10")]).toEqual([1, 4]);
    expect(share("p9") + share("p10")).toBe(f.caseCount);
  });
});

describe("Show My Queue", () => {
  it("reviewers see adjustments at their step (never their own); requesters see returned ones", () => {
    const db = makeDb();
    const adj = createAdjustment(db, config, branchCtl, "f1", input(), { submit: true });
    const f = db.findings[0];
    expect(queueStatusesForSession(district, db)(f)).toBe(true);
    expect(queueStatusesForSession(ho, db)(f)).toBe(false);
    reviewAdjustment(db, district, "f1", adj.id, "RETURN", "Attach the account list");
    expect(queueStatusesForSession(branchCtl, db)(f)).toBe(true);
    expect(queueStatusesForSession(district, db)(f)).toBe(false);
  });
});

describe("dashboard figures", () => {
  it("pending = in review (any period); diff = approved, reported in the period", () => {
    const f = finding();
    const db = makeDb(f);
    const adj = (over: Partial<FindingAdjustment>) => ({ id: Math.random().toString(), findingId: "f1", periodId: "p10", addedCases: 0, amountChange: 0, ...over }) as FindingAdjustment;
    db.findingAdjustments.push(
      adj({ status: "DISTRICT_REVIEW", addedCases: 2, amountChange: 500 }),
      adj({ status: "HO_REVIEW", amountChange: -100 }),
      adj({ status: "APPROVED", addedCases: 1, amountChange: 2000 }),
      adj({ status: "APPROVED", amountChange: -300 }),
      adj({ status: "APPROVED", periodId: "p9", addedCases: 4, amountChange: 50 }),
      adj({ status: "REJECTED", addedCases: 9 }),
      adj({ status: "DRAFT", addedCases: 9 })
    );
    const t = adjustmentDashboardTotals(db, [f], "p10");
    expect(t.pending).toMatchObject({ count: 2, addedCases: 2, amountChange: { ETB: 400 }, byStep: { DISTRICT_REVIEW: 1, HO_REVIEW: 1 } });
    expect(t.diff).toMatchObject({ count: 2, addedCases: 1, amountChange: { ETB: 1700 }, increase: { ETB: 2000 }, decrease: { ETB: -300 } });
    expect(adjustmentDashboardTotals(db, [f], undefined).diff).toMatchObject({ count: 3, addedCases: 5 });
    expect(adjustmentDashboardTotals(db, [], "p10").pending.count).toBe(0);
  });
});

describe("delete", () => {
  it("rejected / returned / withdrawn can be deleted by the requester; approved and in-review never", () => {
    const db = makeDb();
    const a = createAdjustment(db, config, branchCtl, "f1", input(), { submit: true });
    expect(() => deleteAdjustment(db, branchCtl, "f1", a.id)).toThrow(/rejected, returned or withdrawn/);
    reviewAdjustment(db, district, "f1", a.id, "RETURN", "Attach the account list");
    expect(() => deleteAdjustment(db, otherBranchCtl, "f1", a.id)).toThrow(/requester/);
    deleteAdjustment(db, branchCtl, "f1", a.id);
    expect(db.findingAdjustments).toHaveLength(0);
    expect(db.auditLogs.map((l) => l.action)).toContain("FINDING_ADJUSTMENT_DELETED");

    const b = createAdjustment(db, config, branchCtl, "f1", input(), { submit: true });
    reviewAdjustment(db, district, "f1", b.id, "APPROVE");
    reviewAdjustment(db, ho, "f1", b.id, "APPROVE");
    expect(() => deleteAdjustment(db, branchCtl, "f1", b.id)).toThrow(/rejected, returned or withdrawn/);
  });

  it("a rejected one can also be deleted with Delete Rejected", () => {
    const db = makeDb();
    const a = createAdjustment(db, config, branchCtl, "f1", input(), { submit: true });
    reviewAdjustment(db, district, "f1", a.id, "REJECT", "Not a revolving case");
    deleteAdjustment(db, session("hk", "BANK", ["delete-rejected"]), "f1", a.id);
    expect(db.findingAdjustments).toHaveLength(0);
  });
});

describe("dashboard: awaiting you", () => {
  it("counts only adjustments at the user's own review step (never their own), plus their returned ones", () => {
    const db = makeDb();
    const a = createAdjustment(db, config, branchCtl, "f1", input(), { submit: true });
    const f = db.findings[0];
    const awaiting = (s: never) => adjustmentDashboardTotals(db, [f], "p10", s).awaitingYou;
    expect(awaiting(district)).toEqual({ review: 1, returned: 0, total: 1 });
    expect(awaiting(ho)).toEqual({ review: 0, returned: 0, total: 0 });
    expect(awaiting(branchCtl).total).toBe(0);
    reviewAdjustment(db, district, "f1", a.id, "APPROVE");
    expect(awaiting(district).total).toBe(0);
    expect(awaiting(ho).review).toBe(1);
    reviewAdjustment(db, ho, "f1", a.id, "RETURN", "Attach the account list");
    expect(awaiting(branchCtl)).toEqual({ review: 0, returned: 1, total: 1 });
    expect(awaiting(ho).total).toBe(0);
  });
});
