import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/types";

let db: Database;
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  readDb: vi.fn(async () => structuredClone(db)),
  updateDb: vi.fn(async (fn: (d: Database) => unknown) => fn(db)),
}));
vi.mock("@/lib/monitoring", () => ({ captureServerException: vi.fn(async () => {}) }));

import { getCurrentUser } from "@/lib/session";
import { buildSeedDatabase } from "../prisma/seedData";
import { PATCH, DELETE } from "@/app/api/admin/scoring-rules/[id]/route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: object) =>
  new Request("http://localhost/api/admin/scoring-rules/x", { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

beforeEach(() => {
  db = buildSeedDatabase();
  vi.mocked(getCurrentUser).mockResolvedValue({
    isLoggedIn: true, userId: db.users[0].id, name: "Admin", orgScope: "BANK", permissions: ["scoring-rules.view", "scoring-rules.edit", "scoring-rules.delete", "scoring-rules.activate"],
  } as never);
});

describe("scoring rules: editable and deletable", () => {
  it("the active rule can be edited", async () => {
    const active = db.scoringRules.find((r) => r.active)!;
    const res = await PATCH(req("PATCH", { name: "Renamed rule" }), ctx(active.id) as never);
    expect(res.status).toBe(200);
    expect(db.scoringRules.find((r) => r.id === active.id)!.name).toBe("Renamed rule");
  });

  it("a rule that was active before can be deleted", async () => {
    const active = db.scoringRules.find((r) => r.active)!;
    active.active = false; // was active before, not now
    active.everActivated = true;
    expect((await DELETE(req("DELETE"), ctx(active.id) as never)).status).toBe(200);
    expect(db.scoringRules.some((r) => r.id === active.id)).toBe(false);
  });

  it("the active rule can't be deleted", async () => {
    const active = db.scoringRules.find((r) => r.active)!;
    const res = await DELETE(req("DELETE"), ctx(active.id) as never);
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).toMatch(/active scoring rule/);
    expect(db.scoringRules.some((r) => r.id === active.id)).toBe(true);
  });
});
