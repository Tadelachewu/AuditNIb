import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { deleteStoredFile } from "@/lib/fileStorage";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { withApiHandler } from "@/lib/api/handler";

// Delete an import record (Import History → Delete) - only once its findings
// are gone (reversed, or it never imported any), so this can never remove
// findings. Removes the record and its stored original file; the audit log
// keeps the entry (including the removed findings' reference numbers).
async function handleDELETE(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const auth = await requirePermission("findings.reverse-import");
  if (!auth.ok) return auth.response;
  const { batchId } = await params;

  const db = await readDb();
  const batch = db.importBatches.find((b) => b.id === batchId);
  if (!batch) throw new NotFoundError("import");
  const stillHasFindings = db.findings.some((f) => f.importBatchId === batch.id);
  if (!batch.reversedAt && stillHasFindings) {
    throw new BusinessRuleError("IMPORT_NOT_REVERSIBLE", "Reverse this import first - its findings still exist.");
  }

  await updateDb((current) => {
    current.importBatches = current.importBatches.filter((b) => b.id !== batchId);
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "IMPORT_RECORD_DELETED",
      entityType: "ImportBatch",
      entityId: batch.id,
      oldValue: { fileName: batch.fileName, importedCount: batch.importedCount, reversedAt: batch.reversedAt, references: batch.rows.map((r) => r.reference).filter(Boolean) },
    });
  });
  if (batch.storedFile) deleteStoredFile("imports", batch.storedFile);
  return NextResponse.json({ ok: true });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const DELETE = withApiHandler(handleDELETE);
