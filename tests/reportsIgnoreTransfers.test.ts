import { describe, expect, it } from "vitest";
import { originalPeriodId } from "@/lib/findings";
import { getCategoryDetailByDistrict, getMonthlySummaryReport, getUncoveredBranches } from "@/lib/reportTemplates";
import type { Database } from "@/types";

// Category Detail by District and Monthly Summary are never affected by
// transfers: a finding counts whole in the period it was originally reported in.

function db(transfers: { from: string; to: string; at: string }[], nowIn: string): Database {
  return {
    districts: [{ id: "d1", code: "AA", name: "Addis", status: "ACTIVE" }],
    branches: [{ id: "b1", code: "B1", name: "Bole", districtId: "d1", status: "ACTIVE" }],
    categories: [{ id: "c1", code: "OTHER_CASE", name: "Other Case", active: true }],
    sources: [{ id: "s1", code: "IC", name: "Internal Control", active: true }],
    reportingPeriods: [],
    findings: [
      {
        id: "f1", districtId: "d1", branchId: "b1", categoryId: "c1", sourceId: "s1", periodId: nowIn,
        status: "TRANSFERRED", caseCount: 10, closedCases: 4, amount: 1000, closedAmount: 400, currency: "ETB",
        registeredByBankScope: false,
      },
    ],
    findingTransfers: transfers.map((t, i) => ({
      id: `t${i}`, findingId: "f1", fromPeriodId: t.from, toPeriodId: t.to, casesTransferred: 6, amountTransferred: 600, createdAt: t.at,
    })),
    findingClosures: [],
    branchCoverageNotes: [],
    scoringRules: [{ id: "r1", active: true, categories: ["c1"], sources: ["s1"], version: 1 }],
    settings: { reportTemplateSources: {} },
  } as unknown as Database;
}

describe("reports that transfers never change", () => {
  it("a finding's original period is where its first transfer left from", () => {
    const d = db([{ from: "sep", to: "oct", at: "2026-10-01" }, { from: "oct", to: "nov", at: "2026-11-01" }], "nov");
    expect(originalPeriodId(d, d.findings[0])).toBe("sep");
    expect(originalPeriodId(db([], "sep"), db([], "sep").findings[0])).toBe("sep");
  });

  for (const [label, transfers, nowIn] of [
    ["never transferred", [], "sep"],
    ["transferred Sep -> Oct", [{ from: "sep", to: "oct", at: "2026-10-01" }], "oct"],
    ["transferred Sep -> Oct -> back to Sep", [{ from: "sep", to: "oct", at: "2026-10-01" }, { from: "oct", to: "sep", at: "2026-10-05" }], "sep"],
  ] as const) {
    it(`${label}: all 10 cases (4 closed) stay in Sep, none in Oct`, () => {
      const d = db([...transfers], nowIn);
      const sep = getCategoryDetailByDistrict(d, "sep").totalRow;
      expect([sep.totalCases, sep.totalRectified]).toEqual([10, 4]);
      expect(getCategoryDetailByDistrict(d, "oct").totalRow.totalCases).toBe(0);

      const ms = getMonthlySummaryReport(d, "sep");
      expect(ms.totalRow.totalCases).toBe(10);
      expect(ms.rows[0].officialRectified).toBe(4);
      expect(ms.rows[0].branchesNotDispatched).toBe(0); // the branch reported in Sep
      expect(getMonthlySummaryReport(d, "oct").rows[0].branchesNotDispatched).toBe(1); // ...not in Oct

      // Uncovered Branches agrees: covered in Sep, uncovered in Oct.
      expect(getUncoveredBranches(d, "sep")).toHaveLength(0);
      expect(getUncoveredBranches(d, "oct").map((r) => r.branch.id)).toEqual(["b1"]);
    });
  }
});
