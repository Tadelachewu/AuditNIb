import type { Database, User, OrgScope, Department } from "@/types";

export function findBranchRoleHolder(db: Database, branchId: string, roleCode: string): User | undefined {
  return db.users.find((u) => u.branchId === branchId && u.role === roleCode && u.status === "ACTIVE");
}

// Thin, named wrappers kept for the Branches admin page, which always wants
// to show these two well-known BRD roles specifically regardless of what
// other branch-scoped roles an admin may have since defined.
export function findBranchManager(db: Database, branchId: string): User | undefined {
  return findBranchRoleHolder(db, branchId, "BRANCH_MANAGER");
}

export function findBranchController(db: Database, branchId: string): User | undefined {
  return findBranchRoleHolder(db, branchId, "BRANCH_CONTROLLER");
}

// The Branch Manager's deputy - same permission set, seeded as its own
// role (BRANCH_SUB_MANAGER) rather than a second user under the Manager
// role, since branchSingleton already limits each singleton role to one
// active holder per branch.
export function findBranchSubManager(db: Database, branchId: string): User | undefined {
  return findBranchRoleHolder(db, branchId, "BRANCH_SUB_MANAGER");
}

export function findDistrictRoleHolders(db: Database, districtId: string, roleCode: string): User[] {
  return db.users.filter((u) => u.districtId === districtId && u.role === roleCode && u.status === "ACTIVE");
}

// Unlike branches, a district is not a singleton per role - the BRD is
// explicit that "District and Head Office may have multiple Internal
// Controllers" - so these return every active holder, not one.
export function findDistrictControllers(db: Database, districtId: string): User[] {
  return findDistrictRoleHolders(db, districtId, "DISTRICT_CONTROLLER");
}

export function findDistrictDirectors(db: Database, districtId: string): User[] {
  return findDistrictRoleHolders(db, districtId, "DISTRICT_DIRECTOR");
}

/**
 * Enforces "at most one active user per branch" for any role whose
 * RoleDefinition.branchSingleton is true - a generalization of the BRD's
 * "one Branch Manager + one Branch Internal Controller per branch" rule to
 * any custom branch-scoped role an admin defines. Call before saving a user
 * with such a role; `excludeUserId` should be the user's own id when editing.
 */
export function assertBranchRoleAvailable(
  db: Database,
  branchId: string,
  roleCode: string,
  excludeUserId?: string
): string | null {
  const role = db.roles.find((r) => r.code === roleCode);
  if (!role?.branchSingleton) return null;
  const holder = findBranchRoleHolder(db, branchId, roleCode);
  if (holder && holder.id !== excludeUserId) {
    return `This branch already has an active ${role.name} (${holder.name}). Deactivate or reassign them first.`;
  }
  return null;
}

export interface OrgScopeResult {
  error: string | null;
  districtId: string | null;
  branchId: string | null;
}

/**
 * The org-unit resolution rule shared by every "this record has an
 * OrgScope" entity (User via its role, Department directly, and any
 * future one): BRANCH needs a branch (district is derived from it),
 * DISTRICT needs a district and no branch, BANK carries neither
 * regardless of what was passed in. Callers layer their own entity-
 * specific constraints (e.g. resolveOrgAssignment's branchSingleton
 * check below) on top of this.
 */
export function resolveOrgScope(
  db: Database,
  input: { orgScope: OrgScope; districtId?: string | null; branchId?: string | null }
): OrgScopeResult {
  if (input.orgScope === "BRANCH") {
    if (!input.branchId) return { error: "A branch must be selected.", districtId: null, branchId: null };
    const branch = db.branches.find((b) => b.id === input.branchId);
    if (!branch) return { error: "Selected branch does not exist.", districtId: null, branchId: null };
    return { error: null, districtId: branch.districtId, branchId: branch.id };
  }

  if (input.orgScope === "DISTRICT") {
    if (!input.districtId) return { error: "A district must be selected.", districtId: null, branchId: null };
    const district = db.districts.find((d) => d.id === input.districtId);
    if (!district) return { error: "Selected district does not exist.", districtId: null, branchId: null };
    return { error: null, districtId: district.id, branchId: null };
  }

  // BANK scope carries no org unit.
  return { error: null, districtId: null, branchId: null };
}

export interface OrgAssignmentInput {
  roleCode: string;
  districtId?: string | null;
  branchId?: string | null;
}

export type OrgAssignmentResult = OrgScopeResult;

/**
 * Validates and normalizes a user's role + org-unit assignment against the
 * role's RoleDefinition.orgScope, on top of resolveOrgScope's shared rule:
 * BRANCH additionally enforces the branchSingleton constraint above.
 */
export function resolveOrgAssignment(
  db: Database,
  input: OrgAssignmentInput,
  excludeUserId?: string
): OrgAssignmentResult {
  const role = db.roles.find((r) => r.code === input.roleCode);
  if (!role) return { error: "Selected role does not exist.", districtId: null, branchId: null };
  if (role.status !== "ACTIVE") {
    return { error: "Selected role is deactivated and cannot be assigned.", districtId: null, branchId: null };
  }

  const scope = resolveOrgScope(db, { orgScope: role.orgScope, districtId: input.districtId, branchId: input.branchId });
  if (scope.error || role.orgScope !== "BRANCH") return scope;

  const conflict = assertBranchRoleAvailable(db, scope.branchId!, role.code, excludeUserId);
  if (conflict) return { error: conflict, districtId: null, branchId: null };
  return scope;
}

/**
 * Whether a Department is selectable for a record resolved to the given
 * district/branch: a BANK department is available everywhere, a DISTRICT
 * department only within that district, a BRANCH department only at that
 * branch. Used by Finding registration (src/app/api/findings/route.ts),
 * where a bank-wide department can genuinely apply to any finding
 * regardless of which branch/district recorded it. User assignment uses
 * the stricter isDepartmentExactScopeForUser below instead.
 */
export function isDepartmentInScope(department: Department, target: { districtId?: string | null; branchId?: string | null }): boolean {
  if (department.orgScope === "BANK") return true;
  if (department.orgScope === "DISTRICT") return department.districtId === target.districtId;
  return department.branchId === target.branchId;
}

/**
 * Stricter than isDepartmentInScope, and specific to User assignment
 * (src/app/api/admin/users/): a user's department must match their own
 * role's org tier exactly - a branch-scoped user only a department scoped
 * to that exact branch, a district-scoped user only that exact district,
 * a bank-scoped user (Admin/HO/Executive) only a bank-wide department.
 * Deliberately no cross-tier fallback - unlike a Finding, a user's
 * department describes their own organizational home, not something a
 * bank-wide department could also stand in for.
 */
export function isDepartmentExactScopeForUser(
  department: Department,
  userOrgScope: OrgScope,
  target: { districtId?: string | null; branchId?: string | null }
): boolean {
  if (userOrgScope === "BRANCH") return department.orgScope === "BRANCH" && department.branchId === target.branchId;
  if (userOrgScope === "DISTRICT") return department.orgScope === "DISTRICT" && department.districtId === target.districtId;
  return department.orgScope === "BANK";
}
