import { NextResponse } from "next/server";
import { requirePermission, requireUser } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { appendAuditLog } from "@/lib/audit";
import { readStoredFile, deleteStoredFile, attachmentDisposition } from "@/lib/fileStorage";
import { withApiHandler } from "@/lib/api/handler";

type Params = { params: Promise<{ id: string; evidenceId: string }> };

// Download - anyone who can view the finding (in scope). Decrypted on the
// fly from the storage folder, always served as an attachment (never
// rendered inline), and recorded in the audit log.
async function handleGET(_request: Request, { params }: Params) {
  const auth = await requirePermission("findings.view");
  if (!auth.ok) return auth.response;
  const { id, evidenceId } = await params;

  const db = await readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  const record = db.evidence.find((e) => e.id === evidenceId && e.findingId === id);
  if (!record) return NextResponse.json({ error: "Evidence not found" }, { status: 404 });

  // A storage failure is mapped centrally (src/lib/errors/normalize.ts): logged in
  // full, the client only gets FILE_STORAGE_UNAVAILABLE / FILE_INTEGRITY_FAILED.
  const buffer = readStoredFile("evidence", record.storagePath);
  if (!buffer) return NextResponse.json({ error: "File is missing from storage" }, { status: 404 });

  await updateDb((current) => {
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "EVIDENCE_DOWNLOAD",
      entityType: "Evidence",
      entityId: record.id,
      newValue: { findingId: existing.id, reference: existing.reference, fileName: record.fileName },
    });
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": record.mimeType,
      "Content-Disposition": attachmentDisposition(record.fileName),
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}

// Delete - an uploader can remove their own file while the finding isn't
// closed (a wrong file attached by mistake); holders of
// findings.delete-evidence can remove anyone's, at any status
// (housekeeping - e.g. a sensitive file that shouldn't be there). Both
// still need the finding in their org scope. Removes the record and the
// stored file, and is recorded in the audit log.
async function handleDELETE(_request: Request, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id, evidenceId } = await params;

  const db = await readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  const record = db.evidence.find((e) => e.id === evidenceId && e.findingId === id);
  if (!record) return NextResponse.json({ error: "Evidence not found" }, { status: 404 });

  const permissions = auth.session.permissions ?? [];
  const canDeleteAny = hasPermission(permissions, permissionKey("findings", "delete-evidence"));
  const uploadPermission = permissionKey("findings", record.commentId ? "comment" : "evidence");
  const canDeleteOwn =
    record.uploadedBy === auth.session.userId && hasPermission(permissions, uploadPermission) && existing.status !== "CLOSED";
  if (!canDeleteAny && !canDeleteOwn) {
    return NextResponse.json(
      {
        error:
          record.uploadedBy !== auth.session.userId
            ? "You can only remove files you uploaded yourself"
            : "This finding is closed - its files can no longer be removed",
      },
      { status: 403 }
    );
  }

  await updateDb((current) => {
    current.evidence = current.evidence.filter((e) => e.id !== evidenceId);
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "EVIDENCE_DELETE",
      entityType: "Evidence",
      entityId: record.id,
      oldValue: { findingId: existing.id, reference: existing.reference, commentId: record.commentId, fileName: record.fileName, uploadedByName: record.uploadedByName },
    });
  });
  deleteStoredFile("evidence", record.storagePath);

  return NextResponse.json({ ok: true });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const GET = withApiHandler(handleGET);
export const DELETE = withApiHandler(handleDELETE);
