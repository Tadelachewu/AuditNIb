import { v4 as uuid } from "uuid";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { MAX_IMPORT_ROWS, parseImportWorkbook, validateImportRow, existingSimilarityKeys } from "@/lib/import";
import { writeStoredFile, deleteStoredFile, newStoredName } from "@/lib/fileStorage";
import { ApplicationError, ValidationError } from "@/lib/errors";
import { SIMILAR_FINDING_FIELDS } from "@/types";
import type { Database, ImportBatch, ImportBatchRow } from "@/types";

/**
 * One import run - shared by a normal upload and by Re-import (Import
 * History, after a reversal). Order of checks:
 *
 *   1. File shape (readable .xlsx, header, 1..MAX rows)
 *   2. Every row validated against a scratch copy of the data; if ANY row
 *      has an error -> IMPORT_FILE_INVALID, nothing imported, all problems
 *      listed.
 *   3. FINAL check - duplicates, by the admin-configured rule (Settings →
 *      Similar Findings, the same rule the Register Finding form uses). If
 *      rows duplicate existing findings (or each other) and the importer
 *      hasn't decided yet -> IMPORT_DUPLICATES_FOUND with evidence for
 *      each, nothing imported. The importer then either imports everything
 *      anyway, duplicates included (importDuplicates), or cancels.
 *   4. Commit: original file stored (encrypted), findings created, batch +
 *      audit entry written, all in one transaction.
 */
export interface ImportActor {
  userId: string;
  userName: string;
  orgScope: string;
  districtId: string | null;
  branchId: string | null;
}

export interface DuplicateEvidence {
  rowNumber: number;
  /** The existing finding (or earlier row in this file) it duplicates. */
  matchesReference: string;
  matchesFindingId: string | null;
  /** true when the match is another row in the same file, not saved data. */
  withinFile: boolean;
  matchesRowNumber: number | null;
  rowTitle: string;
  existing: {
    title: string;
    status: string;
    branch: string;
    period: string;
    source: string;
    department: string;
    category: string;
    findingDate: string;
    operationArea: string;
    irregularityType: string;
    amount: number;
    currency: string;
    caseCount: number;
  } | null;
}

/** Labels of the admin-configured duplicate fields (Settings → Similar Findings). */
export function duplicateMatchFields(db: Database): string[] {
  return (db.settings.similarFindingFields ?? []).map((k) => SIMILAR_FINDING_FIELDS.find((f) => f.key === k)?.label ?? k);
}

