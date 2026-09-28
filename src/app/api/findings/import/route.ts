import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  parseImportWorkbook,
  validateImportRow,
  existingDedupeKeys,
} from "@/lib/import";
import { isRateLimited, recordAttempt } from "@/lib/rateLimit";
import { writeStoredFile, deleteStoredFile, newStoredName, FileStorageError } from "@/lib/fileStorage";
import type { ImportBatch, ImportBatchRow } from "@/types";

// Per-user cap on import attempts (each parses a whole workbook).
const IMPORT_UPLOAD_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 };

// master.txt §22's import history - every past run, kept permanently
// ("document any transformation") rather than only the response of the
// request that created it.
export async function GET() {
  const auth = await requirePermission("findings.import");
  if (!auth.ok) return auth.response;

  const db = await readDb();
  const batches = [...db.importBatches].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ importBatches: batches });
}

// HO Internal Controller's bulk sibling of POST /api/findings (single-
// record create) - master.txt §22: "HO Internal Controllers can
// import/enter Internal Audit findings." All-or-nothing: every row is
// validated first against a scratch clone of the database, and if even one
// row has a real validation error, nothing is imported at all - the whole
// file is rejected with the full row-by-row breakdown so the importer can
// fix everything in one pass, rather than the file partially landing and
// the importer having to re-derive which rows still need fixing from a
// list of already-mixed-in successes. A row that's merely a *duplicate* of
// existing data is not a validation error and does not block the file -
// only "error" outcomes do; duplicates are still just skipped and reported
// once the rest of the file actually commits.
export async function POST(request: Request) {
  const auth = await requirePermission("findings.import");
  if (!auth.ok) return auth.response;

  const rateKey = `import-upload:${auth.session.userId}`;
  const limited = await isRateLimited(rateKey, IMPORT_UPLOAD_LIMIT);
  if (limited.limited) {
    return NextResponse.json(
      { error: `Too many import attempts - please wait ${Math.ceil(limited.retryAfterSeconds / 60)} minute(s) and try again.` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }
  await recordAttempt(rateKey, IMPORT_UPLOAD_LIMIT);

  let formData: FormData | null = null;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "File exceeds the 10 MB limit" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return NextResponse.json({ error: "File exceeds the 10 MB limit" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = await parseImportWorkbook(buffer);
  if (parsed.error) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  if (parsed.rows.length === 0) {
    return NextResponse.json({ error: "No data rows found below the header" }, { status: 400 });
  }
  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    return NextResponse.json({ error: `This file has ${parsed.rows.length} rows - split it into batches of ${MAX_IMPORT_ROWS} or fewer` }, { status: 400 });
  }

  // Dry run against a scratch clone - never persisted - purely to find out
  // whether the file has any real validation error before touching the
  // real database at all. Uses a throwaway batch id since none of this
  // clone's mutations (findings, transitions, ...) are ever written back.
  const importerScope = {
    orgScope: auth.session.orgScope!,
    districtId: auth.session.districtId ?? null,
    branchId: auth.session.branchId ?? null,
  };

  const dryDb = structuredClone(await readDb());
  const dryRows: ImportBatchRow[] = parsed.rows.map((row, i) =>
    validateImportRow(dryDb, row, i + 2, existingDedupeKeys(dryDb), {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      importBatchId: "dry-run",
      importerScope,
    })
  );
  const dryErrorCount = dryRows.filter((r) => r.outcome === "error").length;
  if (dryErrorCount > 0) {
    return NextResponse.json(
      {
        error: `This file has ${dryErrorCount} problem(s) - fix them and re-upload the whole file. Nothing was imported.`,
        rows: dryRows.map(({ rowNumber, outcome, reference, duplicateOfReference, error }) => ({
          rowNumber,
          outcome,
          reference,
          duplicateOfReference,
          error,
        })),
      },
      { status: 400 }
    );
  }

  const importBatchId = uuid();

  // Keep the original spreadsheet (encrypted, storage folder's imports/
  // area) so the exact file behind this batch can be downloaded later from
  // Import History. Only for a file that actually imports - a rejected file
  // changed nothing, so there's nothing to keep a record of.
  const storedFile = newStoredName("xlsx");
  try {
    writeStoredFile("imports", storedFile, buffer);
  } catch (err) {
    console.error("[import] storing original file failed", err);
    const message = err instanceof FileStorageError ? err.message : "Could not store the import file - please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  let batch: ImportBatch;
  try {
    batch = await updateDb((current) => {
      const seenKeys = existingDedupeKeys(current);
      const rows: ImportBatchRow[] = parsed.rows.map((row, i) =>
        validateImportRow(current, row, i + 2, seenKeys, {
          userId: auth.session.userId!,
          userName: auth.session.name!,
          importBatchId,
          importerScope,
        })
      );

      const importedCount = rows.filter((r) => r.outcome === "imported").length;
      const duplicateCount = rows.filter((r) => r.outcome === "duplicate").length;
      const errorCount = rows.filter((r) => r.outcome === "error").length;

      const record: ImportBatch = {
        id: importBatchId,
        fileName: file.name,
        importedBy: auth.session.userId!,
        importedByName: auth.session.name!,
        totalRows: rows.length,
        importedCount,
        duplicateCount,
        errorCount,
        // Never store the resolved `finding` object here - the ledger
        // records the outcome/reference, not a second copy of the finding.
        rows: rows.map(({ rowNumber, outcome, findingId, reference, duplicateOfReference, error }) => ({
          rowNumber,
          outcome,
          findingId,
          reference,
          duplicateOfReference,
          error,
        })),
        storedFile,
        createdAt: new Date().toISOString(),
      };
      current.importBatches.push(record);

      appendAuditLog(current, {
        userId: auth.session.userId!,
        userName: auth.session.name!,
        action: "IMPORT",
        entityType: "ImportBatch",
        entityId: record.id,
        newValue: { fileName: record.fileName, importedCount, duplicateCount, errorCount, totalRows: record.totalRows },
      });

      return record;
    });
  } catch (err) {
    deleteStoredFile("imports", storedFile);
    throw err;
  }

  return NextResponse.json({ importBatch: batch }, { status: 201 });
}
