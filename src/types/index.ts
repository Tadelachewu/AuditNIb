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
  // Optional - not every role needs one, and it must be in scope for the
  // user's own districtId/branchId (see src/lib/org.ts's
  // isDepartmentInScope, enforced in the admin/users API routes).
  departmentId?: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string | null;
  // Set true whenever someone other than the user themself sets their
  // password - initial account creation, or an admin's password reset via
  // PATCH /api/admin/users/[id] - since in both cases the user didn't
  // choose that password and it may be known to whoever set it. Cleared
  // the moment the user successfully changes their own password from
  // their profile (POST /api/auth/change-password). src/proxy.ts redirects
  // every page but /profile until this clears.
  mustChangePassword?: boolean;
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

// Which internal department a finding belongs to (Credit, IT, Operations,
// etc.) - admin-managed reference data, same shape/lifecycle as Source,
// plus an org scope (same OrgScope/districtId/branchId pattern as User and
// RoleDefinition): a BANK department is available bank-wide, a DISTRICT
// department only to findings in that district, a BRANCH department only
// to findings at that branch (see findings-scope-style filtering in
// NewFindingForm.tsx).
export interface Department {
  id: string;
  code: string;
  name: string;
  active: boolean;
  orgScope: OrgScope;
  districtId?: string | null;
  branchId?: string | null;
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
  // Set true the first time `active` ever becomes true, and never reset -
  // a version that has ever gone live may have already been used to
  // compute historical performance, so once true it permanently blocks
  // edit/delete regardless of `active`'s current value (see PATCH/DELETE
  // in src/app/api/admin/scoring-rules/[id]/route.ts).
  everActivated: boolean;
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
  // The actual reporting window, to the minute - filled in when the
  // period is opened, not just derived from year/month. `year`/`month`
  // (and `code`) are derived from `startsAt` at creation time and kept as
  // their own fields since the rest of the app (nextFindingReference(),
  // performance-period lookups) already keys off them.
  startsAt: string;
  endsAt: string;
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
  // Admin-configurable, same pattern as currencies/riskLevels - a bank's
  // list of operational areas isn't fixed, so it's data, not code (see the
  // Finding registration form).
  operationAreas: string[];
  priorityLevels: string[];
  irregularityTypes: string[];
  notification: NotificationSettings;
  // When true, locking a reporting period automatically transfers every
  // still-outstanding finding in it to the next OPEN period (earliest
  // year/month after the one being locked) - see lockPeriod() in
  // src/lib/findings.ts. A finding already transferred manually before
  // the lock is naturally skipped (it's no longer in that period).
  autoTransferOnLock: boolean;
  // Independent per organizational level: when false, ranking/comparison
  // widgets (District Ranking, Branch Comparison, Top-Performing
  // Branches/Districts) are hidden from every dashboard regardless of who's
  // viewing - a user still sees their own org unit's own performance
  // number, just not how it stacks up against others.
  rankingVisibility: {
    branches: boolean;
    districts: boolean;
  };
  // Drives the Top/Bottom Performers widgets on HO/District/Executive
  // dashboards: a district/branch qualifies as a "top performer" at or
  // above topPercent, a "bottom performer" at or below bottomPercent -
  // admin-configurable rather than a fixed top-5/bottom-5-by-rank cut, so
  // the list can legitimately be empty (nobody qualifies yet) or include
  // everyone that clears the bar, not just a fixed count.
  performanceThresholds: {
    topPercent: number;
    bottomPercent: number;
  };
  // A finding registered by a BANK-scoped user (HO Controller, Admin) can
  // optionally skip the normal District->HO review chain (there's no
  // natural "district" to review an HO-originated finding) and instead go
  // through this single, admin-configured approval step - or none at all,
  // if `required` is off, in which case it's queued straight to the
  // Branch Manager the moment it's submitted. `approverUserIds` is a
  // specific, admin-picked list of individual users (not a role/
  // permission grant), always drawn from BANK-scoped users only (enforced
  // in the settings PATCH route) - see PENDING_BANK_APPROVAL in
  // FINDING_STATUSES and bank-approval/route.ts.
  hoApproval: {
    required: boolean;
    approverUserIds: string[];
  };
  // Document_3 §30's "Rectification Reminder - System -> Branch Manager":
  // there's no cron/scheduler in this app, so this is checked lazily
  // (see checkRectificationReminders() in src/lib/notifications.ts) off
  // the existing 30-second notification poll rather than a real
  // time-based job - lastCheckedAt throttles that to at most once per
  // scan interval instead of every poll from every user.
  rectificationReminders: {
    enabled: boolean;
    thresholdDays: number;
    lastCheckedAt?: string;
  };
  updatedAt: string;
  updatedBy?: string;
}

