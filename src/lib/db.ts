import { prisma } from "@/lib/prismaClient";
import { packCaseDetail, unpackCaseDetail } from "@/lib/adjustments/storage";
import { Prisma } from "@/generated/prisma/client";
import { ALL_PERMISSION_KEYS } from "@/lib/permissions/registry";
import { prepareQueuedEmails } from "@/lib/emailQueue/service";
import { ConflictError } from "@/lib/errors";
import { getRequestContext } from "@/lib/requestContext";
import { assertAuditLogAppendOnly, auditFindingFieldChanges } from "@/lib/auditCompleteness";
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
  ReportingPeriod,
  Finding,
  FindingTransition,
  RectificationEntry,
  FindingCase,
  FindingTransfer,
  FindingClosure,
  FindingAdjustment,
  ImportBatch,
  Evidence,
  Comment,
  Notification,
  AuditLogEntry,
  BranchCoverageNote,
  Settings,
  SupportThread,
  SupportMessage,
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
    phone: u(r.phone),
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
    passwordExpiresAt: r.passwordExpiresAt ? iso(r.passwordExpiresAt) : null,
    sessionVersion: r.sessionVersion,
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

// The sources PATCH route keeps at most one active default on every write,
// but rows written before that rule (or edited directly in the DB) can
// still carry several - or an inactive one. Normalize on read so every
// consumer (Sources admin, Register Finding pre-fill) sees exactly one:
// the most recently updated active row flagged default. The next write
// through updateDb() persists the cleaned-up flags.
function singleDefaultSource(sources: Source[]): Source[] {
  const winner = sources
    .filter((s) => s.isDefault && s.active)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return sources.map((s) => {
    const keep = s.id === winner?.id;
    return keep === s.isDefault ? s : { ...s, isDefault: keep };
  });
}

