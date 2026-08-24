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

// The BRD's literal workflow state list (master.txt §11 + the roadmap doc's
// clean one-liner). TRANSFERRED is kept for type completeness but is
// unreachable for now - the Transfer Engine (BRD §3.7) is a deferred,
// separate feature; see PHASE6.md.
export const FINDING_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "DISTRICT_REVIEW",
  "DISTRICT_APPROVED",
  "HO_REVIEW",
  "HO_APPROVED",
  "SENT_TO_BRANCH_MANAGER",
  "PARTIALLY_RECTIFIED",
  "RECTIFIED",
  "TRANSFERRED",
  "REJECTED",
  "RETURNED",
  "CLOSED",
] as const;

export type FindingStatus = (typeof FINDING_STATUSES)[number];

// Only DRAFT and RETURNED are editable (plan doc §3.3). "SUBMITTED" and
// "DISTRICT_APPROVED"/"HO_APPROVED" are momentary pass-through statuses -
// see src/lib/findings.ts's transitionFinding() for why they still exist
// as real, briefly-held values instead of being skipped entirely.
export interface Finding {
  id: string;
  reference: string;
  sourceId: string;
  periodId: string;
  districtId: string;
  branchId: string;
  findingDate: string;
  operationArea: string;
  irregularityType: string;
  categoryId: string;
  amount: number;
  currency: string;
  caseCount: number;
  riskLevel: string;
  description: string;
  recommendation?: string;
  // Text reference only (e.g. "filed in branch cabinet, ref #4") - there is
  // no file/object storage in the app yet (BRD §3.12 flags this as an open
  // infra decision), so this deliberately isn't a real upload.
  evidenceNote?: string;
  status: FindingStatus;
  // Cumulative across all RectificationEntry rows for this finding.
  // Outstanding = caseCount - rectifiedCases / amount - rectifiedAmount,
  // computed on read rather than stored, so it can never drift.
  rectifiedCases: number;
  rectifiedAmount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface FindingTransition {
  id: string;
  findingId: string;
  fromStatus: string;
  toStatus: string;
  action: string;
  userId: string;
  userName: string;
  reason?: string;
  createdAt: string;
}

// One rectification event's own amount, not a running total - the running
// total lives on Finding.rectifiedCases/rectifiedAmount (see above), kept
// in lockstep by transitionFinding() in the same request that appends this.
export interface RectificationEntry {
  id: string;
  findingId: string;
  rectifiedCases: number;
  rectifiedAmount: number;
  note?: string;
  submittedBy: string;
  submittedByName: string;
  createdAt: string;
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
  findings: Finding[];
  findingTransitions: FindingTransition[];
  rectifications: RectificationEntry[];
  settings: Settings;
  auditLogs: AuditLogEntry[];
}
