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
import type { ImportBatch, ImportBatchRow } from "@/types";

// master.txt §22's import history - every past run, kept permanently
// ("document any transformation") rather than only the response of the
// request that created it.
export async function GET() {
  const auth = await requirePermission("findings.import");
  if (!auth.ok) return auth.response;

  const db = readDb();
  const batches = [...db.importBatches].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ importBatches: batches });
}

// HO Internal Controller's bulk sibling of POST /api/findings (single-
// record create) - master.txt §22: "HO Internal Controllers can
// import/enter Internal Audit findings." Every row is validated and
// deduplicated independently; a bad row is reported and skipped rather
// than failing the whole file, so one typo doesn't block 500 good rows.
export async function POST(request: Request) {
  const auth = await requirePermission("findings.import");
  if (!auth.ok) return auth.response;

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

  const importBatchId = uuid();

  const batch = updateDb((current) => {
    const seenKeys = existingDedupeKeys(current);
    const rows: ImportBatchRow[] = parsed.rows.map((row, i) =>
      validateImportRow(current, row, i + 2, seenKeys, { userId: auth.session.userId!, importBatchId })
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

  return NextResponse.json({ importBatch: batch }, { status: 201 });
}
