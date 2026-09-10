import { prisma } from "@/lib/prismaClient";
import { Prisma } from "@/generated/prisma/client";
import type {
  Database,
  User,
  RoleDefinition,
  District,
  Branch,
  Source,
  Department,
  ClassifiedCategory,
  UncoveredReason,
  ScoringRule,
  ScoringAdjustment,
  ReportingPeriod,
  Finding,
  FindingTransition,
  RectificationEntry,
  FindingCase,
  FindingTransfer,
  FindingClosure,
  ImportBatch,
  Evidence,
  Comment,
  Notification,
  AuditLogEntry,
  BranchCoverageNote,
  Settings,
} from "@/types";

// ---------------------------------------------------------------------------
// "Local storage" data layer — now Postgres via Prisma (see
// prisma/schema.prisma for the relational shape this reassembles).
//
// Every read/write in the app still goes through readDb()/updateDb() only,
// same as when this was a single JSON file (see PHASE1.md §2) - nothing
// above this layer changed: every domain helper, API route, and page still
// just gets a plain `Database` object back and mutates it with plain
// array pushes/filters. The two things that DID have to change, because a
// real database makes them real for the first time:
//
//   1. Every call is now async - Postgres is a network round trip, the old
//      JSON file was a blocking local read. readDb()/updateDb() return
//      Promises now; every call site needs `await` in front of them (the
//      one mechanical, whole-codebase change this migration required).
//
//   2. updateDb()'s write step is a diff, not an overwrite. The JSON-file
//      version read the whole file, handed you the live object to mutate,
//      and serialized the *entire* object back - there was no such thing
//      as "only the changed rows." That doesn't map onto a real database
//      (nor would you want it to - rewriting every Finding on Earth every
//      time one status changes defeats the entire point of migrating).
//      Instead, updateDb() snapshots the database before your mutator
//      runs, diffs it against the result after, and issues targeted
//      Prisma create/update/delete calls - only for rows that actually
//      changed - inside one real transaction. See syncCollection() below.
//
//      This is a deliberate bridge, not the final idiomatic shape: a
//      hand-written Prisma app would have each route call
//      `prisma.finding.update(...)` directly instead of mutating a
//      big in-memory object and diffing it afterward. That's real,
//      valuable follow-up work, route by route, once this lands - but it
//      doesn't have to happen before every route in the app can run on a
//      real, correct, transactional Postgres database, which is what
//      this file delivers today.
// ---------------------------------------------------------------------------

// ---- date helpers: every Database type keeps timestamps as ISO strings
// (unchanged from the JSON-file version), every Prisma column is a real
// `DateTime` - conversion happens only here, invisible to every caller. ----
function iso(d: Date): string {
  return d.toISOString();
}
function isoOrUndef(d: Date | null): string | undefined {
  return d ? d.toISOString() : undefined;
}
function toDate(s: string): Date {
  return new Date(s);
}
function toDateOrNull(s: string | null | undefined): Date | null {
  return s ? new Date(s) : null;
}
function u<T>(v: T | null): T | undefined {
  return v === null ? undefined : v;
}

// =============================================================================
// READ SIDE — one mapper per entity, Prisma row -> the exact Database shape
// every existing caller already expects.
// =============================================================================

function roleFromRow(r: Prisma.RoleDefinitionGetPayload<object>): RoleDefinition {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: u(r.description),
    orgScope: r.orgScope,
    branchSingleton: r.branchSingleton,
    isSystem: r.isSystem,
    permissions: r.permissions,
    status: r.status,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function userFromRow(r: Prisma.UserGetPayload<object>): User {
  return {
    id: r.id,
    name: r.name,
    username: r.username,
    email: r.email,
    passwordHash: r.passwordHash,
    role: r.role,
    status: r.status,
    districtId: r.districtId,
    branchId: r.branchId,
    departmentId: u(r.departmentId),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    lastLoginAt: r.lastLoginAt ? iso(r.lastLoginAt) : null,
    mustChangePassword: r.mustChangePassword,
  };
}

function districtFromRow(r: Prisma.DistrictGetPayload<object>): District {
  return { id: r.id, code: r.code, name: r.name, status: r.status, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) };
}

