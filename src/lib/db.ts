import fs from "node:fs";
import path from "node:path";
import { hashPassword } from "@/lib/auth";
import { ALL_PERMISSION_KEYS, ALL_VIEW_PERMISSION_KEYS, permissionKey } from "@/lib/permissions/registry";
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
    permissionKey("findings", "ho-return-rectification"),
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
    permissionKey("findings", "district-return-rectification"),
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
      email: "admin@nib-control360.local",
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
      email: "selam.tesfaye@nib-control360.local",
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
      email: "dawit.bekele@nib-control360.local",
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
      email: "hana.girma@nib-control360.local",
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
      email: "mekdes.alemu@nib-control360.local",
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
      email: "yonas.kebede@nib-control360.local",
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
      email: "executive@nib-control360.local",
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

  return db;
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
  if (!db.settings.similarFindingFields) {
    // The fields the duplicate-suggestion lookup always compared on before
    // this became configurable - preserves existing behavior for a
    // pre-existing install rather than silently disabling the feature.
    db.settings.similarFindingFields = ["branchId", "categoryId", "operationArea", "irregularityType", "periodId"];
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
    if (p.draftsAllowedWhileLocked === undefined) {
      // Predates the flag - default true (matches the new default), so
      // pre-existing locked periods don't suddenly become a harder stop
      // than they were before this field existed.
      p.draftsAllowedWhileLocked = true;
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
  // "return-rectification" used to be a single combined permission for
  // both District and HO. Now it's split into two scoped permissions with
  // different gating rules: district-return-rectification (District can
  // return at any point before/after verification) vs ho-return-
  // rectification (HO can only return AFTER District has first verified
  // the rectification). Any existing role holding the combined, legacy
  // permission gets the appropriate scoped new one based on its orgScope
  // (DISTRICT -> district variant, BANK -> HO variant) so behavior stays
  // the same as before the split; an admin can fine-tune from /admin/roles.
  for (const r of db.roles) {
    if (r.permissions.includes(permissionKey("findings", "return-rectification"))) {
      if (r.orgScope === "DISTRICT" || r.orgScope === "BRANCH") {
        if (!r.permissions.includes(permissionKey("findings", "district-return-rectification"))) {
          r.permissions = [...r.permissions, permissionKey("findings", "district-return-rectification")];
          changed = true;
        }
      }
      if (r.orgScope === "BANK") {
        if (!r.permissions.includes(permissionKey("findings", "ho-return-rectification"))) {
          r.permissions = [...r.permissions, permissionKey("findings", "ho-return-rectification")];
          changed = true;
        }
      }
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