// The BRD's literal workflow state list (master.txt §11 + the roadmap doc's
// clean one-liner). TRANSFERRED is reached via the Transfer Engine
// (BRD §3.7, src/lib/findings.ts's transferFinding()) - see PHASE7.md.
export const FINDING_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "DISTRICT_REVIEW",
  "DISTRICT_APPROVED",
  "HO_REVIEW",
  "HO_APPROVED",
  // A bank-wide (HO/Admin)-registered finding's optional single approval
  // step, when Settings.hoApproval.required is on - see submitFinding()'s
  // branch in src/lib/findings.ts and bank-approval/route.ts. Skipped
  // entirely (straight from SUBMITTED to SENT_TO_BRANCH_MANAGER) when the
  // setting is off, and never reached at all for a branch/district-
  // originated finding, which still always goes through
  // DISTRICT_REVIEW/HO_REVIEW as before.
  "PENDING_BANK_APPROVAL",
  "SENT_TO_BRANCH_MANAGER",
  "PARTIALLY_RECTIFIED",
  "RECTIFIED",
  "TRANSFERRED",
  // A District/HO Controller reviewing a recorded rectification can send
  // it back to the branch instead of closing/partially closing/
  // transferring it - a mandatory reason is required (see
  // return-rectification/route.ts). Blocks close/transfer until the
  // Branch Manager addresses it and resubmits (resubmit-rectification/
  // route.ts), which moves it back to PARTIALLY_RECTIFIED/RECTIFIED based
  // on the (unchanged) totals - or they can just record more
  // rectification directly, which does the same via the normal rectify
  // flow.
  "RECTIFICATION_RETURNED",
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
  title: string;
  sourceId: string;
  departmentId: string;
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
  priority: string;
  description: string;
  recommendation?: string;
  // Optional, free text - "why did this happen," distinct from
  // `description` ("what happened"). Never required, same as recommendation.
  rootCause?: string;
  // A free-text note alongside the real uploaded files in Evidence
  // (src/lib/evidence.ts) - e.g. "original signed by branch manager, filed
  // in branch cabinet ref #4" - context a scanned file alone doesn't carry.
  evidenceNote?: string;
  status: FindingStatus;
  // Cumulative across all RectificationEntry rows for this finding.
  // Outstanding = caseCount - rectifiedCases / amount - rectifiedAmount,
  // computed on read rather than stored, so it can never drift.
  rectifiedCases: number;
  rectifiedAmount: number;
  // Cumulative across all FindingClosure rows for this finding - always
  // <= rectifiedCases/rectifiedAmount, never ahead of it (you can only
  // verify-and-close what's actually been rectified). A controller can
  // close whatever's currently rectified-but-unclosed at any time; the
  // still-unrectified remainder stays open regardless. Status only moves
  // to CLOSED once these reach caseCount/amount - short of that, the
  // finding's status keeps tracking rectify/transfer progress as before.
  closedCases: number;
  closedAmount: number;
  // Cumulative across every DISTRICT_VERIFY_RECTIFICATION action for this
  // finding, same lagging-progress pattern as closedCases/closedAmount:
  // the District Controller's approval of a recorded rectification, a
  // required gate before any of it becomes closable (see close/route.ts's
  // closable-amount bound and verify-rectification/route.ts). Always
  // <= rectifiedCases/rectifiedAmount, and closedCases/closedAmount can
  // never get ahead of *this*, in turn - a District Controller must
  // approve a rectification before HO (or District itself) can close it,
  // "before it reaches HO" per the workflow gap this closes.
  districtVerifiedCases: number;
  districtVerifiedAmount: number;
  // master.txt §22: "Preserve historical source and identifiers where
  // available" - the source system's own id/reference for this finding
  // (e.g. a legacy Internal Audit tracking number), distinct from
  // `reference` above which is always system-generated, never taken from
  // an import row. Only ever set by the Excel import path.
  externalReference?: string;
  // Which ImportBatch created this finding, if it came from one - lets a
  // controller trace any finding back to the exact import run (and
  // reconciliation report) that produced it.
  importBatchId?: string;
  // When the last automated rectification-reminder notification fired for
  // this finding, so the lazy check in checkRectificationReminders()
  // (src/lib/notifications.ts) never re-reminds inside the same
  // Settings.rectificationReminders.thresholdDays window.
  lastReminderAt?: string;
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
// periodId is a *snapshot* of finding.periodId at the moment this entry
// was recorded, not a live reference - a transfer changes finding.periodId
// afterward, and a rectification that happened before that transfer must
// stay attributed to the period it actually occurred in (BR: "every
// rectification is a transaction linked to user, date and period").
export interface RectificationEntry {
  id: string;
  findingId: string;
  periodId: string;
  rectifiedCases: number;
  rectifiedAmount: number;
  note?: string;
  submittedBy: string;
  submittedByName: string;
  createdAt: string;
  // Set only when the finding is itemized (has FindingCase rows) - the
  // specific cases this entry rectified, so "the Branch Manager may
  // rectify only Case 2" (Document_3 §12) is a real, traceable link
  // instead of just a count/amount that happens to match. Absent for a
  // non-itemized finding's plain numeric rectification (unchanged from
  // before FindingCase existed).
  caseIds?: string[];
}

