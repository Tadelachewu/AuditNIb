import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database, FindingCase } from "@/types";

// Editing a draft / returned finding's tracked cases (its case breakdown):
// change, add or remove cases, keep the totals matched, or stop tracking.

let db: Database;
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  readDb: vi.fn(async () => structuredClone(db)),
  updateDb: vi.fn(async (fn: (d: Database) => unknown) => fn(db)),
}));
vi.mock("@/lib/monitoring", () => ({ captureServerException: vi.fn(async () => {}) }));

import { getCurrentUser } from "@/lib/session";
import { PATCH as edit } from "@/app/api/findings/[id]/route";

const DAY = 24 * 60 * 60 * 1000;
const kase = (seq: number, amount: number, description?: string, status: FindingCase["status"] = "OUTSTANDING"): FindingCase => ({
  id: `c${seq}`, findingId: "f1", seq, amount, description, status, createdAt: "2026-10-01T00:00:00.000Z",
});

function fixture(status = "DRAFT", cases: FindingCase[] = [kase(1, 100, "First"), kase(2, 200, "Second"), kase(3, 300)]): Database {
  const now = Date.now();
  const total = cases.reduce((s, c) => s + c.amount, 0);
  return {
    reportingPeriods: [
      {
        id: "p1", code: "2026-09", year: 2026, month: 9, status: "OPEN", draftsAllowedWhileLocked: true,
        startsAt: new Date(now - 20 * DAY).toISOString(), endsAt: new Date(now + 10 * DAY).toISOString(),
        submissionStartsAt: new Date(now - 20 * DAY).toISOString(), submissionEndsAt: new Date(now + 10 * DAY).toISOString(),
      },
    ],
    districts: [{ id: "d1", code: "D01", name: "Addis", status: "ACTIVE" }],
    branches: [{ id: "b1", code: "B001", name: "Bole", districtId: "d1", status: "ACTIVE" }],
    sources: [], departments: [], categories: [],
    findings: [
      {
        id: "f1", reference: "B001-2026-09-00001", status, periodId: "p1", branchId: "b1", districtId: "d1", createdBy: "u1",
        title: "Cash shortage", caseCount: cases.length || 3, amount: total || 600, registeredCaseCount: cases.length || 3, registeredAmount: total || 600,
      },
    ],
    findingCases: cases,
    findingTransitions: [], rectifications: [], findingTransfers: [], findingClosures: [],
    auditLogs: [], notifications: [], users: [], roles: [], evidence: [], comments: [], importBatches: [],
    settings: { hoApproval: { required: false }, requiredFindingFields: {}, allowOtherValueFields: {}, similarFindingFields: [] },
  } as unknown as Database;
}

const patch = (body: unknown) =>
  edit(new Request("http://localhost/api/findings/f1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "f1" }),
  });
const casesOf = () => db.findingCases.filter((c) => c.findingId === "f1").sort((a, b) => a.seq - b.seq);

beforeEach(() => {
  vi.mocked(getCurrentUser).mockResolvedValue({
    isLoggedIn: true, userId: "u1", name: "BC", orgScope: "BANK", permissions: ["findings.edit", "findings.view"],
  } as never);
  db = fixture();
});

