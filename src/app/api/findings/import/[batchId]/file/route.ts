import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { readStoredFile, attachmentDisposition } from "@/lib/fileStorage";
import { withApiHandler } from "@/lib/api/handler";
import { isImportBatchInScope } from "@/lib/findings-scope";

// Download the original spreadsheet behind an import batch (Import History).
// Same permission as importing/seeing the history itself; decrypted on the
// fly, always an attachment, and recorded in the audit log.
async function handleGET(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const auth = await requirePermission("findings.import");
  if (!auth.ok) return auth.response;
  const { batchId } = await params;

  const db = await readDb();
  const batch = db.importBatches.find((b) => b.id === batchId);
  // Outside the caller's scope reads as "not found" (no hint that it exists).
  if (!batch || !isImportBatchInScope(db, auth.session, batch)) return NextResponse.json({ error: "Import not found" }, { status: 404 });
  if (!batch.storedFile) {
    return NextResponse.json({ error: "The original file wasn't kept for this import (imported before files were stored)" }, { status: 404 });
  }

  // A storage failure is mapped centrally (src/lib/errors/normalize.ts): logged in
  // full, the client only gets FILE_STORAGE_UNAVAILABLE / FILE_INTEGRITY_FAILED.
  const buffer = readStoredFile("imports", batch.storedFile);
  if (!buffer) return NextResponse.json({ error: "File is missing from storage" }, { status: 404 });

  await updateDb((current) => {
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "IMPORT_FILE_DOWNLOAD",
      entityType: "ImportBatch",
      entityId: batch.id,
      newValue: { fileName: batch.fileName },
    });
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": attachmentDisposition(batch.fileName),
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const GET = withApiHandler(handleGET);
