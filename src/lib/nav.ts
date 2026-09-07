import {
  LayoutDashboard,
  UserCircle,
  FileSearch,
  FilePlus2,
  Upload,
  BarChart3,
  FileBarChart2,
  LayoutGrid,
  Users,
  Map,
  Building2,
  Radio,
  Briefcase,
  AlertTriangle,
  Tags,
  Calculator,
  SlidersHorizontal,
  CalendarClock,
  KeyRound,
  Settings,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import { permissionKey } from "@/lib/permissions/registry";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** A "<pageCode>.view" permission key, or undefined for links every logged-in user can see. */
  permission?: string;
  /**
   * Role codes this item is hidden for, regardless of permission - for
   * ADMIN specifically, /dashboard redirects straight to /admin (see
   * (app)/dashboard/page.tsx), so keeping "Dashboard" in the sidebar
   * alongside "Admin Dashboard" would just be two links to the same page.
   */
  hideForRoles?: string[];
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, hideForRoles: ["ADMIN"] },
      { label: "Admin Dashboard", href: "/admin", icon: LayoutGrid, permission: permissionKey("admin-dashboard", "view") },
      { label: "My Profile", href: "/profile", icon: UserCircle },
    ],
  },
  {
    label: "Findings",
    items: [
      { label: "Findings", href: "/findings", icon: FileSearch, permission: permissionKey("findings", "view") },
      { label: "Register Finding", href: "/findings/new", icon: FilePlus2, permission: permissionKey("findings", "create") },
      { label: "Import Findings", href: "/findings/import", icon: Upload, permission: permissionKey("findings", "import") },
      { label: "Reports", href: "/reports", icon: BarChart3, permission: permissionKey("reports", "view") },
      { label: "Report Templates", href: "/reports/templates", icon: FileBarChart2, permission: permissionKey("report-templates", "view") },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Users", href: "/admin/users", icon: Users, permission: permissionKey("users", "view") },
      { label: "Districts", href: "/admin/districts", icon: Map, permission: permissionKey("districts", "view") },
      { label: "Branches", href: "/admin/branches", icon: Building2, permission: permissionKey("branches", "view") },
      { label: "Sources", href: "/admin/sources", icon: Radio, permission: permissionKey("sources", "view") },
      { label: "Departments", href: "/admin/departments", icon: Briefcase, permission: permissionKey("departments", "view") },
      {
        label: "Uncovered Branch Reasons",
        href: "/admin/uncovered-reasons",
        icon: AlertTriangle,
        permission: permissionKey("uncovered-reasons", "view"),
      },
      { label: "Classified Categories", href: "/admin/categories", icon: Tags, permission: permissionKey("categories", "view") },
      { label: "Scoring Rules", href: "/admin/scoring-rules", icon: Calculator, permission: permissionKey("scoring-rules", "view") },
      {
        label: "Scoring Adjustments",
        href: "/admin/scoring-adjustments",
        icon: SlidersHorizontal,
        permission: permissionKey("scoring-adjustments", "view"),
      },
      {
        label: "Reporting Periods",
        href: "/admin/reporting-periods",
        icon: CalendarClock,
        permission: permissionKey("reporting-periods", "view"),
      },
      { label: "Roles & Permissions", href: "/admin/roles", icon: KeyRound, permission: permissionKey("roles", "view") },
      { label: "Settings", href: "/admin/settings", icon: Settings, permission: permissionKey("settings", "view") },
      { label: "Audit Log", href: "/admin/audit-log", icon: ScrollText, permission: permissionKey("audit-log", "view") },
    ],
  },
];

export function isNavItemVisible(item: NavItem, permissions: string[], role: string): boolean {
  if (item.hideForRoles?.includes(role)) return false;
  return !item.permission || permissions.includes(item.permission);
}
