import ExcelJS from "exceljs";
import { v4 as uuid } from "uuid";
import { nextFindingReference } from "@/lib/findings";
import { isDepartmentInScope } from "@/lib/org";
import type { Database, Finding, ImportBatchRow, RequirableFindingField } from "@/types";

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
  { key: "recommendation", header: "Recommendation", required: false },
  { key: "evidenceNote", header: "Evidence Note", required: false },
  { key: "externalReference", header: "External Reference (optional)", required: false },
] as const;

type ImportColumnKey = (typeof IMPORT_COLUMNS)[number]["key"];

// Maps each IMPORT_COLUMNS key that's also admin-configurable via
// Settings.requiredFindingFields to the matching key there - explicit
// rather than assuming identical names, because three of them genuinely
// aren't: this file's columns are the *code* a spreadsheet row supplies
// (sourceCode/departmentCode/categoryCode, resolved to a real record
// below), while REQUIRABLE_FINDING_FIELDS names the *id* field actually
// stored on the Finding (sourceId/departmentId/categoryId) - relying on
// name equality here would have silently ignored the admin's setting for
// exactly those three. Every column not listed here (districtCode,
// branchCode, periodCode, amount, caseCount, externalReference) keeps its
// own static `required` flag above - none of the five hard-required
// fields are configurable, and externalReference is always optional.
// rootCause has no import column at all (a pre-existing gap, not
// introduced here), so a required/optional toggle for it has nothing to
// affect on this path.
const IMPORT_COLUMN_REQUIRABLE_KEY: Partial<Record<ImportColumnKey, RequirableFindingField>> = {
  title: "title",
  sourceCode: "sourceId",
  departmentCode: "departmentId",
  findingDate: "findingDate",
  operationArea: "operationArea",
  irregularityType: "irregularityType",
  categoryCode: "categoryId",
  currency: "currency",
  riskLevel: "riskLevel",
  priority: "priority",
  description: "description",
  recommendation: "recommendation",
  evidenceNote: "evidenceNote",
};

// Whether this column is currently required - Settings.requiredFindingFields
// for a configurable column, its own static flag otherwise.
function columnRequired(db: Database, column: (typeof IMPORT_COLUMNS)[number]): boolean {
  const requirableKey = IMPORT_COLUMN_REQUIRABLE_KEY[column.key];
  return requirableKey ? db.settings.requiredFindingFields[requirableKey] : column.required;
}

// The base `header` above is a static label; for a configurable column,
// whether "(optional)" belongs on the end depends on that live setting,
// not a fixed per-column flag - externalReference (always optional, never
// configurable) keeps its suffix baked into the literal above instead.
function columnHeader(db: Database, column: (typeof IMPORT_COLUMNS)[number]): string {
  if (!IMPORT_COLUMN_REQUIRABLE_KEY[column.key]) return column.header;
  return columnRequired(db, column) ? column.header : `${column.header} (optional)`;
}

