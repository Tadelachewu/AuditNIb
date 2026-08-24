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
  ];

  const sources: Source[] = [
    { id: "source-1", code: "IC", name: "Internal Control", active: true, createdAt: now, updatedAt: now },
    { id: "source-2", code: "IA", name: "Internal Audit", active: true, createdAt: now, updatedAt: now },
  ];

  const categories: ClassifiedCategory[] = [
    { id: "cat-1", code: "ATM_MISMATCH", name: "ATM Mismatch", scored: false, active: true, createdAt: now, updatedAt: now },
    { id: "cat-2", code: "ATM_LONG_OS", name: "ATM Long O/S", scored: false, active: true, createdAt: now, updatedAt: now },
    { id: "cat-3", code: "IT", name: "IT", scored: false, active: true, createdAt: now, updatedAt: now },
    { id: "cat-4", code: "DORMANT", name: "Dormant", scored: false, active: true, createdAt: now, updatedAt: now },
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
  const reportingPeriods: ReportingPeriod[] = [
    {
      id: "period-1",
      year: today.getFullYear(),
      month: today.getMonth() + 1,
      code: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`,
      status: "OPEN",
      lockedBy: null,
      lockedAt: null,
      lockReason: null,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const settings: Settings = {
    currencies: ["ETB", "USD"],
    riskLevels: ["Low", "Medium", "High", "Critical"],
    notification: { provider: "NONE", fromAddress: "" },
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
  ];
  const districtControllerPermissions = [
    permissionKey("districts", "view"),
    permissionKey("branches", "view"),
    permissionKey("sources", "view"),
    permissionKey("categories", "view"),
    permissionKey("scoring-rules", "view"),
    permissionKey("scoring-adjustments", "view"),
    permissionKey("reporting-periods", "view"),
    permissionKey("reporting-periods", "lock"),
    // "Review branch submissions... Approve or return findings" (icfms.txt);
    // closure is their verification duty per master.txt §"Verification".
    permissionKey("findings", "view"),
    permissionKey("findings", "district-review"),
    permissionKey("findings", "close"),
  ];
  const districtDirectorPermissions = [
    permissionKey("districts", "view"),
    permissionKey("branches", "view"),
    permissionKey("sources", "view"),
    permissionKey("categories", "view"),
    permissionKey("scoring-rules", "view"),
    permissionKey("scoring-adjustments", "view"),
    permissionKey("reporting-periods", "view"),
    // View only - icfms.txt is explicit: "Cannot modify findings or scores."
    permissionKey("findings", "view"),
  ];
  const branchControllerPermissions = [
    permissionKey("branch-dashboard", "view"),
    permissionKey("sources", "view"),
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
  ];
  const branchManagerPermissions = [
    permissionKey("branch-dashboard", "view"),
    permissionKey("categories", "view"),
    permissionKey("reporting-periods", "view"),
    // "Record corrective actions... Enter rectified case counts" (icfms.txt).
    permissionKey("findings", "view"),
    permissionKey("findings", "rectify"),
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
      id: "role-executive",
      code: "EXECUTIVE_READONLY",
      name: "Executive (Read-only)",
      description: "Read-only oversight dashboards and reports across the bank.",
      orgScope: "BANK",
      branchSingleton: false,
      isSystem: true,
      permissions: ALL_VIEW_PERMISSION_KEYS,
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

  return {
    users,
    roles,
    districts,
    branches,
    sources,
    categories,
    scoringRules,
    scoringAdjustments: [],
    reportingPeriods,
    findings: [],
    findingTransitions: [],
    rectifications: [],
    settings,
    auditLogs: [],
  };
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

export function readDb(): Database {
  ensureDataFile();
  const raw = fs.readFileSync(DB_FILE, "utf-8");
  return JSON.parse(raw) as Database;
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
