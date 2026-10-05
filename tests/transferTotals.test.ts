import { describe, expect, it } from "vitest";
import { transferTotals } from "@/lib/findings";
import type { Database, FindingTransfer } from "@/types";

// Dashboards' "Transferred Findings / Transferred Cases": what is currently
// out of the period, not every transfer event.

let n = 0;
function t(findingId: string, from: string, to: string, cases: number): FindingTransfer {
  n += 1;
  return {
    id: `t${n}`,
    findingId,
    fromPeriodId: from,
    toPeriodId: to,
    casesTransferred: cases,
    amountTransferred: cases * 100,
    createdAt: `2026-10-01T00:00:${String(n).padStart(2, "0")}Z`,
  } as FindingTransfer;
}
const db = (where: Record<string, string>) => ({ findings: Object.entries(where).map(([id, periodId]) => ({ id, periodId })) }) as unknown as Database;

describe("transferred counts = currently out of the period", () => {
  it("Sep -> Oct: Sep shows 1 finding / 2 cases out", () => {
    const transfers = [t("f1", "sep", "oct", 2)];
    expect(transferTotals(db({ f1: "oct" }), transfers, "sep")).toEqual({ transferredFindings: 1, transferredCases: 2, transferredAmount: 200 });
    expect(transferTotals(db({ f1: "oct" }), transfers, "oct").transferredFindings).toBe(0);
  });

  it("Sep -> Oct -> back to Sep: Sep shows 0; Oct shows 1 / 2 (it left Oct)", () => {
    const transfers = [t("f1", "sep", "oct", 2), t("f1", "oct", "sep", 2)];
    expect(transferTotals(db({ f1: "sep" }), transfers, "sep")).toEqual({ transferredFindings: 0, transferredCases: 0, transferredAmount: 0 });
    expect(transferTotals(db({ f1: "sep" }), transfers, "oct")).toEqual({ transferredFindings: 1, transferredCases: 2, transferredAmount: 200 });
  });

  it("All periods: moved back and forth to its origin = 0; never double-counted", () => {
    const back = [t("f1", "sep", "oct", 2), t("f1", "oct", "sep", 2)];
    expect(transferTotals(db({ f1: "sep" }), back, undefined).transferredCases).toBe(0);
    const onward = [t("f2", "sep", "oct", 5), t("f2", "oct", "nov", 3)];
    expect(transferTotals(db({ f2: "nov" }), onward, undefined)).toEqual({ transferredFindings: 1, transferredCases: 3, transferredAmount: 300 });
  });

  it("left the period twice: the last departure's cases count", () => {
    const transfers = [t("f1", "sep", "oct", 4), t("f1", "oct", "sep", 4), t("f1", "sep", "nov", 3)];
    expect(transferTotals(db({ f1: "nov" }), transfers, "sep")).toEqual({ transferredFindings: 1, transferredCases: 3, transferredAmount: 300 });
  });

  it("moved onward (Sep -> Oct -> Nov) still counts as out of Sep", () => {
    const transfers = [t("f1", "sep", "oct", 5), t("f1", "oct", "nov", 3)];
    expect(transferTotals(db({ f1: "nov" }), transfers, "sep").transferredCases).toBe(5);
  });
});
