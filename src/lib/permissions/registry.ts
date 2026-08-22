// The permission *catalog*: every page the Administration console has, and
// the actions each page supports. This list is static (it corresponds to
// real routes/API handlers that exist in code - you can't grant a
// permission for a page that doesn't exist), but which *roles* hold which
// permissions is fully dynamic, stored on RoleDefinition.permissions and
// editable at /admin/roles. See PHASE2.md for the full design.

export type PermissionAction = "view" | "create" | "edit" | "toggle-status" | "activate" | "lock" | "manage";

export interface PageAction {
  action: PermissionAction;
  label: string;
}

export interface PageDefinition {
  code: string;
  label: string;
  actions: PageAction[];
}

const V: PageAction = { action: "view", label: "View" };
const C: PageAction = { action: "create", label: "Create" };
const E: PageAction = { action: "edit", label: "Edit" };
const T: PageAction = { action: "toggle-status", label: "Activate / Deactivate" };

export const PAGE_REGISTRY: PageDefinition[] = [
  { code: "admin-dashboard", label: "Admin Dashboard", actions: [V] },
  { code: "users", label: "Users", actions: [V, C, E, T] },
  { code: "districts", label: "Districts", actions: [V, C, E, T] },
  { code: "branches", label: "Branches", actions: [V, C, E, T] },
  { code: "sources", label: "Sources", actions: [V, C, E, T] },
  { code: "categories", label: "Classified Categories", actions: [V, C, E, T] },
  { code: "scoring-rules", label: "Scoring Rules", actions: [V, C, { action: "activate", label: "Activate / Deactivate" }] },
  { code: "scoring-adjustments", label: "Scoring Adjustments", actions: [V, C] },
  { code: "reporting-periods", label: "Reporting Periods", actions: [V, C, { action: "lock", label: "Lock / Unlock" }] },
  { code: "settings", label: "Settings", actions: [V, E] },
  { code: "audit-log", label: "Audit Log", actions: [V] },
  { code: "roles", label: "Roles & Permissions", actions: [V, { action: "manage", label: "Manage" }] },
];

export function permissionKey(pageCode: string, action: PermissionAction | string): string {
  return `${pageCode}.${action}`;
}

export function hasPermission(permissions: string[] | undefined, key: string): boolean {
  return Boolean(permissions?.includes(key));
}

export function hasAnyPermission(permissions: string[] | undefined, keys: string[]): boolean {
  return keys.some((key) => hasPermission(permissions, key));
}

export const ALL_PERMISSION_KEYS: string[] = PAGE_REGISTRY.flatMap((page) =>
  page.actions.map((a) => permissionKey(page.code, a.action))
);

/** All ".view" keys except the Roles module - a sensible non-empty default for a read-only role. */
export const ALL_VIEW_PERMISSION_KEYS: string[] = PAGE_REGISTRY.filter((p) => p.code !== "roles").map((p) =>
  permissionKey(p.code, "view")
);

export function pageLabel(pageCode: string): string {
  return PAGE_REGISTRY.find((p) => p.code === pageCode)?.label ?? pageCode;
}

/** The admin-page URL segment for a given page code is identical by convention (see src/proxy.ts). */
export function isValidPermissionKey(key: string): boolean {
  const [pageCode, action] = key.split(".");
  const page = PAGE_REGISTRY.find((p) => p.code === pageCode);
  return Boolean(page?.actions.some((a) => a.action === action));
}
