import ExcelJS from "exceljs";
import { v4 as uuid } from "uuid";
import { appendAuditLog } from "@/lib/audit";
import { nextFindingReference, transitionFinding, transferFinding } from "@/lib/findings";
import { isDepartmentInScope } from "@/lib/org";
import type { Database, Finding, ImportBatchRow, ReportingPeriod, RequirableFindingField } from "@/types";

// Import exists purely to backfill a bank's already-resolved paper/Excel
// records, never to register a genuinely new finding - there's no "DRAFT,
// goes through the live district/HO review workflow" option, deliberately.
// Each of these three fast-forwards the finding straight to that resting
// state via the same transition machinery a live action would use (see
// fastForwardHistoricalImport() below), not a bare status assignment, so
// the finding's own history/audit trail stays honest about what happened
// and when - just stamped "Historical import" as the actor's reason
// instead of a live human's decision. TRANSFERRED is the one that also
// needs a destination period (see the Transferred To Period Code column
// below) - a transferred finding's own reporting period is wherever it
// moved *from*, not where it currently sits. See ALLOWED_IMPORT_STATUSES'
// own validation in validateImportRow() for what each one requires.
const ALLOWED_IMPORT_STATUSES = ["SENT_TO_BRANCH_MANAGER", "TRANSFERRED", "CLOSED"] as const;
type ImportStatus = (typeof ALLOWED_IMPORT_STATUSES)[number];

const SHEET_NAME = "Findings";
const REFERENCE_SHEET_NAME = "Reference Data";

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
// A generous ceiling, not an expected volume - guards against a single
// request trying to create an unreasonable number of findings in one
// updateDb() transaction.
export const MAX_IMPORT_ROWS = 2000;

