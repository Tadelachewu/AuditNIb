import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/types";

// Broken Object Level Authorization (BOLA / IDOR): a user who holds the
// right permission must still not act on another district's / branch's
// objects by passing their ids. Covers the routes fixed after the review:
// delete an import record, re-import a batch, delete a user.

let db: Database;
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  readDb: vi.fn(async () => structuredClone(db)),
  updateDb: vi.fn(async (fn: (d: Database) => unknown) => fn(db)),
}));
vi.mock("@/lib/fileStorage", () => ({ deleteStoredFile: vi.fn(() => true), readStoredFile: vi.fn(() => null), writeStoredFile: vi.fn(), newStoredName: vi.fn(() => "x.xlsx") }));
vi.mock("@/lib/monitoring", () => ({ captureServerException: vi.fn(async () => {}) }));

import { getCurrentUser } from "@/lib/session";
import { DELETE as deleteBatch } from "@/app/api/findings/import/[batchId]/route";
import { POST as reimport } from "@/app/api/findings/import/[batchId]/reimport/route";
import { DELETE as deleteUser } from "@/app/api/admin/users/[id]/route";

function fixture(): Database {
  return {
    roles: [
      { id: "r1", code: "DISTRICT_ADMIN", name: "District admin", orgScope: "DISTRICT", status: "ACTIVE", permissions: [] },
      { id: "r2", code: "HO_CONTROLLER", name: "HO", orgScope: "BANK", status: "ACTIVE", permissions: [] },
      { id: "r3", code: "BRANCH_MANAGER", name: "BM", orgScope: "BRANCH", status: "ACTIVE", permissions: [] },
    ],
    users: [
      { id: "me", name: "Me", role: "DISTRICT_ADMIN", status: "ACTIVE", districtId: "d1", branchId: null },
      { id: "bm-d1", name: "BM d1", role: "BRANCH_MANAGER", status: "ACTIVE", districtId: "d1", branchId: "b1" },
      { id: "bm-d2", name: "BM d2", role: "BRANCH_MANAGER", status: "ACTIVE", districtId: "d2", branchId: "b2" },
      { id: "ho", name: "HO", role: "HO_CONTROLLER", status: "ACTIVE", districtId: null, branchId: null },
      { id: "admin", name: "Admin", role: "ADMIN", status: "ACTIVE", districtId: null, branchId: null },
    ],
    importBatches: [
      // Reversed batches: their findings are gone.
      { id: "mine", fileName: "a.xlsx", importedBy: "me", importedByName: "Me", reversedAt: "2026-10-01T00:00:00Z", rows: [{ findingId: "gone1" }], storedFile: "a.xlsx" },
      { id: "theirs", fileName: "b.xlsx", importedBy: "someone-in-d2", importedByName: "X", reversedAt: "2026-10-01T00:00:00Z", rows: [{ findingId: "gone2" }], storedFile: "b.xlsx" },
    ],
    findings: [], findingTransitions: [], rectifications: [], findingTransfers: [], findingClosures: [], findingCases: [],
    findingAdjustments: [], evidence: [], comments: [], notifications: [], auditLogs: [], supportThreads: [], supportMessages: [],
    districts: [], branches: [], sources: [], departments: [], categories: [], reportingPeriods: [],
    settings: { hoApproval: { required: false, approverUserIds: [] } },
  } as unknown as Database;
}

const as = (orgScope: "BANK" | "DISTRICT" | "BRANCH", permissions: string[], extra: Record<string, unknown> = {}) =>
  vi.mocked(getCurrentUser).mockResolvedValue({ isLoggedIn: true, userId: "me", name: "Me", role: "DISTRICT_ADMIN", orgScope, districtId: "d1", branchId: null, permissions, ...extra } as never);
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const req = (method: string, body?: unknown) => new Request("http://localhost/x", { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  db = fixture();
});

describe("import records (Import History)", () => {
  it("a district user can't delete another scope's import record by its id", async () => {
    as("DISTRICT", ["findings.reverse-import"]);
    const res = await deleteBatch(req("DELETE"), params({ batchId: "theirs" }));
    expect(res.status).toBe(404);
    expect(db.importBatches.map((b) => b.id)).toContain("theirs");
  });
  it("...but can delete their own", async () => {
    as("DISTRICT", ["findings.reverse-import"]);
    expect((await deleteBatch(req("DELETE"), params({ batchId: "mine" }))).status).toBe(200);
    expect(db.importBatches.map((b) => b.id)).not.toContain("mine");
  });
  it("a bank-wide user can delete any", async () => {
    as("BANK", ["findings.reverse-import"], { userId: "ho" });
    expect((await deleteBatch(req("DELETE"), params({ batchId: "theirs" }))).status).toBe(200);
  });
  it("a district user can't re-import another scope's batch (refused before its file is read)", async () => {
    as("DISTRICT", ["findings.import", "findings.reverse-import"]);
    const res = await reimport(req("POST", {}), params({ batchId: "theirs" }));
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toMatch(/file/i);
  });
  it("...their own batch gets past the scope check (here: its stored file is missing)", async () => {
    as("DISTRICT", ["findings.import", "findings.reverse-import"]);
    const res = await reimport(req("POST", {}), params({ batchId: "mine" }));
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).toMatch(/file/i);
  });
});

describe("deleting users", () => {
  it("a district-scoped role with Users > Delete can't delete a user of another district", async () => {
    as("DISTRICT", ["users.delete"]);
    const res = await deleteUser(req("DELETE"), params({ id: "bm-d2" }));
    expect(res.status).toBe(403);
    expect(db.users.map((u) => u.id)).toContain("bm-d2");
  });
  it("...nor a bank-wide user", async () => {
    as("DISTRICT", ["users.delete"]);
    expect((await deleteUser(req("DELETE"), params({ id: "ho" }))).status).toBe(403);
  });
  it("...but can delete one in its own district", async () => {
    as("DISTRICT", ["users.delete"]);
    const res = await deleteUser(req("DELETE"), params({ id: "bm-d1" }));
    expect(res.status).not.toBe(403);
  });
});
