// One-time ETL: reads the existing data/db.json (the JSON-file "database"
// this app has used since Phase 1) and inserts every row into Postgres via
// Prisma, preserving every id byte-for-byte so no Finding reference, audit
// log entry, or foreign-key relationship changes across the cutover.
//
// Run once, against an EMPTY (freshly migrated, `prisma migrate dev`
// already applied) database:
//   npx tsx prisma/migrate-from-json.ts
//
// Safe to re-run against an empty database if it fails partway (it does
// not delete anything first) - if you need to retry after a partial run,
// truncate the tables or drop/recreate the database and re-migrate first.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient, Prisma } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Database } from "../src/types";

// Run via tsx, outside Next.js, so nothing auto-loads .env for us or wires
// up the driver adapter the way src/lib/prismaClient.ts does for the app -
// both are done explicitly here instead.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function toDate(iso: string): Date {
  return new Date(iso);
}
function toDateOrNull(iso: string | null | undefined): Date | null {
  return iso ? new Date(iso) : null;
}

async function main() {
  const dbPath = path.join(process.cwd(), "data", "db.json");
  const raw = fs.readFileSync(dbPath, "utf-8");
  const db = JSON.parse(raw) as Database;

  console.log("Migrating from", dbPath);

  // Insertion order respects foreign keys: reference/org data first,
  // findings next, then every table that hangs off a Finding, settings
  // last (order-independent, but kept at the end for readability).

  await prisma.roleDefinition.createMany({
    data: db.roles.map((r) => ({
      id: r.id,
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
    })),
  });
  console.log(`  roles: ${db.roles.length}`);

  await prisma.district.createMany({
    data: db.districts.map((d) => ({
      id: d.id,
      code: d.code,
      name: d.name,
      status: d.status,
      createdAt: toDate(d.createdAt),
      updatedAt: toDate(d.updatedAt),
    })),
  });
  console.log(`  districts: ${db.districts.length}`);

  await prisma.branch.createMany({
    data: db.branches.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      districtId: b.districtId,
      status: b.status,
      createdAt: toDate(b.createdAt),
      updatedAt: toDate(b.updatedAt),
    })),
  });
  console.log(`  branches: ${db.branches.length}`);

  await prisma.source.createMany({
    data: db.sources.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      active: s.active,
      createdAt: toDate(s.createdAt),
      updatedAt: toDate(s.updatedAt),
    })),
  });
  console.log(`  sources: ${db.sources.length}`);

  await prisma.department.createMany({
    data: db.departments.map((d) => ({
      id: d.id,
      code: d.code,
      name: d.name,
      active: d.active,
      orgScope: d.orgScope,
      districtId: d.districtId ?? null,
      branchId: d.branchId ?? null,
      createdAt: toDate(d.createdAt),
      updatedAt: toDate(d.updatedAt),
    })),
  });
  console.log(`  departments: ${db.departments.length}`);

  await prisma.classifiedCategory.createMany({
    data: db.categories.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      scored: c.scored,
      active: c.active,
      createdAt: toDate(c.createdAt),
      updatedAt: toDate(c.updatedAt),
    })),
  });
  console.log(`  categories: ${db.categories.length}`);

  await prisma.uncoveredReason.createMany({
    data: db.uncoveredReasons.map((u) => ({
      id: u.id,
      code: u.code,
      name: u.name,
      active: u.active,
      createdAt: toDate(u.createdAt),
      updatedAt: toDate(u.updatedAt),
    })),
  });
  console.log(`  uncoveredReasons: ${db.uncoveredReasons.length}`);

  // Users reference roles by code (already inserted above).
  await prisma.user.createMany({
    data: db.users.map((u) => ({
      id: u.id,
      name: u.name,
      username: u.username,
      email: u.email ?? null,
      passwordHash: u.passwordHash,
      role: u.role,
      status: u.status,
      districtId: u.districtId ?? null,
      branchId: u.branchId ?? null,
      departmentId: u.departmentId ?? null,
      createdAt: toDate(u.createdAt),
      updatedAt: toDate(u.updatedAt),
      lastLoginAt: toDateOrNull(u.lastLoginAt),
      mustChangePassword: u.mustChangePassword ?? false,
    })),
  });
  console.log(`  users: ${db.users.length}`);

  await prisma.scoringRule.createMany({
    data: db.scoringRules.map((r) => ({
      id: r.id,
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
    })),
  });
  console.log(`  scoringRules: ${db.scoringRules.length}`);

  await prisma.reportingPeriod.createMany({
    data: db.reportingPeriods.map((p) => ({
      id: p.id,
      year: p.year,
      month: p.month,
      code: p.code,
      startsAt: toDate(p.startsAt),
      endsAt: toDate(p.endsAt),
      submissionStartsAt: toDate(p.submissionStartsAt),
      submissionEndsAt: toDate(p.submissionEndsAt),
      status: p.status,
      lockedBy: p.lockedBy ?? null,
      lockedAt: toDateOrNull(p.lockedAt),
      lockReason: p.lockReason ?? null,
      draftsAllowedWhileLocked: p.draftsAllowedWhileLocked,
      createdAt: toDate(p.createdAt),
      updatedAt: toDate(p.updatedAt),
    })),
  });
  console.log(`  reportingPeriods: ${db.reportingPeriods.length}`);

  await prisma.scoringAdjustment.createMany({
    data: db.scoringAdjustments.map((a) => ({
      id: a.id,
      targetType: a.targetType,
      targetId: a.targetId,
      periodId: a.periodId,
      districtId: a.targetType === "DISTRICT" ? a.targetId : null,
      branchId: a.targetType === "BRANCH" ? a.targetId : null,
      value: a.value,
      reason: a.reason,
      adjustedBy: a.adjustedBy,
      createdAt: toDate(a.createdAt),
    })),
  });
  console.log(`  scoringAdjustments: ${db.scoringAdjustments.length}`);

  // Import batches before findings (a finding may reference one).
  await prisma.importBatch.createMany({
    data: db.importBatches.map((b) => ({
      id: b.id,
      fileName: b.fileName,
      importedBy: b.importedBy,
      importedByName: b.importedByName,
      totalRows: b.totalRows,
      importedCount: b.importedCount,
      duplicateCount: b.duplicateCount,
      errorCount: b.errorCount,
      rows: b.rows as object,
      createdAt: toDate(b.createdAt),
    })),
  });
  console.log(`  importBatches: ${db.importBatches.length}`);

  await prisma.finding.createMany({
    data: db.findings.map((f) => ({
      id: f.id,
      reference: f.reference,
      title: f.title,
      sourceId: f.sourceId || null,
      departmentId: f.departmentId || null,
      periodId: f.periodId,
      districtId: f.districtId,
      branchId: f.branchId,
      findingDate: f.findingDate,
      operationArea: f.operationArea,
      irregularityType: f.irregularityType,
      categoryId: f.categoryId || null,
      amount: f.amount,
      currency: f.currency,
      caseCount: f.caseCount,
      riskLevel: f.riskLevel,
      priority: f.priority,
      description: f.description,
      recommendation: f.recommendation ?? null,
      rootCause: f.rootCause ?? null,
      evidenceNote: f.evidenceNote ?? null,
      status: f.status,
      rectifiedCases: f.rectifiedCases,
      rectifiedAmount: f.rectifiedAmount,
      closedCases: f.closedCases,
      closedAmount: f.closedAmount,
      districtVerifiedCases: f.districtVerifiedCases,
      districtVerifiedAmount: f.districtVerifiedAmount,
      externalReference: f.externalReference ?? null,
      importBatchId: f.importBatchId ?? null,
      lastReminderAt: toDateOrNull(f.lastReminderAt),
      createdBy: f.createdBy,
      createdAt: toDate(f.createdAt),
      updatedAt: toDate(f.updatedAt),
    })),
  });
  console.log(`  findings: ${db.findings.length}`);

  await prisma.findingTransition.createMany({
    data: db.findingTransitions.map((t) => ({
      id: t.id,
      findingId: t.findingId,
      fromStatus: t.fromStatus,
      toStatus: t.toStatus,
      action: t.action,
      userId: t.userId,
      userName: t.userName,
      reason: t.reason ?? null,
      createdAt: toDate(t.createdAt),
    })),
  });
  console.log(`  findingTransitions: ${db.findingTransitions.length}`);

  await prisma.rectificationEntry.createMany({
    data: db.rectifications.map((r) => ({
      id: r.id,
      findingId: r.findingId,
      periodId: r.periodId,
      rectifiedCases: r.rectifiedCases,
      rectifiedAmount: r.rectifiedAmount,
      note: r.note ?? null,
      submittedBy: r.submittedBy,
      submittedByName: r.submittedByName,
      createdAt: toDate(r.createdAt),
      caseIds: r.caseIds ?? [],
    })),
  });
  console.log(`  rectifications: ${db.rectifications.length}`);

  await prisma.findingCase.createMany({
    data: db.findingCases.map((c) => ({
      id: c.id,
      findingId: c.findingId,
      seq: c.seq,
      amount: c.amount,
      description: c.description ?? null,
      status: c.status,
      rectificationId: c.rectificationId ?? null,
      rectifiedAt: toDateOrNull(c.rectifiedAt),
      rectifiedBy: c.rectifiedBy ?? null,
      rectifiedByName: c.rectifiedByName ?? null,
      createdAt: toDate(c.createdAt),
    })),
  });
  console.log(`  findingCases: ${db.findingCases.length}`);

  await prisma.findingTransfer.createMany({
    data: db.findingTransfers.map((t) => ({
      id: t.id,
      findingId: t.findingId,
      fromPeriodId: t.fromPeriodId,
      toPeriodId: t.toPeriodId,
      casesTransferred: t.casesTransferred,
      amountTransferred: t.amountTransferred,
      originalCaseCount: t.originalCaseCount,
      originalAmount: t.originalAmount,
      caseAgeAtTransferDays: t.caseAgeAtTransferDays,
      reason: t.reason,
      createdBy: t.createdBy,
      createdByName: t.createdByName,
      createdAt: toDate(t.createdAt),
      method: t.method,
    })),
  });
  console.log(`  findingTransfers: ${db.findingTransfers.length}`);

  await prisma.findingClosure.createMany({
    data: db.findingClosures.map((c) => ({
      id: c.id,
      findingId: c.findingId,
      periodId: c.periodId,
      closedCases: c.closedCases,
      closedAmount: c.closedAmount,
      submittedBy: c.submittedBy,
      submittedByName: c.submittedByName,
      createdAt: toDate(c.createdAt),
    })),
  });
  console.log(`  findingClosures: ${db.findingClosures.length}`);

  // Comments before evidence - evidence.commentId can reference one.
  await prisma.comment.createMany({
    data: db.comments.map((c) => ({
      id: c.id,
      findingId: c.findingId,
      parentCommentId: c.parentCommentId ?? null,
      authorId: c.authorId,
      authorName: c.authorName,
      text: c.text,
      createdAt: toDate(c.createdAt),
    })),
  });
  console.log(`  comments: ${db.comments.length}`);

  await prisma.evidence.createMany({
    data: db.evidence.map((e) => ({
      id: e.id,
      findingId: e.findingId,
      commentId: e.commentId ?? null,
      fileName: e.fileName,
      mimeType: e.mimeType,
      size: e.size,
      storagePath: e.storagePath,
      uploadedBy: e.uploadedBy,
      uploadedByName: e.uploadedByName,
      createdAt: toDate(e.createdAt),
    })),
  });
  console.log(`  evidence: ${db.evidence.length}`);

  await prisma.notification.createMany({
    data: db.notifications.map((n) => ({
      id: n.id,
      recipientUserId: n.recipientUserId,
      type: n.type,
      title: n.title,
      message: n.message,
      entityType: n.entityType,
      entityId: n.entityId,
      readAt: toDateOrNull(n.readAt),
      createdAt: toDate(n.createdAt),
    })),
  });
  console.log(`  notifications: ${db.notifications.length}`);

  await prisma.auditLogEntry.createMany({
    data: db.auditLogs.map((a) => ({
      id: a.id,
      userId: a.userId,
      userName: a.userName,
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId,
      oldValue: (a.oldValue ?? Prisma.DbNull) as Prisma.InputJsonValue,
      newValue: (a.newValue ?? Prisma.DbNull) as Prisma.InputJsonValue,
      reason: a.reason ?? null,
      timestamp: toDate(a.timestamp),
    })),
  });
  console.log(`  auditLogs: ${db.auditLogs.length}`);

  await prisma.branchCoverageNote.createMany({
    data: db.branchCoverageNotes.map((n) => ({
      id: n.id,
      branchId: n.branchId,
      periodId: n.periodId,
      reason: n.reason,
      reasonId: n.reasonId,
      recordedBy: n.recordedBy,
      recordedByName: n.recordedByName,
      createdAt: toDate(n.createdAt),
      updatedAt: toDate(n.updatedAt),
    })),
  });
  console.log(`  branchCoverageNotes: ${db.branchCoverageNotes.length}`);

  await prisma.settings.create({
    data: {
      id: "singleton",
      currencies: db.settings.currencies,
      riskLevels: db.settings.riskLevels,
      operationAreas: db.settings.operationAreas,
      priorityLevels: db.settings.priorityLevels,
      irregularityTypes: db.settings.irregularityTypes,
      notification: db.settings.notification as object,
      autoTransferOnLock: db.settings.autoTransferOnLock,
      rankingVisibility: db.settings.rankingVisibility as object,
      performanceThresholds: db.settings.performanceThresholds as object,
      hoApproval: db.settings.hoApproval as object,
      rectificationReminders: db.settings.rectificationReminders as object,
      similarFindingFields: db.settings.similarFindingFields,
      requiredFindingFields: db.settings.requiredFindingFields as object,
      allowOtherValueFields: db.settings.allowOtherValueFields as object,
      permissionRegistrySyncedKeys: db.permissionRegistrySyncedKeys,
      updatedAt: toDate(db.settings.updatedAt),
      updatedBy: db.settings.updatedBy ?? null,
    },
  });
  console.log("  settings: 1");

  console.log("\nMigration complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
