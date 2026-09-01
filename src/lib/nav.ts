import { permissionKey } from "@/lib/permissions/registry";

export interface NavItem {
  label: string;
  href: string;
  /** A "<pageCode>.view" permission key, or undefined for links every logged-in user can see. */
  permission?: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "My Profile", href: "/profile" },
    ],
  },
  {
    label: "Findings",
    items: [
      { label: "Findings", href: "/findings", permission: permissionKey("findings", "view") },
      { label: "Register Finding", href: "/findings/new", permission: permissionKey("findings", "create") },
      { label: "Import Findings", href: "/findings/import", permission: permissionKey("findings", "import") },
      { label: "Reports", href: "/reports", permission: permissionKey("reports", "view") },
      { label: "Report Templates", href: "/reports/templates", permission: permissionKey("report-templates", "view") },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Admin Dashboard", href: "/admin", permission: permissionKey("admin-dashboard", "view") },
      { label: "Users", href: "/admin/users", permission: permissionKey("users", "view") },
      { label: "Districts", href: "/admin/districts", permission: permissionKey("districts", "view") },
      { label: "Branches", href: "/admin/branches", permission: permissionKey("branches", "view") },
      { label: "Sources", href: "/admin/sources", permission: permissionKey("sources", "view") },
      { label: "Departments", href: "/admin/departments", permission: permissionKey("departments", "view") },
      {
        label: "Uncovered Branch Reasons",
        href: "/admin/uncovered-reasons",
        permission: permissionKey("uncovered-reasons", "view"),
      },
      { label: "Classified Categories", href: "/admin/categories", permission: permissionKey("categories", "view") },
      { label: "Scoring Rules", href: "/admin/scoring-rules", permission: permissionKey("scoring-rules", "view") },
      {
        label: "Scoring Adjustments",
        href: "/admin/scoring-adjustments",
        permission: permissionKey("scoring-adjustments", "view"),
      },
      {
        label: "Reporting Periods",
        href: "/admin/reporting-periods",
        permission: permissionKey("reporting-periods", "view"),
      },
      { label: "Roles & Permissions", href: "/admin/roles", permission: permissionKey("roles", "view") },
      { label: "Settings", href: "/admin/settings", permission: permissionKey("settings", "view") },
      { label: "Audit Log", href: "/admin/audit-log", permission: permissionKey("audit-log", "view") },
    ],
  },
];

export function isNavItemVisible(item: NavItem, permissions: string[]): boolean {
  return !item.permission || permissions.includes(item.permission);
}
