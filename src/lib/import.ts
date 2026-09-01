import ExcelJS from "exceljs";
import { v4 as uuid } from "uuid";
import { nextFindingReference } from "@/lib/findings";
import { isDepartmentInScope } from "@/lib/org";
import type { Database, Finding, ImportBatchRow } from "@/types";

const SHEET_NAME = "Findings";
const REFERENCE_SHEET_NAME = "Reference Data";

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
// A generous ceiling, not an expected volume - guards against a single
// request trying to create an unreasonable number of findings in one
// updateDb() transaction.
export const MAX_IMPORT_ROWS = 2000;

// Ordered to match the registration form (NewFindingForm.tsx / the
// createSchema in src/app/api/findings/route.ts) field-for-field - the
// dedupe key below is defined over the same fields for the same reason
// (master.txt §22: "other fields should be the same as the finding
// registration form fields"). Reference/status/rectifiedCases etc. are
// never columns here - they're either system-generated or start at zero,
// exactly like a manually-registered finding.
const IMPORT_COLUMNS = [
  { key: "districtCode", header: "District Code", required: true },
  { key: "branchCode", header: "Branch Code", required: true },
  { key: "periodCode", header: "Reporting Period Code", required: true },
  { key: "sourceCode", header: "Source Code", required: true },
  { key: "departmentCode", header: "Department Code", required: true },
  { key: "categoryCode", header: "Classified Category Code", required: true },
  { key: "title", header: "Title", required: true },
  { key: "findingDate", header: "Finding Date (YYYY-MM-DD)", required: true },
  { key: "operationArea", header: "Operation Area", required: true },
  { key: "irregularityType", header: "Type of Irregularity", required: true },
  { key: "amount", header: "Amount", required: true },
  { key: "currency", header: "Currency", required: true },
  { key: "caseCount", header: "Number of Cases", required: true },
  { key: "riskLevel", header: "Risk Level", required: true },
  { key: "priority", header: "Priority", required: true },
  { key: "description", header: "Description", required: true },
  { key: "recommendation", header: "Recommendation (optional)", required: false },
  { key: "evidenceNote", header: "Evidence Note (optional)", required: false },
  { key: "externalReference", header: "External Reference (optional)", required: false },
] as const;

type ImportColumnKey = (typeof IMPORT_COLUMNS)[number]["key"];
type RawImportRow = Partial<Record<ImportColumnKey, string>>;

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object" && "text" in value) return String((value as { text: unknown }).text ?? "");
  if (typeof value === "object" && "result" in value) return String((value as { result: unknown }).result ?? "");
  return String(value).trim();
}

/**
 * Builds the downloadable import template: a "Findings" sheet with the
 * exact header row parseImportWorkbook() expects, plus a "Reference Data"
 * sheet listing every currently-valid code/name for each lookup column, so
 * whoever fills the template in Excel has the real, current values to
 * copy from instead of guessing (master.txt §22: "standardized import
 * template aligned to Finding model").
 */
export async function buildImportTemplate(db: Database): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  const sheet = workbook.addWorksheet(SHEET_NAME);
  sheet.addRow(IMPORT_COLUMNS.map((c) => c.header));
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((col) => {
    col.width = 24;
  });

  const ref = workbook.addWorksheet(REFERENCE_SHEET_NAME);
  const refSection = (title: string, rows: string[][]) => {
    ref.addRow([title]).font = { bold: true };
    rows.forEach((r) => ref.addRow(r));
    ref.addRow([]);
  };
  refSection(
    "Districts (code — name)",
    db.districts.filter((d) => d.status === "ACTIVE").map((d) => [d.code, d.name])
  );
  refSection(
    "Branches (code — name — district code)",
    db.branches
      .filter((b) => b.status === "ACTIVE")
      .map((b) => [b.code, b.name, db.districts.find((d) => d.id === b.districtId)?.code ?? ""])
  );
  refSection(
    "Reporting Periods (code — status)",
    db.reportingPeriods.map((p) => [p.code, p.status])
  );
  refSection(
    "Sources (code — name)",
    db.sources.filter((s) => s.active).map((s) => [s.code, s.name])
  );
  refSection(
    "Departments (code — name — scope)",
    db.departments.filter((d) => d.active).map((d) => [d.code, d.name, d.orgScope])
  );
  refSection(
    "Classified Categories (code — name)",
    db.categories.filter((c) => c.active).map((c) => [c.code, c.name])
  );
  refSection("Currencies", db.settings.currencies.map((c) => [c]));
  refSection("Risk Levels", db.settings.riskLevels.map((r) => [r]));
  refSection("Priorities", db.settings.priorityLevels.map((p) => [p]));
  refSection("Operation Areas", db.settings.operationAreas.map((a) => [a]));
  refSection("Types of Irregularity", db.settings.irregularityTypes.map((t) => [t]));
  ref.columns.forEach((col) => {
    col.width = 28;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export interface ParsedImportResult {
  rows: RawImportRow[];
  error?: string;
}

/** Reads the "Findings" sheet (or the first sheet, if unrenamed) - column order doesn't matter, only the header text does. */
export async function parseImportWorkbook(buffer: Buffer): Promise<ParsedImportResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return { rows: [], error: "Could not read this file - upload the .xlsx template file" };
  }

  const sheet = workbook.getWorksheet(SHEET_NAME) ?? workbook.worksheets[0];
  if (!sheet) return { rows: [], error: "The workbook has no sheets" };

  const headerRow = sheet.getRow(1);
  const columnForIndex = new Map<number, ImportColumnKey>();
  headerRow.eachCell((cell, colNumber) => {
    const text = cellText(cell.value).toLowerCase();
    const match = IMPORT_COLUMNS.find((c) => c.header.toLowerCase() === text);
    if (match) columnForIndex.set(colNumber, match.key);
  });
  if (columnForIndex.size === 0) {
    return { rows: [], error: "No recognized columns found - use the downloaded template's header row unchanged" };
  }

  const rows: RawImportRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (row.cellCount === 0) continue;
    const record: RawImportRow = {};
    let hasAnyValue = false;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = columnForIndex.get(colNumber);
      if (!key) return;
      const text = cellText(cell.value);
      if (text) hasAnyValue = true;
      record[key] = text;
    });
    if (hasAnyValue) rows.push(record);
  }

  return { rows };
}

