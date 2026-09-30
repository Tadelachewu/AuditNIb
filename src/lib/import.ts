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
  // Last, not beside Recommendation, so every existing column keeps its
  // position; columns are matched by header, so older templates without
  // it still import (as long as Root cause isn't set to required).
  { key: "rootCause", header: "Root Cause", required: false },
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
  rootCause: "rootCause",
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

/** Case-insensitive code lookup (district/branch/period/source/department/category codes). */
function findByCode<T extends { code: string }>(list: T[], code: string): T | undefined {
  const c = code.trim().toLowerCase();
  return list.find((x) => x.code.trim().toLowerCase() === c);
}

/** A real calendar date in strict YYYY-MM-DD form (rejects 2026-02-30, 15/09/2026, ...). */
function isCalendarDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * The server-local calendar date (YYYY-MM-DD) of a timestamp - the same
 * local-time basis a reporting period's own code/month is derived from
 * (see POST /api/admin/reporting-periods), so "ends 2026-09-30" matches
 * the period's real last day rather than its UTC instant.
 */
function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  opts: {
    userId: string;
    userName: string;
    importBatchId: string;
    // The importer's own org scope - mirrors POST /api/findings' identical
    // "BRANCH/DISTRICT roles are forced to their own org unit, BANK isn't"
    // check. findings.import is seeded onto the HO Controller role only
    // (BANK-scoped, by design meant to import for any district/branch -
    // icfms.txt: "Register Internal Audit findings received from the
    // Internal Audit Department"), but permissions are dynamic, admin-
    // editable data (see PHASE2.md) - nothing stops an admin from granting
    // findings.import to a DISTRICT- or BRANCH-scoped role too. Without
    // this check, that misconfiguration would let a District/Branch
    // Controller import a finding for any OTHER district/branch just by
    // putting a different code in the Excel file's District/Branch Code
    // columns - a horizontal privilege escalation the single-record create
    // path already closes off but the bulk path didn't.
    importerScope: { orgScope: string; districtId: string | null; branchId: string | null };
  }
): ImportBatchRow & { finding?: Finding } {
  // Every problem in the row is collected and reported together (not just
  // the first one), so a file can be fixed in one pass. Codes and list
  // values match regardless of letter case and are stored in the
  // configured spelling. Rules: docs/import.md and the in-app Import Guide.
  const errors: string[] = [];

  const missing = IMPORT_COLUMNS.filter((c) => columnRequired(db, c) && !row[c.key]?.trim());
  if (missing.length > 0) errors.push(`Missing required value(s): ${missing.map((c) => columnHeader(db, c)).join(", ")}`);

  const statusInput = (row.status ?? "").trim().toUpperCase();
  const status: ImportStatus | null = (ALLOWED_IMPORT_STATUSES as readonly string[]).includes(statusInput) ? (statusInput as ImportStatus) : null;
  if (statusInput && !status) errors.push(`Invalid status "${row.status}" - must be one of ${ALLOWED_IMPORT_STATUSES.join(", ")}`);

  // District / branch: must exist, be active, and belong together.
  const districtCode = row.districtCode?.trim();
  const districtAny = districtCode ? findByCode(db.districts, districtCode) : undefined;
  if (districtCode && !districtAny) errors.push(`Unknown district code "${districtCode}"`);
  if (districtAny && districtAny.status !== "ACTIVE") errors.push(`District "${districtAny.code}" is deactivated`);
  const district = districtAny?.status === "ACTIVE" ? districtAny : undefined;

  const branchCode = row.branchCode?.trim();
  const branchAny = branchCode ? findByCode(db.branches, branchCode) : undefined;
  if (branchCode && !branchAny) errors.push(`Unknown branch code "${branchCode}"`);
  if (branchAny && branchAny.status !== "ACTIVE") errors.push(`Branch "${branchAny.code}" is deactivated`);
  const branch = branchAny?.status === "ACTIVE" ? branchAny : undefined;

  if (district && branch && branch.districtId !== district.id) {
    errors.push(`Branch "${branch.code}" does not belong to district "${district.code}"`);
  }
  if (branch && opts.importerScope.orgScope === "BRANCH" && branch.id !== opts.importerScope.branchId) {
    errors.push(`Branch "${branch.code}" is outside your assigned branch`);
  }
  if (district && opts.importerScope.orgScope === "DISTRICT" && district.id !== opts.importerScope.districtId) {
    errors.push(`District "${district.code}" is outside your assigned district`);
  }

  // No "locked periods don't accept new writes" check - every import row
  // is a historical backfill (see ALLOWED_IMPORT_STATUSES' doc comment);
  // a period being long since locked is usually *why* it's backfilled now.
  const periodCode = row.periodCode?.trim();
  const period = periodCode ? findByCode(db.reportingPeriods, periodCode) : undefined;
  if (periodCode && !period) errors.push(`Unknown reporting period code "${periodCode}"`);

  // TRANSFERRED needs a second, *different*, open period - the one it moved
  // *into*. Reporting Period Code stays the finding's own original period
  // (used for its reference number, like a live transfer).
  let destinationPeriod: ReportingPeriod | undefined;
  if (status === "TRANSFERRED") {
    const toPeriodCode = row.transferredToPeriodCode?.trim();
    if (!toPeriodCode) {
      errors.push(`Status "TRANSFERRED" requires Transferred To Period Code`);
    } else {
      destinationPeriod = findByCode(db.reportingPeriods, toPeriodCode);
      if (!destinationPeriod) errors.push(`Unknown reporting period code "${toPeriodCode}" (Transferred To)`);
      else if (period && destinationPeriod.id === period.id) errors.push(`Transferred To Period Code must differ from Reporting Period Code`);
      else if (destinationPeriod.status !== "OPEN") errors.push(`Transferred To Period "${destinationPeriod.code}" must be open`);
      else if (period && destinationPeriod.startsAt <= period.startsAt) errors.push(`Transferred To Period "${destinationPeriod.code}" must be later than "${period.code}"`);
    }
  }

  // Source / department / category: only checked when given (a blank one
  // only gets this far when Settings.requiredFindingFields opts it out).
  const sourceCode = row.sourceCode?.trim();
  const sourceAny = sourceCode ? findByCode(db.sources, sourceCode) : undefined;
  if (sourceCode && !sourceAny) errors.push(`Unknown source code "${sourceCode}"`);
  if (sourceAny && !sourceAny.active) errors.push(`Source "${sourceAny.code}" is deactivated`);
  const source = sourceAny?.active ? sourceAny : undefined;

  const departmentCode = row.departmentCode?.trim();
  const departmentAny = departmentCode ? findByCode(db.departments, departmentCode) : undefined;
  if (departmentCode && !departmentAny) errors.push(`Unknown department code "${departmentCode}"`);
  if (departmentAny && !departmentAny.active) errors.push(`Department "${departmentAny.code}" is deactivated`);
  const department = departmentAny?.active ? departmentAny : undefined;
  if (department && district && branch && !isDepartmentInScope(department, { districtId: district.id, branchId: branch.id })) {
    errors.push(`Department "${department.code}" is not available for branch "${branch.code}"`);
  }

  const categoryCode = row.categoryCode?.trim();
  const categoryAny = categoryCode ? findByCode(db.categories, categoryCode) : undefined;
  if (categoryCode && !categoryAny) errors.push(`Unknown classified category code "${categoryCode}"`);
  if (categoryAny && !categoryAny.active) errors.push(`Classified category "${categoryAny.code}" is deactivated`);
  const category = categoryAny?.active ? categoryAny : undefined;

  // Settings lists - case-insensitive, stored in the configured spelling.
  const listValue = (list: string[], raw: string | undefined, label: string): string => {
    const v = (raw ?? "").trim();
    if (!v) return "";
    const match = list.find((x) => x.trim().toLowerCase() === v.toLowerCase());
    if (!match) errors.push(`Unknown ${label} "${v}" - must be one of: ${list.join(", ")}`);
    return match ?? v;
  };
  const currency = listValue(db.settings.currencies, row.currency, "currency");
  const riskLevel = listValue(db.settings.riskLevels, row.riskLevel, "risk level");
  const priority = listValue(db.settings.priorityLevels, row.priority, "priority");
  const operationArea = listValue(db.settings.operationAreas, row.operationArea, "operation area");
  const irregularityType = listValue(db.settings.irregularityTypes, row.irregularityType, "type of irregularity");

  // Finding date: a real YYYY-MM-DD calendar date, not in the future, and
  // never after its reporting period ends (inside the period or earlier).
  const findingDate = (row.findingDate ?? "").trim();
  if (findingDate) {
    if (!isCalendarDate(findingDate)) {
      errors.push(`Invalid finding date "${findingDate}" - use YYYY-MM-DD (e.g. 2026-09-15)`);
    } else {
      if (findingDate > localDate(new Date().toISOString())) errors.push(`Finding date ${findingDate} is in the future`);
      if (period) {
        const periodEnd = localDate(period.endsAt);
        if (findingDate > periodEnd) {
          errors.push(`Finding date ${findingDate} is after reporting period ${period.code} (ends ${periodEnd}) - it must be within the period or before it`);
        }
      }
    }
  }

  const amountRaw = (row.amount ?? "").trim();
  const amount = Number(amountRaw.replace(/,/g, ""));
  const amountOk = amountRaw !== "" && Number.isFinite(amount) && amount >= 0;
  if (amountRaw && !amountOk) errors.push(`Invalid amount "${amountRaw}" - must be a number, 0 or more`);
  const caseCountRaw = (row.caseCount ?? "").trim();
  const caseCount = Number(caseCountRaw);
  const caseCountOk = caseCountRaw !== "" && Number.isInteger(caseCount) && caseCount >= 1;
  if (caseCountRaw && !caseCountOk) errors.push(`Invalid number of cases "${caseCountRaw}" - must be a whole number of at least 1`);

  // Historical-status amounts: CLOSED implies full resolution. TRANSFERRED's
  // Rectified Cases/Amount are optional (progress made before the
  // transfer) and bound-checked like a live rectification, including "no
  // orphaned balance"; zero/zero is valid, the full finding isn't (nothing
  // would be left to transfer). A historical import is treated as already
  // verified and closed for whatever it declares rectified.
  let rectifiedCases = 0;
  let rectifiedAmount = 0;
  if (status === "TRANSFERRED" && amountOk && caseCountOk) {
    const rectifiedCasesRaw = row.rectifiedCases?.trim();
    const rectifiedAmountRaw = row.rectifiedAmount?.trim();
    rectifiedCases = rectifiedCasesRaw ? Number(rectifiedCasesRaw) : 0;
    rectifiedAmount = rectifiedAmountRaw ? Number(rectifiedAmountRaw.replace(/,/g, "")) : 0;
    const casesOk = Number.isInteger(rectifiedCases) && rectifiedCases >= 0 && rectifiedCases <= caseCount;
    const amountInRange = Number.isFinite(rectifiedAmount) && rectifiedAmount >= 0 && rectifiedAmount <= amount;
    if (!casesOk) errors.push(`Invalid rectified cases "${row.rectifiedCases}" - must be a whole number from 0 to ${caseCount}`);
    if (!amountInRange) errors.push(`Invalid rectified amount "${row.rectifiedAmount}" - must be from 0 to ${amount}`);
    if (casesOk && amountInRange) {
      if (rectifiedCases === caseCount && rectifiedAmount === amount) {
        errors.push(`Rectified cases and amount can't equal the full finding (${caseCount} / ${amount}) - nothing would be outstanding to transfer; use CLOSED instead`);
      } else if (rectifiedCases === caseCount) {
        errors.push(`Rectified cases equals the full case count (${caseCount}) - rectified amount must equal the full amount (${amount}) too`);
      } else if (rectifiedAmount === amount) {
        errors.push(`Rectified amount equals the full amount (${amount}) - rectified cases must equal the full case count (${caseCount}) too`);
      }
    }
  } else if (status === "CLOSED") {
    rectifiedCases = caseCount;
    rectifiedAmount = amount;
  }

  if (errors.length > 0 || !status || !district || !branch || !period) {
    if (errors.length === 0) errors.push("Row could not be validated");
    return { rowNumber, outcome: "error", error: errors.join(" · "), errors };
  }

  // Duplicate check - the import's own exact-match key (see dedupeKey()),
  // not the Register Finding form's admin-configured similar-finding hint.
  // TRANSFERRED dedupes by its *current* period (the destination), which is
  // what an already-imported TRANSFERRED finding's own periodId now is.
  const key = dedupeKey({
    branchId: branch.id,
    periodId: status === "TRANSFERRED" ? destinationPeriod!.id : period.id,
    sourceId: source?.id ?? "",
    departmentId: department?.id ?? "",
    categoryId: category?.id ?? "",
    findingDate,
    operationArea,
    irregularityType,
    currency,
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
    operationArea,
    irregularityType,
    categoryId: category?.id ?? "",
    amount,
    currency,
    caseCount,
    riskLevel,
    priority,
    description: (row.description ?? "").trim(),
    recommendation: row.recommendation?.trim() || undefined,
    rootCause: row.rootCause?.trim() || undefined,
    evidenceNote: row.evidenceNote?.trim() || undefined,
    externalReference: row.externalReference?.trim() || undefined,
    importBatchId: opts.importBatchId,
    status: "DRAFT",
    // A historical import always targets a real district/branch through
    // the normal chain (there's no bank-scope import path) - set for real
    // by submitFinding() if/when this ever gets submitted through the live
    // workflow rather than imported pre-transitioned.
    registeredByBankScope: false,
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
