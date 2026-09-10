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
  // Optional - existing/seeded users predate this field, and not every
  // account needs one to log in (username/password is still the only
  // login credential). Where notification emails actually get sent - see
  // src/lib/mail.ts - and, unlike display name, editable by the user
  // themself (src/app/api/auth/email/route.ts) since it carries no
  // audit-attribution weight the way name does.
  email?: string | null;
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
  // Set alongside mustChangePassword: a temporary/admin-set password is
  // only good for 24h - the login route rejects it outright once this
  // passes, rather than letting someone in on a password an admin chose
  // (and may still know) indefinitely. Cleared together with
  // mustChangePassword once the user sets their own password.
  passwordExpiresAt?: string | null;
  // Bumped on every password change (see /api/auth/change-password and
  // the admin password-reset branch of PATCH /api/admin/users/[id]) and
  // compared against the session cookie's own copy on every guarded
  // request (src/lib/guard.ts's requireUser()) - the standard technique
  // for revoking an already-issued, otherwise-stateless session cookie
  // without a server-side session store: change the password, and every
  // *other* still-logged-in session for this user stops working on its
  // very next request, not just whenever that cookie would have expired
  // naturally.
  sessionVersion: number;
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
  // The narrower window inside startsAt..endsAt during which a finding
  // can actually be SUBMITTED (moved past DRAFT) - see
  // assertPeriodOpenForSubmission() in src/lib/findings.ts. Independent
  // of startsAt/endsAt (the period's own overall reporting window) and
  // independent of status/locking - this only ever tightens the already-
  // OPEN case, it doesn't replace the lock mechanism. Defaults to exactly
  // matching startsAt/endsAt at creation (submission allowed for the
  // period's entire span), but an admin can narrow it - e.g. the period
  // covers all of September, but branches should only submit new findings
  // in the first two weeks.
  submissionStartsAt: string;
  submissionEndsAt: string;
  status: PeriodStatus;
  lockedBy?: string | null;
  lockedAt?: string | null;
  lockReason?: string | null;
  // Whether a finding can still be created/edited as a DRAFT while this
  // period is LOCKED - everything past DRAFT (submit and beyond) remains a
  // hard stop regardless of this flag. Irrelevant while OPEN.
  draftsAllowedWhileLocked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationSettings {
  provider: "NONE" | "SMTP" | "GRAPH";
  fromAddress: string;
  smtpHost?: string;
  smtpPort?: number;
}

// The candidate fields the Register Finding form's duplicate-suggestion
// lookup (src/app/api/findings/similar/route.ts) can compare on - every
// one an exact-equality match (never a fuzzy/numeric-range one). Which
// subset actually applies is entirely a matter of admin config
// (Settings.similarFindingFields, same "let the admin decide" philosophy
// as Settings.requiredFindingFields) - every field the Register Finding
// form itself collects is a candidate here, nothing hardcoded-excluded.
// externalReference is deliberately NOT included even though it's a real
// Finding field: it only exists on imported findings (see src/lib/import.ts)
// and has no input on the interactive form at all, so this route's own
// "every configured field must have a value from the in-progress form"
// rule (see that route) could never be satisfied for it - an admin
// checking it would silently disable suggestions entirely rather than
// narrow them. SIMILAR_FINDING_FIELDS is the full menu + display labels,
// shared by that route and the admin Settings page so there's exactly one
// place a new candidate field gets added.
export const SIMILAR_FINDING_FIELDS = [
  { key: "districtId", label: "District" },
  { key: "branchId", label: "Branch" },
  { key: "sourceId", label: "Source" },
  { key: "departmentId", label: "Department" },
  { key: "categoryId", label: "Classified case" },
  { key: "periodId", label: "Reporting period" },
  { key: "findingDate", label: "Finding date" },
  { key: "operationArea", label: "Operation area" },
  { key: "irregularityType", label: "Type of irregularity" },
  { key: "amount", label: "Amount" },
  { key: "currency", label: "Currency" },
  { key: "caseCount", label: "Number of cases" },
  { key: "riskLevel", label: "Risk level" },
  { key: "priority", label: "Priority" },
  { key: "title", label: "Title" },
  { key: "description", label: "Description" },
  { key: "recommendation", label: "Recommendation" },
  { key: "rootCause", label: "Root cause" },
  { key: "evidenceNote", label: "Evidence note" },
] as const;
export type SimilarFindingField = (typeof SIMILAR_FINDING_FIELDS)[number]["key"];

// Every registration-form field a bank might legitimately want to make
// optional, as a matter of admin policy rather than a fixed form -
// REQUIRABLE_FINDING_FIELDS is the full menu + display labels, shared by
// the create/edit routes, the bulk import validator, and the admin
// Settings page, same convention as SIMILAR_FINDING_FIELDS just above.
// Deliberately excludes exactly five fields, none of which are
// "descriptive content" in the sense every field below is - each is
// either the axis the whole app organizes/secures data around, or a
// quantity with no sensible blank state:
//   - periodId: every dashboard, report, lock/transfer computation
//     filters by Finding.periodId - a finding with none would be invisible
//     everywhere and unreachable by the Transfer Engine.
//   - districtId/branchId: the organizational-scope security boundary
//     itself (assertFindingInScope/findingsInScope) - not descriptive
//     content a registrant fills in, but the identity of whose data this
//     is; leaving either blank would break the scoping every dashboard
//     and permission check relies on.
//   - amount/caseCount: the actual quantities every performance
//     percentage, rectification, and closure calculation sums - a finding
//     fundamentally represents "N cases worth some amount," so there's no
//     coherent "blank" state, unlike a narrative field that can simply be
//     empty.
// Every field below this comment, by contrast, can be blank ("") without
// breaking anything structural - at most it drops out of a report filter
// or a dashboard grouping that already tolerates an unmatched value.
export const REQUIRABLE_FINDING_FIELDS = [
  { key: "title", label: "Finding title" },
  { key: "sourceId", label: "Source" },
  { key: "departmentId", label: "Department" },
  { key: "findingDate", label: "Finding date" },
  { key: "operationArea", label: "Operation area" },
  { key: "irregularityType", label: "Type of irregularity" },
  { key: "categoryId", label: "Classified case" },
  { key: "currency", label: "Currency" },
  { key: "riskLevel", label: "Risk level" },
  { key: "priority", label: "Priority" },
  { key: "description", label: "Description" },
  { key: "recommendation", label: "Recommendation" },
  { key: "rootCause", label: "Root cause" },
  { key: "evidenceNote", label: "Evidence note" },
] as const;
export type RequirableFindingField = (typeof REQUIRABLE_FINDING_FIELDS)[number]["key"];

