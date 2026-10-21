import { describe, expect, it } from "vitest";
import { getCategoryDetailByDistrict, getMonthlySummaryReport, getUncoveredBranches } from "@/lib/reportTemplates";
import type { Database } from "@/types";

// Category Detail by District and Monthly Summary follow transfers, like the
// dashboards and the Findings list: cases count in the period they are in,
// and rectified = closed IN that period. Dispatch coverage (Monthly Summary's
// "not dispatched", Uncovered Branches) stays by the period a branch reported in.

type Hop = { from: string; to: string; at: string; cases: number };
type Closure = { period: string; cases: number; at: string };

function db(hops: Hop[], closures: Closure[], nowIn: string): Database {
  const closed = closures.reduce((n, c) => n + c.cases, 0);
  return {
    districts: [{ id: "d1", code: "AA", name: "Addis", status: "ACTIVE" }],
    branches: [{ id: "b1", code: "B1", name: "Bole", districtId: "d1", status: "ACTIVE" }],
    categories: [{ id: "c1", code: "OTHER_CASE", name: "Other Case", active: true }],
    sources: [{ id: "s1", code: "IC", name: "Internal Control", active: true }],
    reportingPeriods: [],
    findings: [
      {
        id: "f1", districtId: "d1", branchId: "b1", categoryId: "c1", sourceId: "s1", periodId: nowIn,
        status: "PARTIALLY_RECTIFIED", caseCount: 10, registeredCaseCount: 10, closedCases: closed, amount: 1000, registeredAmount: 1000,
        closedAmount: closed * 100, currency: "ETB", registeredByBankScope: false,
      },
    ],
    findingTransfers: hops.map((h, i) => ({ id: `t${i}`, findingId: "f1", fromPeriodId: h.from, toPeriodId: h.to, casesTransferred: h.cases, amountTransferred: h.cases * 100, createdAt: h.at })),
    findingClosures: closures.map((c, i) => ({ id: `x${i}`, findingId: "f1", periodId: c.period, closedCases: c.cases, closedAmount: c.cases * 100, createdAt: c.at })),
    findingAdjustments: [],
    rectifications: [],
    branchCoverageNotes: [],
    scoringRules: [{ id: "r1", active: true, categories: ["c1"], sources: ["s1"], version: 1 }],
    settings: { reportTemplateSources: {} },
  } as unknown as Database;
}

const category = (d: Database, period: string) => {
  const t = getCategoryDetailByDistrict(d, period).totalRow;
  return [t.totalCases, t.totalRectified];
};
const monthly = (d: Database, period: string) => {
  const r = getMonthlySummaryReport(d, period);
  return [r.totalRow.totalCases, r.totalRow.officialRectified, r.rows[0].branchesNotDispatched];
};

describe("Category Detail by District / Monthly Summary follow transfers", () => {
  it("never transferred: all 10 cases in Sep with what was closed there", () => {
    const d = db([], [{ period: "sep", cases: 4, at: "2026-09-20T00:00:00Z" }], "sep");
    expect(category(d, "sep")).toEqual([10, 4]);
    expect(monthly(d, "sep")).toEqual([10, 4, 0]);
    expect(category(d, "oct")).toEqual([0, 0]);
  });

  it("4 closed in Sep, 6 transferred to Oct, 2 closed in Oct: Sep 4 / 4, Oct 6 / 2", () => {
    const d = db([{ from: "sep", to: "oct", at: "2026-10-01T00:00:00Z", cases: 6 }], [
      { period: "sep", cases: 4, at: "2026-09-20T00:00:00Z" },
      { period: "oct", cases: 2, at: "2026-10-15T00:00:00Z" },
    ], "oct");
    expect(category(d, "sep")).toEqual([4, 4]);
    expect(category(d, "oct")).toEqual([6, 2]);
    expect(monthly(d, "sep")).toEqual([4, 4, 0]);
    // The branch reported in Sep, not Oct: dispatch coverage stays by registration.
    expect(monthly(d, "oct")).toEqual([6, 2, 1]);
    expect(getUncoveredBranches(d, "sep")).toHaveLength(0);
    expect(getUncoveredBranches(d, "oct").map((r) => r.branch.id)).toEqual(["b1"]);
  });

  it("all periods: every case once, every closure once", () => {
    const d = db([{ from: "sep", to: "oct", at: "2026-10-01T00:00:00Z", cases: 6 }], [
      { period: "sep", cases: 4, at: "2026-09-20T00:00:00Z" },
      { period: "oct", cases: 2, at: "2026-10-15T00:00:00Z" },
    ], "oct");
    const all = getCategoryDetailByDistrict(d, undefined).totalRow;
    expect([all.totalCases, all.totalRectified]).toEqual([10, 6]);
  });

  it("Sep -> Oct -> back to Sep: everything is in Sep again, nothing in Oct", () => {
    const d = db(
      [
        { from: "sep", to: "oct", at: "2026-10-01T00:00:00Z", cases: 6 },
        { from: "oct", to: "sep", at: "2026-10-05T00:00:00Z", cases: 6 },
      ],
      [{ period: "sep", cases: 4, at: "2026-09-20T00:00:00Z" }],
      "sep"
    );
    expect(category(d, "sep")).toEqual([10, 4]);
    expect(category(d, "oct")).toEqual([0, 0]);
  });
});
