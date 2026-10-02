import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database, Finding } from "@/types";

// Head Office can return a rectification for correction only AFTER the
// District Controller: nothing may still await District verification, and
// some District-verified rectification must not be closed yet.

let db: Database;
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  readDb: vi.fn(async () => structuredClone(db)),
  updateDb: vi.fn(async (fn: (d: Database) => unknown) => fn(db)),
}));
vi.mock("@/lib/monitoring", () => ({ captureServerException: vi.fn(async () => {}) }));
vi.mock("@/lib/notifications", () => ({
  notifyUsers: vi.fn(),
  notifyFindingsPermissionHolders: vi.fn(),
  usersWithFindingsPermission: vi.fn(() => []),
}));

import { getCurrentUser } from "@/lib/session";
import { hoReturnBlockedReason } from "@/lib/findings";
import { POST as returnRoute } from "@/app/api/findings/[id]/return-rectification/route";

/** A 2-case finding (1,000 each) with the given rectified / verified / closed case counts. */
const finding = (rectified: number, verified: number, closed: number, status = "PARTIALLY_RECTIFIED") =>
  ({
    id: "f1", reference: "F-1", status, periodId: "p9", branchId: "b1", districtId: "d1", createdBy: "u9", currency: "ETB",
    caseCount: 2, amount: 2000,
    rectifiedCases: rectified, rectifiedAmount: rectified * 1000,
    districtVerifiedCases: verified, districtVerifiedAmount: verified * 1000,
    closedCases: closed, closedAmount: closed * 1000,
  }) as unknown as Finding;

describe("hoReturnBlockedReason", () => {
  it("blocks while a recorded rectification awaits District verification", () => {
    expect(hoReturnBlockedReason(finding(1, 0, 0))).toMatch(/awaiting District verification/);
    // District verified an earlier case, but a newer one still awaits District - still blocked.
    expect(hoReturnBlockedReason(finding(2, 1, 0))).toMatch(/awaiting District verification/);
    expect(hoReturnBlockedReason(finding(2, 1, 1))).toMatch(/awaiting District verification/);
  });

  it("blocks when everything District verified is already closed", () => {
    expect(hoReturnBlockedReason(finding(1, 1, 1))).toMatch(/no District-verified rectification awaiting closure/);
  });

  it("allows once everything recorded is District-verified and some of it isn't closed", () => {
    expect(hoReturnBlockedReason(finding(1, 1, 0))).toBeNull();
    expect(hoReturnBlockedReason(finding(2, 2, 1, "RECTIFIED"))).toBeNull();
  });
});

describe("POST return-rectification as Head Office", () => {
  const call = () =>
    returnRoute(
      new Request("http://localhost/api/findings/f1/return-rectification", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Evidence doesn't match" }),
      }),
      { params: Promise.resolve({ id: "f1" }) }
    );
  const setup = (f: Finding) => {
    db = {
      findings: [f], findingTransitions: [], findingTransfers: [], rectifications: [], findingClosures: [], auditLogs: [], notifications: [], users: [], roles: [],
      reportingPeriods: [{ id: "p9", code: "2026-09", status: "OPEN" }],
    } as unknown as Database;
  };

  beforeEach(() => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      isLoggedIn: true, userId: "ho1", name: "HO", orgScope: "BANK", permissions: ["findings.ho-return-rectification"],
    } as never);
  });

  it("is refused while a case awaits District verification, and nothing changes", async () => {
    setup(finding(2, 1, 0));
    const res = await call();
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).toMatch(/awaiting District verification/);
    expect(db.findings[0].status).toBe("PARTIALLY_RECTIFIED");
  });

  it("works once District has verified everything recorded", async () => {
    setup(finding(2, 2, 1, "RECTIFIED"));
    const res = await call();
    expect(res.status).toBe(200);
    expect(db.findings[0].status).toBe("RECTIFICATION_RETURNED");
  });
});
