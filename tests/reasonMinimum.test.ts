import { describe, expect, it } from "vitest";
import { reasonError } from "@/lib/inputRules";
import { resolveChange } from "@/lib/adjustments/rules";

// Reasons (return, reject, transfer, reverse, period changes, adjustments):
// at least 3 characters everywhere.
describe("reason minimum = 3 characters", () => {
  it("the shared rule", () => {
    expect(reasonError("ab")).toMatch(/at least 3/);
    expect(reasonError("abc")).toBeNull();
  });
  it("adjustments use the same minimum", () => {
    const f = { id: "f1", caseCount: 2, amount: 200, rectifiedCases: 0, rectifiedAmount: 0, closedCases: 0, closedAmount: 0 } as never;
    const db = { findingCases: [] } as never;
    expect(resolveChange(db, f, { addedCases: 1, amountChange: 100, reason: "ab" })).toMatchObject({ ok: false, problem: expect.stringMatching(/at least 3/) });
    expect(resolveChange(db, f, { addedCases: 1, amountChange: 100, reason: "abc" }).ok).toBe(true);
  });
});
