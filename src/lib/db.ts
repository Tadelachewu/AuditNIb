import fs from "node:fs";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { hashPassword } from "@/lib/auth";
import { ALL_PERMISSION_KEYS, ALL_VIEW_PERMISSION_KEYS, permissionKey } from "@/lib/permissions/registry";
import { appendAuditLog } from "@/lib/audit";
import {
  transitionFinding,
  submitFinding,
  districtApproveFinding,
  hoApproveFinding,
  transferFinding,
  nextFindingReference,
} from "@/lib/findings";
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
  Finding,
  FindingCase,
  RectificationEntry,
  FindingClosure,
  Comment,
} from "@/types";

// ---------------------------------------------------------------------------
// "Local storage" data layer.
//
// The whole app currently persists to a single JSON file on disk instead of
// a real database, per the project plan ("use nextjs and local storage, we
// will convert into a db later"). Every read/write goes through this module,
// so swapping in a real database later means reimplementing the functions in
// this file only — nothing above this layer (API routes, pages) needs to
// change since they only ever call readDb()/writeDb()/getDb().
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

// The 10 named report templates (src/lib/reportTemplates.ts) are every bit
// HO/District-level oversight reading as the existing Reports page - every
// one of them ranks or compares *across* districts - so they go to exactly
// the roles that already get reports.view by default (HO Controller,
// District Controller, District Director, Executive). Module-level (not
// local to buildSeedDatabase()) so normalizeDb()'s migration below can
// reuse the exact same list when backfilling pre-existing installs.
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
];

// Default canned reasons for the Uncovered Branches report - module-level
// (not local to buildSeedDatabase()) so normalizeDb()'s migration below can
// seed the same list for pre-existing installs, matching the "add them by
// default" request rather than leaving older databases with an empty list.
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

function buildSeedDatabase(): Database {
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
      status: "LOCKED",
      lockedBy: "user-admin",
      lockedAt: seedPeriodStart.toISOString(),
      lockReason: "Prior period closed at seed time.",
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
      status: "OPEN",
      lockedBy: null,
      lockedAt: null,
      lockReason: null,
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
    updatedAt: now,
  };

  // Roles are data (Phase 2) - this is the seed, not a hard-coded enum. Every
  // seeded role gets a non-empty, BRD-grounded default permission set (see
  // PHASE5.md) so an admin starts from "this is what the role should
  // plausibly have" and adjusts from there via /admin/roles, rather than
  // building every role's access from zero. ADMIN always gets every
  // permission (isSystem protects it from being edited away, see
  // src/app/api/admin/roles/[id]/route.ts).
  //
  // Defaults are deliberately conservative: icfms.txt reserves "User
  // creation, Role assignment, Branch/District configuration, Category
  // maintenance, Workflow configuration, System settings" to the
  // Administrator alone, so no non-admin role gets create/edit/delete/
  // toggle-status on org structure, users, or roles by default - only the
  // view/monitoring access each role's BRD description calls for, plus
  // (per master.txt §"District and Head Office Controllers can control
  // periods within authorized scope") reporting-periods.lock for HO and
  // District Controller specifically, not District Director (whose BRD
  // description explicitly says "cannot modify findings or scores") and not
  // Branch roles (period control is district/HO-level per the BRD).
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
    // "Register Internal Audit findings received from the Internal Audit
    // Department" (icfms.txt) + the second-approval stage of the workflow.
    permissionKey("findings", "view"),
    permissionKey("findings", "create"),
    permissionKey("findings", "ho-review"),
    permissionKey("findings", "close"),
    permissionKey("findings", "comment"),
    // master.txt §22: "HO Internal Controllers can import/enter Internal
    // Audit findings" - the bulk sibling of the single-record "create"
    // path just above, both landing in the exact same DRAFT-first workflow.
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
    // "Review branch submissions... Approve or return findings" (icfms.txt);
    // closure is their verification duty per master.txt §"Verification".
    permissionKey("findings", "view"),
    permissionKey("findings", "district-review"),
    // The gate on a Branch Manager's recorded rectification, before it
    // reaches HO (or is closable at all): approve it, or return it for
    // correction - two separate permissions (see verify-rectification/
    // route.ts and return-rectification/route.ts) so a role can be granted
    // one without the other; District Controller gets both by default.
    permissionKey("findings", "verify-rectification"),
    permissionKey("findings", "return-rectification"),
    permissionKey("findings", "close"),
    // "Transfer outstanding cases" (icfms.txt).
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
    // View only - icfms.txt is explicit: "Cannot modify findings or scores."
    permissionKey("findings", "view"),
    // The one mutating exception: proposal.txt §6 - "District Directors
    // shall have view and comment access" - explicitly authorized, unlike
    // modifying a finding or its score.
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
    // "Register findings, Edit draft findings, Submit findings, Verify
    // rectifications" (icfms.txt).
    permissionKey("findings", "view"),
    permissionKey("findings", "create"),
    permissionKey("findings", "edit"),
    permissionKey("findings", "delete"),
    permissionKey("findings", "submit"),
    permissionKey("findings", "rectify"),
    // "Upload optional evidence... Verify rectifications" (icfms.txt).
    permissionKey("findings", "evidence"),
    permissionKey("findings", "comment"),
  ];
  const branchManagerPermissions = [
    permissionKey("branch-dashboard", "view"),
    permissionKey("categories", "view"),
    permissionKey("reporting-periods", "view"),
    // "Record corrective actions... Enter rectified case counts" (icfms.txt).
    permissionKey("findings", "view"),
    permissionKey("findings", "rectify"),
    // "Upload optional supporting evidence... Respond to comments" (icfms.txt).
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
      // One deputy per branch, same singleton convention as Manager/
      // Controller - not a BRD-mandated role (hence isSystem: false, so an
      // admin can delete it outright if unwanted, unlike the core seven),
      // but seeded with the Branch Manager's exact permission set so it
      // starts genuinely equivalent rather than needing manual setup.
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
      // ALL_VIEW_PERMISSION_KEYS only ever grabs each page's literal "view"
      // action - it covers report-templates.view (the hub) automatically,
      // but not the 10 individually-named template actions, so those need
      // adding explicitly here (same array every other reporting role uses;
      // deduped since report-templates.view appears in both).
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
      passwordHash: hashPassword("Admin@123"),
      role: "ADMIN",
      status: "ACTIVE",
      districtId: null,
      branchId: null,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    },
    {
      id: "user-ho-controller",
      name: "Selam Tesfaye",
      username: "ho.controller",
      passwordHash: hashPassword("Ho@12345"),
      role: "HO_CONTROLLER",
      status: "ACTIVE",
      districtId: null,
      branchId: null,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    },
    {
      id: "user-district-controller",
      name: "Dawit Bekele",
      username: "district.controller",
      passwordHash: hashPassword("District@123"),
      role: "DISTRICT_CONTROLLER",
      status: "ACTIVE",
      districtId: "district-1",
      branchId: null,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    },
    {
      id: "user-district-director",
      name: "Hana Girma",
      username: "district.director",
      passwordHash: hashPassword("Director@123"),
      role: "DISTRICT_DIRECTOR",
      status: "ACTIVE",
      districtId: "district-1",
      branchId: null,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    },
    {
      id: "user-branch-controller",
      name: "Mekdes Alemu",
      username: "branch.controller",
      passwordHash: hashPassword("Branch@123"),
      role: "BRANCH_CONTROLLER",
      status: "ACTIVE",
      districtId: "district-1",
      branchId: "branch-1",
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    },
    {
      id: "user-branch-manager",
      name: "Yonas Kebede",
      username: "branch.manager",
      passwordHash: hashPassword("Manager@123"),
      role: "BRANCH_MANAGER",
      status: "ACTIVE",
      districtId: "district-1",
      branchId: "branch-1",
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    },
    {
      id: "user-executive",
      name: "Executive Office",
      username: "executive",
      passwordHash: hashPassword("Executive@123"),
      role: "EXECUTIVE_READONLY",
      status: "ACTIVE",
      districtId: null,
      branchId: null,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    },
  ];

  const db: Database = {
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
    // registry addition, exactly the scenario syncAdminPermissions() below
    // exists for.
    permissionRegistrySyncedKeys: [...ALL_PERMISSION_KEYS],
    evidence: [],
    comments: [],
    notifications: [],
    settings,
    auditLogs: [],
    branchCoverageNotes: [],
  };

  seedFindings(db);
  return db;
}

