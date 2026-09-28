import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { readStoredFile, attachmentDisposition, FileStorageError } from "@/lib/fileStorage";

// Download the original spreadsheet behind an import batch (Import History).
// Same permission as importing/seeing the history itself; decrypted on the
// fly, always an attachment, and recorded in the audit log.
export async function GET(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const auth = await requirePermission("findings.import");
  if (!auth.ok) return auth.response;
  const { batchId } = await params;

  const db = await readDb();
  const batch = db.importBatches.find((b) => b.id === batchId);
  if (!batch) return NextResponse.json({ error: "Import not found" }, { status: 404 });
  if (!batch.storedFile) {
    return NextResponse.json({ error: "The original file wasn't kept for this import (imported before files were stored)" }, { status: 404 });
  }

  let buffer: Buffer | null;
  try {
    buffer = readStoredFile("imports", batch.storedFile);
  } catch (err) {
    console.error("[import] reading stored file failed", err);
    const message = err instanceof FileStorageError ? err.message : "Could not read the stored file";
    return NextResponse.json({ error: message }, { status: 500 });
  }
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
