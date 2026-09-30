import { NextResponse } from "next/server";
import { lockoutError } from "@/lib/permissions/lockout";
import { z } from "zod";
import { requireToggleOrEditPermission, requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { validatePasswordFull } from "@/lib/passwordValidation";
import { resolveOrgAssignment, isDepartmentExactScopeForUser, inactiveOrgUnitError } from "@/lib/org";
import { appendAuditLog } from "@/lib/audit";
import { toSafeUser } from "@/lib/sanitize";
import { withApiHandler } from "@/lib/api/handler";

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  // Email is mandatory - we accept ".min(1)" alongside `.email()` so the
  // error on "empty string submitted to clear the field" is "Email address
  // is required" rather than "Enter a valid email address". We also accept
  // undefined (not sent, don't change it) but NOT null (explicitly clear) -
  // email must never be nullable, per the DB constraint and the forgot-
  // password/notification flows that depend on it always existing.
  // .optional(): a status-only PATCH (Activate/Deactivate) sends no email.
  // Zod 4 treats a union with z.undefined() as a *required* key unless
  // marked optional - that broke every user status toggle.
  email: z.string().min(1, "Email address is required").email("Enter a valid email address").optional(),
  // Optional and nullable (unlike email) - not every account has one, and
  // an admin can clear it back out. Loosely validated, same reasoning as
  // POST /api/admin/users' own phone field.
  phone: z
    .union([z.string().trim().regex(/^[+0-9()\-.\s]{6,20}$/, "Enter a valid phone number"), z.literal(""), z.null()])
    .optional(),
  role: z.string().min(1).optional(),
  districtId: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  departmentId: z.string().nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  password: z.string().min(8).optional(),
});