/**
 * The dedupe key: every field an import row and a manually-registered
 * finding both have, excluding free text (description/recommendation/
 * evidenceNote/title - too easy to differ by whitespace/wording for an
 * exact-match key to be meaningful) and excluding reference (always
 * system-generated, never comparable across a re-import).
 */
function dedupeKey(f: {
  branchId: string;
  periodId: string;
  sourceId: string;
  departmentId: string;
  categoryId: string;
  findingDate: string;
  operationArea: string;
  irregularityType: string;
  currency: string;
  amount: number;
  caseCount: number;
}): string {
  return [
    f.branchId,
    f.periodId,
    f.sourceId,
    f.departmentId,
    f.categoryId,
    f.findingDate,
    f.operationArea,
    f.irregularityType,
    f.currency,
    f.amount,
    f.caseCount,
  ].join("|");
}

export function existingDedupeKeys(db: Database): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of db.findings) {
    map.set(
      dedupeKey({
        branchId: f.branchId,
        periodId: f.periodId,
        sourceId: f.sourceId,
        departmentId: f.departmentId,
        categoryId: f.categoryId,
        findingDate: f.findingDate,
        operationArea: f.operationArea,
        irregularityType: f.irregularityType,
        currency: f.currency,
        amount: f.amount,
        caseCount: f.caseCount,
      }),
      f.reference
    );
  }
  return map;
}

/**
 * Validates one raw row against current reference data and, if valid and
 * not a duplicate, creates the Finding (status DRAFT, same as a manually-
 * registered one - master.txt §24 leaves "does Internal Audit skip
 * workflow" as an open decision, so import deliberately reuses the exact
 * same entry point/workflow as the existing single-record HO "create"
 * path rather than inventing a shortcut).
 *
 * `db` must be the live mutable draft inside an updateDb() callback, not a
 * read-only snapshot: a valid row is pushed straight into `db.findings`
 * before returning, so nextFindingReference()'s per-branch/period sequence
 * count - and every later row's duplicate check - both see it immediately.
 * Without that, two rows in the same file for the same branch/period would
 * collide on the same generated reference number. `seenKeys` is likewise
 * mutated immediately so two duplicate rows *within the same file* are
 * caught against each other, not just against what predates this import.
 */
