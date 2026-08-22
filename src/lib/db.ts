import fs from "node:fs";
import path from "node:path";
import { hashPassword } from "@/lib/auth";
import { ALL_PERMISSION_KEYS, ALL_VIEW_PERMISSION_KEYS } from "@/lib/permissions/registry";
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

  // Roles are data (Phase 2) - this is the seed, not a hard-coded enum.
  // ADMIN always gets every permission (isSystem protects it from being
  // edited away, see src/app/api/admin/roles/[id]/route.ts). The other six
  // seeded roles start with NO admin-console permissions, matching Phase 1's
  // actual behavior (only ADMIN could reach /admin/*) - an admin now grants
  // access deliberately via /admin/roles rather than it being implicit.
  // EXECUTIVE_READONLY is the one exception: it gets read-only visibility
  // across the console by default, matching its "read-only oversight" BRD
  // description, excluding Roles & Permissions itself.
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
      permissions: [],
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
      permissions: [],
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
      permissions: [],
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
      permissions: [],
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
      permissions: [],
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