export async function runImport(
  buffer: Buffer,
  fileName: string,
  actor: ImportActor,
  opts: { importDuplicates: boolean; auditAction?: string; reimportOf?: string }
): Promise<ImportBatch> {
  const parsed = await parseImportWorkbook(buffer);
  if (parsed.error) throw new ValidationError(parsed.error);
  if (parsed.rows.length === 0) throw new ValidationError("No data rows found below the header");
  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    throw new ValidationError(`This file has ${parsed.rows.length} rows - split it into batches of ${MAX_IMPORT_ROWS} or fewer`);
  }

  const rowOpts = (importBatchId: string, allowDuplicates = false) => ({
    userId: actor.userId,
    userName: actor.userName,
    importBatchId,
    allowDuplicates,
    importerScope: { orgScope: actor.orgScope, districtId: actor.districtId, branchId: actor.branchId },
  });

  // Dry run on a scratch copy - never persisted.
  const live = await readDb();
  const dryDb = structuredClone(live);
  const drySeen = existingSimilarityKeys(dryDb);
  const dryRows: ImportBatchRow[] = parsed.rows.map((row, i) => stripFinding(validateImportRow(dryDb, row, i + 2, drySeen, rowOpts("dry-run"))));

  const errorCount = dryRows.filter((r) => r.outcome === "error").length;
  if (errorCount > 0) {
    throw new ApplicationError("IMPORT_FILE_INVALID", {
      message: `This file has ${errorCount} problem(s) - fix them and re-upload the whole file. Nothing was imported.`,
      details: { rows: dryRows },
    });
  }

  const duplicates = dryRows.filter((r) => r.outcome === "duplicate");
  if (duplicates.length > 0 && !opts.importDuplicates) {
    throw new ApplicationError("IMPORT_DUPLICATES_FOUND", {
      message: `${duplicates.length} of ${dryRows.length} row(s) look like findings that already exist. Nothing was imported yet - import all ${dryRows.length} row(s) anyway, or cancel.`,
      details: {
        totalRows: dryRows.length,
        matchFields: duplicateMatchFields(live),
        duplicates: duplicates.map((d) => duplicateEvidence(d, parsed.rows[d.rowNumber - 2]?.title ?? "", live, dryDb, dryRows)),
      },
    });
  }

  const importBatchId = uuid();
  const storedFile = newStoredName("xlsx");
  writeStoredFile("imports", storedFile, buffer);
  try {
    return await updateDb((current) => {
      const seenKeys = existingSimilarityKeys(current);
      const rows = parsed.rows.map((row, i) => stripFinding(validateImportRow(current, row, i + 2, seenKeys, rowOpts(importBatchId, opts.importDuplicates))));
      const importedCount = rows.filter((r) => r.outcome === "imported").length;
      const duplicateCount = rows.filter((r) => r.outcome === "duplicate").length;
      const record: ImportBatch = {
        id: importBatchId,
        fileName,
        importedBy: actor.userId,
        importedByName: actor.userName,
        totalRows: rows.length,
        importedCount,
        duplicateCount,
        errorCount: rows.filter((r) => r.outcome === "error").length,
        rows,
        storedFile,
        createdAt: new Date().toISOString(),
      };
      current.importBatches.push(record);
      appendAuditLog(current, {
        userId: actor.userId,
        userName: actor.userName,
        action: opts.auditAction ?? "IMPORT",
        entityType: "ImportBatch",
        entityId: record.id,
        newValue: {
          fileName,
          importedCount,
          duplicatesImportedAnyway: rows.filter((r) => r.outcome === "imported" && r.duplicateOfReference).length,
          totalRows: rows.length,
          reimportOf: opts.reimportOf,
        },
      });
      return record;
    });
  } catch (err) {
    deleteStoredFile("imports", storedFile);
    throw err;
  }
}

/** The batch ledger records outcomes, never a second copy of the finding. */
function stripFinding(r: ImportBatchRow & { finding?: unknown }): ImportBatchRow {
  const { rowNumber, outcome, findingId, reference, duplicateOfReference, error, errors } = r;
  return { rowNumber, outcome, findingId, reference, duplicateOfReference, error, errors };
}

function duplicateEvidence(row: ImportBatchRow, rowTitle: string, live: Database, dryDb: Database, dryRows: ImportBatchRow[]): DuplicateEvidence {
  const ref = row.duplicateOfReference ?? "";
  const saved = live.findings.find((f) => f.reference === ref);
  const match = saved ?? dryDb.findings.find((f) => f.reference === ref);
  const name = <T extends { id: string; name?: string; code?: string }>(list: T[], id: string) => {
    const x = list.find((i) => i.id === id);
    return x ? (x.name ?? x.code ?? "") : "";
  };
  return {
    rowNumber: row.rowNumber,
    matchesReference: ref,
    matchesFindingId: saved?.id ?? null,
    withinFile: !saved,
    matchesRowNumber: saved ? null : (dryRows.find((r) => r.reference === ref)?.rowNumber ?? null),
    rowTitle,
    existing: match
      ? {
          title: match.title,
          status: match.status,
          branch: name(live.branches, match.branchId),
          period: live.reportingPeriods.find((p) => p.id === match.periodId)?.code ?? "",
          source: name(live.sources, match.sourceId),
          department: name(live.departments, match.departmentId),
          category: name(live.categories, match.categoryId),
          findingDate: match.findingDate,
          operationArea: match.operationArea,
          irregularityType: match.irregularityType,
          amount: match.amount,
          currency: match.currency,
          caseCount: match.caseCount,
        }
      : null,
  };
}
