import type { Database, User, Role } from "@/types";

const DISTRICT_SCOPED_ROLES: Role[] = ["DISTRICT_CONTROLLER", "DISTRICT_DIRECTOR"];
const BRANCH_SCOPED_ROLES: Role[] = ["BRANCH_CONTROLLER", "BRANCH_MANAGER"];

export interface OrgAssignmentInput {
  role: Role;
  districtId?: string | null;
  branchId?: string | null;
}

export interface OrgAssignmentResult {
  error: string | null;
  districtId: string | null;
  branchId: string | null;
}

/**
 * Validates and normalizes a user's role + org-unit assignment:
 *  - district-scoped roles must have a district and no branch
 *  - branch-scoped roles must have a branch (district is derived from it)
 *  - bank-wide roles (Admin, HO Controller, Executive) carry no org unit
 * Also enforces the one-active-Manager / one-active-Controller-per-branch rule.
 */
export function resolveOrgAssignment(
  db: Database,
  input: OrgAssignmentInput,
  excludeUserId?: string
): OrgAssignmentResult {
  const { role } = input;

  if (BRANCH_SCOPED_ROLES.includes(role)) {
    if (!input.branchId) return { error: "A branch must be selected for this role.", districtId: null, branchId: null };
    const branch = db.branches.find((b) => b.id === input.branchId);
    if (!branch) return { error: "Selected branch does not exist.", districtId: null, branchId: null };
    const conflict = assertBranchRoleAvailable(db, branch.id, role as "BRANCH_MANAGER" | "BRANCH_CONTROLLER", excludeUserId);
    if (conflict) return { error: conflict, districtId: null, branchId: null };
    return { error: null, districtId: branch.districtId, branchId: branch.id };
  }

  if (DISTRICT_SCOPED_ROLES.includes(role)) {
    if (!input.districtId) return { error: "A district must be selected for this role.", districtId: null, branchId: null };
    const district = db.districts.find((d) => d.id === input.districtId);
    if (!district) return { error: "Selected district does not exist.", districtId: null, branchId: null };
    return { error: null, districtId: district.id, branchId: null };
  }

  // ADMIN, HO_CONTROLLER, EXECUTIVE_READONLY are bank-wide.
  return { error: null, districtId: null, branchId: null };
}

export function findBranchManager(db: Database, branchId: string): User | undefined {
  return db.users.find((u) => u.branchId === branchId && u.role === "BRANCH_MANAGER" && u.status === "ACTIVE");
}

export function findBranchController(db: Database, branchId: string): User | undefined {
  return db.users.find((u) => u.branchId === branchId && u.role === "BRANCH_CONTROLLER" && u.status === "ACTIVE");
}

/**
 * Enforces "one active Branch Manager + one active Branch Internal
 * Controller per branch". Call before saving a user with one of those two
 * roles. `excludeUserId` should be the user's own id when editing.
 */
export function assertBranchRoleAvailable(
  db: Database,
  branchId: string,
  role: "BRANCH_MANAGER" | "BRANCH_CONTROLLER",
  excludeUserId?: string
): string | null {
  const holder = role === "BRANCH_MANAGER" ? findBranchManager(db, branchId) : findBranchController(db, branchId);
  if (holder && holder.id !== excludeUserId) {
    const roleLabel = role === "BRANCH_MANAGER" ? "Branch Manager" : "Branch Internal Controller";
    return `This branch already has an active ${roleLabel} (${holder.name}). Deactivate or reassign them first.`;
  }
  return null;
}
