import { NextResponse } from "next/server";
import fs from "fs";
import { requirePermission } from "@/lib/guard";
import { readDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { evidenceStoragePath } from "@/lib/evidence";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; evidenceId: string }> }
) {
  const auth = await requirePermission("findings.view");
  if (!auth.ok) return auth.response;
  const { id, evidenceId } = await params;

  const db = readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  const record = db.evidence.find((e) => e.id === evidenceId && e.findingId === id);
  if (!record) return NextResponse.json({ error: "Evidence not found" }, { status: 404 });

  const filePath = evidenceStoragePath(record.storagePath);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "File is missing from storage" }, { status: 404 });
  }

  const buffer = fs.readFileSync(filePath);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": record.mimeType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(record.fileName)}"`,
      "Content-Length": String(record.size),
    },
  });
}