// Document_3 §12/§34: "A finding containing three cases should not be
// permanently treated as one indivisible record... the production
// database should be capable of tracking the individual cases." Optional,
// case-level itemization layered on top of Finding's existing aggregate
// caseCount/amount - a finding either has zero FindingCase rows (today's
// behavior, completely unchanged: rectify by typing a case count/amount)
// or exactly `caseCount` of them, one per case, whose amounts sum to
// `Finding.amount`. When present, rectifying switches from typing numbers
// to picking specific still-OUTSTANDING cases (see rectify/route.ts),
// which is what actually makes "rectify only Case 2" a stored fact rather
// than a free-text note.
export interface FindingCase {
  id: string;
  findingId: string;
  seq: number;
  amount: number;
  description?: string;
  status: "OUTSTANDING" | "RECTIFIED";
  rectificationId?: string;
  rectifiedAt?: string;
  rectifiedBy?: string;
  rectifiedByName?: string;
  createdAt: string;
}

// A transfer moves an existing finding's periodId forward - it is never a
// new Finding row (master.txt §8: "a transferred case is a continuation,
// not a new finding"). This row is the permanent record of one hop in that
// chain; findingId stays constant across any number of consecutive
// transfers, so the full chain is just every row with that findingId.
export interface FindingTransfer {
  id: string;
  findingId: string;
  fromPeriodId: string;
  toPeriodId: string;
  // The outstanding balance actually carried forward - what's transferred.
  casesTransferred: number;
  amountTransferred: number;
  // Document_3 §15's "Original Amount"/"Original Case Count" - the
  // finding's *full* caseCount/amount as of this specific hop, snapshotted
  // rather than read live off the finding later. A finding transferred
  // more than once keeps the same original totals at every hop (they
  // don't change finding-to-finding), but snapshotting each hop makes
  // every FindingTransfer row a complete, self-contained historical
  // record on its own, matching how RectificationEntry/FindingClosure
  // already snapshot their own periodId rather than trusting a live
  // finding reference.
  originalCaseCount: number;
  originalAmount: number;
  // Document_3 §15's "Case Age" - days since the finding's original
  // createdAt (caseAgeDays() in src/lib/findings.ts), as of this transfer,
  // not recomputed live later.
  caseAgeAtTransferDays: number;
  reason: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  // MANUAL = a District/HO Controller's own transfer action. AUTOMATIC =
  // the system swept it forward when its period locked (only if the
  // Admin has enabled that in Settings - see syncAutoTransferOnLock() in
  // src/lib/findings.ts). A finding manually transferred before its
  // period locks simply isn't in that period any more by the time the
  // lock's automatic sweep runs - the periodId move IS the dedupe, no
  // separate bookkeeping needed.
  method: "MANUAL" | "AUTOMATIC";
}

