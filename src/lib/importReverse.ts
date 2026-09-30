import { appendAuditLog } from "@/lib/audit";
import type { Database, ImportBatch } from "@/types";

/**
 * Reversing an import removes EVERY finding it created, whatever has
 * happened to them since - together with everything recorded against them
 * (workflow history, rectifications, closures, transfers, itemized cases,
 * comments, evidence and its files, notifications). Because that can
 * include real work done after the import, the UI first shows the impact
 * (importReverseImpact) and requires a reason. The batch record is kept
 * (marked Reversed) so it can be re-imported or deleted; the audit trail
 * keeps everything, and removed reference numbers are never reissued.
 */

export interface ReverseImpact {
  findings: number;
  /** One line per finding with activity after the import, e.g. "B001-2026-09-00003: 2 comments, rectification recorded". */
  withActivity: string[];
  evidenceFiles: number;
}

export function importReverseImpact(db: Database, batch: ImportBatch): ReverseImpact {
  const since = batch.createdAt;
  const findings = db.findings.filter((x) => x.importBatchId === batch.id);
  const withActivity: string[] = [];
  let evidenceFiles = 0;
  for (const f of findings) {
    const parts: string[] = [];
    const actions = db.findingTransitions.filter((t) => t.findingId === f.id && !t.action.startsWith("IMPORT_")).length;
    const comments = db.comments.filter((c) => c.findingId === f.id).length;
    const files = db.evidence.filter((e) => e.findingId === f.id).length;
    evidenceFiles += files;
    if (actions) parts.push(`${actions} workflow action(s)`);
    if (db.rectifications.some((r) => r.findingId === f.id && r.createdAt > since)) parts.push("rectification recorded");
    if (db.findingClosures.some((c) => c.findingId === f.id && c.createdAt > since)) parts.push("closure recorded");
    if (db.findingTransfers.some((t) => t.findingId === f.id && t.createdAt > since)) parts.push("transferred");
    if (comments) parts.push(`${comments} comment(s)`);
    if (files) parts.push(`${files} evidence file(s)`);
    if (db.findingCases.some((c) => c.findingId === f.id)) parts.push("itemized cases");
    if (parts.length === 0 && f.updatedAt > since) parts.push("edited");
    if (parts.length) withActivity.push(`${f.reference}: ${parts.join(", ")}`);
  }
  return { findings: findings.length, withActivity, evidenceFiles };
}

/**
 * Removes the batch's findings and everything attached to them, marks the
 * batch reversed (or removes the batch too when `deleteRecord`), and writes
 * the audit entry. Call inside updateDb(). Returns the stored evidence file
 * names to delete from disk AFTER the transaction commits.
 */
export function reverseImportBatch(
  db: Database,
  batch: ImportBatch,
  actor: { userId: string; userName: string },
  reason: string,
  opts: { deleteRecord?: boolean } = {}
): { removedReferences: string[]; evidenceFilesToDelete: string[]; importFileToDelete: string | null } {
  const impact = importReverseImpact(db, batch);
  const removed = db.findings.filter((f) => f.importBatchId === batch.id);
  const ids = new Set(removed.map((f) => f.id));
  const evidenceFilesToDelete = db.evidence.filter((e) => ids.has(e.findingId)).map((e) => e.storagePath);

  db.findings = db.findings.filter((f) => !ids.has(f.id));
  db.findingTransitions = db.findingTransitions.filter((t) => !ids.has(t.findingId));
  db.rectifications = db.rectifications.filter((r) => !ids.has(r.findingId));
  db.findingClosures = db.findingClosures.filter((c) => !ids.has(c.findingId));
  db.findingTransfers = db.findingTransfers.filter((t) => !ids.has(t.findingId));
  db.findingCases = db.findingCases.filter((c) => !ids.has(c.findingId));
  db.comments = db.comments.filter((c) => !ids.has(c.findingId));
  db.evidence = db.evidence.filter((e) => !ids.has(e.findingId));
  db.notifications = db.notifications.filter((n) => !(n.entityType === "Finding" && ids.has(n.entityId)));

  const now = new Date().toISOString();
  const removedReferences = removed.map((f) => f.reference);
  let importFileToDelete: string | null = null;
  if (opts.deleteRecord) {
    importFileToDelete = batch.storedFile;
    db.importBatches = db.importBatches.filter((b) => b.id !== batch.id);
  } else {
    batch.reversedAt = now;
    batch.reversedBy = actor.userId;
    batch.reversedByName = actor.userName;
    batch.reverseReason = reason;
  }

  appendAuditLog(db, {
    userId: actor.userId,
    userName: actor.userName,
    action: opts.deleteRecord ? "IMPORT_REVERSE_AND_DELETE" : "IMPORT_REVERSE",
    entityType: "ImportBatch",
    entityId: batch.id,
    oldValue: { fileName: batch.fileName, importedCount: batch.importedCount, references: removedReferences },
    newValue: { reversedAt: now, removedFindings: removedReferences.length, findingsWithLaterActivity: impact.withActivity, evidenceFilesRemoved: evidenceFilesToDelete.length, recordDeleted: Boolean(opts.deleteRecord) },
    reason,
  });
  return { removedReferences, evidenceFilesToDelete, importFileToDelete };
}
