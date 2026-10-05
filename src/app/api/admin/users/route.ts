import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { zEmail, zPersonName, zPhone, zUsername } from "@/lib/inputRules";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { PASSWORD_MIN_LENGTH, validatePasswordFull } from "@/lib/passwordValidation";
import { resolveOrgAssignment, isDepartmentExactScopeForUser, inactiveOrgUnitError } from "@/lib/org";
import { appendAuditLog } from "@/lib/audit";
import { toSafeUser } from "@/lib/sanitize";
import { withApiHandler } from "@/lib/api/handler";
import { listPageJson } from "@/lib/serverList";

// A real bank deployment can have hundreds of users (several per branch,
// across every branch bank-wide) - paginated the same way Branches/Audit
// Log are, rather than shipping every user row on every page load.
//
// `?orgScope=BANK` bypasses pagination and returns every ACTIVE user whose
// role holds that org scope - for pickers like Settings' HO-approval
// assignment, where "every active bank-wide user" is a genuinely small,
// bounded set (ADMIN/HO Controller/Executive holders) that needs to be
// fully visible to choose from, not paged.
async function handleGET(request: Request) {
  const auth = await requirePermission("users.view");
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const db = await readDb();
  const sorted = [...db.users].sort((a, b) => a.name.localeCompare(b.name));

  const orgScopeFilter = searchParams.get("orgScope");
  if (orgScopeFilter) {
    const rolesByCode = new Map(db.roles.map((r) => [r.code, r]));
    const filtered = sorted.filter((u) => u.status === "ACTIVE" && rolesByCode.get(u.role)?.orgScope === orgScopeFilter);
    return NextResponse.json({ users: filtered.map(toSafeUser), total: filtered.length, page: 1, pageSize: filtered.length, totalPages: 1 });
  }

  // ?all=1 -> everyone at once (same permission, same sanitized shape - no password hashes).
  if (searchParams.get("all") === "1") {
    const all = sorted.map(toSafeUser);
    return NextResponse.json({ users: all, total: all.length, page: 1, pageSize: all.length, totalPages: 1 });
  }

  // The Users table: one page, searched / filtered / sorted on the server
  // (src/lib/serverList.ts) by the same values the table's columns show.
  const name = <T extends { id: string; name: string }>(list: T[], id?: string | null) => (id ? (list.find((x) => x.id === id)?.name ?? "—") : "—");
  const paged = listPageJson(request, "users", sorted.map(toSafeUser), {
    fields: {
      name: (u) => u.name,
      username: (u) => u.username,
      email: (u) => u.email || "—",
      phone: (u) => u.phone || "—",
      role: (u) => db.roles.find((r) => r.code === u.role)?.name ?? u.role,
      orgUnit: (u) => (u.branchId ? name(db.branches, u.branchId) : u.districtId ? name(db.districts, u.districtId) : "Bank-wide"),
      department: (u) => name(db.departments, u.departmentId),
      status: (u) => u.status,
      lastLogin: (u) => u.lastLoginAt ?? "",
    },
    exact: ["role", "orgUnit", "department", "status"],
  });
  if (paged) return NextResponse.json(paged);
  const all = sorted.map(toSafeUser);
  return NextResponse.json({ users: all, total: all.length, page: 1, pageSize: all.length, totalPages: 1 });
}

const createUserSchema = z.object({
  name: zPersonName(),
  // Shared with the Add User form and CSV import (src/lib/usernameValidation.ts).
  username: zUsername(),
  email: zEmail(),
  // Optional, loosely validated - international formats vary too much for
  // a strict pattern to be worth the false rejections; just reject stray
  // letters/junk. Admin-only, like email (see User.phone's own doc
  // comment in src/types/index.ts).
  phone: zPhone().optional(),
  password: z.string().min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`),
  role: z.string().min(1, "Role is required"),
  districtId: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  departmentId: z.string().nullable().optional(),
});

async function handlePOST(request: Request) {
  const auth = await requirePermission("users.create");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const input = parsed.data;

  const strength = await validatePasswordFull(input.password);
  if (!strength.valid) {
    return NextResponse.json({ error: strength.error }, { status: 400 });
  }

  const db = await readDb();
  if (db.users.some((u) => u.username.toLowerCase() === input.username.toLowerCase())) {
    return NextResponse.json({ error: "That username is already taken" }, { status: 409 });
  }
  if (db.users.some((u) => u.email.toLowerCase() === input.email.toLowerCase())) {
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
  const inactiveUnit = inactiveOrgUnitError(db, assignment.districtId, assignment.branchId);
  if (inactiveUnit) return NextResponse.json({ error: `${inactiveUnit} New users can't be assigned to it.` }, { status: 409 });

  // Defense in depth, not a live restriction today - see the identical
  // check (and its own doc comment) in PATCH .../users/[id]/route.ts.
  // users.create is seeded onto ADMIN only (BANK-scoped, so this never
  // fires for the only role that currently holds it), but permissions are
  // dynamic data - a DISTRICT/BRANCH-scoped role granted this permission
  // later should still only be able to create a user in its own org unit,
  // holding a role no broader than its own.
  if (auth.session.orgScope !== "BANK") {
    const newRole = db.roles.find((r) => r.code === input.role);
    if (newRole && newRole.orgScope === "BANK") {
      return NextResponse.json({ error: "You cannot assign a bank-wide role" }, { status: 403 });
    }
    if (auth.session.orgScope === "BRANCH" && assignment.branchId !== auth.session.branchId) {
      return NextResponse.json({ error: "Outside your organizational scope" }, { status: 403 });
    }
    if (auth.session.orgScope === "DISTRICT" && assignment.districtId !== auth.session.districtId) {
      return NextResponse.json({ error: "Outside your organizational scope" }, { status: 403 });
    }
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
    email: input.email.trim(),
    phone: input.phone?.trim() || null,
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
    // profile to set their own on first login (src/proxy.ts), and only
    // valid for 24h from now (see the login route's own expiry check) so
    // an unused temporary credential doesn't stay usable indefinitely.
    mustChangePassword: true,
    passwordExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    sessionVersion: 1,
  };

  await updateDb((current) => {
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

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const GET = withApiHandler(handleGET);
export const POST = withApiHandler(handlePOST);