// Every seeded Finding is driven through the exact same domain functions
// the real API routes call (submitFinding/districtApproveFinding/
// hoApproveFinding/transferFinding/transitionFinding from
// src/lib/findings.ts, plus the same field-mutation logic
// rectify/verify-rectification/close/route.ts each use) rather than
// hand-assembled with a status string and hoped-for field values - so
// every seeded finding's rectifiedCases/districtVerifiedCases/
// closedCases bounds, FindingTransition history, and RectificationEntry/
// FindingClosure ledger rows are exactly as internally consistent as a
// finding that went through the real workflow, and a fresh install's
// dashboards/charts/rankings have real, varied data instead of being
// empty until someone manually creates test records.
function seedFindings(db: Database): void {
  const [prevPeriod, openPeriod] = db.reportingPeriods;
  const branch1 = db.branches.find((b) => b.id === "branch-1")!; // district-1
  const branch2 = db.branches.find((b) => b.id === "branch-2")!; // district-1
  const branch3 = db.branches.find((b) => b.id === "branch-3")!; // district-2
  const branch4 = db.branches.find((b) => b.id === "branch-4")!; // district-2

  const ADMIN = { id: "user-admin", name: "System Administrator" };
  const HO = { id: "user-ho-controller", name: "Selam Tesfaye" };
  const DC = { id: "user-district-controller", name: "Dawit Bekele" };
  const BC = { id: "user-branch-controller", name: "Mekdes Alemu" };
  const BM = { id: "user-branch-manager", name: "Yonas Kebede" };

  function makeFinding(opts: {
    branch: Branch;
    period: ReportingPeriod;
    sourceId: string;
    categoryId: string;
    departmentId?: string;
    title: string;
    description: string;
    riskLevel: string;
    priority?: string;
    caseCount: number;
    amount: number;
    findingDate: string;
    operationArea: string;
    irregularityType: string;
    createdBy: string;
  }): Finding {
    const nowIso2 = nowIso();
    const finding: Finding = {
      id: uuid(),
      reference: nextFindingReference(db, opts.branch, opts.period),
      title: opts.title,
      sourceId: opts.sourceId,
      departmentId: opts.departmentId ?? "dept-1",
      periodId: opts.period.id,
      districtId: opts.branch.districtId,
      branchId: opts.branch.id,
      findingDate: opts.findingDate,
      operationArea: opts.operationArea,
      irregularityType: opts.irregularityType,
      categoryId: opts.categoryId,
      amount: opts.amount,
      currency: "ETB",
      caseCount: opts.caseCount,
      riskLevel: opts.riskLevel,
      priority: opts.priority ?? "Medium",
      description: opts.description,
      status: "DRAFT",
      rectifiedCases: 0,
      rectifiedAmount: 0,
      closedCases: 0,
      closedAmount: 0,
      districtVerifiedCases: 0,
      districtVerifiedAmount: 0,
      createdBy: opts.createdBy,
      createdAt: nowIso2,
      updatedAt: nowIso2,
    };
    db.findings.push(finding);
    return finding;
  }

  // Mirrors rectify/route.ts's own field mutation (minus the notification
  // side effects, which only make sense fired from a real request).
  function recordRectification(
    f: Finding,
    opts: { rectifiedCases: number; rectifiedAmount: number; note?: string; userId: string; userName: string; caseIds?: string[] }
  ): void {
    const ts = nowIso();
    const entry: RectificationEntry = {
      id: uuid(),
      findingId: f.id,
      periodId: f.periodId,
      rectifiedCases: opts.rectifiedCases,
      rectifiedAmount: opts.rectifiedAmount,
      note: opts.note,
      submittedBy: opts.userId,
      submittedByName: opts.userName,
      createdAt: ts,
      caseIds: opts.caseIds,
    };
    db.rectifications.push(entry);
    if (opts.caseIds) {
      for (const fc of db.findingCases) {
        if (opts.caseIds.includes(fc.id)) {
          fc.status = "RECTIFIED";
          fc.rectificationId = entry.id;
          fc.rectifiedAt = ts;
          fc.rectifiedBy = opts.userId;
          fc.rectifiedByName = opts.userName;
        }
      }
    }
    f.rectifiedCases += opts.rectifiedCases;
    f.rectifiedAmount += opts.rectifiedAmount;
    const fullyRectified = f.rectifiedCases >= f.caseCount && f.rectifiedAmount >= f.amount;
    transitionFinding(db, f, {
      toStatus: fullyRectified ? "RECTIFIED" : "PARTIALLY_RECTIFIED",
      action: "RECTIFY",
      userId: opts.userId,
      userName: opts.userName,
    });
  }

  // Mirrors verify-rectification/route.ts: catches districtVerifiedCases/
  // Amount up to whatever's currently rectified - no status change of its
  // own, same as the real route.
  function verifyRectification(f: Finding, actor: { id: string; name: string }): void {
    const verifiableCases = f.rectifiedCases - f.districtVerifiedCases;
    const verifiableAmount = f.rectifiedAmount - f.districtVerifiedAmount;
    f.districtVerifiedCases += verifiableCases;
    f.districtVerifiedAmount += verifiableAmount;
    f.updatedAt = nowIso();
    appendAuditLog(db, {
      userId: actor.id,
      userName: actor.name,
      action: "DISTRICT_VERIFY_RECTIFICATION",
      entityType: "Finding",
      entityId: f.id,
      newValue: { districtVerifiedCases: f.districtVerifiedCases, districtVerifiedAmount: f.districtVerifiedAmount },
    });
  }

  // Mirrors close/route.ts: bounded by min(rectified, districtVerified),
  // only reaches CLOSED once closedCases/Amount catch all the way up to
  // caseCount/amount.
  function closeFinding(f: Finding, actor: { id: string; name: string }): void {
    const verifiedCases = Math.min(f.rectifiedCases, f.districtVerifiedCases);
    const verifiedAmount = Math.min(f.rectifiedAmount, f.districtVerifiedAmount);
    const closableCases = verifiedCases - f.closedCases;
    const closableAmount = verifiedAmount - f.closedAmount;
    const ts = nowIso();
    const closure: FindingClosure = {
      id: uuid(),
      findingId: f.id,
      periodId: f.periodId,
      closedCases: closableCases,
      closedAmount: closableAmount,
      submittedBy: actor.id,
      submittedByName: actor.name,
      createdAt: ts,
    };
    db.findingClosures.push(closure);
    f.closedCases += closableCases;
    f.closedAmount += closableAmount;
    const fullyClosed = f.closedCases >= f.caseCount && f.closedAmount >= f.amount;
    if (fullyClosed) {
      transitionFinding(db, f, { toStatus: "CLOSED", action: "CLOSE", userId: actor.id, userName: actor.name });
    } else {
      f.updatedAt = ts;
      appendAuditLog(db, {
        userId: actor.id,
        userName: actor.name,
        action: "PARTIAL_CLOSE",
        entityType: "Finding",
        entityId: f.id,
        newValue: { closedCases: f.closedCases, closedAmount: f.closedAmount },
      });
    }
  }

  // 1. DRAFT - registered, never submitted.
  makeFinding({
    branch: branch1,
    period: openPeriod,
    sourceId: "source-1",
    categoryId: "cat-1",
    title: "ATM cash reconciliation mismatch - Bole Branch ATM #2",
    description: "End-of-day ATM cash count did not match the system-reported dispensed total for three consecutive days.",
    riskLevel: "Medium",
    caseCount: 4,
    amount: 40_000,
    findingDate: openPeriod.startsAt.slice(0, 10),
    operationArea: "ATM Operations",
    irregularityType: "Reconciliation Discrepancy",
    createdBy: BC.id,
  });

  // 2. DISTRICT_REVIEW - submitted, awaiting the District Controller.
  const f2 = makeFinding({
    branch: branch1,
    period: openPeriod,
    sourceId: "source-1",
    categoryId: "cat-3",
    departmentId: "dept-10",
    title: "Unauthorized access attempt on core banking terminal",
    description: "A teller workstation logged three failed privileged-account login attempts outside business hours.",
    riskLevel: "High",
    caseCount: 2,
    amount: 25_000,
    findingDate: openPeriod.startsAt.slice(0, 10),
    operationArea: "Cybersecurity",
    irregularityType: "Access Control Violation",
    createdBy: BC.id,
  });
  submitFinding(db, f2, BC.id, BC.name);

  // 3. HO_REVIEW - district-approved, awaiting Head Office.
  const f3 = makeFinding({
    branch: branch1,
    period: openPeriod,
    sourceId: "source-2",
    categoryId: "cat-7",
    title: "Loan documentation gaps identified during audit",
    description: "Six active loan files are missing collateral valuation reports required before disbursement.",
    riskLevel: "Medium",
    caseCount: 6,
    amount: 90_000,
    findingDate: openPeriod.startsAt.slice(0, 10),
    operationArea: "Loan Processing",
    irregularityType: "Documentation Deficiency",
    createdBy: BC.id,
  });
  submitFinding(db, f3, BC.id, BC.name);
  districtApproveFinding(db, f3, DC.id, DC.name);

  // 4. PENDING_BANK_APPROVAL - HO-registered (bank scope), awaiting the
  // assigned bank-wide approver (Settings.hoApproval.approverUserIds).
  const f4 = makeFinding({
    branch: branch3,
    period: openPeriod,
    sourceId: "source-2",
    categoryId: "cat-7",
    title: "Internal Audit finding - suspense account aging",
    description: "A bank-wide suspense account carries unreconciled entries older than 90 days.",
    riskLevel: "High",
    caseCount: 3,
    amount: 150_000,
    findingDate: openPeriod.startsAt.slice(0, 10),
    operationArea: "Reconciliation",
    irregularityType: "Reconciliation Discrepancy",
    createdBy: HO.id,
  });
  transitionFinding(db, f4, { toStatus: "SUBMITTED", action: "SUBMIT", userId: HO.id, userName: HO.name });
  transitionFinding(db, f4, { toStatus: "PENDING_BANK_APPROVAL", action: "QUEUE_BANK_APPROVAL", userId: HO.id, userName: HO.name });

  // 5. SENT_TO_BRANCH_MANAGER - full district+HO chain, now with the
  // Branch Manager for corrective action.
  const f5 = makeFinding({
    branch: branch1,
    period: openPeriod,
    sourceId: "source-1",
    categoryId: "cat-4",
    title: "Dormant account reactivated without proper authorization",
    description: "A dormant account was reactivated and funds withdrawn without the required dual-signatory approval.",
    riskLevel: "Low",
    caseCount: 5,
    amount: 60_000,
    findingDate: openPeriod.startsAt.slice(0, 10),
    operationArea: "Account Opening",
    irregularityType: "Policy Violation",
    createdBy: BC.id,
  });
  submitFinding(db, f5, BC.id, BC.name);
  districtApproveFinding(db, f5, DC.id, DC.name);
  hoApproveFinding(db, f5, HO.id, HO.name);

  // 6. SENT_TO_BRANCH_MANAGER (bank-registered path) - HO/Admin-registered
  // findings skip District/HO review entirely (no natural "district" to
  // review a bank-originated finding) and queue straight to the branch.
  const f6 = makeFinding({
    branch: branch4,
    period: openPeriod,
    sourceId: "source-2",
    categoryId: "cat-7",
    title: "Suspected fraudulent fund transfer - Adama Kality",
    description: "A same-day outbound transfer was flagged by Internal Audit as inconsistent with the account's normal activity.",
    riskLevel: "Critical",
    caseCount: 2,
    amount: 200_000,
    findingDate: openPeriod.startsAt.slice(0, 10),
    operationArea: "Fund Transfer",
    irregularityType: "Fraud",
    createdBy: ADMIN.id,
  });
  submitFinding(db, f6, ADMIN.id, ADMIN.name, { registeredByBankScope: true });

  // 7. PARTIALLY_RECTIFIED.
  const f7 = makeFinding({
    branch: branch1,
    period: openPeriod,
    sourceId: "source-1",
    categoryId: "cat-1",
    title: "ATM long-outstanding cash variance - Bole Branch",
    description: "A cash variance from a prior ATM replenishment run remains unresolved across multiple reconciliations.",
    riskLevel: "Medium",
    caseCount: 8,
    amount: 80_000,
    findingDate: openPeriod.startsAt.slice(0, 10),
    operationArea: "ATM Operations",
    irregularityType: "Reconciliation Discrepancy",
    createdBy: BC.id,
  });
  submitFinding(db, f7, BC.id, BC.name);
  districtApproveFinding(db, f7, DC.id, DC.name);
  hoApproveFinding(db, f7, HO.id, HO.name);
  recordRectification(f7, { rectifiedCases: 3, rectifiedAmount: 30_000, note: "3 cases traced and corrected; remainder pending vault audit.", userId: BM.id, userName: BM.name });

  // 8. RECTIFIED - fully rectified, not yet district-verified.
  const f8 = makeFinding({
    branch: branch1,
    period: openPeriod,
    sourceId: "source-1",
    categoryId: "cat-7",
    title: "Other Case - teller till overage unresolved",
    description: "A recurring till overage was traced to a miscounted cash bundle.",
    riskLevel: "High",
    caseCount: 4,
    amount: 48_000,
    findingDate: openPeriod.startsAt.slice(0, 10),
    operationArea: "Teller Counter",
    irregularityType: "Cash Excess",
    createdBy: BC.id,
  });
  submitFinding(db, f8, BC.id, BC.name);
  districtApproveFinding(db, f8, DC.id, DC.name);
  hoApproveFinding(db, f8, HO.id, HO.name);
  recordRectification(f8, { rectifiedCases: 4, rectifiedAmount: 48_000, note: "Cash bundle re-counted and corrected same day.", userId: BM.id, userName: BM.name });

  // 9. RECTIFIED - fully rectified AND district-verified, ready for HO to close.
  const f9 = makeFinding({
    branch: branch1,
    period: openPeriod,
    sourceId: "source-2",
    categoryId: "cat-7",
    title: "Other Case - loan file collateral update completed",
    description: "Collateral valuation reports were obtained and filed for the previously flagged loan accounts.",
    riskLevel: "Medium",
    caseCount: 5,
    amount: 55_000,
    findingDate: openPeriod.startsAt.slice(0, 10),
    operationArea: "Loan Processing",
    irregularityType: "Documentation Deficiency",
    createdBy: BC.id,
  });
  submitFinding(db, f9, BC.id, BC.name);
  districtApproveFinding(db, f9, DC.id, DC.name);
  hoApproveFinding(db, f9, HO.id, HO.name);
  recordRectification(f9, { rectifiedCases: 5, rectifiedAmount: 55_000, note: "All five loan files updated with valuation reports.", userId: BM.id, userName: BM.name });
  verifyRectification(f9, DC);

  // 10. CLOSED.
  const f10 = makeFinding({
    branch: branch1,
    period: openPeriod,
    sourceId: "source-1",
    categoryId: "cat-7",
    title: "Other Case - vault dual-control lapse corrected",
    description: "A single-officer vault access event was addressed with revised dual-control scheduling.",
    riskLevel: "Low",
    caseCount: 3,
    amount: 33_000,
    findingDate: openPeriod.startsAt.slice(0, 10),
    operationArea: "Vault",
    irregularityType: "Policy Violation",
    createdBy: BC.id,
  });
  submitFinding(db, f10, BC.id, BC.name);
  districtApproveFinding(db, f10, DC.id, DC.name);
  hoApproveFinding(db, f10, HO.id, HO.name);
  recordRectification(f10, { rectifiedCases: 3, rectifiedAmount: 33_000, note: "Revised access roster in effect; confirmed with branch security.", userId: BM.id, userName: BM.name });
  verifyRectification(f10, DC);
  closeFinding(f10, DC);

  // 11. RECTIFICATION_RETURNED - District sent the recorded rectification
  // back for correction, with a thread of comments about it.
  const f11 = makeFinding({
    branch: branch1,
    period: openPeriod,
    sourceId: "source-1",
    categoryId: "cat-3",
    departmentId: "dept-10",
    title: "IT Case - unpatched branch workstation",
    description: "A branch workstation was found running an operating system version past its security patch window.",
    riskLevel: "High",
    caseCount: 4,
    amount: 44_000,
    findingDate: openPeriod.startsAt.slice(0, 10),
    operationArea: "Cybersecurity",
    irregularityType: "System Error",
    createdBy: BC.id,
  });
  submitFinding(db, f11, BC.id, BC.name);
  districtApproveFinding(db, f11, DC.id, DC.name);
  hoApproveFinding(db, f11, HO.id, HO.name);
  recordRectification(f11, { rectifiedCases: 2, rectifiedAmount: 22_000, note: "2 of 4 workstations patched so far.", userId: BM.id, userName: BM.name });
  transitionFinding(db, f11, {
    toStatus: "RECTIFICATION_RETURNED",
    action: "RETURN_RECTIFICATION",
    userId: DC.id,
    userName: DC.name,
    reason: "Patch confirmation screenshots are missing for the 2 cases marked rectified - please attach evidence and resubmit.",
  });
  const f11Comment: Comment = {
    id: uuid(),
    findingId: f11.id,
    parentCommentId: null,
    authorId: BM.id,
    authorName: BM.name,
    text: "Uploading the patch confirmation screenshots by Friday.",
    createdAt: nowIso(),
  };
  db.comments.push(f11Comment);
  db.comments.push({
    id: uuid(),
    findingId: f11.id,
    parentCommentId: f11Comment.id,
    authorId: DC.id,
    authorName: DC.name,
    text: "Thanks - I'll re-verify as soon as they're attached.",
    createdAt: nowIso(),
  });

  // 12. REJECTED - District-level rejection.
  const f12 = makeFinding({
    branch: branch2,
    period: openPeriod,
    sourceId: "source-2",
    categoryId: "cat-1",
    title: "ATM mismatch - duplicate entry, no actual variance",
    description: "Reported ATM mismatch was traced to a duplicate journal entry, not a real cash variance.",
    riskLevel: "Low",
    caseCount: 2,
    amount: 15_000,
    findingDate: openPeriod.startsAt.slice(0, 10),
    operationArea: "ATM Operations",
    irregularityType: "Reconciliation Discrepancy",
    createdBy: BC.id,
  });
  submitFinding(db, f12, BC.id, BC.name);
  transitionFinding(db, f12, {
    toStatus: "REJECTED",
    action: "DISTRICT_REJECT",
    userId: DC.id,
    userName: DC.name,
    reason: "Confirmed duplicate journal entry - no underlying irregularity. Closing without further action.",
  });

  // 13. RETURNED - District-level return-to-branch (before rectification
  // even starts - distinct from RECTIFICATION_RETURNED at #11).
  const f13 = makeFinding({
    branch: branch2,
    period: openPeriod,
    sourceId: "source-1",
    categoryId: "cat-3",
    title: "IT Case - printer access log anomaly",
    description: "An unusual pattern of after-hours print jobs was flagged for review.",
    riskLevel: "Medium",
    caseCount: 3,
    amount: 36_000,
    findingDate: openPeriod.startsAt.slice(0, 10),
    operationArea: "Cybersecurity",
    irregularityType: "Access Control Violation",
    createdBy: BC.id,
  });
  submitFinding(db, f13, BC.id, BC.name);
  transitionFinding(db, f13, {
    toStatus: "RETURNED",
    action: "DISTRICT_RETURN",
    userId: DC.id,
    userName: DC.name,
    reason: "Please attach the print log export referenced in the description before this can be reviewed.",
  });

  // 14. REJECTED - HO-level rejection (second-stage reject, distinct from
  // the district-level one at #12).
  const f14 = makeFinding({
    branch: branch1,
    period: openPeriod,
    sourceId: "source-2",
    categoryId: "cat-1",
    title: "ATM mismatch - resolved at district level, HO disagrees with classification",
    description: "District approved this as an ATM mismatch; HO review determined it was miscategorized.",
    riskLevel: "Critical",
    caseCount: 2,
    amount: 28_000,
    findingDate: openPeriod.startsAt.slice(0, 10),
    operationArea: "ATM Operations",
    irregularityType: "Reconciliation Discrepancy",
    createdBy: BC.id,
  });
  submitFinding(db, f14, BC.id, BC.name);
  districtApproveFinding(db, f14, DC.id, DC.name);
  transitionFinding(db, f14, {
    toStatus: "REJECTED",
    action: "HO_REJECT",
    userId: HO.id,
    userName: HO.name,
    reason: "This matches an IT system error pattern, not a genuine ATM mismatch - please reclassify and resubmit as a new finding.",
  });

  // 15. TRANSFERRED - registered and partially rectified in the prior
  // (now LOCKED) period, its outstanding balance carried into the
  // current OPEN period by the Transfer Engine.
  const f15 = makeFinding({
    branch: branch1,
    period: prevPeriod,
    sourceId: "source-1",
    categoryId: "cat-7",
    title: "Other Case - foreign currency till shortage",
    description: "A foreign-currency till count came up short against the recorded opening balance.",
    riskLevel: "High",
    caseCount: 6,
    amount: 72_000,
    findingDate: prevPeriod.startsAt.slice(0, 10),
    operationArea: "Teller Counter",
    irregularityType: "Cash Shortage",
    createdBy: BC.id,
  });
  submitFinding(db, f15, BC.id, BC.name);
  districtApproveFinding(db, f15, DC.id, DC.name);
  hoApproveFinding(db, f15, HO.id, HO.name);
  recordRectification(f15, { rectifiedCases: 2, rectifiedAmount: 24_000, note: "2 of 6 cases traced to a till-swap error and corrected.", userId: BM.id, userName: BM.name });
  transferFinding(db, f15, {
    toPeriodId: openPeriod.id,
    reason: `${prevPeriod.code} locked with this finding still outstanding.`,
    userId: ADMIN.id,
    userName: ADMIN.name,
  });

  // 16. Itemized cases (Document_3 §12/§34) - one case rectified by
  // specific selection rather than a typed count, the other two still
  // outstanding. PARTIALLY_RECTIFIED, same as #7/#11, but exercising the
  // per-case breakdown path instead of the plain-number one.
  const f16 = makeFinding({
    branch: branch1,
    period: openPeriod,
    sourceId: "source-2",
    categoryId: "cat-7",
    title: "Other Case - three unrelated suspense postings",
    description: "Three unrelated suspense postings were bundled under one finding, itemized per Document_3 §12/§34.",
    riskLevel: "Medium",
    caseCount: 3,
    amount: 45_000,
    findingDate: openPeriod.startsAt.slice(0, 10),
    operationArea: "Reconciliation",
    irregularityType: "Reconciliation Discrepancy",
    createdBy: BC.id,
  });
  submitFinding(db, f16, BC.id, BC.name);
  districtApproveFinding(db, f16, DC.id, DC.name);
  hoApproveFinding(db, f16, HO.id, HO.name);
  const f16Cases: FindingCase[] = [
    { id: uuid(), findingId: f16.id, seq: 1, amount: 15_000, status: "OUTSTANDING", createdAt: nowIso() },
    { id: uuid(), findingId: f16.id, seq: 2, amount: 20_000, status: "OUTSTANDING", createdAt: nowIso() },
    { id: uuid(), findingId: f16.id, seq: 3, amount: 10_000, status: "OUTSTANDING", createdAt: nowIso() },
  ];
  db.findingCases.push(...f16Cases);
  recordRectification(f16, {
    rectifiedCases: 1,
    rectifiedAmount: f16Cases[0].amount,
    note: "Case 1 traced to a same-day duplicate posting and reversed.",
    userId: BM.id,
    userName: BM.name,
    caseIds: [f16Cases[0].id],
  });
}

