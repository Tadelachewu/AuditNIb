import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isHighRisk, notifyFindingSubmitted, notifyHighRiskApproved } from "@/lib/notifications";
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

describe("High / Critical risk finding approved -> Executive Dashboard users", () => {
  function execDb(): Database {
    return {
      notifications: [],
      branches: [{ id: "b1", name: "Bole Branch" }],
      users: [
        { id: "exec1", status: "ACTIVE", role: "EXECUTIVE_READONLY" },
        { id: "exec2", status: "ACTIVE", role: "EXECUTIVE_READONLY" },
        { id: "exec-off", status: "INACTIVE", role: "EXECUTIVE_READONLY" },
        { id: "ho", status: "ACTIVE", role: "HO_CONTROLLER" },
        { id: "bm", status: "ACTIVE", role: "BRANCH_MANAGER", branchId: "b1" },
        { id: "admin", status: "ACTIVE", role: "ADMIN" },
      ],
      roles: [
        { code: "EXECUTIVE_READONLY", status: "ACTIVE", orgScope: "BANK", permissions: ["executive-dashboard.view", "findings.view"] },
        { code: "HO_CONTROLLER", status: "ACTIVE", orgScope: "BANK", permissions: ["ho-dashboard.view", "findings.ho-review"] },
        { code: "BRANCH_MANAGER", status: "ACTIVE", orgScope: "BRANCH", permissions: ["branch-dashboard.view", "findings.rectify"] },
        { code: "ADMIN", status: "ACTIVE", orgScope: "BANK", permissions: ["executive-dashboard.view"] },
      ],
      settings: { riskLevels: ["Low", "Medium", "High", "Critical"], hoApproval: { required: false, approverUserIds: [] }, notification: { provider: "NONE", fromAddress: "" } },
    } as unknown as Database;
  }
  const risky = (riskLevel: string) => ({ id: "f1", reference: "F-1", title: "Vault shortage", riskLevel, branchId: "b1", currency: "ETB", amount: 250000, caseCount: 2 });
  const ho = { userId: "ho", name: "Selam" };

  it("the top two risk levels count as high-risk, whatever their letter case", () => {
    const db = execDb();
    expect(["High", "critical", " HIGH "].map((r) => isHighRisk(db, r))).toEqual([true, true, true]);
    expect(["Low", "Medium", "", undefined].map((r) => isHighRisk(db, r))).toEqual([false, false, false, false]);
  });

  it("notifies every active Executive Dashboard user - not the HO controller, the branch or administrators", () => {
    const db = execDb();
    notifyHighRiskApproved(db, risky("Critical"), ho);
    expect(sentTo(db)).toEqual(["exec1", "exec2"]);
    expect(db.notifications[0]).toMatchObject({ type: "HIGH_RISK_APPROVED", title: "Critical-risk finding approved: F-1", entityType: "Finding", entityId: "f1" });
    expect(db.notifications[0].message).toBe("Vault shortage - Bole Branch. 2 cases, ETB 250,000. This finding needs branch action; the responsible person is the Branch Manager (none assigned yet).");
  });

  it("says nothing for Low / Medium risk", () => {
    for (const level of ["Low", "Medium"]) {
      const db = execDb();
      notifyHighRiskApproved(db, risky(level), ho);
      expect(db.notifications).toHaveLength(0);
    }
  });

  it("an executive who made the final approval themselves isn't notified of it", () => {
    const db = execDb();
    notifyHighRiskApproved(db, risky("High"), { userId: "exec1", name: "Executive Office" });
    expect(sentTo(db)).toEqual(["exec2"]);
  });

  it("follows the Risk levels list in Settings", () => {
    const db = execDb();
    db.settings.riskLevels = ["Minor", "Moderate", "Major", "Severe"];
    notifyHighRiskApproved(db, risky("Major"), ho);
    notifyHighRiskApproved(db, risky("High"), ho);
    expect(db.notifications.map((n) => n.title)).toEqual(["Major-risk finding approved: F-1", "Major-risk finding approved: F-1"]);
  });

  // Every final approval sends it: HO's, the bank-wide approver's, and a
  // bank-registered finding that goes straight to the branch on submit.
  for (const route of ["src/app/api/findings/[id]/ho-review/route.ts", "src/app/api/findings/[id]/bank-approval/route.ts", "src/app/api/findings/[id]/submit/route.ts", "src/app/api/findings/route.ts"]) {
    it(`is called from ${route}`, () => {
      expect(readFileSync(route, "utf8")).toContain("notifyHighRiskApproved(current, ");
    });
  }
});
