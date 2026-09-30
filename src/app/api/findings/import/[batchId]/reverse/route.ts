import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { isFindingInScope } from "@/lib/findings-scope";
import { importReverseImpact, reverseImportBatch } from "@/lib/importReverse";
import { deleteStoredFile } from "@/lib/fileStorage";
import { AuthorizationError, BusinessRuleError, NotFoundError } from "@/lib/errors";
import { fromZodError } from "@/lib/errors/normalize";
import { logger } from "@/lib/logger";
import { withApiHandler } from "@/lib/api/handler";
import type { Database, ImportBatch } from "@/types";
import type { SessionData } from "@/lib/session";

const bodySchema = z.object({
  reason: z.string().trim().min(5, "Give a reason (at least 5 characters)").max(500),
  /** Also delete the import record (and its stored file) - no re-import afterwards. */
  deleteRecord: z.boolean().optional(),
});

// Reverse an import batch (Import History → Reverse), whatever has happened
// to its findings since - see src/lib/importReverse.ts. GET = the impact
// preview shown before confirming; POST = do it. Permission: Findings ›
// Reverse an Import, plus the caller's org scope must cover every finding.

function loadBatch(db: Database, batchId: string, session: SessionData): ImportBatch {
  const batch = db.importBatches.find((b) => b.id === batchId);
  if (!batch) throw new NotFoundError("import");
  if (batch.reversedAt) throw new BusinessRuleError("IMPORT_NOT_REVERSIBLE", "This import was already reversed.");
  const outOfScope = db.findings.filter((f) => f.importBatchId === batch.id && !isFindingInScope(session, f)).length;
  if (outOfScope > 0) throw new AuthorizationError(`This import includes ${outOfScope} finding(s) outside your organizational scope.`);
  return batch;
}

async function handleGET(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const auth = await requirePermission("findings.reverse-import");
  if (!auth.ok) return auth.response;
  const { batchId } = await params;
  const db = await readDb();
  const batch = loadBatch(db, batchId, auth.session);
  return NextResponse.json({ impact: importReverseImpact(db, batch) });
}

async function handlePOST(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const auth = await requirePermission("findings.reverse-import");
  if (!auth.ok) return auth.response;
  const { batchId } = await params;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw fromZodError(parsed.error);

  loadBatch(await readDb(), batchId, auth.session);
  const result = await updateDb((current) => {
    const b = loadBatch(current, batchId, auth.session);
    return reverseImportBatch(current, b, { userId: auth.session.userId!, userName: auth.session.name! }, parsed.data.reason, {
      deleteRecord: parsed.data.deleteRecord,
    });
  });

  // Files only after the database change committed.
  for (const name of result.evidenceFilesToDelete) {
    if (!deleteStoredFile("evidence", name)) logger.warn({ event: "storage.orphan" }, "Evidence file of a reversed import was already missing");
  }
  if (result.importFileToDelete) deleteStoredFile("imports", result.importFileToDelete);

  return NextResponse.json({ ok: true, removed: result.removedReferences.length, recordDeleted: Boolean(parsed.data.deleteRecord) });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const GET = withApiHandler(handleGET);
export const POST = withApiHandler(handlePOST);