describe("editing a draft's tracked cases", () => {
  it("changes amounts and names, keeping each case's record", async () => {
    const res = await patch({ amount: 650, caseAmounts: [150, 200, 300], caseDescriptions: ["First (corrected)", "Second", "Third"] });
    expect(res.status).toBe(200);
    expect(casesOf().map((c) => [c.id, c.seq, c.amount, c.description])).toEqual([
      ["c1", 1, 150, "First (corrected)"],
      ["c2", 2, 200, "Second"],
      ["c3", 3, 300, "Third"],
    ]);
    expect(db.findings[0]).toMatchObject({ amount: 650, caseCount: 3, registeredAmount: 650, registeredCaseCount: 3 });
  });

  it("adds a case", async () => {
    const res = await patch({ caseCount: 4, amount: 650, caseAmounts: [100, 200, 300, 50], caseDescriptions: ["First", "Second", "", "New one"] });
    expect(res.status).toBe(200);
    expect(casesOf().map((c) => [c.seq, c.amount, c.description ?? null, c.status])).toEqual([
      [1, 100, "First", "OUTSTANDING"],
      [2, 200, "Second", "OUTSTANDING"],
      [3, 300, null, "OUTSTANDING"],
      [4, 50, "New one", "OUTSTANDING"],
    ]);
    expect(db.findings[0]).toMatchObject({ caseCount: 4, registeredCaseCount: 4 });
  });

  it("removes a case and renumbers the rest", async () => {
    const res = await patch({ caseCount: 2, amount: 400, caseAmounts: [100, 300], caseDescriptions: ["First", "Third"] });
    expect(res.status).toBe(200);
    expect(casesOf().map((c) => [c.seq, c.amount, c.description])).toEqual([
      [1, 100, "First"],
      [2, 300, "Third"],
    ]);
  });

  it("stops tracking individual cases (null): the saved cases are removed", async () => {
    const res = await patch({ caseAmounts: null });
    expect(res.status).toBe(200);
    expect(casesOf()).toEqual([]);
  });

  it("starts tracking cases on a finding that had none", async () => {
    db = fixture("DRAFT", []);
    const res = await patch({ caseCount: 2, amount: 600, caseAmounts: [250, 350] });
    expect(res.status).toBe(200);
    expect(casesOf().map((c) => [c.seq, c.amount])).toEqual([
      [1, 250],
      [2, 350],
    ]);
  });

  it("works the same on a returned finding", async () => {
    db = fixture("RETURNED");
    expect((await patch({ amount: 700, caseAmounts: [100, 200, 400] })).status).toBe(200);
    expect(casesOf().map((c) => c.amount)).toEqual([100, 200, 400]);
  });

  it("records the cases before and after in the audit log", async () => {
    await patch({ amount: 650, caseAmounts: [150, 200, 300] });
    const entry = db.auditLogs.at(-1) as unknown as { oldValue: { cases: unknown[] }; newValue: { cases: unknown[] } };
    expect(entry.oldValue.cases).toEqual([
      { seq: 1, amount: 100, description: "First" },
      { seq: 2, amount: 200, description: "Second" },
      { seq: 3, amount: 300, description: null },
    ]);
    expect(entry.newValue.cases).toEqual([
      { seq: 1, amount: 150, description: null },
      { seq: 2, amount: 200, description: null },
      { seq: 3, amount: 300, description: null },
    ]);
  });
});

describe("what is refused", () => {
  it("a breakdown that doesn't add up to the amount", async () => {
    const res = await patch({ caseAmounts: [100, 200, 250] });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/totals 550 but the amount involved is 600/);
    expect(casesOf().map((c) => c.amount)).toEqual([100, 200, 300]);
  });

  it("a breakdown with a different number of cases than the case count", async () => {
    const res = await patch({ caseAmounts: [300, 300] });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/2 entries but the case count is 3/);
  });

  it("names that don't line up with the amounts", async () => {
    const res = await patch({ caseAmounts: [100, 200, 300], caseDescriptions: ["Only one"] });
    expect(res.status).toBe(400);
  });

  it("changing the totals without the breakdown (as before)", async () => {
    const res = await patch({ amount: 900 });
    expect(res.status).toBe(409);
    expect(casesOf().map((c) => c.amount)).toEqual([100, 200, 300]);
  });

  it("editing other fields leaves the cases alone", async () => {
    expect((await patch({ title: "New title" })).status).toBe(200);
    expect(casesOf().map((c) => [c.id, c.amount])).toEqual([
      ["c1", 100],
      ["c2", 200],
      ["c3", 300],
    ]);
  });

  it("a breakdown change when a case is already rectified", async () => {
    db = fixture("DRAFT", [kase(1, 100, "First", "RECTIFIED"), kase(2, 200), kase(3, 300)]);
    expect((await patch({ caseAmounts: [100, 200, 300] })).status).toBe(409);
  });
});