// Strips a trailing "(optional)" (case-insensitive) so an uploaded
// header matches its column regardless of whether the file was
// downloaded while the field was required or optional.
function normalizeHeaderText(text: string): string {
  return text.trim().toLowerCase().replace(/\s*\(optional\)\s*$/i, "");
}
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
  sheet.addRow(IMPORT_COLUMNS.map((c) => columnHeader(db, c)));
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
    const text = normalizeHeaderText(cellText(cell.value));
    // Matched with a trailing "(optional)" stripped from both sides - a
    // downloaded template's exact wording for a configurable column
    // depends on Settings.requiredFindingFields at download time, which
    // may have changed since (or the file predates this feature
    // entirely), so this can't assume today's setting matches whatever
    // the uploaded file's header literally says.
    const match = IMPORT_COLUMNS.find((c) => normalizeHeaderText(c.header) === text);
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
  const missing = IMPORT_COLUMNS.filter((c) => columnRequired(db, c) && !row[c.key]?.trim());
  if (missing.length > 0) {
    return { rowNumber, outcome: "error", error: `Missing required value(s): ${missing.map((c) => columnHeader(db, c)).join(", ")}` };
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
  // Imported rows always land as DRAFT (see below) - same exception as
  // manual creation in src/app/api/findings/route.ts.
  if (period.status === "LOCKED" && !period.draftsAllowedWhileLocked) {
    return { rowNumber, outcome: "error", error: `${period.code} is locked and cannot accept new findings` };
  }

  // Each of source/department/category is only looked up (and thus only
  // validated against reference data) when a code was actually given -
  // the row can only reach this point with one blank at all because the
  // `missing` check above already let it through, which only happens
  // when Settings.requiredFindingFields has opted that field out.
  const sourceCode = row.sourceCode?.trim();
  const source = sourceCode ? db.sources.find((s) => s.code === sourceCode && s.active) : undefined;
  if (sourceCode && !source) return { rowNumber, outcome: "error", error: `Unknown or inactive source code "${row.sourceCode}"` };

  const departmentCode = row.departmentCode?.trim();
  const department = departmentCode ? db.departments.find((d) => d.code === departmentCode && d.active) : undefined;
  if (departmentCode && !department) return { rowNumber, outcome: "error", error: `Unknown or inactive department code "${row.departmentCode}"` };
  if (department && !isDepartmentInScope(department, { districtId: district.id, branchId: branch.id })) {
    return { rowNumber, outcome: "error", error: `Department "${row.departmentCode}" is not available for branch "${row.branchCode}"` };
  }

  const categoryCode = row.categoryCode?.trim();
  const category = categoryCode ? db.categories.find((c) => c.code === categoryCode && c.active) : undefined;
  if (categoryCode && !category) return { rowNumber, outcome: "error", error: `Unknown or inactive classified category code "${row.categoryCode}"` };

  // Same reasoning for these five - a blank value only reaches here when
  // it's been opted out of Settings.requiredFindingFields, in which case
  // there's nothing to check it against.
  if (row.currency?.trim() && !db.settings.currencies.includes(row.currency.trim())) {
    return { rowNumber, outcome: "error", error: `Unknown currency "${row.currency}"` };
  }
  if (row.riskLevel?.trim() && !db.settings.riskLevels.includes(row.riskLevel.trim())) {
    return { rowNumber, outcome: "error", error: `Unknown risk level "${row.riskLevel}"` };
  }
  if (row.priority?.trim() && !db.settings.priorityLevels.includes(row.priority.trim())) {
    return { rowNumber, outcome: "error", error: `Unknown priority "${row.priority}"` };
  }
  if (row.operationArea?.trim() && !db.settings.operationAreas.includes(row.operationArea.trim())) {
    return { rowNumber, outcome: "error", error: `Unknown operation area "${row.operationArea}"` };
  }
  if (row.irregularityType?.trim() && !db.settings.irregularityTypes.includes(row.irregularityType.trim())) {
    return { rowNumber, outcome: "error", error: `Unknown type of irregularity "${row.irregularityType}"` };
  }

  const findingDate = (row.findingDate ?? "").trim();
  if (findingDate && Number.isNaN(new Date(findingDate).getTime())) {
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
    // Fall back to "" for any of these three left blank (admin-opted-out
    // via Settings.requiredFindingFields) - same as operationArea/
    // irregularityType/currency below, which can equally be blank now.
    sourceId: source?.id ?? "",
    departmentId: department?.id ?? "",
    categoryId: category?.id ?? "",
    findingDate,
    operationArea: (row.operationArea ?? "").trim(),
    irregularityType: (row.irregularityType ?? "").trim(),
    currency: (row.currency ?? "").trim(),
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
    // Same "" fallback pattern as operationArea/irregularityType/priority/
    // description below for every one of these that's now admin-
    // configurable and was left blank.
    title: (row.title ?? "").trim(),
    sourceId: source?.id ?? "",
    departmentId: department?.id ?? "",
    periodId: period.id,
    districtId: district.id,
    branchId: branch.id,
    findingDate,
    operationArea: (row.operationArea ?? "").trim(),
    irregularityType: (row.irregularityType ?? "").trim(),
    categoryId: category?.id ?? "",
    amount,
    currency: (row.currency ?? "").trim(),
    caseCount,
    riskLevel: (row.riskLevel ?? "").trim(),
    priority: (row.priority ?? "").trim(),
    description: (row.description ?? "").trim(),
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
