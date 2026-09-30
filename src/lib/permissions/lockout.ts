import { permissionKey } from "@/lib/permissions/registry";
import type { Database, RoleDefinition, User } from "@/types";

/**
 * Permissions that must always stay with at least one active user, or
 * nobody could ever undo a deactivation from inside the app:
 *   - Users › Activate / Deactivate: re-enables a deactivated user
 *   - Roles & Permissions › Manage:   re-enables a role / restores permissions
 * Permission-based, not tied to the Administrator role name - whichever
 * roles hold these, the last active holder is protected.
 */
export const KEEPER_PERMISSIONS = [
  { key: permissionKey("users", "toggle-status"), label: "Users › Activate / Deactivate" },
  { key: permissionKey("roles", "manage"), label: "Roles & Permissions › Manage" },
] as const;

/** Active users (with an active role) that hold `key`. */
export function activeHolders(users: User[], roles: RoleDefinition[], key: string): User[] {
  const holding = new Set(roles.filter((r) => r.status === "ACTIVE" && r.permissions.includes(key)).map((r) => r.code));
  return users.filter((u) => u.status === "ACTIVE" && holding.has(u.role));
}

/**
 * Checks a proposed change - the users and roles lists as they would be
 * after it - and returns an error if it leaves a keeper permission with no
 * active holder that has it today. Null when the change is safe.
 */
export function lockoutError(db: Database, next: { users?: User[]; roles?: RoleDefinition[] }): string | null {
  const users = next.users ?? db.users;
  const roles = next.roles ?? db.roles;
  for (const p of KEEPER_PERMISSIONS) {
    const before = activeHolders(db.users, db.roles, p.key).length;
    const after = activeHolders(users, roles, p.key).length;
    if (before > 0 && after === 0) {
      return `Not allowed: nobody active would be left with "${p.label}", so this could never be undone from the app. Give that permission to another active user first.`;
    }
  }
  return null;
}
