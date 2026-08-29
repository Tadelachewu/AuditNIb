import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import fs from "fs";
import { requireUser, requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import {
  ALLOWED_EVIDENCE_TYPES,
  MAX_EVIDENCE_BYTES,
  ensureUploadsDir,
  evidenceStoragePath,
  evidenceContentMatchesType,
} from "@/lib/evidence";

// icfms.txt: Branch Controller/Manager "upload optional evidence" for a
// finding - gated by findings.evidence. A file attached to a *comment*
// instead (BR-WF-018, master.txt §12: "Users may add attachments to
// comments where permitted") is gated by findings.comment instead, since
// that's the actual action being authorized - District Controller/Director
// can comment (and so attach to their own comment) without holding
// findings.evidence at all. Uses Next.js's native request.formData()
// rather than a new multipart-parsing dependency.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // The runtime's own request body parser rejects a formData() body over
  // ~10MB before this route ever sees it (verified: a well-formed upload
  // just past 10MB fails here, not at the MAX_EVIDENCE_BYTES check below) -
  // so a parse failure is treated as "too large" rather than the more
  // literal but misleading "no file provided". Parsed before the
  // permission check below since which permission applies depends on
  // whether a commentId field is present.
  const authBase = await requireUser();
  if (!authBase.ok) return authBase.response;

  let formData: FormData | null = null;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "File exceeds the 10 MB limit" }, { status: 400 });
  }

  const commentIdField = formData.get("commentId");
  const commentId = typeof commentIdField === "string" && commentIdField ? commentIdField : null;
  const requiredPermission = permissionKey("findings", commentId ? "comment" : "evidence");
  if (!hasPermission(authBase.session.permissions, requiredPermission)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const auth = authBase;

  const db = readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  if (commentId && !db.comments.some((c) => c.id === commentId && c.findingId === id)) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

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

  ensureUploadsDir();
  const storedFileName = `${uuid()}.${extension}`;
  fs.writeFileSync(evidenceStoragePath(storedFileName), buffer);

  const updated = updateDb((current) => {
    const f = current.findings.find((x) => x.id === id)!;
    const entry = {
      id: uuid(),
      findingId: f.id,
      commentId,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      storagePath: storedFileName,
      uploadedBy: auth.session.userId!,
      uploadedByName: auth.session.name!,
      createdAt: new Date().toISOString(),
    };
    current.evidence.push(entry);
    return entry;
  });

  return NextResponse.json({ evidence: updated }, { status: 201 });
}

// Listing (unlike uploading) is available to anyone who can view the
// finding at all - a reviewer needs to see evidence without necessarily
// holding upload rights.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.view");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  return NextResponse.json({ evidence: db.evidence.filter((e) => e.findingId === id) });
}
