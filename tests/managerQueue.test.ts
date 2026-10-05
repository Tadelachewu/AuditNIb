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

describe("HO Controller's queue: findings to transfer", async () => {
  const { needsTransfer } = await import("@/lib/findings");
  const now = new Date("2026-10-03T12:00:00Z").getTime();
  const dbP = {
    settings: { hoApproval: { approverUserIds: [] } },
    reportingPeriods: [
      { id: "aug", status: "OPEN", endsAt: "2026-08-31T20:59:00Z" }, // ended
      { id: "sep", status: "LOCKED", endsAt: "2026-09-30T20:59:00Z" }, // locked
      { id: "oct", status: "OPEN", endsAt: "2026-10-31T20:59:00Z" }, // current
    ],
  } as unknown as Database;
  const at = (periodId: string, status = "SENT_TO_BRANCH_MANAGER", extra: Partial<Finding> = {}) => f(status, { periodId, ...extra });

  it("an open finding in an ended or locked period needs transferring", () => {
    expect(needsTransfer(dbP, at("aug"), now)).toBe(true);
    expect(needsTransfer(dbP, at("sep", "PARTIALLY_RECTIFIED"), now)).toBe(true);
    expect(needsTransfer(dbP, at("sep", "TRANSFERRED"), now)).toBe(true);
  });
  it("not in the current period, not when closed, not before approval", () => {
    expect(needsTransfer(dbP, at("oct"), now)).toBe(false);
    expect(needsTransfer(dbP, at("aug", "CLOSED", { closedCases: 2, closedAmount: 200 }), now)).toBe(false);
    expect(needsTransfer(dbP, at("aug", "DISTRICT_REVIEW"), now)).toBe(false);
  });
  it("is never a Show My Queue item, even for someone who can transfer (HO Controller)", () => {
    const ho = { userId: "ho", permissions: ["findings.transfer", "findings.close", "findings.ho-review"] } as never;
    const inQueue = queueStatusesForSession(ho, dbP);
    expect(inQueue(at("sep"))).toBe(false);
    expect(inQueue(at("oct"))).toBe(false);
  });

  it("rejected findings are never in Show My Queue", () => {
    const registrant = { userId: "u", permissions: ["findings.edit", "findings.submit"] } as never;
    expect(queueStatusesForSession(registrant, dbP)(at("sep", "REJECTED"))).toBe(false);
  });
});