async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const input = parsed.data;

  // A pure {status} PATCH (what the deactivate/reactivate button sends) is
  // gated by "users.toggle-status"; anything that touches name/role/org/
  // password is a real edit and needs "users.edit" - action-level, not just
  // page-level, permissions.
  const auth = await requireToggleOrEditPermission("users", input);
  if (!auth.ok) return auth.response;

  const db = await readDb();
  const existing = db.users.find((u) => u.id === id);
  if (!existing) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Deactivating signs the user out on their next request and blocks
  // login (src/lib/session.ts, the login route). Never allowed on your own
  // account; and never (deactivation or a role change) when it would leave
  // nobody active holding the permissions needed to undo it - permission-
  // based, whatever the role is called (src/lib/permissions/lockout.ts).
  if (input.status === "INACTIVE" && existing.status === "ACTIVE" && existing.id === auth.session.userId) {
    return NextResponse.json({ error: "You can't deactivate your own account." }, { status: 409 });
  }
  if ((input.status !== undefined && input.status !== existing.status) || (input.role !== undefined && input.role !== existing.role)) {
    const lockout = lockoutError(db, {
      users: db.users.map((u) => (u.id === existing.id ? { ...u, status: input.status ?? u.status, role: input.role ?? u.role } : u)),
    });
    if (lockout) return NextResponse.json({ error: lockout, code: "LOCKOUT_PREVENTED" }, { status: 409 });
  }

  // Defense in depth, not a live restriction today: users.edit/toggle-status
  // are seeded onto ADMIN only (BANK-scoped, so none of this fires for the
  // only role that currently holds them - icfms.txt reserves "User
  // creation, Role assignment... " to the Administrator alone). But
  // permissions are dynamic, admin-editable data (PHASE2.md) - if a
  // DISTRICT/BRANCH-scoped role is ever granted this permission, it should
  // still only ever be able to touch a user in its own org unit, and never
  // assign a role with broader reach than its own - the same "BRANCH/
  // DISTRICT roles stay inside their own org unit" rule POST /api/findings
  // and prisma import already enforce for their own resources.
  if (auth.session.orgScope !== "BANK") {
    const inScope = (districtId: string | null, branchId: string | null) => {
      if (auth.session.orgScope === "BRANCH") return branchId === auth.session.branchId;
      return districtId === auth.session.districtId;
    };
    if (!inScope(existing.districtId ?? null, existing.branchId ?? null)) {
      return NextResponse.json({ error: "Outside your organizational scope" }, { status: 403 });
    }
    const targetRoleCode = input.role ?? existing.role;
    const targetRole = db.roles.find((r) => r.code === targetRoleCode);
    if (targetRole && targetRole.orgScope === "BANK") {
      return NextResponse.json({ error: "You cannot assign a bank-wide role" }, { status: 403 });
    }
  }

  if (input.password) {
    const strength = await validatePasswordFull(input.password);
    if (!strength.valid) {
      return NextResponse.json({ error: strength.error }, { status: 400 });
    }
  }

  if (input.email !== undefined && db.users.some((u) => u.id !== id && u.email.toLowerCase() === input.email!.toLowerCase())) {
    return NextResponse.json({ error: "That email is already in use" }, { status: 409 });
  }

  const nextRole = input.role ?? existing.role;
  const wantsOrgChange = input.role !== undefined || input.districtId !== undefined || input.branchId !== undefined;

  let districtId = existing.districtId ?? null;
  let branchId = existing.branchId ?? null;

  if (wantsOrgChange) {
    const assignment = resolveOrgAssignment(
      db,
      {
        roleCode: nextRole,
        districtId: input.districtId !== undefined ? input.districtId : existing.districtId,
        branchId: input.branchId !== undefined ? input.branchId : existing.branchId,
      },
      existing.id
    );
    if (assignment.error) return NextResponse.json({ error: assignment.error }, { status: 409 });
    // Only a *move* into a deactivated district/branch is refused; a user
    // already there can still be edited (e.g. to move them out).
    if (assignment.districtId !== existing.districtId || assignment.branchId !== existing.branchId) {
      const inactiveUnit = inactiveOrgUnitError(db, assignment.districtId, assignment.branchId);
      if (inactiveUnit) return NextResponse.json({ error: `${inactiveUnit} Users can't be moved into it.` }, { status: 409 });
    }
    districtId = assignment.districtId;
    branchId = assignment.branchId;

    // Same non-BANK defense-in-depth as above: block moving an in-scope
    // user's org assignment to somewhere the editor itself has no reach.
    if (auth.session.orgScope === "BRANCH" && branchId !== auth.session.branchId) {
      return NextResponse.json({ error: "Outside your organizational scope" }, { status: 403 });
    }
    if (auth.session.orgScope === "DISTRICT" && districtId !== auth.session.districtId) {
      return NextResponse.json({ error: "Outside your organizational scope" }, { status: 403 });
    }
  }

  // Re-validated whenever the department itself changes, or whenever the
  // org scope changes underneath it - e.g. moving a user to a different
  // branch shouldn't silently leave them holding a department scoped to
  // their old branch.
  let departmentId: string | null = existing.departmentId ?? null;
  if (input.departmentId !== undefined || wantsOrgChange) {
    const targetDepartmentId = input.departmentId !== undefined ? input.departmentId : existing.departmentId;
    if (targetDepartmentId) {
      const department = db.departments.find((d) => d.id === targetDepartmentId && d.active);
      if (!department) return NextResponse.json({ error: "Selected department is not active" }, { status: 400 });
      const role = db.roles.find((r) => r.code === nextRole)!;
      if (!isDepartmentExactScopeForUser(department, role.orgScope, { districtId, branchId })) {
        return NextResponse.json({ error: "Selected department does not match this user's district/branch" }, { status: 400 });
      }
      departmentId = department.id;
    } else {
      departmentId = null;
    }
  }

  const before = {
    name: existing.name,
    email: existing.email,
    phone: existing.phone ?? null,
    role: existing.role,
    status: existing.status,
    districtId: existing.districtId,
    branchId: existing.branchId,
    departmentId: existing.departmentId,
  };

  const updated = await updateDb((current) => {
    const u = current.users.find((x) => x.id === id)!;
    if (input.name !== undefined) u.name = input.name;
    if (input.email !== undefined) u.email = input.email;
    if (input.phone !== undefined) u.phone = input.phone || null;
    if (input.status !== undefined) u.status = input.status;
    if (input.password) {
      u.passwordHash = hashPassword(input.password);
      // Same reasoning as account creation - the admin chose this
      // password, not the user, so it's forced through /profile again,
      // and only valid for 24h (see the login route's own expiry check).
      u.mustChangePassword = true;
      u.passwordExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      // Kills every session this user currently has open elsewhere - an
      // admin resetting a password is very often a "this account may be
      // compromised" action, not just routine credential hygiene, so the
      // old password's sessions shouldn't outlive the reset itself (see
      // User.sessionVersion's own doc comment).
      u.sessionVersion = (u.sessionVersion ?? 1) + 1;
    }
    u.role = nextRole;
    u.districtId = districtId;
    u.branchId = branchId;
    u.departmentId = departmentId;
    u.updatedAt = new Date().toISOString();

    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "UPDATE",
      entityType: "User",
      entityId: u.id,
      oldValue: before,
      newValue: {
        name: u.name,
        email: u.email,
        phone: u.phone ?? null,
        role: u.role,
        status: u.status,
        districtId: u.districtId,
        branchId: u.branchId,
        departmentId: u.departmentId,
      },
    });

    return u;
  });

  return NextResponse.json({ user: toSafeUser(updated) });
}

