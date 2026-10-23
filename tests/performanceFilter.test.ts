import { describe, expect, it } from "vitest";
import { computePerformance } from "@/lib/findings";
import type { Database } from "@/types";

// Dashboard Performance % follows the filters (findingFilter): only the
// findings it accepts, still within the scoring rule's categories / sources.
const finding = (id: string, sourceId: string, caseCount: number, closedCases: number) =>
  ({ id, sourceId, categoryId: "c1", districtId: "d1", branchId: "b1", periodId: "p1", status: "SENT_TO_BRANCH_MANAGER", caseCount, closedCases }) as never;
const db = {
  scoringRules: [{ id: "r", active: true, categories: ["c1"], sources: ["IC", "IA"] }],
  findings: [finding("f1", "IC", 4, 4), finding("f2", "IA", 4, 0)],
  findingTransfers: [],
  findingClosures: [],
} as unknown as Database;

describe("Performance % follows the dashboard filters", () => {
  it("no filter: every eligible finding (4 of 8 = 50%)", () => {
    expect(computePerformance(db, {})).toBe(50);
  });
  it("source filter: only that source's findings", () => {
    expect(computePerformance(db, { findingFilter: (f) => f.sourceId === "IC" })).toBe(100);
    expect(computePerformance(db, { findingFilter: (f) => f.sourceId === "IA" })).toBe(0);
  });
  it("a filter nothing matches: no score (not 0%)", () => {
    expect(computePerformance(db, { findingFilter: () => false })).toBeNull();
  });
});