// The first eighteen columns (through evidenceNote) are ordered to match
// the registration form (NewFindingForm.tsx / the createSchema in
// src/app/api/findings/route.ts) field-for-field - the dedupe key below
// is defined over the same fields for the same reason (master.txt §22:
// "other fields should be the same as the finding registration form
// fields"). Reference is never a column - always system-generated, same
// as a manually-registered finding. Status/rectifiedCases/rectifiedAmount
// have no analog on that live form at all (a brand-new finding is always
// DRAFT) - they exist only here, to let a row declare it's actually
// backfilling an already-resolved historical record instead of
// registering a new one - see ALLOWED_IMPORT_STATUSES' own doc comment.
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
  {
    key: "status",
    header: "Status (SENT_TO_BRANCH_MANAGER / TRANSFERRED / CLOSED)",
    required: true,
  },
  {
    key: "rectifiedCases",
    header: "Rectified Cases (optional - only for a TRANSFERRED row with some progress already made)",
    required: false,
  },
  {
    key: "rectifiedAmount",
    header: "Rectified Amount (optional - only for a TRANSFERRED row with some progress already made)",
    required: false,
  },
  {
    key: "transferredToPeriodCode",
    header: "Transferred To Period Code (required only if Status is TRANSFERRED)",
    required: false,
  },
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
  refSection(
    "Status values",
    [
      ["SENT_TO_BRANCH_MANAGER", "Historical - already approved, nothing rectified yet."],
      [
        "TRANSFERRED",
        "Historical - moved to a later still-open period with an outstanding balance. Requires Transferred To Period Code; Rectified Cases/Amount are optional (how much was rectified before the transfer, if any).",
      ],
      ["CLOSED", "Historical - fully resolved."],
    ]
  );
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
 * not a duplicate, creates the Finding. Every row is a historical backfill
 * (see ALLOWED_IMPORT_STATUSES' own doc comment) - see
 * fastForwardHistoricalImport() for how it's fast-forwarded to its
 * declared resting state through the same transition machinery a live
 * action uses, not a bare status assignment.
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
  opts: { userId: string; userName: string; importBatchId: string }
): ImportBatchRow & { finding?: Finding } {
  const missing = IMPORT_COLUMNS.filter((c) => columnRequired(db, c) && !row[c.key]?.trim());
  if (missing.length > 0) {
    return { rowNumber, outcome: "error", error: `Missing required value(s): ${missing.map((c) => columnHeader(db, c)).join(", ")}` };
  }

  const statusInput = (row.status ?? "").trim().toUpperCase();
  if (!(ALLOWED_IMPORT_STATUSES as readonly string[]).includes(statusInput)) {
    return {
      rowNumber,
      outcome: "error",
      error: `Invalid status "${row.status}" - must be one of ${ALLOWED_IMPORT_STATUSES.join(", ")}`,
    };
  }
  const status = statusInput as ImportStatus;

  const district = db.districts.find((d) => d.code === row.districtCode?.trim() && d.status === "ACTIVE");
  if (!district) return { rowNumber, outcome: "error", error: `Unknown or inactive district code "${row.districtCode}"` };

  const branch = db.branches.find((b) => b.code === row.branchCode?.trim() && b.status === "ACTIVE");
  if (!branch) return { rowNumber, outcome: "error", error: `Unknown or inactive branch code "${row.branchCode}"` };
  if (branch.districtId !== district.id) {
    return { rowNumber, outcome: "error", error: `Branch "${row.branchCode}" does not belong to district "${row.districtCode}"` };
  }

  const period = db.reportingPeriods.find((p) => p.code === row.periodCode?.trim());
  if (!period) return { rowNumber, outcome: "error", error: `Unknown reporting period code "${row.periodCode}"` };
  // No "locked periods don't accept new writes" check here at all - every
  // import row is a historical backfill (see ALLOWED_IMPORT_STATUSES' own
  // doc comment), so this is never a new write against a live period in
  // the sense assertPeriodWritable() guards against elsewhere; a period
  // being long since locked is usually *why* it's being backfilled now.

  // TRANSFERRED needs a second, *different* period - the one it moved
  // *into*. Reporting Period Code above stays the finding's own original
  // period (used for its reference number, exactly like a real transfer
  // never changes reference - see transferFinding()'s own doc comment).
  let destinationPeriod: ReportingPeriod | undefined;
  if (status === "TRANSFERRED") {
    const toPeriodCode = row.transferredToPeriodCode?.trim();
    if (!toPeriodCode) {
      return { rowNumber, outcome: "error", error: `Status "TRANSFERRED" requires Transferred To Period Code` };
    }
    destinationPeriod = db.reportingPeriods.find((p) => p.code === toPeriodCode);
    if (!destinationPeriod) {
      return { rowNumber, outcome: "error", error: `Unknown reporting period code "${row.transferredToPeriodCode}"` };
    }
    if (destinationPeriod.id === period.id) {
      return { rowNumber, outcome: "error", error: `Transferred To Period Code must differ from Reporting Period Code` };
    }
    // Same "destination must be open" rule the live manual-transfer route
    // enforces (transferFinding() itself doesn't) - a TRANSFERRED finding
    // always rests in a period still open for further action.
    if (destinationPeriod.status !== "OPEN") {
      return { rowNumber, outcome: "error", error: `Transferred To Period "${destinationPeriod.code}" must be open` };
    }
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

  // Historical-status amounts: CLOSED implies full resolution (no partial-
  // accounting columns needed for the common "yes, this was fully dealt
  // with" case). TRANSFERRED's Rectified Cases/Amount are optional - how
  // much was rectified *before* the transfer, if any - and when given are
  // bound-checked the same way the live rectify route validates a real
  // rectification entry (src/app/api/findings/[id]/rectify/route.ts),
  // including its "can't leave an orphaned balance" rule, since a non-
  // itemized finding has no per-case amount to attach a leftover to; but
  // unlike a live PARTIALLY_RECTIFIED submission, zero/zero is valid here -
  // a finding can transfer having had no progress at all - while equaling
  // the full case count/amount is invalid, since that would leave nothing
  // outstanding to transfer. District verification isn't a separate
  // column - a historical import is treated as already verified (whoever's
  // importing it is attesting to its recorded state), same amount as
  // rectified.
  let rectifiedCases = 0;
  let rectifiedAmount = 0;
  if (status === "TRANSFERRED") {
    const rectifiedCasesRaw = row.rectifiedCases?.trim();
    const rectifiedAmountRaw = row.rectifiedAmount?.trim();
    rectifiedCases = rectifiedCasesRaw ? Number(rectifiedCasesRaw) : 0;
    rectifiedAmount = rectifiedAmountRaw ? Number(rectifiedAmountRaw) : 0;
    if (!Number.isInteger(rectifiedCases) || rectifiedCases < 0 || rectifiedCases > caseCount) {
      return {
        rowNumber,
        outcome: "error",
        error: `Invalid rectified cases "${row.rectifiedCases}" - must be a whole number from 0 to ${caseCount}`,
      };
    }
    if (!Number.isFinite(rectifiedAmount) || rectifiedAmount < 0 || rectifiedAmount > amount) {
      return {
        rowNumber,
        outcome: "error",
        error: `Invalid rectified amount "${row.rectifiedAmount}" - must be from 0 to ${amount}`,
      };
    }
    if (rectifiedCases === caseCount && rectifiedAmount === amount) {
      return {
        rowNumber,
        outcome: "error",
        error: `Rectified cases and amount can't equal the full finding (${caseCount} / ${amount}) - nothing would be outstanding to transfer; use CLOSED instead`,
      };
    }
    if (rectifiedCases === caseCount && rectifiedAmount !== amount) {
      return {
        rowNumber,
        outcome: "error",
        error: `Rectified cases equals the full case count (${caseCount}) - rectified amount must equal the full amount (${amount}) too`,
      };
    }
    if (rectifiedAmount === amount && rectifiedCases !== caseCount) {
      return {
        rowNumber,
        outcome: "error",
        error: `Rectified amount equals the full amount (${amount}) - rectified cases must equal the full case count (${caseCount}) too`,
      };
    }
  } else if (status === "CLOSED") {
    rectifiedCases = caseCount;
    rectifiedAmount = amount;
  }

  // TRANSFERRED dedupes (and, on a live finding, is found) by its *current*
  // period - the destination it moved into, not the origin used for its
  // reference above - matching what existingDedupeKeys() reads off an
  // already-transferred live finding's own (destination) periodId. Getting
  // this backwards would mean re-uploading the same file never recognizes
  // its own previously-imported TRANSFERRED rows as duplicates.
  const key = dedupeKey({
    branchId: branch.id,
    periodId: status === "TRANSFERRED" ? destinationPeriod!.id : period.id,
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
  // caseAgeDays() (src/lib/findings.ts) measures age from createdAt, per
  // master.txt §8's "track case age from original finding date" - for a
  // live registration createdAt and Finding Date are always close (the
  // form is filled in near-realtime), but a historical import's whole
  // point is backfilling a record whose real finding date can be months
  // or years before the import run. Stamping createdAt with the import
  // moment would make a genuinely old backlog item read as 0 days old on
  // every case-age/backlog-age dashboard metric - so createdAt is backdated
  // to the row's own Finding Date when one was given (parsed as that
  // calendar day's midnight UTC, same as any other date-only value in this
  // app), falling back to the import moment only when Finding Date was left
  // blank (itself only possible when Settings.requiredFindingFields has
  // opted it out) and there's nothing to backdate to.
  const createdAt = findingDate ? new Date(findingDate).toISOString() : now;
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
    createdAt,
    updatedAt: now,
  };

  seenKeys.set(key, finding.reference);
  db.findings.push(finding);

  fastForwardHistoricalImport(
    db,
    finding,
    status,
    {
      rectifiedCases,
      rectifiedAmount,
      // "Verified" mirrors "rectified" for a historical import - see
      // this function's own doc comment for why there's no separate
      // verification column. Closed likewise mirrors rectified now (see
      // fastForwardHistoricalImport()'s own doc comment on that) - CLOSED
      // rows always have rectifiedCases/Amount forced to the full
      // caseCount/amount just above, so this already covers that case too.
      districtVerifiedCases: rectifiedCases,
      districtVerifiedAmount: rectifiedAmount,
      toPeriodId: destinationPeriod?.id,
    },
    { userId: opts.userId, userName: opts.userName }
  );

  return { rowNumber, outcome: "imported", findingId: finding.id, reference: finding.reference, finding };
}

/**
 * Fast-forwards a freshly-created DRAFT finding straight to `target`
 * through the same transition machinery a live action would use
 * (transitionFinding()/transferFinding(), plus the actual
 * RectificationEntry/FindingClosure ledger rows scoring reads -
 * src/lib/findings.ts's closedInPeriod() sums FindingClosure rows, not a
 * bare cumulative field, so a "closed" import with no such row would
 * silently score as 0 rectified/closed despite its own status) - never a
 * bare status/counter assignment, so the finding's FindingTransition
 * history and audit log stay exactly as complete and honest as a live-
 * approved, live-rectified, live-closed, live-transferred finding's would.
 * Every hop is stamped with a distinct "IMPORT_*" action and the same
 * "Historical import" reason, specifically so anyone reading the trail
 * later can tell at a glance this was backfilled, not a live decision -
 * a bulk import silently posing as a normal reviewed/approved finding
 * would defeat the whole point of the review trail everywhere else in
 * this app relies on.
 *
 * Skips DISTRICT_REVIEW/HO_REVIEW/PENDING_BANK_APPROVAL entirely and goes
 * straight to SENT_TO_BRANCH_MANAGER - the same "no natural district to
 * review it" reasoning submitFinding()'s registeredByBankScope branch
 * already applies to a live HO-registered finding (import is HO/Admin-only
 * - see findings.import's default role grants), extended here to also
 * bypass Settings.hoApproval.required: there's no live approver to wait on
 * for a fact that's already resolved.
 */
function fastForwardHistoricalImport(
  db: Database,
  finding: Finding,
  target: ImportStatus,
  amounts: {
    rectifiedCases: number;
    rectifiedAmount: number;
    districtVerifiedCases: number;
    districtVerifiedAmount: number;
    // Only set (and only used) when target === "TRANSFERRED".
    toPeriodId?: string;
  },
  opts: { userId: string; userName: string }
): void {
  const reason = "Historical import - backfilled from an already-resolved external record, not reviewed live.";
  const { userId, userName } = opts;

  transitionFinding(db, finding, { toStatus: "SUBMITTED", action: "IMPORT_SUBMIT", userId, userName, reason });
  transitionFinding(db, finding, { toStatus: "SENT_TO_BRANCH_MANAGER", action: "IMPORT_APPROVE", userId, userName, reason });
  if (target === "SENT_TO_BRANCH_MANAGER") return;

  // CLOSED always has rectifiedCases/Amount set to the full caseCount/
  // amount by validateImportRow(), so this is always true for CLOSED;
  // for TRANSFERRED it only fires when the row declared real progress
  // made before the transfer - a zero/zero TRANSFERRED row skips straight
  // from SENT_TO_BRANCH_MANAGER to the transfer below, same as a live
  // finding transferred before any rectification ever happened.
  const hasRectifiedProgress = amounts.rectifiedCases > 0 || amounts.rectifiedAmount > 0;
  if (hasRectifiedProgress) {
    finding.rectifiedCases = amounts.rectifiedCases;
    finding.rectifiedAmount = amounts.rectifiedAmount;
    db.rectifications.push({
      id: uuid(),
      findingId: finding.id,
      periodId: finding.periodId,
      rectifiedCases: amounts.rectifiedCases,
      rectifiedAmount: amounts.rectifiedAmount,
      note: reason,
      submittedBy: userId,
      submittedByName: userName,
      createdAt: finding.updatedAt,
    });
    transitionFinding(db, finding, {
      toStatus: target === "CLOSED" ? "RECTIFIED" : "PARTIALLY_RECTIFIED",
      action: "IMPORT_RECTIFY",
      userId,
      userName,
      reason,
    });
    finding.districtVerifiedCases = amounts.districtVerifiedCases;
    finding.districtVerifiedAmount = amounts.districtVerifiedAmount;

    // Whatever's rectified in a historical import is treated as already
    // closed too, not merely district-verified and sitting in a live
    // Controller's Verify & Close queue - a backfilled record is
    // attesting to a fact that was already fully resolved and signed off
    // in whatever process predates this system, not a new pending
    // District/HO review. This is exactly what a live PARTIAL_CLOSE does
    // (close/route.ts) when the closed portion doesn't yet cover the
    // finding's full caseCount/amount: closedCases/Amount move, but
    // finding.status is untouched (it keeps tracking rectify/transfer
    // progress) - transitionFinding() is only called here for the one
    // case that's genuinely fully closed (target === "CLOSED", where
    // rectifiedCases/Amount already equals the full caseCount/amount by
    // construction above).
    finding.closedCases = amounts.rectifiedCases;
    finding.closedAmount = amounts.rectifiedAmount;
    db.findingClosures.push({
      id: uuid(),
      findingId: finding.id,
      periodId: finding.periodId,
      closedCases: amounts.rectifiedCases,
      closedAmount: amounts.rectifiedAmount,
      submittedBy: userId,
      submittedByName: userName,
      createdAt: finding.updatedAt,
    });
    if (target === "CLOSED") {
      transitionFinding(db, finding, { toStatus: "CLOSED", action: "IMPORT_CLOSE", userId, userName, reason });
    } else {
      appendAuditLog(db, {
        userId,
        userName,
        action: "IMPORT_PARTIAL_CLOSE",
        entityType: "Finding",
        entityId: finding.id,
        newValue: { closedCases: finding.closedCases, closedAmount: finding.closedAmount },
        reason,
      });
    }
  }

  if (target === "TRANSFERRED") {
    // The real transfer mechanism - snapshots the FindingTransfer ledger
    // row and moves finding.periodId to the destination, exactly like a
    // live manual transfer (see transferFinding()'s own doc comment).
    // "IMPORT_TRANSFER" (not the live "TRANSFER") keeps this hop
    // identifiable as historical the same way every other hop here is.
    transferFinding(db, finding, {
      toPeriodId: amounts.toPeriodId!,
      reason,
      userId,
      userName,
      method: "MANUAL",
      action: "IMPORT_TRANSFER",
    });
  }
}