// The Settings-configurable *list* fields on the Register Finding form
// (operation area/irregularity type/priority/risk level/currency -
// everything else on the form besides categoryId is a real linked record
// with its own id, like source/department, which can't take a typed-in
// value at all, or already free text with nothing to be "Other" than).
// Whether each one's dropdown also offers "Other (type in)" - a value not
// currently in the admin's configured list - is itself admin policy, not
// a fixed code-level decision, same "matter of config" philosophy as
// REQUIRABLE_FINDING_FIELDS/SIMILAR_FINDING_FIELDS above.
//
// categoryId is the one exception among the id-linked fields: admin policy
// decided its "Other" value is stored as plain text directly in
// Finding.categoryId, with no backing ClassifiedCategory record - unlike
// source/department, which have no escape hatch at all. That trades away
// referential integrity for that finding (it won't match any
// ScoringRule.categories entry, and category-grouped reports/dashboards
// will just show the typed text as its own ad-hoc bucket) in exchange for
// never blocking registration on the admin's list being incomplete.
export const OTHER_VALUE_ALLOWED_FIELDS = [
  { key: "operationArea", label: "Operation area" },
  { key: "irregularityType", label: "Type of irregularity" },
  { key: "priority", label: "Priority" },
  { key: "riskLevel", label: "Risk level" },
  { key: "currency", label: "Currency" },
  { key: "categoryId", label: "Classified case" },
] as const;
export type OtherValueAllowedField = (typeof OTHER_VALUE_ALLOWED_FIELDS)[number]["key"];

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
  // Which of SIMILAR_FINDING_FIELDS the duplicate-suggestion lookup on the
  // Register Finding form requires to match before flagging a finding as a
  // likely duplicate - see that route's own doc comment. Every configured
  // field must match (AND, not OR) and must actually have a value on the
  // in-progress form, or nothing is suggested at all.
  similarFindingFields: SimilarFindingField[];
  // Which of REQUIRABLE_FINDING_FIELDS must be filled in to register or
  // edit a finding - a bank policy decision, not a fixed form (see that
  // const's own doc comment for the full menu, and for exactly which five
  // fields - periodId/districtId/branchId/amount/caseCount - are
  // deliberately NOT here and why). Every key defaults to `true` (today's
  // fully-required behavior) so an existing install sees zero change
  // until an admin actually opts a field out - see the normalizeDb()
  // backfill.
  requiredFindingFields: Record<RequirableFindingField, boolean>;
  // Whether each of OTHER_VALUE_ALLOWED_FIELDS' dropdowns offers
  // "Other (type in)" on the Register Finding form - see that const's own
  // doc comment. Every key defaults to `true` (today's behavior) so an
  // existing install sees zero change until an admin actually opts a
  // field out - see the normalizeDb() backfill. Turning one off only
  // blocks *new* custom entries; an existing finding whose value was
  // typed in before the field was locked down keeps displaying and
  // remains editable, it just can't be freshly chosen again from a blank
  // start once disabled.
  allowOtherValueFields: Record<OtherValueAllowedField, boolean>;
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
  branchCoverageNotes: BranchCoverageNote[];
  uncoveredReasons: UncoveredReason[];
}

// Admin-configurable canned reasons offered on the Uncovered Branches
// report (see BranchCoverageNote.reasonId below) - same shape/lifecycle as
// Source/Department (code + name + active), managed at
// /admin/uncovered-reasons. The reporter can always fall back to a free-
// text "Other" reason instead of picking one of these (see ReasonPicker).
export interface UncoveredReason {
  id: string;
  code: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// The Uncovered Branches report template's one piece of writable state: why
// a branch has zero findings for a period (resigned, on leave, no
// controller assigned, ...) - everything else every report template shows
// is computed live off existing Finding records, never stored separately.
// At most one note per branch+period; recording/editing it is gated by the
// same report-templates.uncovered-branches permission that lets you view
// the report at all (a low-stakes annotation, not a distinct mutation
// class), not a separate action.
export interface BranchCoverageNote {
  id: string;
  branchId: string;
  periodId: string;
  reason: string;
  // Which UncoveredReason the reporter picked from the admin-configured
  // list, or null when they chose "Other" and typed `reason` by hand (or
  // for a note recorded before this field existed). `reason` itself is
  // always the display text either way - this is only for traceability
  // back to the canned list, e.g. to block deleting a reason still in use.
  reasonId: string | null;
  recordedBy: string;
  recordedByName: string;
  createdAt: string;
  updatedAt: string;
}
