import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/types";

// In an OPEN period drafting is always allowed: the "Drafts allowed / blocked"
// setting only applies once the period is locked, and the submission window
// limits Submit only, never drafts.

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
  notifyFindingSubmitted: vi.fn(),
  usersWithFindingsPermission: vi.fn(() => []),
}));

import { getCurrentUser } from "@/lib/session";
import { POST as create } from "@/app/api/findings/route";
import { PATCH as edit, DELETE as remove } from "@/app/api/findings/[id]/route";
import { POST as submit } from "@/app/api/findings/[id]/submit/route";

const DAY = 24 * 60 * 60 * 1000;
/** An OPEN period whose drafts setting says "blocked" (irrelevant while open), with the submission window open or closed. */
function fixture(windowOpen: boolean): Database {
  const now = Date.now();
  return {
    reportingPeriods: [
      {
        id: "p1", code: "2026-09", year: 2026, month: 9, status: "OPEN", draftsAllowedWhileLocked: false,
        startsAt: new Date(now - 20 * DAY).toISOString(), endsAt: new Date(now + 10 * DAY).toISOString(),
        submissionStartsAt: new Date(now - 20 * DAY).toISOString(),
        submissionEndsAt: new Date(windowOpen ? now + 10 * DAY : now - DAY).toISOString(),
      },
    ],
    districts: [{ id: "d1", code: "D01", name: "Addis", status: "ACTIVE" }],
    branches: [{ id: "b1", code: "B001", name: "Bole", districtId: "d1", status: "ACTIVE" }],
    sources: [], departments: [], categories: [],
    findings: [
      { id: "f1", reference: "B001-2026-09-00001", status: "DRAFT", periodId: "p1", branchId: "b1", districtId: "d1", createdBy: "u1", title: "Old title", caseCount: 1, amount: 0 },
    ],
    findingTransitions: [], rectifications: [], findingTransfers: [], findingClosures: [], findingCases: [],
    auditLogs: [], notifications: [], users: [], roles: [], evidence: [], comments: [], importBatches: [],
    settings: { hoApproval: { required: false }, requiredFindingFields: {}, allowOtherValueFields: {}, similarFindingFields: [] },
  } as unknown as Database;
}

const json = (method: string, body?: unknown) =>
  new Request("http://localhost/api/findings", { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = { params: Promise.resolve({ id: "f1" }) };
const newDraft = { periodId: "p1", districtId: "d1", branchId: "b1", title: "Cash shortage", amount: 100, caseCount: 1 };

beforeEach(() => {
  vi.mocked(getCurrentUser).mockResolvedValue({
    isLoggedIn: true, userId: "u1", name: "HO", orgScope: "BANK",
    permissions: ["findings.create", "findings.edit", "findings.delete", "findings.submit"],
  } as never);
});

describe.each([
  ["submission window open", true],
  ["submission window closed", false],
])("open period, %s", (_label, windowOpen) => {
  beforeEach(() => {
    db = fixture(windowOpen);
  });

  it("registering a draft works", async () => {
    const res = await create(json("POST", { ...newDraft, submit: false }), { params: Promise.resolve({}) });
    expect(res.status).toBe(201);
    expect(db.findings).toHaveLength(2);
    expect(db.findings[1].status).toBe("DRAFT");
  });

  it("saving changes to a draft works", async () => {
    expect((await edit(json("PATCH", { title: "Updated title" }), ctx)).status).toBe(200);
    expect(db.findings[0].title).toBe("Updated title");
  });

  it("deleting a draft works", async () => {
    expect((await remove(json("DELETE"), ctx)).status).toBe(200);
    expect(db.findings).toHaveLength(0);
  });

  it(`submitting ${windowOpen ? "works" : "is refused (window closed) - the draft stays"}`, async () => {
    const res = await submit(json("POST", {}), ctx);
    if (windowOpen) {
      expect(res.status).toBe(200);
    } else {
      expect(res.status).toBe(409);
      expect(JSON.stringify(await res.json())).toMatch(/submission window has closed/);
      expect(db.findings[0].status).toBe("DRAFT");
    }
  });
});

describe("deleting a returned finding", () => {
  beforeEach(() => {
    db = fixture(true);
  });

  it("the registrant can delete it, like a draft", async () => {
    db.findings[0].status = "RETURNED";
    expect((await remove(json("DELETE"), ctx)).status).toBe(200);
    expect(db.findings).toHaveLength(0);
  });

  it("its reference number goes to the next new finding", async () => {
    db.findings[0].status = "RETURNED";
    await remove(json("DELETE"), ctx);
    await create(json("POST", { ...newDraft, submit: false }), { params: Promise.resolve({}) });
    expect(db.findings[0].reference).toBe("B001-2026-09-00001");
  });

  it("a deleted never-submitted draft's number may be reused", async () => {
    await remove(json("DELETE"), ctx);
    await create(json("POST", { ...newDraft, submit: false }), { params: Promise.resolve({}) });
    expect(db.findings[0].reference).toBe("B001-2026-09-00001");
  });

  it("someone else's returned finding can't be deleted", async () => {
    db.findings[0].status = "RETURNED";
    db.findings[0].createdBy = "someone-else";
    expect((await remove(json("DELETE"), ctx)).status).toBe(403);
    expect(db.findings).toHaveLength(1);
  });
});

describe("reference numbers fill gaps", () => {
  it("a deleted draft's number in the middle is reused by the next finding", async () => {
    db = fixture(true);
    const makeDraft = () => create(json("POST", { ...newDraft, submit: false }), { params: Promise.resolve({}) });
    await makeDraft(); // 00002
    await makeDraft(); // 00003
    const second = db.findings.find((f) => f.reference.endsWith("-00002"))!;
    await remove(json("DELETE"), { params: Promise.resolve({ id: second.id }) });
    await makeDraft();
    expect(db.findings.map((f) => f.reference).sort()).toEqual(["B001-2026-09-00001", "B001-2026-09-00002", "B001-2026-09-00003"]);
  });
});

describe("a deleted rejected finding's reference number", () => {
  it("is given to the next new finding", async () => {
    db = fixture(true);
    db.findings[0].status = "REJECTED";
    vi.mocked(getCurrentUser).mockResolvedValue({ ...(await getCurrentUser()), permissions: [...(((await getCurrentUser()) as { permissions: string[] }).permissions), "findings.delete-rejected"] } as never);
    expect((await remove(json("DELETE"), ctx)).status).toBe(200);
    await create(json("POST", { ...newDraft, submit: false }), { params: Promise.resolve({}) });
    expect(db.findings[0].reference).toBe("B001-2026-09-00001");
  });
});
