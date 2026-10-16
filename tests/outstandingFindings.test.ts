import { describe, expect, it } from "vitest";
import { isHoApproved, isOutstandingFinding } from "@/lib/findings";
import { sumOutstandingByCurrency } from "@/lib/currency";
import type { Finding, FindingStatus } from "@/types";

// Dashboards' "Outstanding (findings)": an approved finding stays outstanding
// until HO formally closes it - also once the Branch Manager has fully
// rectified it and while the district verifies it.

const f = (status: FindingStatus, extra: Partial<Finding> = {}) =>
  ({ status, currency: "ETB", caseCount: 3, amount: 3000, rectifiedCases: 0, rectifiedAmount: 0, closedCases: 0, closedAmount: 0, ...extra }) as Finding;
const counted = (x: Finding) => isHoApproved(x) && isOutstandingFinding(x);

describe("outstanding findings on the dashboards", () => {
  it("not yet approved: not counted at all", () => {
    for (const s of ["DRAFT", "DISTRICT_REVIEW", "HO_REVIEW", "RETURNED"] as FindingStatus[]) expect(counted(f(s))).toBe(false);
  });
  it("with the branch, partly rectified, returned for correction, reversed or transferred: outstanding", () => {
    for (const s of ["SENT_TO_BRANCH_MANAGER", "PARTIALLY_RECTIFIED", "RECTIFICATION_RETURNED", "REVERSED", "TRANSFERRED"] as FindingStatus[]) {
      expect(counted(f(s))).toBe(true);
    }
  });
  it("fully rectified by the Branch Manager but not verified or closed: still outstanding", () => {
    expect(counted(f("RECTIFIED", { rectifiedCases: 3, rectifiedAmount: 3000 }))).toBe(true);
  });
  it("verified by the district, or partly closed by HO: still outstanding", () => {
    expect(counted(f("RECTIFIED", { rectifiedCases: 3, rectifiedAmount: 3000, districtVerifiedCases: 3, districtVerifiedAmount: 3000 } as Partial<Finding>))).toBe(true);
    expect(counted(f("RECTIFIED", { rectifiedCases: 3, rectifiedAmount: 3000, closedCases: 2, closedAmount: 2000 }))).toBe(true);
  });
  it("closed by HO: no longer outstanding; rejected: never", () => {
    expect(counted(f("CLOSED", { rectifiedCases: 3, rectifiedAmount: 3000, closedCases: 3, closedAmount: 3000 }))).toBe(false);
    expect(counted(f("REJECTED"))).toBe(false);
  });
  it("outstanding amount (all periods) is what isn't closed yet, not what the branch reported", () => {
    expect(sumOutstandingByCurrency([f("RECTIFIED", { rectifiedCases: 3, rectifiedAmount: 3000 })])).toContain("3,000");
    expect(sumOutstandingByCurrency([f("RECTIFIED", { rectifiedCases: 3, rectifiedAmount: 3000, closedCases: 2, closedAmount: 2000 })])).toContain("1,000");
  });
});
