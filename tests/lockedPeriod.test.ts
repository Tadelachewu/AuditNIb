import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/types";

// A locked period only blocks submission: Reverse (and every other action)
// still works there, Submit is refused.
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
import { POST as reverse } from "@/app/api/findings/[id]/reverse/route";
import { POST as submit } from "@/app/api/findings/[id]/submit/route";
import { PATCH as editFinding, DELETE as deleteFinding } from "@/app/api/findings/[id]/route";

const ctx = { params: Promise.resolve({ id: "f1" }) };
const req = (body: unknown = {}) =>
  new Request("http://localhost/api/findings/f1/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function fixture(status: string, draftsAllowedWhileLocked = false): Database {
  return {
    reportingPeriods: [{ id: "p9", code: "2026-09", year: 2026, month: 9, status: "LOCKED", draftsAllowedWhileLocked, startsAt: "2026-08-31T21:00:00.000Z", endsAt: "2026-09-30T20:59:00.000Z" }],
    districts: [{ id: "d1", code: "D01", name: "Addis", status: "ACTIVE" }],
    branches: [{ id: "b1", code: "B001", name: "Bole", districtId: "d1", status: "ACTIVE" }],
    findings: [
      {
        id: "f1", reference: "F-1", status, periodId: "p9", branchId: "b1", districtId: "d1", createdBy: "u1",
        caseCount: 2, amount: 100, rectifiedCases: 2, rectifiedAmount: 100, districtVerifiedCases: 2, districtVerifiedAmount: 100,
        closedCases: status === "CLOSED" ? 2 : 0, closedAmount: status === "CLOSED" ? 100 : 0,
      },
    ],
    findingTransitions: [],
    rectifications: [],
    findingTransfers: [],
    findingClosures: [{ id: "c1", findingId: "f1", periodId: "p9", closedCases: 2, closedAmount: 100 }],
    findingCases: [],
    auditLogs: [],
    notifications: [],
    users: [],
    roles: [],
    settings: { hoApproval: { required: false }, requiredFindingFields: {}, allowOtherValueFields: {} },
    evidence: [],
    comments: [],
  } as unknown as Database;
}

beforeEach(() => {
  vi.mocked(getCurrentUser).mockResolvedValue({
    isLoggedIn: true, userId: "u1", name: "HO", orgScope: "BANK", permissions: ["findings.reopen", "findings.submit", "findings.edit", "findings.delete"],
  } as never);
});

describe("locked period", () => {
  it("does not block Reverse", async () => {
    db = fixture("CLOSED");
    const res = await reverse(req({ reason: "closed by mistake" }), ctx);
    expect(res.status).toBe(200);
    expect(db.findings[0]).toMatchObject({ status: "REVERSED", closedCases: 0 });
  });

  it("blocks submission", async () => {
    db = fixture("DRAFT");
    const res = await submit(req(), ctx);
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).toContain("PERIOD_LOCKED");
    expect(db.findings[0].status).toBe("DRAFT");
  });

  describe("drafting follows the period's Drafts allowed / blocked setting", () => {
    const edit = () =>
      editFinding(new Request("http://localhost/api/findings/f1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Updated title" }) }), ctx);
    const remove = () => deleteFinding(new Request("http://localhost/api/findings/f1", { method: "DELETE" }), ctx);

    it("drafts blocked: saving or deleting a draft is refused, and nothing changes", async () => {
      db = fixture("DRAFT", false);
      const saved = await edit();
      expect(saved.status).toBe(409);
      expect(JSON.stringify(await saved.json())).toMatch(/drafts are blocked/);
      expect((await remove()).status).toBe(409);
      expect(db.findings).toHaveLength(1);
    });

    it("drafts blocked: a returned finding can't be saved either", async () => {
      db = fixture("RETURNED", false);
      expect((await edit()).status).toBe(409);
    });

    it("drafts allowed: the draft can be saved", async () => {
      db = fixture("DRAFT", true);
      const saved = await edit();
      expect(saved.status).toBe(200);
      expect(db.findings[0].title).toBe("Updated title");
    });
  });
});
