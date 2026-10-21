import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/types";

// The To picker's Roles tab: every active role except Administrator - also
// a role nobody holds yet (it shows 0 people).

const db = {
  users: [
    { id: "ho", name: "HO", role: "HO_CONTROLLER", status: "ACTIVE", districtId: null, branchId: null },
    { id: "bm", name: "BM", role: "BRANCH_MANAGER", status: "ACTIVE", districtId: "d1", branchId: "b1" },
    { id: "admin", name: "ADMIN", role: "ADMIN", status: "ACTIVE", districtId: null, branchId: null },
  ],
  roles: [
    { code: "ADMIN", name: "Administrator", status: "ACTIVE" },
    { code: "BRANCH_MANAGER", name: "Branch Manager", status: "ACTIVE" },
    { code: "HO_CONTROLLER", name: "HO Controller", status: "ACTIVE" },
    { code: "DISTRICT_DIRECTOR", name: "District Director", status: "ACTIVE" }, // nobody holds it yet
    { code: "OLD_ROLE", name: "Old Role", status: "INACTIVE" },
  ],
  districts: [{ id: "d1", name: "Addis", status: "ACTIVE" }],
  branches: [{ id: "b1", name: "Bole", districtId: "d1", status: "ACTIVE" }],
} as unknown as Database;

vi.mock("@/lib/db", () => ({ readDb: vi.fn(async () => db), updateDb: vi.fn() }));
vi.mock("@/lib/prismaClient", () => ({ prisma: {} }));

import { directory } from "@/lib/communications/service";

describe("Communications directory: roles", () => {
  it("lists every active role except Administrator, even one with nobody in it", async () => {
    const res = await directory({ isLoggedIn: true, userId: "ho", role: "HO_CONTROLLER", permissions: ["communications.view", "communications.send"] } as never);
    expect(res.ok).toBe(true);
    const roles = res.ok ? res.value.roles.map((r) => r.code) : [];
    expect(roles).toEqual(["BRANCH_MANAGER", "DISTRICT_DIRECTOR", "HO_CONTROLLER"]);
    expect(roles).not.toContain("ADMIN");
    expect(roles).not.toContain("OLD_ROLE");
  });
});
