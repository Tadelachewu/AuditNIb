// Core domain types for NIB Control360 (ICFMS).
// Data currently persists to a local JSON file (see src/lib/db.ts) and is
// designed to be swapped for a real relational database later without
// changing these shapes.

export type Status = "ACTIVE" | "INACTIVE";

// Roles are no longer a fixed set (Phase 2) - they're data, editable at
// /admin/roles. `User.role` stores a RoleDefinition.code, a plain string,
// not a literal union: which codes exist is only known at runtime. See
// PHASE2.md for the full design and src/lib/permissions/registry.ts for the
// static catalog of pages/actions that a role's `permissions` are drawn from.
export type OrgScope = "BANK" | "DISTRICT" | "BRANCH";

export interface RoleDefinition {
  id: string;
  code: string;
  name: string;
  description?: string;
  orgScope: OrgScope;
  // Only meaningful when orgScope === "BRANCH": at most one ACTIVE user
  // holding this role per branch (the BRD's "one Branch Manager + one
  // Branch Internal Controller per branch" rule, generalized to any
  // branch-scoped role - see src/lib/org.ts).
  branchSingleton: boolean;
  // Seeded roles: code/orgScope are locked, and (for ADMIN specifically)
  // permissions can't be edited away, to prevent a self-lockout.
  isSystem: boolean;
  permissions: string[];
  status: Status;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  name: string;
  username: string;
  passwordHash: string;
  role: string;
  status: Status;
  districtId?: string | null;
  branchId?: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string | null;
}

export type SafeUser = Omit<User, "passwordHash">;

export interface District {
  id: string;
  code: string;
  name: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
}

// A branch's manager/controller are not stored as pointers here - they are
// derived by looking up the ACTIVE user(s) with role BRANCH_MANAGER /
// BRANCH_CONTROLLER whose branchId matches (see src/lib/org.ts). That keeps
// a single source of truth and avoids the two records drifting out of sync.
export interface Branch {
  id: string;
  code: string;
  name: string;
  districtId: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
}

export interface Source {
  id: string;
  code: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClassifiedCategory {
  id: string;
  code: string;
  name: string;
  scored: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScoringRule {
  id: string;
  version: number;
  name: string;
  active: boolean;
  effectiveFrom: string;
  categories: string[];
  sources: string[];
  basis: string;
  formulaType: string;
  createdBy: string;
  createdAt: string;
}

export interface ScoringAdjustment {
  id: string;
  targetType: "DISTRICT" | "BRANCH";
  targetId: string;
  periodId: string;
  value: number;
  reason: string;
  adjustedBy: string;
  createdAt: string;
}

export type PeriodStatus = "OPEN" | "LOCKED";

export interface ReportingPeriod {
  id: string;
  year: number;
  month: number;
  code: string;
  status: PeriodStatus;
  lockedBy?: string | null;
  lockedAt?: string | null;
  lockReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationSettings {
  provider: "NONE" | "SMTP" | "GRAPH";
  fromAddress: string;
  smtpHost?: string;
  smtpPort?: number;
}

export interface Settings {
  currencies: string[];
  riskLevels: string[];
  notification: NotificationSettings;
  updatedAt: string;
  updatedBy?: string;
}

export interface AuditLogEntry {
  id: string;
  userId: string;
  userName: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  timestamp: string;
}

export interface Database {
  users: User[];
  roles: RoleDefinition[];
  districts: District[];
  branches: Branch[];
  sources: Source[];
  categories: ClassifiedCategory[];
  scoringRules: ScoringRule[];
  scoringAdjustments: ScoringAdjustment[];
  reportingPeriods: ReportingPeriod[];
  settings: Settings;
  auditLogs: AuditLogEntry[];
}