// icfms.txt otherwise reserves user lifecycle to create/edit/deactivate
// (no delete) - this only ever applies to a user with genuinely zero
// recorded activity anywhere findings-workflow-related (never registered,
// reviewed, rectified, transferred, closed, uploaded evidence for,
// commented on, imported, or created a scoring rule/adjustment for
// anything, and isn't a designated bank-approval approver). In practice
// that's an account created by mistake minutes ago, not a real one that's
// ever been used - once a user has done anything the BRD actually cares
// about, deleting them would silently orphan that history (findings still
// show a createdBy pointing at nobody, a transition still shows who
// approved it but that id no longer resolves, ...). Deliberately NOT
// checked: Notification.recipientUserId and AuditLogEntry.userId (as
// actor) - both already snapshot a display name alongside the id
// (userName), so a dangling reference there doesn't break anything shown
// to anyone, and blocking on "this user was once notified about something"
// or "logged in once" would make almost no account ever deletable.
async function handleDELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("users.delete");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = await readDb();
  const existing = db.users.find((u) => u.id === id);
  if (!existing) return NextResponse.json({ error: "User not found" }, { status: 404 });
  // Same lock-out protection as deactivation (see PATCH above).
  if (existing.id === auth.session.userId) {
    return NextResponse.json({ error: "You can't delete your own account." }, { status: 409 });
  }
  const lockout = lockoutError(db, { users: db.users.filter((u) => u.id !== existing.id) });
  if (lockout) return NextResponse.json({ error: lockout, code: "LOCKOUT_PREVENTED" }, { status: 409 });

  const references: Array<{ label: string; count: number }> = [
    { label: "finding(s) registered", count: db.findings.filter((f) => f.createdBy === id).length },
    { label: "finding status change(s)", count: db.findingTransitions.filter((t) => t.userId === id).length },
    { label: "rectification(s) submitted", count: db.rectifications.filter((r) => r.submittedBy === id).length },
    { label: "itemized case(s) marked rectified", count: db.findingCases.filter((c) => c.rectifiedBy === id).length },
    { label: "transfer(s) performed", count: db.findingTransfers.filter((t) => t.createdBy === id).length },
    { label: "closure(s) submitted", count: db.findingClosures.filter((c) => c.submittedBy === id).length },
    { label: "import batch(es)", count: db.importBatches.filter((b) => b.importedBy === id).length },
    { label: "evidence file(s) uploaded", count: db.evidence.filter((e) => e.uploadedBy === id).length },
    { label: "comment(s) authored", count: db.comments.filter((c) => c.authorId === id).length },
    { label: "branch coverage note(s) recorded", count: db.branchCoverageNotes.filter((n) => n.recordedBy === id).length },
    { label: "scoring rule(s) created", count: db.scoringRules.filter((r) => r.createdBy === id).length },
  ];
  const blocking = references.find((r) => r.count > 0);
  if (blocking) {
    return NextResponse.json({ error: `Cannot delete: this user has ${blocking.count} ${blocking.label}. Deactivate instead.` }, { status: 409 });
  }
  if (db.settings.hoApproval.approverUserIds.includes(id)) {
    return NextResponse.json(
      { error: "Cannot delete: this user is a designated Bank-Wide Approval approver. Remove them from Settings first." },
      { status: 409 }
    );
  }

  await updateDb((current) => {
    current.users = current.users.filter((u) => u.id !== id);
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "DELETE",
      entityType: "User",
      entityId: id,
      oldValue: toSafeUser(existing),
    });
  });

  return NextResponse.json({ ok: true });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const PATCH = withApiHandler(handlePATCH);
export const DELETE = withApiHandler(handleDELETE);
