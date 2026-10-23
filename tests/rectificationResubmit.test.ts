import { describe, expect, it } from "vitest";
import { planResubmit, rectifiedCaseRows } from "@/lib/rectificationResubmit";
import { queueStatusesForSession } from "@/lib/findings";
import type { Database, Finding, FindingCase } from "@/types";

// A returned rectification can be resubmitted all, one, some - the rest goes
// back to outstanding; closed cases always stay. And HO's My Queue doesn't
// list a returned rectification (it's the branch's turn; close refuses it).

const figures = (over: Partial<Finding> = {}) =>
  ({ caseCount: 3, amount: 300, rectifiedCases: 3, rectifiedAmount: 300, closedCases: 0, closedAmount: 0, districtVerifiedCases: 3, districtVerifiedAmount: 300, ...over }) as Finding;
const row = (id: string, seq: number, amount: number, at: string, status: FindingCase["status"] = "RECTIFIED") =>
  ({ id, findingId: "f1", seq, amount, status, rectifiedAt: at, createdAt: "2026-10-01T00:00:00Z" }) as FindingCase;
const rows = [row("c1", 1, 100, "2026-10-02T00:00:00Z"), row("c2", 2, 100, "2026-10-03T00:00:00Z"), row("c3", 3, 100, "2026-10-04T00:00:00Z")];

describe("itemized: pick the cases to resubmit", () => {
  it("all (nothing sent): unchanged, fully rectified", () => {
    const r = planResubmit(figures(), rows, { kind: "all" });
    expect(r.ok && r.plan).toMatchObject({ rectifiedCases: 3, rectifiedAmount: 300, status: "RECTIFIED", releaseCaseIds: [] });
  });
  it("one of three: the other two go back to outstanding; verification capped", () => {
    const r = planResubmit(figures(), rows, { kind: "cases", keepCaseIds: ["c2"] });
    expect(r.ok && r.plan).toMatchObject({ rectifiedCases: 1, rectifiedAmount: 100, districtVerifiedCases: 1, districtVerifiedAmount: 100, status: "PARTIALLY_RECTIFIED" });
    expect(r.ok && r.plan.releaseCaseIds.sort()).toEqual(["c1", "c3"]);
  });
  it("none: everything back to the branch", () => {
    const r = planResubmit(figures(), rows, { kind: "cases", keepCaseIds: [] });
    expect(r.ok && r.plan).toMatchObject({ rectifiedCases: 0, rectifiedAmount: 0, status: "SENT_TO_BRANCH_MANAGER" });
  });
  it("closed cases are locked (oldest rectified first) and can't be chosen or released", () => {
    expect(rectifiedCaseRows(rows, 1).locked.map((c) => c.id)).toEqual(["c1"]);
    const r = planResubmit(figures({ closedCases: 1, closedAmount: 100 }), rows, { kind: "cases", keepCaseIds: [] });
    expect(r.ok && r.plan).toMatchObject({ rectifiedCases: 1, rectifiedAmount: 100 });
    expect(r.ok && r.plan.releaseCaseIds.sort()).toEqual(["c2", "c3"]);
    expect(planResubmit(figures({ closedCases: 1, closedAmount: 100 }), rows, { kind: "cases", keepCaseIds: ["c1"] }).ok).toBe(false);
  });
});

describe("not itemized: number of cases and amount to resubmit", () => {
  it("some: the rest back to outstanding", () => {
    const r = planResubmit(figures(), [], { kind: "totals", keepCases: 2, keepAmount: 150 });
    expect(r.ok && r.plan).toMatchObject({ rectifiedCases: 2, rectifiedAmount: 150, districtVerifiedCases: 2, districtVerifiedAmount: 150, status: "PARTIALLY_RECTIFIED" });
  });
  it("never below what's closed, never above what's rectified", () => {
    const f = figures({ closedCases: 1, closedAmount: 100 });
    expect(planResubmit(f, [], { kind: "totals", keepCases: 0, keepAmount: 0 }).ok).toBe(false);
    expect(planResubmit(f, [], { kind: "totals", keepCases: 4, keepAmount: 300 }).ok).toBe(false);
    expect(planResubmit(f, [], { kind: "totals", keepCases: 1, keepAmount: 100 }).ok).toBe(true);
  });
  it("the wrong kind of choice is refused", () => {
    expect(planResubmit(figures(), [], { kind: "cases", keepCaseIds: [] }).ok).toBe(false);
    expect(planResubmit(figures(), rows, { kind: "totals", keepCases: 3, keepAmount: 300 }).ok).toBe(false);
  });
});

describe("HO My Queue", () => {
  it("doesn't list a returned rectification, even with verified cases not closed", () => {
    const f = { ...figures(), id: "f1", status: "RECTIFICATION_RETURNED", createdBy: "x" } as Finding;
    const db = { findings: [f], findingAdjustments: [], settings: { hoApproval: { approverUserIds: [] } } } as unknown as Database;
    const ho = { userId: "ho", permissions: ["findings.ho-review", "findings.close", "findings.ho-return-rectification"] } as never;
    expect(queueStatusesForSession(ho, db)(f)).toBe(false);
    // ...and once resubmitted (Rectified, verified, not closed) it's HO's to close again.
    expect(queueStatusesForSession(ho, db)({ ...f, status: "RECTIFIED" })).toBe(true);
  });
});
