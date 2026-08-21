import fs from "node:fs";
import path from "node:path";
import { hashPassword } from "@/lib/auth";
import type {
  Database,
  User,
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
