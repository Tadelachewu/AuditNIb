import type { Database, User } from "@/types";

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

export interface OrgAssignmentInput {
  roleCode: string;
  districtId?: string | null;
  branchId?: string | null;
}

export interface OrgAssignmentResult {
  error: string | null;
  districtId: string | null;
  branchId: string | null;
}

/**
 * Validates and normalizes a user's role + org-unit assignment against the
 * role's RoleDefinition.orgScope:
 *  - BRANCH: must have a branch (district is derived from it); enforces
 *    the branchSingleton constraint above
 *  - DISTRICT: must have a district, no branch
 *  - BANK: carries no org unit, regardless of what was passed in
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

  if (role.orgScope === "BRANCH") {
    if (!input.branchId) return { error: "A branch must be selected for this role.", districtId: null, branchId: null };
    const branch = db.branches.find((b) => b.id === input.branchId);
    if (!branch) return { error: "Selected branch does not exist.", districtId: null, branchId: null };
    const conflict = assertBranchRoleAvailable(db, branch.id, role.code, excludeUserId);
    if (conflict) return { error: conflict, districtId: null, branchId: null };
    return { error: null, districtId: branch.districtId, branchId: branch.id };
  }

  if (role.orgScope === "DISTRICT") {
    if (!input.districtId) return { error: "A district must be selected for this role.", districtId: null, branchId: null };
    const district = db.districts.find((d) => d.id === input.districtId);
    if (!district) return { error: "Selected district does not exist.", districtId: null, branchId: null };
    return { error: null, districtId: district.id, branchId: null };
  }

  // BANK-scoped roles carry no org unit.
  return { error: null, districtId: null, branchId: null };
}
