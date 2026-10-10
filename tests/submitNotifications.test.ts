import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { notifyFindingSubmitted } from "@/lib/notifications";
import type { Database, Finding } from "@/types";

// Whoever must act next is told when a finding is submitted - from every
// path that submits (the Register form's one-step Submit used to skip it).

function makeDb(): Database {
  return {
    notifications: [],
    users: [
      { id: "dc1", status: "ACTIVE", role: "DISTRICT_CONTROLLER", districtId: "d1" },
      { id: "dc2", status: "ACTIVE", role: "DISTRICT_CONTROLLER", districtId: "d2" },
      { id: "dc-off", status: "INACTIVE", role: "DISTRICT_CONTROLLER", districtId: "d1" },
      { id: "bm1", status: "ACTIVE", role: "BRANCH_MANAGER", districtId: "d1", branchId: "b1" },
      { id: "bm2", status: "ACTIVE", role: "BRANCH_MANAGER", districtId: "d1", branchId: "b2" },
      { id: "approver", status: "ACTIVE", role: "HO_CONTROLLER" },
      { id: "admin", status: "ACTIVE", role: "ADMIN" },
    ],
    roles: [
      { code: "DISTRICT_CONTROLLER", status: "ACTIVE", orgScope: "DISTRICT", permissions: ["findings.district-review"] },
      { code: "BRANCH_MANAGER", status: "ACTIVE", orgScope: "BRANCH", permissions: ["findings.rectify"] },
      { code: "HO_CONTROLLER", status: "ACTIVE", orgScope: "BANK", permissions: ["findings.ho-review"] },
      { code: "ADMIN", status: "ACTIVE", orgScope: "BANK", permissions: ["findings.district-review", "findings.rectify"] },
    ],
    settings: { hoApproval: { required: true, approverUserIds: ["approver"] }, notification: { provider: "NONE", fromAddress: "" } },
  } as unknown as Database;
}

const finding = (status: Finding["status"]) => ({ id: "f1", reference: "F-1", status, districtId: "d1", branchId: "b1" });
const sentTo = (db: Database) => db.notifications.map((n) => n.recipientUserId).sort();

describe("submitted finding: who is told", () => {
  it("District review -> the reviewers of that district only (active, never the Administrator)", () => {
    const db = makeDb();
    notifyFindingSubmitted(db, finding("DISTRICT_REVIEW"), "Abebe");
    expect(sentTo(db)).toEqual(["dc1"]);
    expect(db.notifications[0]).toMatchObject({ type: "SUBMITTED", title: "F-1 awaiting district review", message: "Abebe submitted this finding for district review.", entityType: "Finding", entityId: "f1" });
  });

  it("Bank-wide approval -> the assigned approvers", () => {
    const db = makeDb();
    notifyFindingSubmitted(db, finding("PENDING_BANK_APPROVAL"), "Abebe");
    expect(sentTo(db)).toEqual(["approver"]);
    expect(db.notifications[0].title).toBe("F-1 awaiting approval");
  });

  it("Sent straight to the branch -> that branch's rectifiers", () => {
    const db = makeDb();
    notifyFindingSubmitted(db, finding("SENT_TO_BRANCH_MANAGER"), "Abebe");
    expect(sentTo(db)).toEqual(["bm1"]);
    expect(db.notifications[0].title).toBe("F-1 awaiting rectification");
  });

  it("a finding that wasn't submitted notifies nobody", () => {
    const db = makeDb();
    notifyFindingSubmitted(db, finding("DRAFT"), "Abebe");
    expect(db.notifications).toHaveLength(0);
  });
});

describe("every path that submits sends it", () => {
  // Both routes must call the shared function right after submitFinding() -
  // the one-step Submit on the Register form once forgot to notify at all.
  for (const route of ["src/app/api/findings/route.ts", "src/app/api/findings/[id]/submit/route.ts"]) {
    it(route, () => {
      const source = readFileSync(route, "utf8");
      const submits = source.split("submitFinding(current").length - 1;
      const notifies = source.split("notifyFindingSubmitted(current").length - 1;
      expect(submits).toBeGreaterThan(0);
      expect(notifies).toBe(submits);
    });
  }
});
