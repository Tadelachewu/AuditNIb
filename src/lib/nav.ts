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
  CalendarClock,
  KeyRound,
  Settings,
  ScrollText,
  LifeBuoy,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import { permissionKey } from "@/lib/permissions/registry";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /**
   * The page's own colour (hex), used for its icon in the sidebar and on
   * the Admin Dashboard's Quick Links (globals.css .tone-tile / .quick-link),
   * so a page keeps the same colour everywhere. Chosen by meaning: home in
   * the brand's bronze, people in blue / rose, the organisation in teal,
   * green and indigo, findings and reports in blue / violet, configuration
   * in warm tones, records in stone / slate, help in pink.
   */
  color: string;
  /**
   * A "<pageCode>.<action>" permission key, or undefined for links every
   * logged-in user can see. An array is "any of" - e.g. Support Inbox
   * needs support.view OR support.respond, since respond alone would
   * otherwise leave a role with no way to reach the inbox it can act on.
   */
  permission?: string | string[];
  /**
   * Role codes this item is hidden for, regardless of permission - for
   * ADMIN specifically, /dashboard redirects straight to /admin (see
   * (app)/dashboard/page.tsx), so keeping "Dashboard" in the sidebar
   * alongside "Admin Dashboard" would just be two links to the same page.
   */
  hideForRoles?: string[];
}

export interface NavSection {
  // Optional: the first section (Dashboard/Profile/Support) is shown with
  // no heading above it - those links need no category name.
  label?: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, color: "#b45309", hideForRoles: ["ADMIN"] },
      { label: "Admin Dashboard", href: "/admin", icon: LayoutGrid, color: "#b45309", permission: permissionKey("admin-dashboard", "view") },
      { label: "My Profile", href: "/profile", icon: UserCircle, color: "#0891b2" },
      { label: "Support", href: "/support", icon: LifeBuoy, color: "#db2777", permission: permissionKey("support", "create") },
    ],
  },
  {
    label: "Findings",
    items: [
      { label: "Findings", href: "/findings", icon: FileSearch, color: "#2563eb", permission: permissionKey("findings", "view") },
      { label: "Register Finding", href: "/findings/new", icon: FilePlus2, color: "#059669", permission: permissionKey("findings", "create") },
      { label: "Import Findings", href: "/findings/import", icon: Upload, color: "#0d9488", permission: permissionKey("findings", "import") },
      { label: "Reports", href: "/reports", icon: BarChart3, color: "#7c3aed", permission: permissionKey("reports", "view") },
      { label: "Report Templates", href: "/reports/templates", icon: FileBarChart2, color: "#9333ea", permission: permissionKey("report-templates", "view") },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Users", href: "/admin/users", icon: Users, color: "#2563eb", permission: permissionKey("users", "view") },
      { label: "Districts", href: "/admin/districts", icon: Map, color: "#0d9488", permission: permissionKey("districts", "view") },
      { label: "Branches", href: "/admin/branches", icon: Building2, color: "#059669", permission: permissionKey("branches", "view") },
      { label: "Sources", href: "/admin/sources", icon: Radio, color: "#7c3aed", permission: permissionKey("sources", "view") },
      { label: "Departments", href: "/admin/departments", icon: Briefcase, color: "#4f46e5", permission: permissionKey("departments", "view") },
      {
        label: "Uncovered Branch Reasons",
        href: "/admin/uncovered-reasons",
        icon: AlertTriangle, color: "#dc2626",
        permission: permissionKey("uncovered-reasons", "view"),
      },
      { label: "Classified Categories", href: "/admin/categories", icon: Tags, color: "#ea580c", permission: permissionKey("categories", "view") },
      { label: "Scoring Rules", href: "/admin/scoring-rules", icon: Calculator, color: "#d97706", permission: permissionKey("scoring-rules", "view") },
      {
        label: "Reporting Periods",
        href: "/admin/reporting-periods",
        icon: CalendarClock, color: "#0284c7",
        permission: permissionKey("reporting-periods", "view"),
      },
      { label: "Roles & Permissions", href: "/admin/roles", icon: KeyRound, color: "#e11d48", permission: permissionKey("roles", "view") },
      { label: "Settings", href: "/admin/settings", icon: Settings, color: "#475569", permission: permissionKey("settings", "view") },
      { label: "Audit Log", href: "/admin/audit-log", icon: ScrollText, color: "#78716c", permission: permissionKey("audit-log", "view") },
      {
        label: "Support Inbox",
        href: "/admin/support",
        icon: Inbox, color: "#db2777",
        permission: [permissionKey("support", "view"), permissionKey("support", "respond")],
      },
    ],
  },
];

export function isNavItemVisible(item: NavItem, permissions: string[], role: string): boolean {
  if (item.hideForRoles?.includes(role)) return false;
  if (!item.permission) return true;
  const required = Array.isArray(item.permission) ? item.permission : [item.permission];
  return required.some((key) => permissions.includes(key));
}
