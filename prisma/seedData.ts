// Default seed content for a brand-new install: the same starting data set
// this app has always bootstrapped with (originally built inline in
// src/lib/db.ts, back when "the database" was a JSON file created on first
// run - see git history for that version). Ported here unchanged, as its own
// module, once db.ts became a pure Prisma read/write layer with nothing left
// to bootstrap a missing file for.
import { hashPassword } from "../src/lib/auth";
import { ALL_PERMISSION_KEYS, ALL_VIEW_PERMISSION_KEYS, permissionKey } from "../src/lib/permissions/registry";
import type {
  Database,
  User,
  RoleDefinition,
  District,
  Branch,
  Source,
  Department,
  UncoveredReason,
  ClassifiedCategory,
  ScoringRule,
  ReportingPeriod,
  Settings,
} from "../src/types";

// The 10 named report templates (src/lib/reportTemplates.ts) are every bit
// HO/District-level oversight reading as the existing Reports page - every
// one of them ranks or compares *across* districts - so they go to exactly
// the roles that already get reports.view by default (HO Controller,
// District Controller, District Director, Executive).
const reportTemplatePermissions = [
  permissionKey("report-templates", "view"),
  permissionKey("report-templates", "uncovered-branches"),
  permissionKey("report-templates", "category-detail-by-district"),
  permissionKey("report-templates", "monthly-summary"),
  permissionKey("report-templates", "monthly-district-history"),
  permissionKey("report-templates", "monthly-district-detail"),
  permissionKey("report-templates", "district-ranking-other-cases"),
  permissionKey("report-templates", "weekly-executive-summary"),
  permissionKey("report-templates", "district-ranking-all-cases"),
  permissionKey("report-templates", "category-performance-summary"),
  permissionKey("report-templates", "mid-month-district-snapshot"),
  permissionKey("report-templates", "transferred-findings"),
];

// Default canned reasons for the Uncovered Branches report.
const defaultUncoveredReasons: Omit<UncoveredReason, "createdAt" | "updatedAt">[] = [
  { id: "uncov-reason-1", code: "NOT_DISPATCHED", name: "Audit Not Yet Dispatched", active: true },
  { id: "uncov-reason-2", code: "BRANCH_CLOSED", name: "Branch Temporarily Closed", active: true },
  { id: "uncov-reason-3", code: "NEWLY_OPENED", name: "Newly Opened Branch", active: true },
  { id: "uncov-reason-4", code: "NO_IRREGULARITY", name: "No Irregularities Identified", active: true },
  { id: "uncov-reason-5", code: "DOCS_PENDING", name: "Awaiting Documentation from Branch", active: true },
  { id: "uncov-reason-6", code: "STAFF_SHORTAGE", name: "Controller/Auditor Shortage", active: true },
];

function nowIso(): string {
  return new Date().toISOString();
}

