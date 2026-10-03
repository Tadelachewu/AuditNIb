import { describe, expect, it } from "vitest";
import { awaitingBranchRectification, queueStatusesForSession } from "@/lib/findings";
import type { Database, Finding } from "@/types";

const f = (status: string, extra: Partial<Finding> = {}) =>
  ({ id: status, status, caseCount: 2, amount: 200, rectifiedCases: 0, rectifiedAmount: 0, districtVerifiedCases: 0, districtVerifiedAmount: 0, closedCases: 0, closedAmount: 0, ...extra }) as unknown as Finding;
const db = { settings: { hoApproval: { approverUserIds: [] } } } as unknown as Database;
const manager = { userId: "bm", permissions: ["findings.rectify"] } as never;

describe("Branch Manager's queue (Show My Queue)", () => {
  it("includes a TRANSFERRED finding with cases still to rectify", () => {
    const inQueue = queueStatusesForSession(manager, db);
    expect(inQueue(f("TRANSFERRED"))).toBe(true);
    expect(inQueue(f("TRANSFERRED", { rectifiedCases: 1, rectifiedAmount: 100, closedCases: 1, closedAmount: 100 }))).toBe(true);
  });
  it("still includes the other rectification statuses", () => {
    for (const s of ["SENT_TO_BRANCH_MANAGER", "REVERSED", "PARTIALLY_RECTIFIED", "RECTIFICATION_RETURNED"]) expect(awaitingBranchRectification(f(s))).toBe(true);
  });
  it("leaves out a transferred finding with nothing left to rectify, and findings past the branch", () => {
    expect(awaitingBranchRectification(f("TRANSFERRED", { rectifiedCases: 2, rectifiedAmount: 200 }))).toBe(false);
    for (const s of ["RECTIFIED", "CLOSED", "DISTRICT_REVIEW", "DRAFT"]) expect(awaitingBranchRectification(f(s))).toBe(false);
  });
});
