import { beforeEach, describe, expect, it, vi } from "vitest";

// Integration: a real Route Handler (Admin → Districts) through the real
// guard and central handler, with only the session and database stubbed.
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/db", () => ({ readDb: vi.fn(), updateDb: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ captureServerException: vi.fn(async () => {}) }));

import { GET, POST } from "@/app/api/admin/districts/route";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";

const ctx = { params: Promise.resolve({}) };
const post = (body: unknown) =>
  new Request("http://localhost/api/admin/districts", {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "route-test-01" },
    body: JSON.stringify(body),
  });
const session = (permissions: string[]) => ({ isLoggedIn: true, userId: "u1", name: "Tester", permissions, orgScope: "BANK" }) as never;

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset();
  vi.mocked(readDb).mockReset();
});

describe("Route Handler contract (districts)", () => {
  it("401 AUTHENTICATION_FAILED when not signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/admin/districts"), ctx);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: { code: "AUTHENTICATION_FAILED" } });
    expect(typeof body.requestId).toBe("string");
  });

  it("403 AUTHORIZATION_DENIED without the permission", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(session(["findings.view"]));
    const res = await POST(post({ code: "X", name: "Y" }), ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("AUTHORIZATION_DENIED");
  });

  it("400 VALIDATION_ERROR for invalid input, with the request ID", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(session(["districts.create"]));
    const res = await POST(post({ code: "" }), ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.requestId).toBe("route-test-01");
  });

  it("409 CONFLICT for a duplicate code", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(session(["districts.create"]));
    vi.mocked(readDb).mockResolvedValue({ districts: [{ id: "d1", code: "AA", name: "Addis" }] } as never);
    const res = await POST(post({ code: "aa", name: "Other" }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatchObject({ code: "CONFLICT", message: "A district with that code already exists" });
  });

  it("503 DATABASE_ERROR when the database is down - no internals leaked", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(session(["districts.view"]));
    vi.mocked(readDb).mockRejectedValue(
      Object.assign(new Error("Can't reach database server at `10.1.2.3:5432`. postgresql://nib:S3cret@10.1.2.3/audit"), { name: "PrismaClientInitializationError" })
    );
    const res = await GET(new Request("http://localhost/api/admin/districts"), ctx);
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toMatch(/10\.1\.2\.3|S3cret|postgresql|5432/);
    expect(JSON.parse(text).error.code).toBe("DATABASE_ERROR");
  });
});

describe("user status toggle (regression: status-only PATCH)", () => {
  it("deactivates a user with just { status } and returns the permission-based lock-out error for the last holder", async () => {
    const { updateDb } = await import("@/lib/db");
    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    const roles = [
      { code: "ADMIN", status: "ACTIVE", orgScope: "BANK", permissions: ["users.toggle-status", "roles.manage"] },
      { code: "CLERK", status: "ACTIVE", orgScope: "BANK", permissions: [] },
    ];
    const users = [
      { id: "admin1", username: "admin", name: "Admin", role: "ADMIN", status: "ACTIVE", sessionVersion: 1 },
      { id: "clerk1", username: "clerk", name: "Clerk", role: "CLERK", status: "ACTIVE", sessionVersion: 1 },
    ];
    const state = { users, roles, auditLogs: [], districts: [], branches: [], departments: [] } as never;
    vi.mocked(readDb).mockResolvedValue(state);
    vi.mocked(updateDb).mockImplementation((async (fn: (d: unknown) => unknown) => fn(state)) as never);
    vi.mocked(getCurrentUser).mockResolvedValue({ isLoggedIn: true, userId: "admin1", name: "Admin", permissions: ["users.toggle-status"], orgScope: "BANK" } as never);

    const patch = (id: string, body: unknown) =>
      PATCH(new Request(`http://localhost/api/admin/users/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
        params: Promise.resolve({ id }),
      });

    const ok = await patch("clerk1", { status: "INACTIVE" });
    expect(ok.status).toBe(200);
    expect(users[1].status).toBe("INACTIVE");

    const self = await patch("admin1", { status: "INACTIVE" });
    expect(self.status).toBe(409);
    expect((await self.json()).error.message).toMatch(/your own account/);
  });
});
