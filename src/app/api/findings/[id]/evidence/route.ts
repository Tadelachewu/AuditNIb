import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { requireUser, requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { appendAuditLog } from "@/lib/audit";
import { isRateLimited, recordAttempt } from "@/lib/rateLimit";
import { ALLOWED_EVIDENCE_TYPES, MAX_EVIDENCE_BYTES, EVIDENCE_UPLOAD_LIMIT, evidenceContentMatchesType } from "@/lib/evidence";
import { writeStoredFile, deleteStoredFile, newStoredName } from "@/lib/fileStorage";
import { withApiHandler } from "@/lib/api/handler";

// icfms.txt: Branch Controller/Manager "upload optional evidence" for a
// finding - gated by findings.evidence. This is the only way to attach a
// file: comments are text only, so an upload naming a comment (the old
// comment-attachment flow) is refused outright. Attachments stored on
// older comments stay listed/downloadable/removable. Validation rules:
// EVIDENCE_VALIDATION_RULES.md. Uses Next.js's native request.formData()
// rather than a new multipart-parsing dependency.
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // The runtime's own request body parser rejects a formData() body over
  // ~10MB before this route ever sees it (verified: a well-formed upload
  // just past 10MB fails here, not at the MAX_EVIDENCE_BYTES check below) -
  // so a parse failure is treated as "too large" rather than the more
  // literal but misleading "no file provided".
  const authBase = await requireUser();
  if (!authBase.ok) return authBase.response;

  let formData: FormData | null = null;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "File exceeds the 10 MB limit" }, { status: 400 });
  }

  // Comments are text only - files can't be attached to a comment.
  const commentIdField = formData.get("commentId");
  if (typeof commentIdField === "string" && commentIdField) {
    return NextResponse.json(
      { error: "Comments are text only - attach files in the finding's Evidence section instead." },
      { status: 400 }
    );
  }
  if (!hasPermission(authBase.session.permissions, permissionKey("findings", "evidence"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const auth = authBase;

  // One account can't fill the disk: a per-user cap on uploads per window.
  const rateKey = `evidence-upload:${auth.session.userId}`;
  const limited = await isRateLimited(rateKey, EVIDENCE_UPLOAD_LIMIT);
  if (limited.limited) {
    return NextResponse.json(
      { error: `Too many uploads - please wait ${Math.ceil(limited.retryAfterSeconds / 60)} minute(s) and try again.` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  const db = await readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });


  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const extension = ALLOWED_EVIDENCE_TYPES[file.type];
  if (!extension) {
    return NextResponse.json(
      { error: "Unsupported file type. Allowed: PDF, PNG, JPG, XLSX, DOCX, CSV" },
      { status: 400 }
    );
  }
  if (file.size > MAX_EVIDENCE_BYTES) {
    return NextResponse.json({ error: "File exceeds the 10 MB limit" }, { status: 400 });
  }

  // file.type is just the Content-Type the client chose to send with the
  // upload - not trustworthy on its own. Confirm the actual bytes match
  // what the claimed type should look like before it's ever written to
  // disk or allowed into the allow-listed extension (see evidence.ts).
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!evidenceContentMatchesType(buffer, file.type)) {
    return NextResponse.json(
      { error: "File content doesn't match its declared type. Allowed: PDF, PNG, JPG, XLSX, DOCX, CSV" },
      { status: 400 }
    );
  }

  // Encrypted at rest in the dedicated storage folder (src/lib/fileStorage.ts).
  const storedFileName = newStoredName(extension);
  // A storage failure is mapped centrally (src/lib/errors/normalize.ts): logged in
  // full, the client only gets FILE_STORAGE_UNAVAILABLE / FILE_INTEGRITY_FAILED.
  writeStoredFile("evidence", storedFileName, buffer);
  await recordAttempt(rateKey, EVIDENCE_UPLOAD_LIMIT);

  let updated;
  try {
    updated = await updateDb((current) => {
      const f = current.findings.find((x) => x.id === id)!;
      const entry = {
        id: uuid(),
        findingId: f.id,
        commentId: null,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        storagePath: storedFileName,
        uploadedBy: auth.session.userId!,
        uploadedByName: auth.session.name!,
        createdAt: new Date().toISOString(),
      };
      current.evidence.push(entry);
      appendAuditLog(current, {
        userId: auth.session.userId!,
        userName: auth.session.name!,
        action: "EVIDENCE_UPLOAD",
        entityType: "Evidence",
        entityId: entry.id,
        newValue: { findingId: f.id, reference: f.reference, fileName: entry.fileName, mimeType: entry.mimeType, size: entry.size },
      });
      return entry;
    });
  } catch (err) {
    // The record didn't save - don't leave the file behind as an orphan.
    deleteStoredFile("evidence", storedFileName);
    throw err;
  }

  return NextResponse.json({ evidence: updated }, { status: 201 });
}

// Listing (unlike uploading) is available to anyone who can view the
// finding at all - a reviewer needs to see evidence without necessarily
// holding upload rights.
async function handleGET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.view");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = await readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  return NextResponse.json({ evidence: db.evidence.filter((e) => e.findingId === id) });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const POST = withApiHandler(handlePOST);
export const GET = withApiHandler(handleGET);
