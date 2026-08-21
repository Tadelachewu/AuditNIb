import type { Role } from "@/types";

export interface NavItem {
  label: string;
  href: string;
  roles: Role[] | "all";
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", href: "/dashboard", roles: "all" }],
  },
  {
    label: "Administration",
    items: [
      { label: "Admin Dashboard", href: "/admin", roles: ["ADMIN"] },
      { label: "Users", href: "/admin/users", roles: ["ADMIN"] },
      { label: "Districts", href: "/admin/districts", roles: ["ADMIN"] },
      { label: "Branches", href: "/admin/branches", roles: ["ADMIN"] },
      { label: "Sources", href: "/admin/sources", roles: ["ADMIN"] },
      { label: "Classified Categories", href: "/admin/categories", roles: ["ADMIN"] },
      { label: "Scoring Rules", href: "/admin/scoring-rules", roles: ["ADMIN"] },
      { label: "Scoring Adjustments", href: "/admin/scoring-adjustments", roles: ["ADMIN"] },
      { label: "Reporting Periods", href: "/admin/reporting-periods", roles: ["ADMIN"] },
      { label: "Settings", href: "/admin/settings", roles: ["ADMIN"] },
      { label: "Audit Log", href: "/admin/audit-log", roles: ["ADMIN"] },
    ],
  },
];

export function isNavItemVisible(item: NavItem, role: Role): boolean {
  return item.roles === "all" || item.roles.includes(role);
}