export function validateImportRow(
  db: Database,
  row: RawImportRow,
  rowNumber: number,
  seenKeys: Map<string, string>,
  opts: { userId: string; importBatchId: string }
): ImportBatchRow & { finding?: Finding } {
  const missing = IMPORT_COLUMNS.filter((c) => c.required && !row[c.key]?.trim());
  if (missing.length > 0) {
    return { rowNumber, outcome: "error", error: `Missing required value(s): ${missing.map((c) => c.header).join(", ")}` };
  }

  const district = db.districts.find((d) => d.code === row.districtCode?.trim() && d.status === "ACTIVE");
  if (!district) return { rowNumber, outcome: "error", error: `Unknown or inactive district code "${row.districtCode}"` };

  const branch = db.branches.find((b) => b.code === row.branchCode?.trim() && b.status === "ACTIVE");
  if (!branch) return { rowNumber, outcome: "error", error: `Unknown or inactive branch code "${row.branchCode}"` };
  if (branch.districtId !== district.id) {
    return { rowNumber, outcome: "error", error: `Branch "${row.branchCode}" does not belong to district "${row.districtCode}"` };
  }

  const period = db.reportingPeriods.find((p) => p.code === row.periodCode?.trim());
  if (!period) return { rowNumber, outcome: "error", error: `Unknown reporting period code "${row.periodCode}"` };
  if (period.status === "LOCKED") {
    return { rowNumber, outcome: "error", error: `${period.code} is locked and cannot accept new findings` };
  }

  const source = db.sources.find((s) => s.code === row.sourceCode?.trim() && s.active);
  if (!source) return { rowNumber, outcome: "error", error: `Unknown or inactive source code "${row.sourceCode}"` };

  const department = db.departments.find((d) => d.code === row.departmentCode?.trim() && d.active);
  if (!department) return { rowNumber, outcome: "error", error: `Unknown or inactive department code "${row.departmentCode}"` };
  if (!isDepartmentInScope(department, { districtId: district.id, branchId: branch.id })) {
    return { rowNumber, outcome: "error", error: `Department "${row.departmentCode}" is not available for branch "${row.branchCode}"` };
  }

  const category = db.categories.find((c) => c.code === row.categoryCode?.trim() && c.active);
  if (!category) return { rowNumber, outcome: "error", error: `Unknown or inactive classified category code "${row.categoryCode}"` };

  if (!db.settings.currencies.includes(row.currency!.trim())) {
    return { rowNumber, outcome: "error", error: `Unknown currency "${row.currency}"` };
  }
  if (!db.settings.riskLevels.includes(row.riskLevel!.trim())) {
    return { rowNumber, outcome: "error", error: `Unknown risk level "${row.riskLevel}"` };
  }
  if (!db.settings.priorityLevels.includes(row.priority!.trim())) {
    return { rowNumber, outcome: "error", error: `Unknown priority "${row.priority}"` };
  }
  if (!db.settings.operationAreas.includes(row.operationArea!.trim())) {
    return { rowNumber, outcome: "error", error: `Unknown operation area "${row.operationArea}"` };
  }
  if (!db.settings.irregularityTypes.includes(row.irregularityType!.trim())) {
    return { rowNumber, outcome: "error", error: `Unknown type of irregularity "${row.irregularityType}"` };
  }

  const findingDate = row.findingDate!.trim();
  if (Number.isNaN(new Date(findingDate).getTime())) {
    return { rowNumber, outcome: "error", error: `Invalid finding date "${row.findingDate}" - use YYYY-MM-DD` };
  }

  const amount = Number(row.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return { rowNumber, outcome: "error", error: `Invalid amount "${row.amount}"` };
  }
  const caseCount = Number(row.caseCount);
  if (!Number.isInteger(caseCount) || caseCount < 1) {
    return { rowNumber, outcome: "error", error: `Invalid number of cases "${row.caseCount}" - must be a whole number of at least 1` };
  }

  const key = dedupeKey({
    branchId: branch.id,
    periodId: period.id,
    sourceId: source.id,
    departmentId: department.id,
    categoryId: category.id,
    findingDate,
    operationArea: row.operationArea!.trim(),
    irregularityType: row.irregularityType!.trim(),
    currency: row.currency!.trim(),
    amount,
    caseCount,
  });
  const existingReference = seenKeys.get(key);
  if (existingReference) {
    return { rowNumber, outcome: "duplicate", duplicateOfReference: existingReference };
  }

  const now = new Date().toISOString();
  const finding: Finding = {
    id: uuid(),
    reference: nextFindingReference(db, branch, period),
    title: row.title!.trim(),
    sourceId: source.id,
    departmentId: department.id,
    periodId: period.id,
    districtId: district.id,
    branchId: branch.id,
    findingDate,
    operationArea: row.operationArea!.trim(),
    irregularityType: row.irregularityType!.trim(),
    categoryId: category.id,
    amount,
    currency: row.currency!.trim(),
    caseCount,
    riskLevel: row.riskLevel!.trim(),
    priority: row.priority!.trim(),
    description: row.description!.trim(),
    recommendation: row.recommendation?.trim() || undefined,
    evidenceNote: row.evidenceNote?.trim() || undefined,
    externalReference: row.externalReference?.trim() || undefined,
    importBatchId: opts.importBatchId,
    status: "DRAFT",
    rectifiedCases: 0,
    rectifiedAmount: 0,
    closedCases: 0,
    closedAmount: 0,
    districtVerifiedCases: 0,
    districtVerifiedAmount: 0,
    createdBy: opts.userId,
    createdAt: now,
    updatedAt: now,
  };

  seenKeys.set(key, finding.reference);
  db.findings.push(finding);

  return { rowNumber, outcome: "imported", findingId: finding.id, reference: finding.reference, finding };
}