// One verify-and-close event's own amount, not a running total - mirrors
// RectificationEntry (the running total lives on
// Finding.closedCases/closedAmount, kept in lockstep by the close route in
// the same request that appends this). periodId is a snapshot of
// finding.periodId at the moment of closure, same reasoning as
// RectificationEntry: a later transfer must not retroactively change which
// period this closure is attributed to.
export interface FindingClosure {
  id: string;
  findingId: string;
  periodId: string;
  closedCases: number;
  closedAmount: number;
  submittedBy: string;
  submittedByName: string;
  createdAt: string;
}

// master.txt §22's "reconcile imported totals... document any
// transformation" - the permanent record of one Excel import run, kept
// even after the findings it created move through their own workflow, so
// a controller can always answer "which import produced these, and what
// did the source file actually contain at the time." Never mutated after
// creation - a re-import is a new ImportBatch, not an edit to this one.
export interface ImportBatchRow {
  rowNumber: number;
  outcome: "imported" | "duplicate" | "error";
  findingId?: string;
  reference?: string;
  duplicateOfReference?: string;
  error?: string;
}

export interface ImportBatch {
  id: string;
  fileName: string;
  importedBy: string;
  importedByName: string;
  totalRows: number;
  importedCount: number;
  duplicateCount: number;
  errorCount: number;
  rows: ImportBatchRow[];
  createdAt: string;
}

// Real uploaded files (see src/lib/evidence.ts) - stored on local disk
// under data/uploads/, metadata here. storagePath is server-generated
// (never derived from the user's filename) to rule out path traversal;
// fileName is the original name, display-only.
// master.txt §12/§15's attachment entity is keyed to "finding/comment" -
// modeled here as one Evidence table, always tied to a Finding, optionally
// further scoped to one Comment on it (BR-WF-018: "Users may add
// attachments to comments where permitted"). commentId unset = a
// finding-level attachment (the original Phase 7 behavior); set = an
// attachment on that specific comment, shown inline under it.
export interface Evidence {
  id: string;
  findingId: string;
  commentId?: string | null;
  fileName: string;
  mimeType: string;
  size: number;
  storagePath: string;
  uploadedBy: string;
  uploadedByName: string;
  createdAt: string;
}

// One level of threading: a top-level comment has no parentCommentId, a
// reply has the id of the comment it replies to. Not arbitrarily nested -
// nothing in the BRD calls for deeper threading than that.
export interface Comment {
  id: string;
  findingId: string;
  parentCommentId?: string | null;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  recipientUserId: string;
  type: string;
  title: string;
  message: string;
  entityType: string;
  entityId: string;
  readAt?: string | null;
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
  departments: Department[];
  categories: ClassifiedCategory[];
  scoringRules: ScoringRule[];
  scoringAdjustments: ScoringAdjustment[];
  reportingPeriods: ReportingPeriod[];
  findings: Finding[];
  findingTransitions: FindingTransition[];
  rectifications: RectificationEntry[];
  findingTransfers: FindingTransfer[];
  findingClosures: FindingClosure[];
  importBatches: ImportBatch[];
  findingCases: FindingCase[];
  // Every permission key that has ever been auto-reconciled onto the
  // ADMIN role (see src/lib/db.ts's syncAdminPermissions()) - lets a
  // brand-new key added to PAGE_REGISTRY get auto-granted to ADMIN
  // exactly once (so registry growth never silently strips access) while
  // never re-adding a key an admin has since deliberately unchecked via
  // /admin/roles.
  permissionRegistrySyncedKeys: string[];
  evidence: Evidence[];
  comments: Comment[];
  notifications: Notification[];
  settings: Settings;
  auditLogs: AuditLogEntry[];
}
