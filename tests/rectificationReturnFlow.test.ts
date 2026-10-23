import { describe, expect, it } from "vitest";
import { applyReturn, rectificationStatus } from "@/lib/rectificationResubmit";
import type { Finding, FindingCase } from "@/types";

// A returned rectification goes straight back to outstanding - the branch
// records it again with Record Rectification (no separate resubmit).

const f = (over: Partial<Finding> = {}) =>
  ({ caseCount: 3, amount: 300, rectifiedCases: 3, rectifiedAmount: 300, districtVerifiedCases: 1, districtVerifiedAmount: 100, closedCases: 0, closedAmount: 0, ...over }) as Finding;
const row = (id: string, seq: number, at: string) => ({ id, findingId: "f1", seq, amount: 100, status: "RECTIFIED", rectifiedAt: at }) as FindingCase;

describe("returning a rectification", () => {
  it("District returns what awaited it: that part is outstanding again, verified part stays", () => {
    const x = f();
    applyReturn(x, [], "district");
    expect([x.rectifiedCases, x.rectifiedAmount, x.districtVerifiedCases, x.returnedCases ?? 0]).toEqual([1, 100, 1, 0]);
    // Once the branch records it again, the status moves on as for a fresh one.
    expect(rectificationStatus({ ...x, rectifiedCases: 3, rectifiedAmount: 300 })).toBe("RECTIFIED");
  });
  it("HO returns everything not closed, and clears verification", () => {
    const x = f({ closedCases: 1, closedAmount: 100 });
    applyReturn(x, [], "all");
    expect([x.rectifiedCases, x.districtVerifiedCases]).toEqual([1, 1]);
  });
  it("itemized: the released cases are OUTSTANDING again", () => {
    const x = f();
    const cases = [row("c1", 1, "2026-10-01"), row("c2", 2, "2026-10-02"), row("c3", 3, "2026-10-03")];
    applyReturn(x, cases, "district");
    expect(cases.map((c) => c.status)).toEqual(["RECTIFIED", "OUTSTANDING", "OUTSTANDING"]);
    expect([x.rectifiedCases, x.rectifiedAmount]).toEqual([1, 100]);
  });
});