export function buildSeedDatabase(): Database {
  const now = nowIso();

  const districts: District[] = [
    { id: "district-1", code: "D01", name: "Addis Ababa District", status: "ACTIVE", createdAt: now, updatedAt: now },
    { id: "district-2", code: "D02", name: "Adama District", status: "ACTIVE", createdAt: now, updatedAt: now },
    { id: "district-3", code: "D03", name: "Mekelle District", status: "ACTIVE", createdAt: now, updatedAt: now },
  ];

  const branches: Branch[] = [
    { id: "branch-1", code: "B001", name: "Bole Branch", districtId: "district-1", status: "ACTIVE", createdAt: now, updatedAt: now },
    { id: "branch-2", code: "B002", name: "Piassa Branch", districtId: "district-1", status: "ACTIVE", createdAt: now, updatedAt: now },
    { id: "branch-3", code: "B003", name: "Adama Main Branch", districtId: "district-2", status: "ACTIVE", createdAt: now, updatedAt: now },
    // A second branch in district-2, so District Ranking's "branches are
    // dynamic per district" claim has more than one district actually
    // demonstrating it (district-3 stays at zero branches on purpose -
    // that's its own useful edge case, an org unit with nothing under it yet).
    { id: "branch-4", code: "B004", name: "Adama Kality Branch", districtId: "district-2", status: "ACTIVE", createdAt: now, updatedAt: now },
  ];

  const sources: Source[] = [
    { id: "source-1", code: "IC", name: "Internal Control", active: true, createdAt: now, updatedAt: now },
    { id: "source-2", code: "IA", name: "Internal Audit", active: true, createdAt: now, updatedAt: now },
  ];

  // Not from the BRD - a starting list an admin can extend at
  // /admin/departments, mirroring Source's shape/lifecycle plus the same
  // OrgScope pattern as User/RoleDefinition: most departments here are
  // BANK-wide (available on any finding), with one DISTRICT and one
  // BRANCH example seeded to demonstrate the narrower scopes.
  const departments: Department[] = [
    { id: "dept-1", code: "OPS", name: "Operations", active: true, orgScope: "BANK", districtId: null, branchId: null, createdAt: now, updatedAt: now },
    { id: "dept-2", code: "CREDIT", name: "Credit", active: true, orgScope: "BANK", districtId: null, branchId: null, createdAt: now, updatedAt: now },
    { id: "dept-3", code: "FINANCE", name: "Finance", active: true, orgScope: "BANK", districtId: null, branchId: null, createdAt: now, updatedAt: now },
    { id: "dept-4", code: "IT", name: "Information Technology", active: true, orgScope: "BANK", districtId: null, branchId: null, createdAt: now, updatedAt: now },
    { id: "dept-5", code: "HR", name: "Human Resources", active: true, orgScope: "BANK", districtId: null, branchId: null, createdAt: now, updatedAt: now },
    { id: "dept-6", code: "LEGAL", name: "Legal & Compliance", active: true, orgScope: "BANK", districtId: null, branchId: null, createdAt: now, updatedAt: now },
    { id: "dept-7", code: "RISK", name: "Risk Management", active: true, orgScope: "BANK", districtId: null, branchId: null, createdAt: now, updatedAt: now },
    { id: "dept-8", code: "TREASURY", name: "Treasury", active: true, orgScope: "BANK", districtId: null, branchId: null, createdAt: now, updatedAt: now },
    { id: "dept-9", code: "CUSTOMER_SERVICE", name: "Customer Service", active: true, orgScope: "DISTRICT", districtId: "district-1", branchId: null, createdAt: now, updatedAt: now },
    { id: "dept-10", code: "INTERNAL_AUDIT", name: "Internal Audit", active: true, orgScope: "BRANCH", districtId: "district-1", branchId: "branch-1", createdAt: now, updatedAt: now },
  ];

  const uncoveredReasons: UncoveredReason[] = defaultUncoveredReasons.map((r) => ({ ...r, createdAt: now, updatedAt: now }));

  // Names match master.txt §25's reference list exactly ("ATM Mismatch;
  // ATM Long Outstanding; IT Case; Dormant Account; Zero Balance; CK Book;
  // Other Case").
  const categories: ClassifiedCategory[] = [
    { id: "cat-1", code: "ATM_MISMATCH", name: "ATM Mismatch", scored: false, active: true, createdAt: now, updatedAt: now },
    { id: "cat-2", code: "ATM_LONG_OS", name: "ATM Long Outstanding", scored: false, active: true, createdAt: now, updatedAt: now },
    { id: "cat-3", code: "IT", name: "IT Case", scored: false, active: true, createdAt: now, updatedAt: now },
    { id: "cat-4", code: "DORMANT", name: "Dormant Account", scored: false, active: true, createdAt: now, updatedAt: now },
    { id: "cat-5", code: "ZERO_BALANCE", name: "Zero Balance", scored: false, active: true, createdAt: now, updatedAt: now },
    { id: "cat-6", code: "CK_BOOK", name: "CK Book", scored: false, active: true, createdAt: now, updatedAt: now },
    { id: "cat-7", code: "OTHER_CASE", name: "Other Case", scored: true, active: true, createdAt: now, updatedAt: now },
  ];

  const scoringRules: ScoringRule[] = [
    {
      id: "scoring-rule-1",
      version: 1,
      name: "Other Case Performance v1",
      active: true,
      everActivated: true,
      effectiveFrom: now,
      categories: ["cat-7"],
      sources: ["source-1", "source-2"],
      basis: "Rectified eligible Other Cases ÷ Total eligible Other Cases × 100",
      formulaType: "PERCENTAGE",
      createdBy: "user-admin",
      createdAt: now,
    },
  ];

  const today = new Date();
  const seedPeriodStart = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0);
  const seedPeriodEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59);
  // A prior, already-LOCKED period behind the current OPEN one - without
  // one, there's nowhere for a genuine Transfer Engine example to move a
  // finding *from* (transferFinding() moves periodId forward into an
  // OPEN destination), and Monthly Trend/period-over-period "Highest
  // Improvement" have only a single point to draw with just one period.
  const prevPeriodDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const prevPeriodStart = new Date(prevPeriodDate.getFullYear(), prevPeriodDate.getMonth(), 1, 0, 0);
  const prevPeriodEnd = new Date(prevPeriodDate.getFullYear(), prevPeriodDate.getMonth() + 1, 0, 23, 59);
  const reportingPeriods: ReportingPeriod[] = [
    {
      id: "period-0",
      year: prevPeriodDate.getFullYear(),
      month: prevPeriodDate.getMonth() + 1,
      code: `${prevPeriodDate.getFullYear()}-${String(prevPeriodDate.getMonth() + 1).padStart(2, "0")}`,
      startsAt: prevPeriodStart.toISOString(),
      endsAt: prevPeriodEnd.toISOString(),
      // Matches the full period range at seed time - see the type's own
      // doc comment for what narrowing this later means.
      submissionStartsAt: prevPeriodStart.toISOString(),
      submissionEndsAt: prevPeriodEnd.toISOString(),
      status: "LOCKED",
      lockedBy: "user-admin",
      lockedAt: seedPeriodStart.toISOString(),
      lockReason: "Prior period closed at seed time.",
      draftsAllowedWhileLocked: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "period-1",
      year: today.getFullYear(),
      month: today.getMonth() + 1,
      code: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`,
      startsAt: seedPeriodStart.toISOString(),
      endsAt: seedPeriodEnd.toISOString(),
      submissionStartsAt: seedPeriodStart.toISOString(),
      submissionEndsAt: seedPeriodEnd.toISOString(),
      status: "OPEN",
      lockedBy: null,
      lockedAt: null,
      lockReason: null,
      draftsAllowedWhileLocked: true,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const settings: Settings = {
    // master.txt §25: "ETB; USD; EUR; GBP initially; configurable."
    currencies: ["ETB", "USD", "EUR", "GBP"],
    riskLevels: ["Low", "Medium", "High", "Critical"],
    // Sample areas an admin can edit at /admin/settings - not from the BRD,
    // a reasonable starting list of real bank operational areas.
    operationAreas: [
      "Teller Counter",
      "Vault",
      "ATM Operations",
      "Loan Processing",
      "Account Opening",
      "Fund Transfer",
      "Clearing House",
      "Reconciliation",
      "Cybersecurity",
      "Branch Security",
    ],
    priorityLevels: ["Low", "Medium", "High", "Urgent"],
    irregularityTypes: [
      "Cash Shortage",
      "Cash Excess",
      "Unauthorized Transaction",
      "Fraud",
      "Forgery",
      "System Error",
      "Policy Violation",
      "Documentation Deficiency",
      "Reconciliation Discrepancy",
      "Access Control Violation",
    ],
    notification: { provider: "NONE", fromAddress: "" },
    autoTransferOnLock: false,
    rankingVisibility: { branches: true, districts: true },
    performanceThresholds: { topPercent: 80, bottomPercent: 50 },
    // Left off by default (see the field's own doc comment), but with a
    // real approver already assigned - so the one seeded
    // PENDING_BANK_APPROVAL example finding below has someone who can
    // actually action it the moment an admin turns `required` on, rather
    // than an empty approver list nobody could ever use.
    hoApproval: { required: false, approverUserIds: ["user-ho-controller"] },
    rectificationReminders: { enabled: false, thresholdDays: 7 },
    // The exact fields the duplicate-suggestion lookup always compared on
    // before this became configurable - kept as the default so turning the
    // feature into a setting doesn't silently change any existing
    // install's behavior.
    similarFindingFields: ["branchId", "categoryId", "operationArea", "irregularityType", "periodId"],
    // Matches exactly what was hard-required before this became
    // configurable (everything except recommendation/rootCause/
    // evidenceNote) - so turning this into a setting doesn't silently
    // change behavior.
    requiredFindingFields: {
      title: true,
      sourceId: true,
      departmentId: true,
      findingDate: true,
      operationArea: true,
      irregularityType: true,
      categoryId: true,
      currency: true,
      riskLevel: true,
      priority: true,
      description: true,
      recommendation: false,
      rootCause: false,
      evidenceNote: false,
    },
    // "Other (type in)" allowed on every list-driven dropdown by default -
    // matches today's behavior, so turning this into a setting doesn't
    // silently lock any field down. categoryId defaults on too, even
    // though its "Other" is a brand-new capability rather than pre-existing
    // behavior being preserved - an admin who wants registration blocked on
    // an incomplete category list instead can turn it off from /admin/settings.
    allowOtherValueFields: {
      operationArea: true,
      irregularityType: true,
      priority: true,
      riskLevel: true,
      currency: true,
      categoryId: true,
    },
    updatedAt: now,
  };

  // Roles are data (Phase 2) - this is the seed, not a hard-coded enum. Every
  // seeded role gets a non-empty, BRD-grounded default permission set (see
  // PHASE5.md) so an admin starts from "this is what the role should
  // plausibly have" and adjusts from there via /admin/roles, rather than
  // building every role's access from zero. ADMIN always gets every
  // permission (isSystem protects it from being edited away, see
  // src/app/api/admin/roles/[id]/route.ts).
  const hoPermissions = [
    permissionKey("admin-dashboard", "view"),
    permissionKey("users", "view"),
    permissionKey("districts", "view"),
    permissionKey("branches", "view"),
    permissionKey("sources", "view"),
    permissionKey("departments", "view"),
    permissionKey("categories", "view"),
    permissionKey("scoring-rules", "view"),
    permissionKey("scoring-adjustments", "view"),
    permissionKey("reporting-periods", "view"),
    permissionKey("reporting-periods", "lock"),
    permissionKey("settings", "view"),
    permissionKey("audit-log", "view"),
    permissionKey("findings", "view"),
    permissionKey("findings", "create"),
    permissionKey("findings", "edit"),
    permissionKey("findings", "delete"),
    permissionKey("findings", "submit"),
    permissionKey("findings", "ho-review"),
    permissionKey("findings", "bank-approval"),
    permissionKey("findings", "close"),
    permissionKey("findings", "ho-return-rectification"),
    permissionKey("findings", "comment"),
    permissionKey("findings", "import"),
    permissionKey("reports", "view"),
    ...reportTemplatePermissions,
    permissionKey("ho-dashboard", "view"),
  ];
  const districtControllerPermissions = [
    permissionKey("districts", "view"),
    permissionKey("branches", "view"),
    permissionKey("sources", "view"),
    permissionKey("departments", "view"),
    permissionKey("categories", "view"),
    permissionKey("scoring-rules", "view"),
    permissionKey("scoring-adjustments", "view"),
    permissionKey("reporting-periods", "view"),
    permissionKey("reporting-periods", "lock"),
    permissionKey("findings", "view"),
    permissionKey("findings", "district-review"),
    permissionKey("findings", "verify-rectification"),
    permissionKey("findings", "district-return-rectification"),
    permissionKey("findings", "close"),
    permissionKey("findings", "transfer"),
    permissionKey("findings", "comment"),
    permissionKey("reports", "view"),
    ...reportTemplatePermissions,
    permissionKey("district-dashboard", "view"),
  ];
  const districtDirectorPermissions = [
    permissionKey("districts", "view"),
    permissionKey("branches", "view"),
    permissionKey("sources", "view"),
    permissionKey("departments", "view"),
    permissionKey("categories", "view"),
    permissionKey("scoring-rules", "view"),
    permissionKey("scoring-adjustments", "view"),
    permissionKey("reporting-periods", "view"),
    permissionKey("findings", "view"),
    permissionKey("findings", "comment"),
    permissionKey("reports", "view"),
    ...reportTemplatePermissions,
    permissionKey("district-dashboard", "view"),
  ];
  const branchControllerPermissions = [
    permissionKey("branch-dashboard", "view"),
    permissionKey("sources", "view"),
    permissionKey("departments", "view"),
    permissionKey("categories", "view"),
    permissionKey("reporting-periods", "view"),
    permissionKey("findings", "view"),
    permissionKey("findings", "create"),
    permissionKey("findings", "edit"),
    permissionKey("findings", "delete"),
    permissionKey("findings", "submit"),
    permissionKey("findings", "rectify"),
    permissionKey("findings", "evidence"),
    permissionKey("findings", "comment"),
  ];
  const branchManagerPermissions = [
    permissionKey("branch-dashboard", "view"),
    permissionKey("categories", "view"),
    permissionKey("reporting-periods", "view"),
    permissionKey("findings", "view"),
    permissionKey("findings", "rectify"),
    permissionKey("findings", "evidence"),
    permissionKey("findings", "comment"),
  ];

  const roles: RoleDefinition[] = [
    {
      id: "role-admin",
      code: "ADMIN",
      name: "Administrator",
      description: "Full bank-wide access to every module, including Roles & Permissions.",
      orgScope: "BANK",
      branchSingleton: false,
      isSystem: true,
      permissions: ALL_PERMISSION_KEYS,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "role-ho-controller",
      code: "HO_CONTROLLER",
      name: "Head Office Internal Controller",
      description: "Second approval/review, Internal Audit entry, bank-wide reporting.",
      orgScope: "BANK",
      branchSingleton: false,
      isSystem: true,
      permissions: hoPermissions,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "role-district-controller",
      code: "DISTRICT_CONTROLLER",
      name: "District Internal Controller",
      description: "Review/approve/reject/return, district reporting-period control.",
      orgScope: "DISTRICT",
      branchSingleton: false,
      isSystem: true,
      permissions: districtControllerPermissions,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "role-district-director",
      code: "DISTRICT_DIRECTOR",
      name: "District Director",
      description: "District oversight, performance and reporting; cannot modify findings or scores.",
      orgScope: "DISTRICT",
      branchSingleton: false,
      isSystem: true,
      permissions: districtDirectorPermissions,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "role-branch-controller",
      code: "BRANCH_CONTROLLER",
      name: "Branch Internal Controller",
      description: "Register/submit findings, verify rectifications for one branch.",
      orgScope: "BRANCH",
      branchSingleton: true,
      isSystem: true,
      permissions: branchControllerPermissions,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "role-branch-manager",
      code: "BRANCH_MANAGER",
      name: "Branch Manager",
      description: "Record corrective actions and rectification progress for one branch.",
      orgScope: "BRANCH",
      branchSingleton: true,
      isSystem: true,
      permissions: branchManagerPermissions,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "role-branch-sub-manager",
      code: "BRANCH_SUB_MANAGER",
      name: "Branch Sub-Manager",
      description: "Deputy for the Branch Manager - identical responsibilities for one branch.",
      orgScope: "BRANCH",
      branchSingleton: true,
      isSystem: false,
      permissions: branchManagerPermissions,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "role-executive",
      code: "EXECUTIVE_READONLY",
      name: "Executive (Read-only)",
      description: "Read-only oversight dashboards and reports across the bank.",
      orgScope: "BANK",
      branchSingleton: false,
      isSystem: true,
      permissions: [...new Set([...ALL_VIEW_PERMISSION_KEYS, ...reportTemplatePermissions])],
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    },
  ];

  const users: User[] = [
    {
      id: "user-admin",
      name: "System Administrator",
      username: "admin",
      email: "admin@nib-control360.local",
      passwordHash: hashPassword("Admin@123"),
      role: "ADMIN",
      status: "ACTIVE",
      districtId: null,
      branchId: null,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
      sessionVersion: 1,
    },
    {
      id: "user-ho-controller",
      name: "Selam Tesfaye",
      username: "ho.controller",
      email: "selam.tesfaye@nib-control360.local",
      passwordHash: hashPassword("Ho@12345"),
      role: "HO_CONTROLLER",
      status: "ACTIVE",
      districtId: null,
      branchId: null,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
      sessionVersion: 1,
    },
    {
      id: "user-district-controller",
      name: "Dawit Bekele",
      username: "district.controller",
      email: "dawit.bekele@nib-control360.local",
      passwordHash: hashPassword("District@123"),
      role: "DISTRICT_CONTROLLER",
      status: "ACTIVE",
      districtId: "district-1",
      branchId: null,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
      sessionVersion: 1,
    },
    {
      id: "user-district-director",
      name: "Hana Girma",
      username: "district.director",
      email: "hana.girma@nib-control360.local",
      passwordHash: hashPassword("Director@123"),
      role: "DISTRICT_DIRECTOR",
      status: "ACTIVE",
      districtId: "district-1",
      branchId: null,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
      sessionVersion: 1,
    },
    {
      id: "user-branch-controller",
      name: "Mekdes Alemu",
      username: "branch.controller",
      email: "mekdes.alemu@nib-control360.local",
      passwordHash: hashPassword("Branch@123"),
      role: "BRANCH_CONTROLLER",
      status: "ACTIVE",
      districtId: "district-1",
      branchId: "branch-1",
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
      sessionVersion: 1,
    },
    {
      id: "user-branch-manager",
      name: "Yonas Kebede",
      username: "branch.manager",
      email: "yonas.kebede@nib-control360.local",
      passwordHash: hashPassword("Manager@123"),
      role: "BRANCH_MANAGER",
      status: "ACTIVE",
      districtId: "district-1",
      branchId: "branch-1",
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
      sessionVersion: 1,
    },
    {
      id: "user-executive",
      name: "Executive Office",
      username: "executive",
      email: "executive@nib-control360.local",
      passwordHash: hashPassword("Executive@123"),
      role: "EXECUTIVE_READONLY",
      status: "ACTIVE",
      districtId: null,
      branchId: null,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
      sessionVersion: 1,
    },
  ];

  return {
    users,
    roles,
    districts,
    branches,
    sources,
    departments,
    uncoveredReasons,
    categories,
    scoringRules,
    scoringAdjustments: [],
    reportingPeriods,
    findings: [],
    findingTransitions: [],
    rectifications: [],
    findingTransfers: [],
    findingClosures: [],
    importBatches: [],
    findingCases: [],
    // A fresh seed's ADMIN role is already ALL_PERMISSION_KEYS, so every
    // key starts "already synced" - nothing to backfill until a future
    // registry addition.
    permissionRegistrySyncedKeys: [...ALL_PERMISSION_KEYS],
    evidence: [],
    comments: [],
    notifications: [],
    settings,
    auditLogs: [],
    branchCoverageNotes: [],
  };
}
