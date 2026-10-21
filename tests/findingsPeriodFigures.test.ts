import { describe, expect, it } from "vitest";
import { findingsResidentInPeriod } from "@/lib/findings";
import { filterFindingsByStatus } from "@/lib/findingListQuery";
import { PREFERENCE_KEYS } from "@/lib/userPreferences";
import type { Database, Finding } from "@/types";

// Findings list with a period chosen: Rectified (recorded), Verified and
// Registered Amount are that period's own; the Status filter matches the
// status IN that period. Plus the saved-columns preference check.

const base = {
  id: "f1", periodId: "oct", caseCount: 10, registeredCaseCount: 10, amount: 1000, registeredAmount: 1000,
  status: "PARTIALLY_RECTIFIED", closedCases: 0, closedAmount: 0, rectifiedCases: 6, rectifiedAmount: 600,
  districtVerifiedCases: 5, districtVerifiedAmount: 500,
} as unknown as Finding;
const rect = (id: string, periodId: string, cases: number, at: string) => ({ id, findingId: "f1", periodId, rectifiedCases: cases, rectifiedAmount: cases * 100, createdAt: at });
const db = (f: Finding, rectifications: ReturnType<typeof rect>[]): Database =>
  ({
    findings: [f],
    // 10 registered in Sep; the 6 still open moved to Oct.
    findingTransfers: [{ id: "t1", findingId: "f1", fromPeriodId: "sep", toPeriodId: "oct", casesTransferred: 6, amountTransferred: 600, createdAt: "2026-10-01T00:00:00Z" }],
    findingClosures: [],
    findingAdjustments: [],
    rectifications,
    reportingPeriods: [{ id: "sep", code: "2026-09" }, { id: "oct", code: "2026-10" }],
  }) as unknown as Database;
const slice = (d: Database, p: string) => findingsResidentInPeriod(d, p, d.findings)[0].slice;

describe("Rectified / Verified per period", () => {
  it("4 rectified in Sep, 2 in Oct (5 verified, oldest first): each period shows its own", () => {
    const d = db(base, [rect("r1", "sep", 4, "2026-09-10T00:00:00Z"), rect("r2", "oct", 2, "2026-10-10T00:00:00Z")]);
    expect(slice(d, "sep")).toMatchObject({ rectifiedCases: 4, rectifiedAmount: 400, verifiedCases: 4, verifiedAmount: 400 });
    expect(slice(d, "oct")).toMatchObject({ rectifiedCases: 2, rectifiedAmount: 200, verifiedCases: 1, verifiedAmount: 100 });
  });

  it("a returned rectification lowered the total: the periods still add up to the finding's own", () => {
    const d = db({ ...base, rectifiedCases: 4, rectifiedAmount: 400, districtVerifiedCases: 4, districtVerifiedAmount: 400 }, [
      rect("r1", "sep", 4, "2026-09-10T00:00:00Z"),
      rect("r2", "oct", 2, "2026-10-10T00:00:00Z"), // returned by the district
    ]);
    expect(slice(d, "sep").rectifiedCases + slice(d, "oct").rectifiedCases).toBe(4);
    expect(slice(d, "oct").rectifiedCases).toBe(0);
  });

  it("Registered Amount: the full amount where it was registered, 0 where it was only transferred in", () => {
    const d = db(base, []);
    expect(slice(d, "sep").reportedAmount).toBe(1000);
    expect(slice(d, "oct").reportedAmount).toBe(0);
  });
});

describe("Status filter with a period", () => {
  it("in a period the finding has left, its status there is Transferred", () => {
    const d = db({ ...base, status: "CLOSED" } as Finding, []);
    const sep = findingsResidentInPeriod(d, "sep", d.findings);
    expect(filterFindingsByStatus(sep, "CLOSED")).toHaveLength(0);
    expect(filterFindingsByStatus(sep, "TRANSFERRED")).toHaveLength(1);
    const oct = findingsResidentInPeriod(d, "oct", d.findings);
    expect(filterFindingsByStatus(oct, "CLOSED")).toHaveLength(1);
  });
});

describe("saved Findings columns preference", () => {
  const ok = PREFERENCE_KEYS["findings.columns"];
  it("accepts column id -> shown / hidden", () => {
    expect(ok({ irregularityType: true, title: false })).toBe(true);
  });
  it("rejects anything else", () => {
    expect(ok(null)).toBe(false);
    expect(ok([true])).toBe(false);
    expect(ok({ title: "yes" })).toBe(false);
    expect(ok({ "bad key!": true })).toBe(false);
    expect(ok(Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`c${i}`, true])))).toBe(false);
  });
});
