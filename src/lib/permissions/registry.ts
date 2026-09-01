// The permission *catalog*: every page in the app - the Administration
// console AND every role dashboard - and the actions each page supports.
// This list is static (it corresponds to real routes/components that exist
// in code - you can't grant a permission for a page that doesn't exist),
// but which *roles* hold which permissions is fully dynamic, stored on
// RoleDefinition.permissions and editable at /admin/roles. See PHASE2.md
// for the full design.
//
// Standing rule (see PHASE5.md): every dashboard or feature added to this
// app gets a PAGE_REGISTRY entry with at least a "view" action, gated by
// requirePermission()/hasPermission() at its actual enforcement point
// (an API route, src/proxy.ts, or an inline check like
// src/app/(app)/dashboard/page.tsx's). Nothing should be reachable by role
// alone once it has a registry entry - only by permission.

export type PermissionAction =
  | "view"
  | "create"
  | "edit"
  | "toggle-status"
  | "delete"
  | "activate"
  | "lock"
  | "manage"
  | "submit"
  | "district-review"
  | "ho-review"
  | "rectify"
  | "verify-rectification"
  | "return-rectification"
  | "close"
  | "transfer"
  | "evidence"
  | "comment"
  | "import";

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
const D: PageAction = { action: "delete", label: "Delete" };

// Users never gets a "delete" action, by BRD design (section 3.1 lists only
// create/edit/deactivate/reactivate) and for audit-integrity reasons - see
// PHASE1.md/PHASE2.md. Districts/Branches/Sources/Categories/Roles are pure
// reference/config data, so a real delete is legitimate admin cleanup - each
// DELETE route still blocks the operation with a 409 if the record is
// referenced elsewhere (see the corresponding [id]/route.ts files).
export const PAGE_REGISTRY: PageDefinition[] = [
  { code: "admin-dashboard", label: "Admin Dashboard", actions: [V] },
  { code: "branch-dashboard", label: "Branch Dashboard", actions: [V] },
  {
    code: "findings",
    label: "Findings",
    // "delete" only ever applies while a finding is still DRAFT (see
    // src/app/api/findings/[id]/route.ts) - matching Users/edit-while-
    // draft-or-returned's rule that the action set here is the ceiling,
    // not a guarantee the action always succeeds.
    actions: [
      V,
      C,
      E,
      D,
      { action: "submit", label: "Submit" },
      { action: "district-review", label: "District Approve / Reject / Return" },
      { action: "ho-review", label: "HO Approve / Reject / Return" },
      { action: "rectify", label: "Record Rectification" },
      // The District Controller's gate on a recorded rectification, before
      // it's closable by anyone (including HO) - approve it as correct.
      // Distinct from "close" itself, which is the (now downstream) final
      // verification/closure action.
      { action: "verify-rectification", label: "Verify Rectification" },
      // Send a recorded rectification back to the Branch Manager for
      // correction - split out from "verify-rectification" so a role can
      // hold one without the other (e.g. a reviewer who can only approve,
      // never bounce work back, or vice versa).
      { action: "return-rectification", label: "Return Rectification for Correction" },
      { action: "close", label: "Close (Verify)" },
      { action: "transfer", label: "Transfer to Next Period" },
      { action: "evidence", label: "Upload Evidence" },
      { action: "comment", label: "Comment" },
      { action: "import", label: "Bulk Import (Excel)" },
    ],
  },
  { code: "reports", label: "Reports", actions: [V] },
  { code: "district-dashboard", label: "District Dashboard", actions: [V] },
  { code: "ho-dashboard", label: "HO Dashboard", actions: [V] },
  { code: "executive-dashboard", label: "Executive Dashboard", actions: [V] },
  { code: "users", label: "Users", actions: [V, C, E, T] },
  { code: "districts", label: "Districts", actions: [V, C, E, T, D] },
  { code: "branches", label: "Branches", actions: [V, C, E, T, D] },
  { code: "sources", label: "Sources", actions: [V, C, E, T, D] },
  { code: "departments", label: "Departments", actions: [V, C, E, T, D] },
  { code: "categories", label: "Classified Categories", actions: [V, C, E, T, D] },
  {
    code: "scoring-rules",
    label: "Scoring Rules",
    // Edit/delete only ever apply to a version that has never gone live
    // (ScoringRule.everActivated) - enforced in
    // src/app/api/admin/scoring-rules/[id]/route.ts, not just here.
    actions: [V, C, E, D, { action: "activate", label: "Activate / Deactivate" }],
  },
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

/**
 * For pages under /admin/<code>, the URL segment is identical to the page
 * code by convention (see src/proxy.ts). Non-admin pages that host more
 * than one role's view behind one route (e.g. /dashboard) aren't proxy-
 * gated this way - they check hasPermission() inline instead (see
 * src/app/(app)/dashboard/page.tsx).
 */
export function isValidPermissionKey(key: string): boolean {
  const [pageCode, action] = key.split(".");
  const page = PAGE_REGISTRY.find((p) => p.code === pageCode);
  return Boolean(page?.actions.some((a) => a.action === action));
}