function ensureDataFile(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const seeded = buildSeedDatabase();
    fs.writeFileSync(DB_FILE, JSON.stringify(seeded, null, 2), "utf-8");
  }
}

// A PAGE_REGISTRY addition (a new page, or a new action on an existing
// page - like this very change adding findings.import and
// scoring-rules.edit/delete) must never silently strip access from an
// already-seeded ADMIN role; only a deliberate edit through /admin/roles
// should ever narrow it (see PATCH .../admin/roles/[id] - ADMIN can be
// narrowed there on purpose, unlike before). Each key is granted at most
// once, ever: recorded in permissionRegistrySyncedKeys the moment it's
// synced, so a later intentional uncheck of that same key is never
// silently reverted. Returns whether it changed anything.
function syncAdminPermissions(db: Database): boolean {
  const admin = db.roles.find((r) => r.code === "ADMIN");
  if (!admin) return false;
  const synced = new Set(db.permissionRegistrySyncedKeys);
  const newKeys = ALL_PERMISSION_KEYS.filter((k) => !synced.has(k));
  if (newKeys.length === 0) return false;

  const granted = new Set(admin.permissions);
  newKeys.forEach((k) => granted.add(k));
  admin.permissions = [...granted];
  db.permissionRegistrySyncedKeys = [...synced, ...newKeys];
  return true;
}