function sourceFromRow(r: Prisma.SourceGetPayload<object>): Source {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    active: r.active,
    isDefault: r.isDefault,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
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

function periodFromRow(r: Prisma.ReportingPeriodGetPayload<object>): ReportingPeriod {
  return {
    id: r.id,
    year: r.year,
    month: r.month,
    code: r.code,
    name: r.name,
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
    registeredCaseCount: r.registeredCaseCount,
    registeredAmount: r.registeredAmount,
    riskLevel: r.riskLevel,
    priority: r.priority,
    description: r.description,
    recommendation: u(r.recommendation),
    rootCause: u(r.rootCause),
    evidenceNote: u(r.evidenceNote),
    status: r.status,
    registeredByBankScope: r.registeredByBankScope,
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

function adjustmentFromRow(r: Prisma.FindingAdjustmentGetPayload<object>): FindingAdjustment {
  return {
    id: r.id,
    findingId: r.findingId,
    periodId: r.periodId,
    status: r.status as FindingAdjustment["status"],
    addedCases: r.addedCases,
    amountChange: r.amountChange,
    newCaseAmounts: r.newCaseAmounts,
    ...unpackCaseDetail(r.caseAmountChanges, r.newCaseAmounts.length),
    reason: r.reason,
    requestedBy: r.requestedBy,
    requestedByName: r.requestedByName,
    requesterScope: r.requesterScope as FindingAdjustment["requesterScope"],
    submittedAt: r.submittedAt ? iso(r.submittedAt) : null,
    approvedAt: r.approvedAt ? iso(r.approvedAt) : null,
    decisions: (r.decisions ?? []) as unknown as FindingAdjustment["decisions"],
    applied: (r.applied ?? null) as unknown as FindingAdjustment["applied"],
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
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
    storedFile: r.storedFile ?? null,
    createdAt: iso(r.createdAt),
    reversedAt: r.reversedAt ? iso(r.reversedAt) : null,
    reversedBy: r.reversedBy ?? null,
    reversedByName: r.reversedByName ?? null,
    reverseReason: r.reverseReason ?? null,
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
    sequence: r.sequence.toString(),
    previousHash: r.previousHash,
    hash: r.hash,
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

function supportThreadFromRow(r: Prisma.SupportThreadGetPayload<object>): SupportThread {
  return {
    id: r.id,
    userId: r.userId,
    subject: r.subject,
    status: r.status,
    rating: u(r.rating),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function supportMessageFromRow(r: Prisma.SupportMessageGetPayload<object>): SupportMessage {
  return {
    id: r.id,
    threadId: r.threadId,
    senderId: r.senderId,
    senderName: r.senderName,
    senderIsSupport: r.senderIsSupport,
    body: r.body,
    createdAt: iso(r.createdAt),
  };
}

function settingsFromRow(r: Prisma.SettingsGetPayload<object>): Settings {
  return {
    currencies: r.currencies,
    riskLevels: r.riskLevels,
    operationAreas: r.operationAreas,
    priorityLevels: r.priorityLevels,
    irregularityTypes: r.irregularityTypes,
    // "SMTP" or "NONE" only: any other provider saved by an older version
    // (the removed, never-built Outlook / Graph option) reads as off.
    notification: (() => {
      const n = r.notification as unknown as Settings["notification"];
      return n && (n.provider as string) !== "SMTP" && (n.provider as string) !== "NONE" ? { ...n, provider: "NONE" as const } : n;
    })(),
    rankingVisibility: r.rankingVisibility as unknown as Settings["rankingVisibility"],
    performanceThresholds: r.performanceThresholds as unknown as Settings["performanceThresholds"],
    hoApproval: r.hoApproval as unknown as Settings["hoApproval"],
    rectificationReminders: r.rectificationReminders as unknown as Settings["rectificationReminders"],
    similarFindingFields: r.similarFindingFields as Settings["similarFindingFields"],
    requiredFindingFields: r.requiredFindingFields as unknown as Settings["requiredFindingFields"],
    allowOtherValueFields: r.allowOtherValueFields as unknown as Settings["allowOtherValueFields"],
    reportTemplateSources: (r as unknown as { reportTemplateSources?: Record<string, string[]> }).reportTemplateSources ?? {},
    updatedAt: iso(r.updatedAt),
    updatedBy: u(r.updatedBy),
  };
}

const SETTINGS_ID = "singleton";

// Self-healing: whenever a code change adds a new permission key to
// src/lib/permissions/registry.ts's PAGE_REGISTRY (e.g. adding a "delete"
// action to a page that only had view/create/edit before), ADMIN's own
// stored `permissions` array in Postgres does NOT automatically grow to
// include it - permissions are plain data on a role row, not derived live
// from the registry. Without this, every existing installation's ADMIN
// role would silently lag behind the code until someone manually re-saved
// it from /admin/roles. Ported from the pre-Postgres JSON-file version of
// this file (see git history) - that version ran this on every readDb()
// too, since the JSON file had no separate migration step either.
// permissionRegistrySyncedKeys (on Settings) tracks which keys have
// already been granted this way, so a key an admin deliberately revoked
// from ADMIN doesn't get silently re-added on the next read.
async function syncAdminPermissions(db: Database, client: DbClient): Promise<void> {
  const admin = db.roles.find((r) => r.code === "ADMIN");
  if (!admin) return;
  const synced = new Set(db.permissionRegistrySyncedKeys);
  const newKeys = ALL_PERMISSION_KEYS.filter((k) => !synced.has(k));
  if (newKeys.length === 0) return;

  const granted = new Set(admin.permissions);
  newKeys.forEach((k) => granted.add(k));
  admin.permissions = [...granted];
  db.permissionRegistrySyncedKeys = [...synced, ...newKeys];

  // A direct, targeted write rather than routing through updateDb() (which
  // would call readDb() again, recursing) - this is the one place in the
  // app allowed to write outside that diff-sync path, for exactly this
  // self-contained reason.
  // Inside updateDb()'s transaction it's written through that transaction.
  if (client !== prisma) {
    await client.roleDefinition.update({ where: { id: admin.id }, data: { permissions: admin.permissions } });
    await client.settings.update({ where: { id: SETTINGS_ID }, data: { permissionRegistrySyncedKeys: db.permissionRegistrySyncedKeys } });
    return;
  }
  await prisma.$transaction([
    prisma.roleDefinition.update({ where: { id: admin.id }, data: { permissions: admin.permissions } }),
    prisma.settings.update({ where: { id: SETTINGS_ID }, data: { permissionRegistrySyncedKeys: db.permissionRegistrySyncedKeys } }),
  ]);
}

/** The global client, or updateDb()'s transaction (so its read sees - and is locked with - its write). */
type DbClient = Prisma.TransactionClient;

export async function readDb(client: DbClient = prisma): Promise<Database> {
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
    reportingPeriods,
    findings,
    findingTransitions,
    rectifications,
    findingCases,
    findingTransfers,
    findingClosures,
    findingAdjustments,
    importBatches,
    evidence,
    comments,
    notifications,
    auditLogs,
    branchCoverageNotes,
    supportThreads,
    supportMessages,
    settingsRow,
  ] = await Promise.all([
    client.roleDefinition.findMany(),
    client.user.findMany(),
    client.district.findMany(),
    client.branch.findMany(),
    client.source.findMany(),
    client.department.findMany(),
    client.classifiedCategory.findMany(),
    client.uncoveredReason.findMany(),
    client.scoringRule.findMany(),
    client.reportingPeriod.findMany(),
    client.finding.findMany(),
    client.findingTransition.findMany(),
    client.rectificationEntry.findMany(),
    client.findingCase.findMany(),
    client.findingTransfer.findMany(),
    client.findingClosure.findMany(),
    client.findingAdjustment.findMany(),
    client.importBatch.findMany(),
    client.evidence.findMany(),
    client.comment.findMany(),
    client.notification.findMany(),
    client.auditLogEntry.findMany(),
    client.branchCoverageNote.findMany(),
    client.supportThread.findMany(),
    client.supportMessage.findMany(),
    client.settings.findUnique({ where: { id: SETTINGS_ID } }),
  ]);

  if (!settingsRow) {
    throw new Error(
      "No Settings row found (expected id='singleton') - run prisma/migrate-from-json.ts (or seed a default Settings row) before starting the app."
    );
  }

  const db: Database = {
    roles: roles.map(roleFromRow),
    users: users.map(userFromRow),
    districts: districts.map(districtFromRow),
    branches: branches.map(branchFromRow),
    sources: singleDefaultSource(sources.map(sourceFromRow)),
    departments: departments.map(departmentFromRow),
    categories: categories.map(categoryFromRow),
    uncoveredReasons: uncoveredReasons.map(uncoveredReasonFromRow),
    scoringRules: scoringRules.map(scoringRuleFromRow),
    reportingPeriods: reportingPeriods.map(periodFromRow),
    findings: findings.map(findingFromRow),
    findingTransitions: findingTransitions.map(transitionFromRow),
    rectifications: rectifications.map(rectificationFromRow),
    findingCases: findingCases.map(findingCaseFromRow),
    findingTransfers: findingTransfers.map(transferFromRow),
    findingClosures: findingClosures.map(closureFromRow),
    findingAdjustments: findingAdjustments.map(adjustmentFromRow),
    importBatches: importBatches.map(importBatchFromRow),
    evidence: evidence.map(evidenceFromRow),
    comments: comments.map(commentFromRow),
    notifications: notifications.map(notificationFromRow),
    auditLogs: auditLogs.map(auditLogFromRow),
    branchCoverageNotes: branchCoverageNotes.map(coverageNoteFromRow),
    supportThreads: supportThreads.map(supportThreadFromRow),
    supportMessages: supportMessages.map(supportMessageFromRow),
    settings: settingsFromRow(settingsRow),
    permissionRegistrySyncedKeys: settingsRow.permissionRegistrySyncedKeys,
  };

  await syncAdminPermissions(db, client);
  await readReturnedParts(db, client);
  // A write request's own read (not updateDb()'s): remembered so its
  // updateDb() can tell whether anything it checked changed since.
  if (client === prisma) rememberCheckedState(db);
  return db;
}

// -----------------------------------------------------------------------------
// Returned rectifications (src/lib/rectificationResubmit.ts): findings.
// returned_cases / returned_amount and finding_cases.returned (migration
// 20261023130000_returned_rectification), read and written with SQL so no
// regenerated Prisma client is needed. Before that migration: always 0.
// -----------------------------------------------------------------------------

let returnedColumns: boolean | null = null;
let returnedCheckedAt = 0;

async function hasReturnedColumns(client: DbClient): Promise<boolean> {
  if (returnedColumns === true) return true;
  if (returnedColumns === false && Date.now() - returnedCheckedAt < 60_000) return false;
  returnedCheckedAt = Date.now();
  try {
    const rows = await client.$queryRaw<{ ok: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'findings' AND column_name = 'returned_cases') AS ok`;
    returnedColumns = rows[0]?.ok === true;
  } catch {
    returnedColumns = false;
  }
  return returnedColumns;
}

async function readReturnedParts(db: Database, client: DbClient): Promise<void> {
  if (!(await hasReturnedColumns(client))) return;
  const parts = await client.$queryRaw<{ id: string; returned_cases: number; returned_amount: number }[]>`
    SELECT id, returned_cases, returned_amount FROM findings WHERE returned_cases > 0 OR returned_amount > 0`;
  if (parts.length > 0) {
    const byId = new Map(parts.map((p) => [p.id, p]));
    for (const f of db.findings) {
      const p = byId.get(f.id);
      if (p) {
        f.returnedCases = Number(p.returned_cases);
        f.returnedAmount = Number(p.returned_amount);
      }
    }
  }
  const cases = await client.$queryRaw<{ id: string }[]>`SELECT id FROM finding_cases WHERE returned = true`;
  if (cases.length > 0) {
    const ids = new Set(cases.map((c) => c.id));
    for (const c of db.findingCases) if (ids.has(c.id)) c.returned = true;
  }
}

async function writeReturnedParts(tx: Prisma.TransactionClient, before: Database, after: Database): Promise<void> {
  const was = new Map(before.findings.map((f) => [f.id, f]));
  const changed = after.findings.filter((f) => {
    const b = was.get(f.id);
    return (f.returnedCases ?? 0) !== (b?.returnedCases ?? 0) || (f.returnedAmount ?? 0) !== (b?.returnedAmount ?? 0);
  });
  const caseWas = new Map(before.findingCases.map((c) => [c.id, c]));
  const changedCases = after.findingCases.filter((c) => Boolean(c.returned) !== Boolean(caseWas.get(c.id)?.returned));
  if (changed.length === 0 && changedCases.length === 0) return;
  if (!(await hasReturnedColumns(tx))) return;
  for (const f of changed) {
    await tx.$executeRaw`UPDATE findings SET returned_cases = ${f.returnedCases ?? 0}, returned_amount = ${f.returnedAmount ?? 0} WHERE id = ${f.id}`;
  }
  for (const c of changedCases) {
    await tx.$executeRaw`UPDATE finding_cases SET returned = ${Boolean(c.returned)} WHERE id = ${c.id}`;
  }
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
      try {
        await delegate.delete({ where: { id } });
      } catch (err) {
        // P2025 ("no record found to delete") happens when this row was
        // already removed as a side effect of deleting its parent in the
        // SAME transaction - e.g. deleting a Finding cascades onto its own
        // FindingTransition/RectificationEntry/FindingCase/FindingTransfer/
        // FindingClosure/Evidence/Comment rows (all onDelete: Cascade -
        // see schema.prisma's own doc comment on why), and this generic
        // helper has no way to know that happened before it gets to that
        // child collection's own syncCollection() call. The end state
        // either way is "this row doesn't exist", which is exactly what a
        // delete wants - not a real failure, so only this specific,
        // already-gone case is swallowed; anything else still throws.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2025") {
          throw err;
        }
      }
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
    phone: r.phone ?? null,
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
    passwordExpiresAt: toDateOrNull(r.passwordExpiresAt),
    sessionVersion: r.sessionVersion,
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
  return {
    code: r.code,
    name: r.name,
    active: r.active,
    isDefault: r.isDefault,
    createdAt: toDate(r.createdAt),
    updatedAt: toDate(r.updatedAt),
  };
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
    // Retired column (the old "Scored category" flag): which categories count
    // toward performance is the active scoring rule's choice. Kept in the
    // table (NOT NULL, no default) until a migration drops it; always false.
    scored: false,
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

function periodToData(r: ReportingPeriod) {
  return {
    year: r.year,
    month: r.month,
    code: r.code,
    name: r.name ?? null,
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
    registeredCaseCount: r.registeredCaseCount,
    registeredAmount: r.registeredAmount,
    riskLevel: r.riskLevel,
    priority: r.priority,
    description: r.description,
    recommendation: r.recommendation ?? null,
    rootCause: r.rootCause ?? null,
    evidenceNote: r.evidenceNote ?? null,
    status: r.status,
    registeredByBankScope: r.registeredByBankScope,
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

function adjustmentToData(r: FindingAdjustment) {
  return {
    findingId: r.findingId,
    periodId: r.periodId,
    status: r.status,
    addedCases: r.addedCases,
    amountChange: r.amountChange,
    newCaseAmounts: r.newCaseAmounts,
    caseAmountChanges: packCaseDetail(r),
    reason: r.reason,
    requestedBy: r.requestedBy,
    requestedByName: r.requestedByName,
    requesterScope: r.requesterScope,
    submittedAt: r.submittedAt ? toDate(r.submittedAt) : null,
    approvedAt: r.approvedAt ? toDate(r.approvedAt) : null,
    decisions: r.decisions as unknown as object,
    applied: (r.applied ?? Prisma.DbNull) as unknown as object,
    createdAt: toDate(r.createdAt),
    updatedAt: toDate(r.updatedAt),
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
    storedFile: r.storedFile ?? null,
    createdAt: toDate(r.createdAt),
    reversedAt: r.reversedAt ? toDate(r.reversedAt) : null,
    reversedBy: r.reversedBy ?? null,
    reversedByName: r.reversedByName ?? null,
    reverseReason: r.reverseReason ?? null,
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
    sequence: BigInt(r.sequence),
    previousHash: r.previousHash,
    hash: r.hash,
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

function supportThreadToData(r: SupportThread) {
  return {
    userId: r.userId,
    subject: r.subject,
    status: r.status,
    rating: r.rating ?? null,
    createdAt: toDate(r.createdAt),
    updatedAt: toDate(r.updatedAt),
  };
}

function supportMessageToData(r: SupportMessage) {
  return {
    threadId: r.threadId,
    senderId: r.senderId,
    senderName: r.senderName,
    senderIsSupport: r.senderIsSupport,
    body: r.body,
    createdAt: toDate(r.createdAt),
  };
}

async function writeChanges(tx: Prisma.TransactionClient, before: Database, after: Database, alsoWrite?: (tx: Prisma.TransactionClient) => Promise<void>): Promise<void> {
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
  await syncCollection(tx.importBatch, before.importBatches, after.importBatches, importBatchToData);
  await syncCollection(tx.finding, before.findings, after.findings, findingToData);
  await syncCollection(tx.findingTransition, before.findingTransitions, after.findingTransitions, transitionToData);
  await syncCollection(tx.rectificationEntry, before.rectifications, after.rectifications, rectificationToData);
  await syncCollection(tx.findingCase, before.findingCases, after.findingCases, findingCaseToData);
  await writeReturnedParts(tx, before, after);
  await syncCollection(tx.findingTransfer, before.findingTransfers, after.findingTransfers, transferToData);
  await syncCollection(tx.findingClosure, before.findingClosures, after.findingClosures, closureToData);
  await syncCollection(tx.findingAdjustment, before.findingAdjustments, after.findingAdjustments, adjustmentToData);
  await syncCollection(tx.comment, before.comments, after.comments, commentToData);
  await syncCollection(tx.evidence, before.evidence, after.evidence, evidenceToData);
  await syncCollection(tx.notification, before.notifications, after.notifications, notificationToData);
  await syncCollection(tx.auditLogEntry, before.auditLogs, after.auditLogs, auditLogToData);
  await syncCollection(tx.branchCoverageNote, before.branchCoverageNotes, after.branchCoverageNotes, coverageNoteToData);
  // Threads before messages - a message's threadId FK needs its parent
  // thread to already exist.
  await syncCollection(tx.supportThread, before.supportThreads, after.supportThreads, supportThreadToData);
  await syncCollection(tx.supportMessage, before.supportMessages, after.supportMessages, supportMessageToData);

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
      rankingVisibility: s.rankingVisibility as object,
      performanceThresholds: s.performanceThresholds as object,
      hoApproval: s.hoApproval as object,
      rectificationReminders: s.rectificationReminders as object,
      similarFindingFields: s.similarFindingFields,
      requiredFindingFields: s.requiredFindingFields as object,
      allowOtherValueFields: s.allowOtherValueFields as object,
      reportTemplateSources: s.reportTemplateSources as object,
      permissionRegistrySyncedKeys: after.permissionRegistrySyncedKeys,
      updatedAt: toDate(s.updatedAt),
      updatedBy: s.updatedBy ?? null,
    };
    await tx.settings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, ...data }, update: data });
  }

  // A caller's own writes outside the Database model (e.g. the
  // automatic transfer's run record), committed or rolled back together
  // with everything above.
  if (alsoWrite) await alsoWrite(tx);
}

// =============================================================================
// CONCURRENCY (race conditions / TOCTOU) - docs/data-integrity.md
//
// 1. One change at a time. updateDb() waits for this process's previous
//    change (writeQueue), then opens the transaction, takes a Postgres
//    advisory lock (shared by every process and server) and only THEN reads.
//    So each change is computed from the state the previous one committed -
//    two simultaneous approvals, rectifications or closes can't both be
//    computed from the same "before".
// 2. Stale checks are refused. A route usually checks its rules (status,
//    what's still outstanding, ownership) on its own readDb() before
//    calling updateDb(). A write request remembers that read; if any row the
//    change modifies or deletes was changed by someone else since, the
//    change is refused with 409 CONFLICT instead of being applied on top -
//    e.g. the second of two "Approve" clicks, or a rectification of cases
//    another user has just rectified.
// =============================================================================

/** pg_advisory_xact_lock key shared by every updateDb() (any fixed, app-specific number). */
const WRITE_LOCK_KEY = 7_360_002_026;

/** Collections a change's rows are compared on (the audit log is append-only and never re-checked). */
const CHECKED_COLLECTIONS = [
  "roles", "users", "districts", "branches", "sources", "departments", "categories", "uncoveredReasons", "scoringRules",
  "reportingPeriods", "findings", "findingTransitions", "rectifications", "findingCases", "findingTransfers", "findingClosures",
  "findingAdjustments", "importBatches", "evidence", "comments", "notifications", "branchCoverageNotes", "supportThreads", "supportMessages",
] as const satisfies readonly (keyof Database)[];
/** collection -> row id -> the row as JSON text. */
export type CheckedState = Map<string, Map<string, string>>;
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function rowsOf(db: Database, collection: (typeof CHECKED_COLLECTIONS)[number]): { id: string }[] {
  return (db[collection] as { id: string }[] | undefined) ?? [];
}

/** What a read saw, as text - so later edits to the objects themselves don't matter. */
export function snapshotState(db: Database): CheckedState {
  const state: CheckedState = new Map();
  for (const c of CHECKED_COLLECTIONS) state.set(c, new Map(rowsOf(db, c).map((r) => [r.id, JSON.stringify(r)])));
  state.set("settings", new Map([["settings", JSON.stringify(db.settings)]]));
  return state;
}

type ContextWithState = { method?: string; userId?: string; checkedState?: CheckedState; inTransaction?: (tx: unknown) => Promise<void> };

/** Called by readDb(): inside a POST / PATCH / DELETE request, keep what it read. */
function rememberCheckedState(db: Database): void {
  const ctx = getRequestContext() as ContextWithState | undefined;
  if (!ctx || !STATE_CHANGING.has(ctx.method ?? "")) return;
  ctx.checkedState = snapshotState(db);
}

/**
 * The first row this change modifies or deletes that someone else changed
 * after the request read it, or null. Rows the request never saw (created
 * since) and rows the change only adds are not conflicts.
 */
export function staleRow(checked: CheckedState, fresh: Database, after: Database): { collection: string; id: string } | null {
  for (const c of CHECKED_COLLECTIONS) {
    const seen = checked.get(c);
    if (!seen) continue;
    const afterById = new Map(rowsOf(after, c).map((r) => [r.id, r]));
    for (const row of rowsOf(fresh, c)) {
      const was = seen.get(row.id);
      if (was === undefined) continue;
      const now = JSON.stringify(row);
      if (now === was) continue;
      const next = afterById.get(row.id);
      if (next === undefined || JSON.stringify(next) !== now) return { collection: c, id: row.id };
    }
  }
  const settingsWas = checked.get("settings")?.get("settings");
  const settingsNow = JSON.stringify(fresh.settings);
  if (settingsWas !== undefined && settingsNow !== settingsWas && JSON.stringify(after.settings) !== settingsNow) {
    return { collection: "settings", id: "settings" };
  }
  return null;
}

let writeQueue: Promise<unknown> = Promise.resolve();

type UpdateOptions<T> = {
  alsoWrite?: (tx: Prisma.TransactionClient, result: T) => Promise<void>;
  staleCheck?: boolean;
  /** Dev Reset only (APP_ENV=development): it removes finding audit entries along with the findings. */
  allowAuditLogRemoval?: boolean;
};

/** Who a change is by, for the automatic audit entries: the signed-in user, or the system (jobs). */
function changeActor(db: Database, userId: string | undefined): { userId: string; userName: string } {
  const user = userId ? db.users.find((u) => u.id === userId) : undefined;
  return user ? { userId: user.id, userName: user.name } : { userId: "system", userName: "System" };
}

/**
 * Read-modify-write: the one way the app changes data (see CONCURRENCY above).
 * `opts.alsoWrite` adds the caller's own writes (tables outside the Database
 * model) to the same transaction, given the mutator's result - all or nothing.
 * `opts.staleCheck: false` is for jobs that decide everything from the
 * current data inside the mutator (automatic transfer, reminders), so a
 * request's earlier read doesn't matter to them.
 *
 * Every change is also made audit-complete before it's saved
 * (src/lib/auditCompleteness.ts): each changed finding field is logged with
 * its old and new value, and existing audit entries can't be edited or removed.
 */
export async function updateDb<T>(mutator: (db: Database) => T, opts: UpdateOptions<T> = {}): Promise<T> {
  const run = writeQueue.then(() => runUpdate(mutator, opts));
  // The next change waits for this one, whether it succeeds or fails.
  writeQueue = run.catch(() => undefined);
  return run;
}

async function runUpdate<T>(mutator: (db: Database) => T, opts: UpdateOptions<T>): Promise<T> {
  const ctx = getRequestContext() as ContextWithState | undefined;
  const checked = opts.staleCheck === false ? undefined : ctx?.checkedState;
  let afterCommit: () => void = () => {};
  let committed: Database | null = null;
  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${WRITE_LOCK_KEY}::bigint)`;
      const before = await readDb(tx);
      const after: Database = JSON.parse(JSON.stringify(before));
      const value = mutator(after);
      if (checked) {
        const stale = staleRow(checked, before, after);
        if (stale) {
          throw new ConflictError("Someone else changed this just now. Reload the page to see the latest, then try again.", { changed: stale.collection });
        }
      }
      if (!opts.allowAuditLogRemoval) assertAuditLogAppendOnly(before, after);
      auditFindingFieldChanges(before, after, changeActor(after, ctx?.userId));
      // Emails queued by notifyUsers() during the mutator: saved in the same
      // transaction as the notifications, delivered after it commits.
      const emails = await prepareQueuedEmails(after.pendingEmails ?? []);
      delete after.pendingEmails;
      await writeChanges(tx, before, after, async (t) => {
        if (emails.insert) await emails.insert(t);
        if (opts.alsoWrite) await opts.alsoWrite(t, value);
        // e.g. the request's Idempotency-Key marked committed with the change.
        if (ctx?.inTransaction) await ctx.inTransaction(t);
      });
      afterCommit = emails.afterCommit;
      committed = after;
      return value;
    },
    // Waiting for the lock counts toward the timeout; historical-import and
    // bulk-registration changes touch many rows under the row-by-row diff.
    { timeout: 60_000, maxWait: 30_000 }
  );
  afterCommit();
  // A second updateDb() in the same request is checked against what this
  // one committed, not against the request's older read.
  if (ctx?.checkedState && committed) ctx.checkedState = snapshotState(committed);
  return result;
}
