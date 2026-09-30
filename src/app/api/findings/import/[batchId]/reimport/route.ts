import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb } from "@/lib/db";
import { readStoredFile } from "@/lib/fileStorage";
import { runImport } from "@/lib/importRun";
import { hasPermission } from "@/lib/permissions/registry";
import { AuthorizationError, BusinessRuleError, NotFoundError } from "@/lib/errors";
import { withApiHandler } from "@/lib/api/handler";

const bodySchema = z.object({ skipDuplicates: z.boolean().optional() }).default({});

// Re-import a REVERSED batch from its stored original file (Import History →
// Re-import). Same pipeline and checks as a fresh upload (runImport):
// validated against today's data, duplicates offered as the final decision.
// Creates a new batch; needs Bulk Import plus Reverse an Import.
async function handlePOST(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const auth = await requirePermission("findings.import");
  if (!auth.ok) return auth.response;
  if (!hasPermission(auth.session.permissions, "findings.reverse-import")) throw new AuthorizationError();
  const { batchId } = await params;
  const body = bodySchema.parse((await request.json().catch(() => ({}))) ?? {});

  const db = await readDb();
  const batch = db.importBatches.find((b) => b.id === batchId);
  if (!batch) throw new NotFoundError("import");
  if (!batch.reversedAt) throw new BusinessRuleError("IMPORT_NOT_REVERSIBLE", "Only a reversed import can be re-imported.");
  if (!batch.storedFile) throw new BusinessRuleError("IMPORT_NOT_REVERSIBLE", "The original file wasn't kept for this import - upload it again instead.");
  const buffer = readStoredFile("imports", batch.storedFile);
  if (!buffer) throw new NotFoundError("import file", "The original file is missing from storage - upload it again instead.");

  const newBatch = await runImport(
    buffer,
    batch.fileName,
    {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      orgScope: auth.session.orgScope!,
      districtId: auth.session.districtId ?? null,
      branchId: auth.session.branchId ?? null,
    },
    { skipDuplicates: Boolean(body.skipDuplicates), auditAction: "IMPORT_REIMPORT", reimportOf: batch.id }
  );
  return NextResponse.json({ importBatch: newBatch }, { status: 201 });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const POST = withApiHandler(handlePOST);
