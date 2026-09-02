import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { resolveOrgAssignment, isDepartmentExactScopeForUser } from "@/lib/org";
import { appendAuditLog } from "@/lib/audit";
import { toSafeUser } from "@/lib/sanitize";
import { paginate, parsePage } from "@/lib/pagination";

// A real bank deployment can have hundreds of users (several per branch,
// across every branch bank-wide) - paginated the same way Branches/Audit
// Log are, rather than shipping every user row on every page load.
//
// `?orgScope=BANK` bypasses pagination and returns every ACTIVE user whose
// role holds that org scope - for pickers like Settings' HO-approval
// assignment, where "every active bank-wide user" is a genuinely small,
// bounded set (ADMIN/HO Controller/Executive holders) that needs to be
// fully visible to choose from, not paged.
export async function GET(request: Request) {
  const auth = await requirePermission("users.view");
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const db = readDb();
  const sorted = [...db.users].sort((a, b) => a.name.localeCompare(b.name));

  const orgScopeFilter = searchParams.get("orgScope");
  if (orgScopeFilter) {
    const rolesByCode = new Map(db.roles.map((r) => [r.code, r]));
    const filtered = sorted.filter((u) => u.status === "ACTIVE" && rolesByCode.get(u.role)?.orgScope === orgScopeFilter);
    return NextResponse.json({ users: filtered.map(toSafeUser), total: filtered.length, page: 1, pageSize: filtered.length, totalPages: 1 });
  }

  const result = paginate(sorted.map(toSafeUser), parsePage(searchParams.get("page") ?? undefined), 25);
  return NextResponse.json({ users: result.items, total: result.total, page: result.page, pageSize: result.pageSize, totalPages: result.totalPages });
}

const createUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .regex(/^[a-zA-Z0-9._-]+$/, "Username may only contain letters, numbers, dots, dashes and underscores"),
  email: z.string().email("Enter a valid email address").optional(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.string().min(1, "Role is required"),
  districtId: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  departmentId: z.string().nullable().optional(),
});

export async function POST(request: Request) {
  const auth = await requirePermission("users.create");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const input = parsed.data;

  const db = readDb();
  if (db.users.some((u) => u.username.toLowerCase() === input.username.toLowerCase())) {
    return NextResponse.json({ error: "That username is already taken" }, { status: 409 });
  }
  if (input.email && db.users.some((u) => u.email?.toLowerCase() === input.email!.toLowerCase())) {
    return NextResponse.json({ error: "That email is already in use" }, { status: 409 });
  }

  const assignment = resolveOrgAssignment(db, {
    roleCode: input.role,
    districtId: input.districtId,
    branchId: input.branchId,
  });
  if (assignment.error) {
    return NextResponse.json({ error: assignment.error }, { status: 409 });
  }

  let departmentId: string | null = null;
  if (input.departmentId) {
    const department = db.departments.find((d) => d.id === input.departmentId && d.active);
    if (!department) return NextResponse.json({ error: "Selected department is not active" }, { status: 400 });
    const role = db.roles.find((r) => r.code === input.role)!;
    if (!isDepartmentExactScopeForUser(department, role.orgScope, assignment)) {
      return NextResponse.json({ error: "Selected department does not match this user's district/branch" }, { status: 400 });
    }
    departmentId = department.id;
  }

  const now = new Date().toISOString();
  const user = {
    id: uuid(),
    name: input.name,
    username: input.username,
    email: input.email || null,
    passwordHash: hashPassword(input.password),
    role: input.role,
    status: "ACTIVE" as const,
    districtId: assignment.districtId,
    branchId: assignment.branchId,
    departmentId,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    // The admin chose this password, not the user - forced to their
    // profile to set their own on first login (src/proxy.ts).
    mustChangePassword: true,
  };

  updateDb((current) => {
    current.users.push(user);
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "CREATE",
      entityType: "User",
      entityId: user.id,
      newValue: { name: user.name, username: user.username, email: user.email, role: user.role },
    });
  });

  return NextResponse.json({ user: toSafeUser(user) }, { status: 201 });
}