function branchFromRow(r: Prisma.BranchGetPayload<object>): Branch {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    districtId: r.districtId,
    status: r.status,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function sourceFromRow(r: Prisma.SourceGetPayload<object>): Source {
  return { id: r.id, code: r.code, name: r.name, active: r.active, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) };
}

function departmentFromRow(r: Prisma.DepartmentGetPayload<object>): Department {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    active: r.active,
    orgScope: r.orgScope,
    districtId: r.districtId,
    branchId: r.branchId,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function categoryFromRow(r: Prisma.ClassifiedCategoryGetPayload<object>): ClassifiedCategory {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    scored: r.scored,
    active: r.active,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function uncoveredReasonFromRow(r: Prisma.UncoveredReasonGetPayload<object>): UncoveredReason {
  return { id: r.id, code: r.code, name: r.name, active: r.active, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) };
}

function scoringRuleFromRow(r: Prisma.ScoringRuleGetPayload<object>): ScoringRule {
  return {
    id: r.id,
    version: r.version,
    name: r.name,
    active: r.active,
    everActivated: r.everActivated,
    effectiveFrom: iso(r.effectiveFrom),
    categories: r.categories,
    sources: r.sources,
    basis: r.basis,
    formulaType: r.formulaType,
    createdBy: r.createdBy,
    createdAt: iso(r.createdAt),
  };
}

function scoringAdjustmentFromRow(r: Prisma.ScoringAdjustmentGetPayload<object>): ScoringAdjustment {
  return {
    id: r.id,
    targetType: r.targetType,
    targetId: r.targetId,
    periodId: r.periodId,
    value: r.value,
    reason: r.reason,
    adjustedBy: r.adjustedBy,
    createdAt: iso(r.createdAt),
  };
}

function periodFromRow(r: Prisma.ReportingPeriodGetPayload<object>): ReportingPeriod {
  return {
    id: r.id,
    year: r.year,
    month: r.month,
    code: r.code,
    startsAt: iso(r.startsAt),
    endsAt: iso(r.endsAt),
    submissionStartsAt: iso(r.submissionStartsAt),
    submissionEndsAt: iso(r.submissionEndsAt),
    status: r.status,
    lockedBy: r.lockedBy,
    lockedAt: r.lockedAt ? iso(r.lockedAt) : null,
    lockReason: r.lockReason,
    draftsAllowedWhileLocked: r.draftsAllowedWhileLocked,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function findingFromRow(r: Prisma.FindingGetPayload<object>): Finding {
  return {
    id: r.id,
    reference: r.reference,
    title: r.title,
    sourceId: r.sourceId ?? "",
    departmentId: r.departmentId ?? "",
    periodId: r.periodId,
    districtId: r.districtId,
    branchId: r.branchId,
    findingDate: r.findingDate,
    operationArea: r.operationArea,
    irregularityType: r.irregularityType,
    categoryId: r.categoryId ?? "",
    amount: r.amount,
    currency: r.currency,
    caseCount: r.caseCount,
    riskLevel: r.riskLevel,
    priority: r.priority,
    description: r.description,
    recommendation: u(r.recommendation),
    rootCause: u(r.rootCause),
    evidenceNote: u(r.evidenceNote),
    status: r.status,
    rectifiedCases: r.rectifiedCases,
    rectifiedAmount: r.rectifiedAmount,
    closedCases: r.closedCases,
    closedAmount: r.closedAmount,
    districtVerifiedCases: r.districtVerifiedCases,
    districtVerifiedAmount: r.districtVerifiedAmount,
    externalReference: u(r.externalReference),
    importBatchId: u(r.importBatchId),
    lastReminderAt: isoOrUndef(r.lastReminderAt),
    createdBy: r.createdBy,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function transitionFromRow(r: Prisma.FindingTransitionGetPayload<object>): FindingTransition {
  return {
    id: r.id,
    findingId: r.findingId,
    fromStatus: r.fromStatus,
    toStatus: r.toStatus,
    action: r.action,
    userId: r.userId,
    userName: r.userName,
    reason: u(r.reason),
    createdAt: iso(r.createdAt),
  };
}

function rectificationFromRow(r: Prisma.RectificationEntryGetPayload<object>): RectificationEntry {
  return {
    id: r.id,
    findingId: r.findingId,
    periodId: r.periodId,
    rectifiedCases: r.rectifiedCases,
    rectifiedAmount: r.rectifiedAmount,
    note: u(r.note),
    submittedBy: r.submittedBy,
    submittedByName: r.submittedByName,
    createdAt: iso(r.createdAt),
    caseIds: r.caseIds.length > 0 ? r.caseIds : undefined,
  };
}

function findingCaseFromRow(r: Prisma.FindingCaseGetPayload<object>): FindingCase {
  return {
    id: r.id,
    findingId: r.findingId,
    seq: r.seq,
    amount: r.amount,
    description: u(r.description),
    status: r.status,
    rectificationId: u(r.rectificationId),
    rectifiedAt: isoOrUndef(r.rectifiedAt),
    rectifiedBy: u(r.rectifiedBy),
    rectifiedByName: u(r.rectifiedByName),
    createdAt: iso(r.createdAt),
  };
}

function transferFromRow(r: Prisma.FindingTransferGetPayload<object>): FindingTransfer {
  return {
    id: r.id,
    findingId: r.findingId,
    fromPeriodId: r.fromPeriodId,
    toPeriodId: r.toPeriodId,
    casesTransferred: r.casesTransferred,
    amountTransferred: r.amountTransferred,
    originalCaseCount: r.originalCaseCount,
    originalAmount: r.originalAmount,
    caseAgeAtTransferDays: r.caseAgeAtTransferDays,
    reason: r.reason,
    createdBy: r.createdBy,
    createdByName: r.createdByName,
    createdAt: iso(r.createdAt),
    method: r.method,
  };
}

function closureFromRow(r: Prisma.FindingClosureGetPayload<object>): FindingClosure {
  return {
    id: r.id,
    findingId: r.findingId,
    periodId: r.periodId,
    closedCases: r.closedCases,
    closedAmount: r.closedAmount,
    submittedBy: r.submittedBy,
    submittedByName: r.submittedByName,
    createdAt: iso(r.createdAt),
  };
}

function importBatchFromRow(r: Prisma.ImportBatchGetPayload<object>): ImportBatch {
  return {
    id: r.id,
    fileName: r.fileName,
    importedBy: r.importedBy,
    importedByName: r.importedByName,
    totalRows: r.totalRows,
    importedCount: r.importedCount,
    duplicateCount: r.duplicateCount,
    errorCount: r.errorCount,
    rows: r.rows as unknown as ImportBatch["rows"],
    createdAt: iso(r.createdAt),
  };
}

function evidenceFromRow(r: Prisma.EvidenceGetPayload<object>): Evidence {
  return {
    id: r.id,
    findingId: r.findingId,
    commentId: r.commentId,
    fileName: r.fileName,
    mimeType: r.mimeType,
    size: r.size,
    storagePath: r.storagePath,
    uploadedBy: r.uploadedBy,
    uploadedByName: r.uploadedByName,
    createdAt: iso(r.createdAt),
  };
}

function commentFromRow(r: Prisma.CommentGetPayload<object>): Comment {
  return {
    id: r.id,
    findingId: r.findingId,
    parentCommentId: r.parentCommentId,
    authorId: r.authorId,
    authorName: r.authorName,
    text: r.text,
    createdAt: iso(r.createdAt),
  };
}

function notificationFromRow(r: Prisma.NotificationGetPayload<object>): Notification {
  return {
    id: r.id,
    recipientUserId: r.recipientUserId,
    type: r.type,
    title: r.title,
    message: r.message,
    entityType: r.entityType,
    entityId: r.entityId,
    readAt: r.readAt ? iso(r.readAt) : null,
    createdAt: iso(r.createdAt),
  };
}

function auditLogFromRow(r: Prisma.AuditLogEntryGetPayload<object>): AuditLogEntry {
  return {
    id: r.id,
    userId: r.userId,
    userName: r.userName,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    oldValue: r.oldValue ?? undefined,
    newValue: r.newValue ?? undefined,
    reason: u(r.reason),
    timestamp: iso(r.timestamp),
  };
}

function coverageNoteFromRow(r: Prisma.BranchCoverageNoteGetPayload<object>): BranchCoverageNote {
  return {
    id: r.id,
    branchId: r.branchId,
    periodId: r.periodId,
    reason: r.reason,
    reasonId: r.reasonId,
    recordedBy: r.recordedBy,
    recordedByName: r.recordedByName,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function settingsFromRow(r: Prisma.SettingsGetPayload<object>): Settings {
  return {
    currencies: r.currencies,
    riskLevels: r.riskLevels,
    operationAreas: r.operationAreas,
    priorityLevels: r.priorityLevels,
    irregularityTypes: r.irregularityTypes,
    notification: r.notification as unknown as Settings["notification"],
    autoTransferOnLock: r.autoTransferOnLock,
    rankingVisibility: r.rankingVisibility as unknown as Settings["rankingVisibility"],
    performanceThresholds: r.performanceThresholds as unknown as Settings["performanceThresholds"],
    hoApproval: r.hoApproval as unknown as Settings["hoApproval"],
    rectificationReminders: r.rectificationReminders as unknown as Settings["rectificationReminders"],
    similarFindingFields: r.similarFindingFields as Settings["similarFindingFields"],
    requiredFindingFields: r.requiredFindingFields as unknown as Settings["requiredFindingFields"],
    allowOtherValueFields: r.allowOtherValueFields as unknown as Settings["allowOtherValueFields"],
    updatedAt: iso(r.updatedAt),
    updatedBy: u(r.updatedBy),
  };
}

const SETTINGS_ID = "singleton";

export async function readDb(): Promise<Database> {
  const [
    roles,
    users,
    districts,
    branches,
    sources,
    departments,
    categories,
    uncoveredReasons,
    scoringRules,
    scoringAdjustments,
    reportingPeriods,
    findings,
    findingTransitions,
    rectifications,
    findingCases,
    findingTransfers,
    findingClosures,
    importBatches,
    evidence,
    comments,
    notifications,
    auditLogs,
    branchCoverageNotes,
    settingsRow,
  ] = await Promise.all([
    prisma.roleDefinition.findMany(),
    prisma.user.findMany(),
    prisma.district.findMany(),
    prisma.branch.findMany(),
    prisma.source.findMany(),
    prisma.department.findMany(),
    prisma.classifiedCategory.findMany(),
    prisma.uncoveredReason.findMany(),
    prisma.scoringRule.findMany(),
    prisma.scoringAdjustment.findMany(),
    prisma.reportingPeriod.findMany(),
    prisma.finding.findMany(),
    prisma.findingTransition.findMany(),
    prisma.rectificationEntry.findMany(),
    prisma.findingCase.findMany(),
    prisma.findingTransfer.findMany(),
    prisma.findingClosure.findMany(),
    prisma.importBatch.findMany(),
    prisma.evidence.findMany(),
    prisma.comment.findMany(),
    prisma.notification.findMany(),
    prisma.auditLogEntry.findMany(),
    prisma.branchCoverageNote.findMany(),
    prisma.settings.findUnique({ where: { id: SETTINGS_ID } }),
  ]);

  if (!settingsRow) {
    throw new Error(
      "No Settings row found (expected id='singleton') - run prisma/migrate-from-json.ts (or seed a default Settings row) before starting the app."
    );
  }

  return {
    roles: roles.map(roleFromRow),
    users: users.map(userFromRow),
    districts: districts.map(districtFromRow),
    branches: branches.map(branchFromRow),
    sources: sources.map(sourceFromRow),
    departments: departments.map(departmentFromRow),
    categories: categories.map(categoryFromRow),
    uncoveredReasons: uncoveredReasons.map(uncoveredReasonFromRow),
    scoringRules: scoringRules.map(scoringRuleFromRow),
    scoringAdjustments: scoringAdjustments.map(scoringAdjustmentFromRow),
    reportingPeriods: reportingPeriods.map(periodFromRow),
    findings: findings.map(findingFromRow),
    findingTransitions: findingTransitions.map(transitionFromRow),
    rectifications: rectifications.map(rectificationFromRow),
    findingCases: findingCases.map(findingCaseFromRow),
    findingTransfers: findingTransfers.map(transferFromRow),
    findingClosures: findingClosures.map(closureFromRow),
    importBatches: importBatches.map(importBatchFromRow),
    evidence: evidence.map(evidenceFromRow),
    comments: comments.map(commentFromRow),
    notifications: notifications.map(notificationFromRow),
    auditLogs: auditLogs.map(auditLogFromRow),
    branchCoverageNotes: branchCoverageNotes.map(coverageNoteFromRow),
    settings: settingsFromRow(settingsRow),
    permissionRegistrySyncedKeys: settingsRow.permissionRegistrySyncedKeys,
  };
}

// =============================================================================
// WRITE SIDE — diff each collection (by id) between the pre-mutation
// snapshot and the post-mutation state, and issue only the create/update/
// delete calls actually needed. See this file's own top doc comment for
// why this exists instead of a targeted Prisma call per route.
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDelegate = { create: (args: any) => Promise<unknown>; update: (args: any) => Promise<unknown>; delete: (args: any) => Promise<unknown> };

async function syncCollection<Row extends { id: string }>(
  delegate: AnyDelegate,
  before: Row[],
  after: Row[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toData: (row: Row) => any
): Promise<void> {
  const beforeById = new Map(before.map((r) => [r.id, r]));
  const afterById = new Map(after.map((r) => [r.id, r]));

  for (const id of beforeById.keys()) {
    if (!afterById.has(id)) {
      await delegate.delete({ where: { id } });
    }
  }
  for (const [id, row] of afterById) {
    const prev = beforeById.get(id);
    if (!prev) {
      await delegate.create({ data: { id, ...toData(row) } });
    } else if (JSON.stringify(prev) !== JSON.stringify(row)) {
      await delegate.update({ where: { id }, data: toData(row) });
    }
  }
}

function roleToData(r: RoleDefinition) {
  return {
    code: r.code,
    name: r.name,
    description: r.description ?? null,
    orgScope: r.orgScope,
    branchSingleton: r.branchSingleton,
    isSystem: r.isSystem,
    permissions: r.permissions,
    status: r.status,
    createdAt: toDate(r.createdAt),
    updatedAt: toDate(r.updatedAt),
  };
}

function userToData(r: User) {
  return {
    name: r.name,
    username: r.username,
    email: r.email ?? null,
    passwordHash: r.passwordHash,
    role: r.role,
    status: r.status,
    districtId: r.districtId ?? null,
    branchId: r.branchId ?? null,
    departmentId: r.departmentId ?? null,
    createdAt: toDate(r.createdAt),
    updatedAt: toDate(r.updatedAt),
    lastLoginAt: toDateOrNull(r.lastLoginAt),
    mustChangePassword: r.mustChangePassword ?? false,
  };
}

function districtToData(r: District) {
  return { code: r.code, name: r.name, status: r.status, createdAt: toDate(r.createdAt), updatedAt: toDate(r.updatedAt) };
}

function branchToData(r: Branch) {
  return {
    code: r.code,
    name: r.name,
    districtId: r.districtId,
    status: r.status,
    createdAt: toDate(r.createdAt),
    updatedAt: toDate(r.updatedAt),
  };
}

function sourceToData(r: Source) {
  return { code: r.code, name: r.name, active: r.active, createdAt: toDate(r.createdAt), updatedAt: toDate(r.updatedAt) };
}

function departmentToData(r: Department) {
  return {
    code: r.code,
    name: r.name,
    active: r.active,
    orgScope: r.orgScope,
    districtId: r.districtId ?? null,
    branchId: r.branchId ?? null,
    createdAt: toDate(r.createdAt),
    updatedAt: toDate(r.updatedAt),
  };
}

function categoryToData(r: ClassifiedCategory) {
  return {
    code: r.code,
    name: r.name,
    scored: r.scored,
    active: r.active,
    createdAt: toDate(r.createdAt),
    updatedAt: toDate(r.updatedAt),
  };
}

function uncoveredReasonToData(r: UncoveredReason) {
  return { code: r.code, name: r.name, active: r.active, createdAt: toDate(r.createdAt), updatedAt: toDate(r.updatedAt) };
}

function scoringRuleToData(r: ScoringRule) {
  return {
    version: r.version,
    name: r.name,
    active: r.active,
    everActivated: r.everActivated,
    effectiveFrom: toDate(r.effectiveFrom),
    categories: r.categories,
    sources: r.sources,
    basis: r.basis,
    formulaType: r.formulaType,
    createdBy: r.createdBy,
    createdAt: toDate(r.createdAt),
  };
}

function scoringAdjustmentToData(r: ScoringAdjustment) {
  return {
    targetType: r.targetType,
    targetId: r.targetId,
    periodId: r.periodId,
    districtId: r.targetType === "DISTRICT" ? r.targetId : null,
    branchId: r.targetType === "BRANCH" ? r.targetId : null,
    value: r.value,
    reason: r.reason,
    adjustedBy: r.adjustedBy,
    createdAt: toDate(r.createdAt),
  };
}

function periodToData(r: ReportingPeriod) {
  return {
    year: r.year,
    month: r.month,
    code: r.code,
    startsAt: toDate(r.startsAt),
    endsAt: toDate(r.endsAt),
    submissionStartsAt: toDate(r.submissionStartsAt),
    submissionEndsAt: toDate(r.submissionEndsAt),
    status: r.status,
    lockedBy: r.lockedBy ?? null,
    lockedAt: toDateOrNull(r.lockedAt),
    lockReason: r.lockReason ?? null,
    draftsAllowedWhileLocked: r.draftsAllowedWhileLocked,
    createdAt: toDate(r.createdAt),
    updatedAt: toDate(r.updatedAt),
  };
}

function findingToData(r: Finding) {
  return {
    reference: r.reference,
    title: r.title,
    // "" (this app's own "left blank" convention, per
    // Settings.requiredFindingFields) can never satisfy a foreign key -
    // converted to a real SQL NULL here, and back to "" by
    // findingFromRow()'s `?? ""` on the way out, so nothing outside this
    // file ever has to know the column is nullable.
    sourceId: r.sourceId || null,
    departmentId: r.departmentId || null,
    periodId: r.periodId,
    districtId: r.districtId,
    branchId: r.branchId,
    findingDate: r.findingDate,
    operationArea: r.operationArea,
    irregularityType: r.irregularityType,
    categoryId: r.categoryId || null,
    amount: r.amount,
    currency: r.currency,
    caseCount: r.caseCount,
    riskLevel: r.riskLevel,
    priority: r.priority,
    description: r.description,
    recommendation: r.recommendation ?? null,
    rootCause: r.rootCause ?? null,
    evidenceNote: r.evidenceNote ?? null,
    status: r.status,
    rectifiedCases: r.rectifiedCases,
    rectifiedAmount: r.rectifiedAmount,
    closedCases: r.closedCases,
    closedAmount: r.closedAmount,
    districtVerifiedCases: r.districtVerifiedCases,
    districtVerifiedAmount: r.districtVerifiedAmount,
    externalReference: r.externalReference ?? null,
    importBatchId: r.importBatchId ?? null,
    lastReminderAt: toDateOrNull(r.lastReminderAt),
    createdBy: r.createdBy,
    createdAt: toDate(r.createdAt),
    updatedAt: toDate(r.updatedAt),
  };
}

function transitionToData(r: FindingTransition) {
  return {
    findingId: r.findingId,
    fromStatus: r.fromStatus,
    toStatus: r.toStatus,
    action: r.action,
    userId: r.userId,
    userName: r.userName,
    reason: r.reason ?? null,
    createdAt: toDate(r.createdAt),
  };
}

function rectificationToData(r: RectificationEntry) {
  return {
    findingId: r.findingId,
    periodId: r.periodId,
    rectifiedCases: r.rectifiedCases,
    rectifiedAmount: r.rectifiedAmount,
    note: r.note ?? null,
    submittedBy: r.submittedBy,
    submittedByName: r.submittedByName,
    createdAt: toDate(r.createdAt),
    caseIds: r.caseIds ?? [],
  };
}

function findingCaseToData(r: FindingCase) {
  return {
    findingId: r.findingId,
    seq: r.seq,
    amount: r.amount,
    description: r.description ?? null,
    status: r.status,
    rectificationId: r.rectificationId ?? null,
    rectifiedAt: toDateOrNull(r.rectifiedAt),
    rectifiedBy: r.rectifiedBy ?? null,
    rectifiedByName: r.rectifiedByName ?? null,
    createdAt: toDate(r.createdAt),
  };
}

function transferToData(r: FindingTransfer) {
  return {
    findingId: r.findingId,
    fromPeriodId: r.fromPeriodId,
    toPeriodId: r.toPeriodId,
    casesTransferred: r.casesTransferred,
    amountTransferred: r.amountTransferred,
    originalCaseCount: r.originalCaseCount,
    originalAmount: r.originalAmount,
    caseAgeAtTransferDays: r.caseAgeAtTransferDays,
    reason: r.reason,
    createdBy: r.createdBy,
    createdByName: r.createdByName,
    createdAt: toDate(r.createdAt),
    method: r.method,
  };
}

function closureToData(r: FindingClosure) {
  return {
    findingId: r.findingId,
    periodId: r.periodId,
    closedCases: r.closedCases,
    closedAmount: r.closedAmount,
    submittedBy: r.submittedBy,
    submittedByName: r.submittedByName,
    createdAt: toDate(r.createdAt),
  };
}

function importBatchToData(r: ImportBatch) {
  return {
    fileName: r.fileName,
    importedBy: r.importedBy,
    importedByName: r.importedByName,
    totalRows: r.totalRows,
    importedCount: r.importedCount,
    duplicateCount: r.duplicateCount,
    errorCount: r.errorCount,
    rows: r.rows as object,
    createdAt: toDate(r.createdAt),
  };
}

function evidenceToData(r: Evidence) {
  return {
    findingId: r.findingId,
    commentId: r.commentId ?? null,
    fileName: r.fileName,
    mimeType: r.mimeType,
    size: r.size,
    storagePath: r.storagePath,
    uploadedBy: r.uploadedBy,
    uploadedByName: r.uploadedByName,
    createdAt: toDate(r.createdAt),
  };
}

function commentToData(r: Comment) {
  return {
    findingId: r.findingId,
    parentCommentId: r.parentCommentId ?? null,
    authorId: r.authorId,
    authorName: r.authorName,
    text: r.text,
    createdAt: toDate(r.createdAt),
  };
}

function notificationToData(r: Notification) {
  return {
    recipientUserId: r.recipientUserId,
    type: r.type,
    title: r.title,
    message: r.message,
    entityType: r.entityType,
    entityId: r.entityId,
    readAt: toDateOrNull(r.readAt),
    createdAt: toDate(r.createdAt),
  };
}

function auditLogToData(r: AuditLogEntry) {
  return {
    userId: r.userId,
    userName: r.userName,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    oldValue: (r.oldValue ?? Prisma.DbNull) as Prisma.InputJsonValue,
    newValue: (r.newValue ?? Prisma.DbNull) as Prisma.InputJsonValue,
    reason: r.reason ?? null,
    timestamp: toDate(r.timestamp),
  };
}

function coverageNoteToData(r: BranchCoverageNote) {
  return {
    branchId: r.branchId,
    periodId: r.periodId,
    reason: r.reason,
    reasonId: r.reasonId,
    recordedBy: r.recordedBy,
    recordedByName: r.recordedByName,
    createdAt: toDate(r.createdAt),
    updatedAt: toDate(r.updatedAt),
  };
}

async function persistChanges(before: Database, after: Database): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      // Reference/org data first (nothing meaningful depends on ordering
      // beyond what foreign keys already enforce at the database level -
      // this order just keeps parents ahead of children for clarity).
      await syncCollection(tx.roleDefinition, before.roles, after.roles, roleToData);
      await syncCollection(tx.district, before.districts, after.districts, districtToData);
      await syncCollection(tx.branch, before.branches, after.branches, branchToData);
      await syncCollection(tx.source, before.sources, after.sources, sourceToData);
      await syncCollection(tx.department, before.departments, after.departments, departmentToData);
      await syncCollection(tx.classifiedCategory, before.categories, after.categories, categoryToData);
      await syncCollection(tx.uncoveredReason, before.uncoveredReasons, after.uncoveredReasons, uncoveredReasonToData);
      await syncCollection(tx.user, before.users, after.users, userToData);
      await syncCollection(tx.scoringRule, before.scoringRules, after.scoringRules, scoringRuleToData);
      await syncCollection(tx.reportingPeriod, before.reportingPeriods, after.reportingPeriods, periodToData);
      await syncCollection(tx.scoringAdjustment, before.scoringAdjustments, after.scoringAdjustments, scoringAdjustmentToData);
      await syncCollection(tx.importBatch, before.importBatches, after.importBatches, importBatchToData);
      await syncCollection(tx.finding, before.findings, after.findings, findingToData);
      await syncCollection(tx.findingTransition, before.findingTransitions, after.findingTransitions, transitionToData);
      await syncCollection(tx.rectificationEntry, before.rectifications, after.rectifications, rectificationToData);
      await syncCollection(tx.findingCase, before.findingCases, after.findingCases, findingCaseToData);
      await syncCollection(tx.findingTransfer, before.findingTransfers, after.findingTransfers, transferToData);
      await syncCollection(tx.findingClosure, before.findingClosures, after.findingClosures, closureToData);
      await syncCollection(tx.comment, before.comments, after.comments, commentToData);
      await syncCollection(tx.evidence, before.evidence, after.evidence, evidenceToData);
      await syncCollection(tx.notification, before.notifications, after.notifications, notificationToData);
      await syncCollection(tx.auditLogEntry, before.auditLogs, after.auditLogs, auditLogToData);
      await syncCollection(tx.branchCoverageNote, before.branchCoverageNotes, after.branchCoverageNotes, coverageNoteToData);

      // Settings is a genuine singleton (always id="singleton") plus
      // permissionRegistrySyncedKeys, which the Database shape carries as
      // its own top-level array but which lives on the same row in
      // Postgres - always upserted together, only when either changed.
      const settingsChanged =
        JSON.stringify(before.settings) !== JSON.stringify(after.settings) ||
        JSON.stringify(before.permissionRegistrySyncedKeys) !== JSON.stringify(after.permissionRegistrySyncedKeys);
      if (settingsChanged) {
        const s = after.settings;
        const data = {
          currencies: s.currencies,
          riskLevels: s.riskLevels,
          operationAreas: s.operationAreas,
          priorityLevels: s.priorityLevels,
          irregularityTypes: s.irregularityTypes,
          notification: s.notification as object,
          autoTransferOnLock: s.autoTransferOnLock,
          rankingVisibility: s.rankingVisibility as object,
          performanceThresholds: s.performanceThresholds as object,
          hoApproval: s.hoApproval as object,
          rectificationReminders: s.rectificationReminders as object,
          similarFindingFields: s.similarFindingFields,
          requiredFindingFields: s.requiredFindingFields as object,
          allowOtherValueFields: s.allowOtherValueFields as object,
          permissionRegistrySyncedKeys: after.permissionRegistrySyncedKeys,
          updatedAt: toDate(s.updatedAt),
          updatedBy: s.updatedBy ?? null,
        };
        await tx.settings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, ...data }, update: data });
      }
    },
    // Historical-import and bulk-registration routes touch many rows in
    // one call; Prisma's interactive-transaction default timeout (5s) is
    // too tight for that under the row-by-row diff strategy above.
    { timeout: 30_000 }
  );
}

/** Read-modify-write helper to avoid repeating the read/mutate/write dance. */
export async function updateDb<T>(mutator: (db: Database) => T): Promise<T> {
  const before = await readDb();
  const after: Database = JSON.parse(JSON.stringify(before));
  const result = mutator(after);
  await persistChanges(before, after);
  return result;
}
