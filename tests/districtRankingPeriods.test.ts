import { describe, expect, it } from "vitest";
import { getDistrictRankingAllCases, getDistrictRankingOtherCases } from "@/lib/reportTemplates";
import type { Database } from "@/types";

// District Ranking - All Cases / Other Cases with one, several or all
// periods: each period gets its own share (transfers and closures counted
// where they happened), several periods = the sum of each, and "All
// periods" = the sum over every period.

const finding = (id: string, districtId: string, branchId: string, categoryId: string, periodId: string, caseCount: number, closedCases: number) => ({
  id, districtId, branchId, categoryId, sourceId: "s1", periodId, status: "PARTIALLY_RECTIFIED",
  caseCount, registeredCaseCount: caseCount, amount: caseCount * 100, registeredAmount: caseCount * 100,
  closedCases, closedAmount: closedCases * 100, rectifiedCases: closedCases, rectifiedAmount: closedCases * 100,
  districtVerifiedCases: closedCases, districtVerifiedAmount: closedCases * 100, currency: "ETB", registeredByBankScope: false,
});

const db = {
  districts: [
    { id: "d1", code: "AA", name: "Addis", status: "ACTIVE" },
    { id: "d2", code: "HW", name: "Hawassa", status: "ACTIVE" },
  ],
  branches: [
    { id: "b1", code: "B1", name: "Bole", districtId: "d1", status: "ACTIVE" },
    { id: "b2", code: "B2", name: "Tabor", districtId: "d2", status: "ACTIVE" },
  ],
  categories: [
    { id: "c1", code: "OTHER_CASE", name: "Other Case", active: true },
    { id: "c2", code: "ATM", name: "ATM", active: true },
  ],
  sources: [{ id: "s1", code: "IC", name: "Internal Control", active: true }],
  reportingPeriods: [
    { id: "sep", code: "2026-09", year: 2026, month: 9, status: "OPEN" },
    { id: "oct", code: "2026-10", year: 2026, month: 10, status: "OPEN" },
  ],
  findings: [
    // Addis: 10 Other Cases registered in Sep, 4 closed there, 6 carried to Oct, 2 closed in Oct.
    finding("f1", "d1", "b1", "c1", "oct", 10, 6),
    // Hawassa: 5 Other Cases in Oct, 1 closed.
    finding("f2", "d2", "b2", "c1", "oct", 5, 1),
    // Addis: 3 ATM cases in Sep (not scored - All Cases only).
    finding("f3", "d1", "b1", "c2", "sep", 3, 0),
  ],
  findingTransfers: [{ id: "t1", findingId: "f1", fromPeriodId: "sep", toPeriodId: "oct", casesTransferred: 6, amountTransferred: 600, createdAt: "2026-10-01T00:00:00Z" }],
  findingClosures: [
    { id: "x1", findingId: "f1", periodId: "sep", closedCases: 4, closedAmount: 400, createdAt: "2026-09-20T00:00:00Z" },
    { id: "x2", findingId: "f1", periodId: "oct", closedCases: 2, closedAmount: 200, createdAt: "2026-10-20T00:00:00Z" },
    { id: "x3", findingId: "f2", periodId: "oct", closedCases: 1, closedAmount: 100, createdAt: "2026-10-21T00:00:00Z" },
  ],
  findingAdjustments: [],
  findingCases: [],
  branchCoverageNotes: [],
  scoringRules: [{ id: "r1", active: true, version: 1, categories: ["c1"], sources: ["s1"], basis: "" }],
  settings: { reportTemplateSources: {} },
} as unknown as Database;

const counts = (fn: typeof getDistrictRankingAllCases | typeof getDistrictRankingOtherCases, periodIds?: string[]) =>
  Object.fromEntries(fn(db, periodIds).rows.map((r) => [r.district.id, [r.totalCases, r.rectifiedCases]]));

describe("District Ranking - All Cases: one, several, all periods", () => {
  it("one period: that period's own share", () => {
    expect(counts(getDistrictRankingAllCases, ["sep"])).toEqual({ d1: [4 + 3, 4], d2: [0, 0] });
    expect(counts(getDistrictRankingAllCases, ["oct"])).toEqual({ d1: [6, 2], d2: [5, 1] });
  });
  it("several periods = the sum of each", () => {
    expect(counts(getDistrictRankingAllCases, ["sep", "oct"])).toEqual({ d1: [13, 6], d2: [5, 1] });
  });
  it("all periods = the sum over every period", () => {
    expect(counts(getDistrictRankingAllCases)).toEqual(counts(getDistrictRankingAllCases, ["sep", "oct"]));
  });
});

describe("District Ranking - Other Cases (scored category only): one, several, all periods", () => {
  it("one period, without the unscored ATM cases", () => {
    expect(counts(getDistrictRankingOtherCases, ["sep"])).toEqual({ d1: [4, 4], d2: [0, 0] });
    expect(counts(getDistrictRankingOtherCases, ["oct"])).toEqual({ d1: [6, 2], d2: [5, 1] });
  });
  it("several periods = the sum of each", () => {
    expect(counts(getDistrictRankingOtherCases, ["sep", "oct"])).toEqual({ d1: [10, 6], d2: [5, 1] });
  });
  it("all periods = the sum over every period", () => {
    expect(counts(getDistrictRankingOtherCases)).toEqual(counts(getDistrictRankingOtherCases, ["sep", "oct"]));
  });
});

it("a period listed twice counts once (both templates)", () => {
  expect(counts(getDistrictRankingAllCases, ["oct", "oct"])).toEqual(counts(getDistrictRankingAllCases, ["oct"]));
  expect(counts(getDistrictRankingOtherCases, ["oct", "oct"])).toEqual(counts(getDistrictRankingOtherCases, ["oct"]));
});