// db.json has no migration system - it's read as-is, so a field added to
// the schema after some findings already exist on disk needs an explicit
// default here, or every read of an older record throws on the missing
// property (e.g. db.findingClosures.push(...) on `undefined`). Returns
// whether anything was actually backfilled, so the caller can decide
// whether the fix is worth persisting immediately.
function normalizeDb(db: Database): { db: Database; changed: boolean } {
  let changed = false;
  if (!db.findingClosures) {
    db.findingClosures = [];
    changed = true;
  }
  if (!db.importBatches) {
    db.importBatches = [];
    changed = true;
  }
  if (!db.permissionRegistrySyncedKeys) {
    // Unknown history: assume nothing has been synced yet, so
    // syncAdminPermissions() below backfills every current key once.
    db.permissionRegistrySyncedKeys = [];
    changed = true;
  }
  if (!db.findingCases) {
    db.findingCases = [];
    changed = true;
  }
  if (!db.branchCoverageNotes) {
    db.branchCoverageNotes = [];
    changed = true;
  }
  if (!db.uncoveredReasons) {
    // Unlike branchCoverageNotes (genuinely empty until someone records
    // one), this is reference/config data the admin expects to already be
    // populated - seed the same defaults a fresh install gets, editable
    // afterward at /admin/uncovered-reasons like any other reference list.
    db.uncoveredReasons = defaultUncoveredReasons.map((r) => ({ ...r, createdAt: nowIso(), updatedAt: nowIso() }));
    changed = true;
  }
  for (const n of db.branchCoverageNotes) {
    if (n.reasonId === undefined) {
      // Predates the canned-reason list - every existing note was
      // necessarily free text, so it's treated the same as a fresh
      // "Other" selection: reasonId null, reason text unchanged.
      n.reasonId = null;
      changed = true;
    }
  }
  if (db.settings.autoTransferOnLock === undefined) {
    db.settings.autoTransferOnLock = false;
    changed = true;
  }
  if (!db.settings.rankingVisibility) {
    db.settings.rankingVisibility = { branches: true, districts: true };
    changed = true;
  }
  if (!db.settings.rectificationReminders) {
    // Off by default for pre-existing installs - an Admin opts in
    // explicitly at /admin/settings rather than suddenly starting to page
    // people who never expected it.
    db.settings.rectificationReminders = { enabled: false, thresholdDays: 7 };
    changed = true;
  }
  if (!db.settings.performanceThresholds) {
    db.settings.performanceThresholds = { topPercent: 80, bottomPercent: 50 };
    changed = true;
  }
  if (!db.settings.hoApproval) {
    // Off by default for pre-existing installs, same reasoning as
    // rectificationReminders above - a bank-registered finding keeps
    // routing straight to the branch (no approval step) until an Admin
    // deliberately turns this on and assigns approver(s).
    db.settings.hoApproval = { required: false, approverUserIds: [] };
    changed = true;
  }
  for (const p of db.reportingPeriods) {
    if (!p.startsAt || !p.endsAt) {
      // Predates the date-range field: default to the calendar month
      // year/month already encoded, so existing periods keep behaving
      // exactly as before (nothing reads startsAt/endsAt for anything
      // that already worked off year/month/code).
      const start = new Date(p.year, p.month - 1, 1, 0, 0);
      const end = new Date(p.year, p.month, 0, 23, 59);
      p.startsAt = start.toISOString();
      p.endsAt = end.toISOString();
      changed = true;
    }
  }
  for (const t of db.findingTransfers) {
    if (!t.method) {
      // Every transfer predating this field was necessarily a manual one -
      // automatic transfer didn't exist yet to have produced any.
      t.method = "MANUAL";
      changed = true;
    }
    if (t.originalCaseCount === undefined || t.originalAmount === undefined || t.caseAgeAtTransferDays === undefined) {
      // Predates these fields: best-effort backfill from the finding's
      // current totals (caseCount/amount don't change over a finding's
      // life in the normal flow, so this is exact for anything that
      // hasn't been hand-edited) and its age as of *now* rather than as
      // of the original transfer, which is the closest available proxy.
      const f = db.findings.find((x) => x.id === t.findingId);
      t.originalCaseCount = f?.caseCount ?? t.casesTransferred;
      t.originalAmount = f?.amount ?? t.amountTransferred;
      t.caseAgeAtTransferDays = f ? Math.floor((Date.now() - new Date(f.createdAt).getTime()) / 86_400_000) : 0;
      changed = true;
    }
  }
  for (const f of db.findings) {
    if (f.closedCases === undefined) {
      f.closedCases = 0;
      changed = true;
    }
    if (f.closedAmount === undefined) {
      f.closedAmount = 0;
      changed = true;
    }
    if (f.districtVerifiedCases === undefined) {
      f.districtVerifiedCases = 0;
      changed = true;
    }
    if (f.districtVerifiedAmount === undefined) {
      f.districtVerifiedAmount = 0;
      changed = true;
    }
  }
  // A rule predating this field: default to "has gone live at least once"
  // since that history is genuinely unknown - the safe assumption, since
  // it only blocks edit/delete (never view/activate), and a rule that
  // truly never went live can simply be recreated instead.
  for (const r of db.scoringRules) {
    if (r.everActivated === undefined) {
      r.everActivated = true;
      changed = true;
    }
  }
  for (const u of db.users) {
    if (u.mustChangePassword === undefined) {
      // Pre-existing users have already been using whatever password they
      // have - only newly-created users and admin password resets should
      // ever start out true.
      u.mustChangePassword = false;
      changed = true;
    }
  }
  // "verify-rectification" and "return-rectification" used to be one
  // combined permission (findings.verify-rectification gated both the
  // approve and the return-for-correction action). Any role already
  // holding the combined permission keeps returning for correction too,
  // exactly as it could before the split - only a deliberate edit through
  // /admin/roles should ever separate them from here on.
  for (const r of db.roles) {
    if (r.permissions.includes(permissionKey("findings", "verify-rectification")) && !r.permissions.includes(permissionKey("findings", "return-rectification"))) {
      r.permissions = [...r.permissions, permissionKey("findings", "return-rectification")];
      changed = true;
    }
  }
  // The 10 named report templates are new - any role that already held the
  // existing Reports page's reports.view (HO Controller, District
  // Controller, District Director, and Executive via
  // ALL_VIEW_PERMISSION_KEYS) picks up every template too, matching the
  // seed's own default grant for those roles - an admin can still narrow
  // this per-role via /admin/roles afterward.
  for (const r of db.roles) {
    if (r.permissions.includes(permissionKey("reports", "view"))) {
      const missing = reportTemplatePermissions.filter((k) => !r.permissions.includes(k));
      if (missing.length > 0) {
        r.permissions = [...r.permissions, ...missing];
        changed = true;
      }
    }
  }
  if (syncAdminPermissions(db)) changed = true;
  return { db, changed };
}

export function readDb(): Database {
  ensureDataFile();
  const raw = fs.readFileSync(DB_FILE, "utf-8");
  const { db, changed } = normalizeDb(JSON.parse(raw) as Database);
  // Persisted immediately rather than left to the next unrelated write -
  // syncAdminPermissions() in particular must not depend on some other
  // action happening to save the file first.
  if (changed) fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf-8");
  return db;
}

export function writeDb(db: Database): void {
  ensureDataFile();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf-8");
}

/** Read-modify-write helper to avoid repeating the read/mutate/write dance. */
export function updateDb<T>(mutator: (db: Database) => T): T {
  const db = readDb();
  const result = mutator(db);
  writeDb(db);
  return result;
}
