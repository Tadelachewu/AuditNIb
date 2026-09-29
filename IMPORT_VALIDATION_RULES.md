# Import ETL — Column & Row Validation Rules

Covers every field accepted by the Excel bulk-importer used at
**Findings → Import Historical Data**.

Scope:
1.  **Workbook-level rules** (sheet names, column-order invariance,
    max sizes, header matching).
2.  **Per-column validation** — each of the 22 columns: allowed values,
    required/optional behavior, blank handling, enum membership,
    reference-data lookups, importer-scope checks, and exactly which
    error text is returned on failure.
3.  **Per-row cross-field invariants** — amount vs caseCount bounds,
    TRANSFERRED/CLOSED status requirements, dedupe key semantics.
4.  **Batch-level rules** — transactionality, ordering effects, how
    `nextFindingReference()` and the duplicate checker see in-flight
    rows.

All rules are traced to their implementing lines in
[src/lib/import.ts](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts).

---

## 0. Intent of the importer

**Import exists for historical backfill only — it never creates a DRAFT
that then goes through the live workflow.**

Every row is fast-forwarded to its declared resting status
(`SENT_TO_BRANCH_MANAGER`, `TRANSFERRED`, or `CLOSED`) through the same
`transitionFinding()` / `transferFinding()` machinery a live action
would use — `fastForwardHistoricalImport()` — so the resulting audit
trail / transition snapshots are authentic, not a bare status stamp.
`"Historical import"` is stamped as the reason on every synthetic
transition.

DRAFT is **not** an allowed import status on purpose: if a row genuinely
needs the live workflow (HO/District review, rectification by the
branch), it should be registered through the UI form one-by-one so the
correct actors see notifications.

Allowed statuses constant: [import.ts#L21-L22](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L21-L22)

---

## 1. Workbook-level rules

### 1a. File size / row count ceilings

| Limit | Value | Where enforced |
|-------|-------|----------------|
| Max bytes | **10 MiB** (`MAX_IMPORT_BYTES = 10 * 1024 * 1024`) | Route handler before ExcelJS load. Exceeded → 413. |
| Max rows | **2000** (`MAX_IMPORT_ROWS = 2000`) | After parse, before `validateImportRow` loop. Exceeded → 400 *"Too many rows (…). Maximum 2000 rows per import."* |

See [import.ts#L27-L31](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L27-L31). These are generous ceilings — the intent is to prevent a single `updateDb()` transaction from being larger than the DB writer can commit without stalling other concurrent writers.

### 1b. Sheet name

- The importer looks for a sheet named **`Findings`** (exact match, case
  sensitive? — ExcelJS uses workbook.getWorksheet, which is exact name
  match).
- If not found, it silently falls back to `workbook.worksheets[0]` (the
  first sheet), so a user who forgot to rename the sheet still works.
- If the workbook has **no sheets** at all → parse error.

Code: [import.ts#L239-L240](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L239-L240).

### 1c. Column matching (order DOES NOT matter — header text does)

The importer reads row 1 as headers and matches them against the
expected header list using **`normalizeHeaderText`**. The matching
algorithm is:

```
for each header cell:
  text = cellText.trim().toLowerCase().replace(/\s*\(optional\)\s*$/i, "")
  compare to IMPORT_COLUMNS[*].header passed through the same normalize()
```

Key effects:
- Whitespace on headers is trimmed.
- Case doesn't matter.
- **The trailing `(optional)` suffix on a configurable column is stripped
  before comparison** — so a template downloaded when `title` was
  required, then re-uploaded after an admin toggled title to optional,
  still matches (the column header the user actually sees in Excel is
  different, we normalize it).

If the parse finds 0 recognizable columns → error:
*"No recognized columns found — use the downloaded template's header row unchanged."*

Code: normalize at [import.ts#L138-L140](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L138-L140); matching at [import.ts#L242-L253](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L242-L253).

### 1d. Empty rows

For each row from **2** onward: the row is iterated with
`includeEmpty: true`. If after `trim()` every cell is empty, the row is
skipped entirely — not counted as an error, not counted against the
2000-row ceiling.

Code: [import.ts#L260-L273](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L260-L273).

### 1e. Cell coercion (`cellText`)

How Excel cells become strings before any validation:

| Excel cell value | Resulting import string |
|------------------|--------------------------|
| `null` / `undefined` | `""` |
| `Date` instance (formatted date) | ISO date slice `YYYY-MM-DD` via `toISOString().slice(0, 10)`. No timezone shifts — use the date *as the user typed it into Excel*. |
| Object with a `text` property (rich text) | `String(text)` |
| Object with a `result` property (formula) | `String(result)` — the cached computed result of the formula, not the formula text. |
| Anything else (strings, numbers, booleans) | `String(value).trim()` — numbers come through as `"12345.67"`, which `Number()` parses correctly on the numeric rows. |

Code: [import.ts#L143-L149](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L143-L149).

---

## 2. Column list & per-column validation

22 columns total. Order in the template matches the registration form for
the first 18, then 4 import-specific columns (status, rectified count,
rectified amount, transferred-to-period code, external reference).

Per-column schema: [import.ts#L44-L84](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L44-L84).
Configurable-required-flag mapping: [import.ts#L103-L117](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L103-L117).

The required/optional behavior for *configurable* columns is **NOT a
static per-column flag**: it is looked up live against
`Settings.requiredFindingFields` at parse+validate time:

```ts
columnRequired(db, column) =
  if column is in IMPORT_COLUMN_REQUIRABLE_KEY →
    db.settings.requiredFindingFields[requirableKey]   // admin toggle
  else → column.required (static)
```

Static-required columns never consult the toggle: districtCode,
branchCode, periodCode, amount, caseCount, status, (and also
transferredToPeriodCode which is conditional on status).
`externalReference` is always optional regardless of any toggle.

---

### I1. `District Code` (districtCode)

| | |
|---|---|
| Static required? | **Yes.** |
| Type | String. Case-insensitive match against `District.code`. |
| Blank handling | Trimmed. Blank → *"Missing required value(s): District Code"*. |
| Lookup rule | Must match an `ACTIVE` district with code exactly (`d.code === row.districtCode.trim()`). Missing or INACTIVE → `Unknown or inactive district code "…"`. [[import.ts#L393-L394](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L393-L394)] |
| Importer scope rule | If importer's role is BRANCH → `district.id must == importer districtId`. → Else `Outside your assigned district`. [[import.ts#L405-L407](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L405-L407)] |
| Why needed | Org hierarchy check + scope check for the row's branch. Districts are the primary reporting slice; an import row without a district can't be scoped into any dashboard correctly. |

---

### I2. `Branch Code` (branchCode)

| | |
|---|---|
| Static required? | **Yes.** |
| Type | String. Case-insensitive match against `Branch.code`. |
| Lookup rule | Must match an ACTIVE branch by code. Missing/INACTIVE → `Unknown or inactive branch code "…"`. |
| Cross-field invariant | `branch.districtId === district.id` (the district resolved in I1). Mismatch → `Branch "…" does not belong to district "…"`. [[import.ts#L396-L400](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L396-L400)] |
| Importer scope rule | If importer orgScope == BRANCH → branch.id must equal session.branchId → `Branch "…" is outside your assigned branch`. [[import.ts#L402-L404](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L402-L404)] |
| Why needed | Combined with district, this resolves the finding's `(branchId, districtId)` — part of the dedupe key and part of `reference` generation. |

---

### I3. `Reporting Period Code` (periodCode)

| | |
|---|---|
| Static required? | **Yes.** |
| Type | String (example `"2026-09"`). Case-sensitive match against `ReportingPeriod.code`. |
| Lookup rule | Must match *any* reporting period (status doesn't matter — OPEN or LOCKED both work). Missing → `Unknown reporting period code "…"`. [[import.ts#L409-L410](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L409-L410)] |
| **NO locked-period check!** (important) | Deliberate: every import row is a **historical backfill**. Locking a period (2 years ago) should NOT block importing its archive now — that's literally the #1 reason importer exists. [[import.ts#L411-L415](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L411-L415)] |
| Why needed | Resolves `period.id` for the finding's reference, its dashboards, and (for TRANSFERRED rows) the origin period used in `transferFinding()`. |

---

### I4. `Source Code` (sourceCode) — requirable

| | |
|---|---|
| Static required? | No. Admin toggle via `requiredFindingFields.sourceId`. |
| Blank allowed? | Yes — but ONLY when admin has toggled source as not-required. Otherwise blank → missing-required error. |
| Lookup rule (if non-blank) | Must match an **ACTIVE** `Source.code`. Missing/inactive → `Unknown or inactive source code "…"`. [[import.ts#L447-L449](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L447-L449)] |
| Why needed | Populates `finding.sourceId` (Internal Control / Internal Audit). |

---

### I5. `Department Code` (departmentCode) — requirable

| | |
|---|---|
| Required | Admin toggle. |
| Lookup rule (if non-blank) | Must match ACTIVE `Department.code`. Else `Unknown or inactive department code "…"`. |
| Scope rule (if found) | Must satisfy `isDepartmentInScope(department, { districtId, branchId })` — i.e. a BANK-scope dept is allowed everywhere; DISTRICT dept only at that district; BRANCH dept only at that branch. Violation → `Department "…" is not available for branch "…"`. [[import.ts#L451-L456](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L451-L456)] |
| Why | Populates `finding.departmentId`. Same org-scope rule as the live form. |

---

### I6. `Classified Category Code` (categoryCode) — requirable

| | |
|---|---|
| Required | Admin toggle. |
| Lookup rule (if non-blank) | Must match ACTIVE `ClassifiedCategory.code`. Else → `Unknown or inactive classified category code "…"`. [[import.ts#L458-L460](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L458-L460)] |
| Note vs categoryId on live form | Unlike the live form, the import column is **always a real category code**, not a free-text "Other." A free-text category must first be formalized as a real ClassifiedCategory row in Admin → Categories before it can be referenced in import. No "Other (typed in)" path exists for the bulk importer. |

---

### I7. `Title` — requirable

| | |
|---|---|
| Required | Admin toggle. |
| Format | Plain text. Trimmed. No length limit (unlike a form text input). Stored as whatever the user typed. |
| Why | Short human-readable label for the finding on list/dashboard cards. |

---

### I8. `Finding Date (YYYY-MM-DD)` (findingDate) — requirable

| | |
|---|---|
| Required | Admin toggle. |
| Format | Must parse as a valid date via `new Date(…).getTime()`. The usual ISO formats work. Invalid → `Invalid finding date "…" — use YYYY-MM-DD`. [[import.ts#L481-L484](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L481-L484)] |
| Implicit side effect | If a date was given, `finding.createdAt` is **backdated** to midnight UTC of that date (instead of the import-run timestamp). This is critical for case-age dashboards: a 2023 finding backfilled today *must not* appear to be 0 days old. Fallback to import-time only when date is blank (which itself only happens when admin has unticked required-finding-fields.findingDate). [[import.ts#L598-L599](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L598-L599)] |
| Why | BRD §case-age — case age tracks from this date, not from createdAt. |

---

### I9. `Operation Area` — requirable

| | |
|---|---|
| Required | Admin toggle. |
| Allowed (if non-blank) | Must be a member of `Settings.operationAreas[]` (the admin-configured list). Not in list → `Unknown operation area "…"`. [[import.ts#L474-L476](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L474-L476)] |
| Why needed | Admin wants to slice reports by business function — Teller Counter, Vault, ATM Ops, etc. Imported rows must tag against the exact same list as live registrations for aggregation to work. |

---

### I10. `Type of Irregularity` — requirable

Same rule pattern as I9, against `Settings.irregularityTypes[]`. Error:
`Unknown type of irregularity "…"`. [[import.ts#L477-L479](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L477-L479)]

---

### I11. `Amount` (amount)

| | |
|---|---|
| Static required? | **Yes.** Always required. |
| Parsing | `Number(row.amount)` — accepts Excel number cells (they come through as strings of digits, or rich-text's `result`). |
| Allowed | Finite number, `>= 0`. Otherwise → `Invalid amount "…"`. [[import.ts#L486-L489](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L486-L489)] |
| 0 allowed? | `amount: 0` passes validation — same rule as live form (purely procedural / zero-financial exposure findings allowed). |
| Why | Primary financial-input column; used for every ETB-denominated metric. |

---

### I12. `Currency` — requirable

| | |
|---|---|
| Required | Admin toggle. |
| Allowed (if non-blank) | Exact string member of `Settings.currencies[]` (case-sensitive). Otherwise → `Unknown currency "…"`. [[import.ts#L465-L467](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L465-L467)] |
| Why needed | Imported historical archives may have mixed currencies across rows (rare but allowed). |

---

### I13. `Number of Cases` (caseCount)

| | |
|---|---|
| Static required? | **Yes.** |
| Parsing | `Number(row.caseCount)`. |
| Allowed | Integer, `>= 1`. Float `2.5` or non-number fails. Negative or zero fails. → `Invalid number of cases "…" — must be a whole number of at least 1`. [[import.ts#L490-L493](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L490-L493)] |
| Max hard cap? | No import-level cap beyond what the 2000-row ceiling and your Excel file practically enforces. The live form only has an itemization cap (caseAmounts.max(500)). |
| Why | Populates `finding.caseCount` — used in every count-style metric. |

---

### I14. `Risk Level` — requirable

Allowed (if non-blank): member of `Settings.riskLevels[]`. Error:
`Unknown risk level "…"`. [[import.ts#L468-L470](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L468-L470)]

---

### I15. `Priority` — requirable

Allowed: member of `Settings.priorityLevels[]`. Error:
`Unknown priority "…"`. [[import.ts#L471-L473](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L471-L473)]

---

### I16. `Description` — requirable

Plain text, trimmed. Required per admin toggle. No length cap. Primary
narrative for the irregularity.

---

### I17. `Recommendation` — requirable (optional by default)

Plain text, trimmed. **Nullable**: if blank → stored as `undefined`
(null on the row). Required per admin toggle.

---

### I18. `Evidence Note` — requirable

Same format as recommendation. Blank → null. Required per admin toggle.

---

### I19. `Status` — required, static

**Only 3 values allowed.** Import-only — the live form never has a
"status" input at create time; a new finding is always DRAFT.

| | |
|---|---|
| Required | **Hard required, static.** Blank → missing-required. |
| Allowed (case-insensitive) | `SENT_TO_BRANCH_MANAGER`, `TRANSFERRED`, `CLOSED`. Any other text → `Invalid status "…" — must be one of <…list>`. [[import.ts#L383-L390](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L383-L390)] |
| Status meaning (see §3 cross-field rules) | Each one implies cross-field behavior for rectifiedCases/Amount and (for TRANSFERRED) the destination period. |

---

### I20. `Rectified Cases` (rectifiedCases) — optional, TRANSFERRED-only

| | |
|---|---|
| Static required? | No. Only meaningful if status == TRANSFERRED. Ignored completely for CLOSED / SENT_TO_BRANCH_MANAGER. |
| Parsing (only when TRANSFERRED) | `Number(…)` or 0 if blank. [[import.ts#L513-L516](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L513-L516)] |
| Bounds | Integer between 0 (inclusive) and `caseCount` (inclusive). → `Invalid rectified cases "…" — must be a whole number from 0 to <caseCount>`. |
| Why it exists on import only | A historical TRANSFERRED finding might have had some rectification progress *before* being transferred from the old period. The live transfer engine always moves the finding with the outstanding balance untouched, but for historical records we sometimes know the transferred balance with some already rectified — this column captures that. |

---

### I21. `Rectified Amount` (rectifiedAmount) — optional, TRANSFERRED-only

Same rule as I20, for the amount. Bounds check:
`0 <= rectifiedAmount <= amount`. → `Invalid rectified amount "…" — must be from 0 to <amount>`. [[import.ts#L524-L529](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L524-L529)]

---

### I22. `Transferred To Period Code` (transferredToPeriodCode)

| | |
|---|---|
| Required when | `Status == TRANSFERRED` → **required hard.** Blank → `Status "TRANSFERRED" requires Transferred To Period Code`. [[import.ts#L422-L426](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L422-L426)] |
| Must exist | Resolve to a real period by `.code`. Missing → `Unknown reporting period code "…"`. |
| Cannot equal the origin period | If `toPeriodCode.id == row's own periodCode.id` → `Transferred To Period Code must differ from Reporting Period Code`. [[import.ts#L431-L433](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L431-L433)] |
| Destination must be OPEN | Status must be OPEN. LOCKED → `Transferred To Period "<code>" must be open`. Same rule live transfer enforces. [[import.ts#L437-L439](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L437-L439)] |
| Why it exists | A TRANSFERRED finding has *two* related periods: the one it originally lived in (Reporting Period Code column, used for its reference) and the one it currently sits in (the destination, used to find it in dashboards). The dedupe key uses the destination to detect re-uploads of the same transfer file (see §4). |

---

### I23. `External Reference` (externalReference) — always optional

Plain string. Trimmed. Blank → null. Stored on `finding.externalReference`.
Purpose: carry a paper-audit / legacy-system / ticket-system ID (e.g. an
ICFMS ticket number) so an operator can cross-reference NIB's old system
to the Control360 finding. Never required. No validation beyond trim.

---

## 3. Cross-field invariants (validated *after* per-column rules)

### 3a. TRANSFERRED status: rectified balance cannot equal the whole finding

If status == TRANSFERRED AND `rectifiedCases == caseCount AND rectifiedAmount == amount`:
→ error *"Rectified cases and amount can't equal the full finding … — nothing would be outstanding to transfer; use CLOSED instead"*.

This prevents someone from tagging a row TRANSFERRED when it's actually
fully resolved — the result of a transfer with zero outstanding balance
would be nonsense (a transfer with nothing to carry). [[import.ts#L531-L537](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L531-L537)]

### 3b. TRANSFERRED: rectified dimensions must exhaust together

Exactly the same parity rule as the live rectify route:

| Rule | Error |
|------|-------|
| `rectifiedCases == caseCount` ⇒ `rectifiedAmount must == amount` (both dimensions fully exhausted) | *"Rectified cases equals the full case count … — rectified amount must equal the full amount … too"* |
| `rectifiedAmount == amount` ⇒ `rectifiedCases must == caseCount` | *"Rectified amount equals the full amount … — rectified cases must equal the full case count … too"* |

Code at [import.ts#L538-L551](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L538-L551).

### 3c. CLOSED status implies full resolution

For `status == CLOSED`, the code **silently writes**
`rectifiedCases = caseCount` and `rectifiedAmount = amount`, regardless
of whatever the user typed in the Rectified Cases/Amount columns (they
aren't even read in this branch). See [import.ts#L552-L555](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L552-L555).

### 3d. SENT_TO_BRANCH_MANAGER

Rectified columns are ignored; rectifiedCases and rectifiedAmount
default to 0 (nothing rectified yet — the finding was just approved and
sent, still outstanding).

---

## 4. Duplicate detection

The dedupe key is built over 12 structural fields. It explicitly
**excludes free text** (title / description / recommendation / evidence
note — they are too easy to differ by one space) and excludes reference
(always generated, not comparable across a re-upload).

Key definition at [import.ts#L285-L311](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L285-L311):
```
[ branchId, periodId, sourceId, departmentId, categoryId,
  findingDate, operationArea, irregularityType, currency,
  amount, caseCount ].join("|")
```

**For TRANSFERRED rows specifically**, the `periodId` used in this key
is the **destination** period (transferredTo), not the origin — matching
how an already-transferred live finding stores `periodId` (where it
currently sits, not where it came from). Getting this backwards would
mean a re-upload never recognizes its own previously-imported
TRANSFERRED rows.  [[import.ts#L563-L578](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L563-L578)]

Two maps are checked:
1.  `existingDedupeKeys(db)` — everything already in `db.findings`
    *before* this import run started.
2.  `seenKeys` — accumulated within the same file during the loop. This
    catches row N being a duplicate of row M (N > M) within the same
    Excel, not just vs the DB.

If duplicate found → row outcome is `duplicate` with
`duplicateOfReference: <existing finding reference>`. Not a hard error;
the UI shows "Duplicate of BR042-2026-09-007" so the user knows the row
was skipped and why.

---

## 5. Batch- and ordering-level rules

### 5a. Single transaction

All rows of the import run inside a single `updateDb()` Prisma
transaction. A single bad row doesn't partially commit. The route
handler returns 400 with the full row-level results array
(`ImportBatchRow[]`, one entry per input row) if *any* row has outcome
`error` — fix that row, re-upload the whole file; partial commits never
happen.

### 5b. In-flight row visibility

The importer calls `validateImportRow(db, row, i, seenKeys, opts)` with
`db` being the SAME mutable draft inside the updateDb callback. Each
valid row is pushed to `db.findings` immediately (before validating the
next row). This affects two downstream things:

- `nextFindingReference()`'s per-(branch,period) sequence counter sees
  previously-imported rows from THIS file. Two rows for the same
  branch+period won't collide on a generated reference.
- The `seenKeys` map catches duplicate rows within the file (as
  explained at §4).

### 5c. Permission check outside validateImportRow

Before any row is processed, the importer's org scope is captured from
the session. It is then enforced on every row inside
validateImportRow's opts.importerScope block, so a DISTRICT- or
BRANCH-scoped role granted `findings.import` (a possible admin-side
permission misconfiguration) is not able to import rows for other
districts just by typing different codes.

Code: [import.ts#L358-L376](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L358-L376).

---

## 6. Import outcome row schema

Each `ImportBatchRow` in the response is `{ rowNumber, outcome, error?, duplicateOfReference? }`.

| Outcome | Meaning |
|---------|---------|
| `imported` | Row was written. The `ImportBatchRow` also has `finding.id/references` on the response. |
| `duplicate` | Row matched the dedupe key against the DB or an earlier in-file row. `duplicateOfReference` references the existing finding. |
| `error` | Any per-column or cross-field invariant failed. `error` is the human readable string (exactly the message the user sees on the import-progress UI). |

---

## 7. Error matrix (quick reference)

| Symptom | Error text | Where |
|---------|------------|-------|
| Excel fails to open | `"Could not read this file — upload the .xlsx template file"` | parseImportWorkbook |
| 0 matched headers | `"No recognized columns found — use the downloaded template's header row unchanged"` | parseImportWorkbook |
| Too many rows (> 2000) | `"Too many rows (…). Maximum 2000 rows per import."` | route handler |
| Missing required columns | `"Missing required value(s): <comma separated headers>"` | validateImportRow |
| Wrong status | `"Invalid status \"…\" — must be one of …"` | validateImportRow |
| Bad district/branch/department/source/category code | `"Unknown or inactive <entity> code \"…\""` | per-lookup blocks |
| Branch not in district | `"Branch \"…\" does not belong to district \"…\""` | validateImportRow |
| Org scope violation | `"District \"…\" is outside your assigned district"` (and variants) | scope blocks |
| TRANSFERRED no dest period | `"Status \"TRANSFERRED\" requires Transferred To Period Code"` | status branch |
| Destination is closed | `"Transferred To Period \"…\" must be open"` | status branch |
| Amount NaN / negative | `"Invalid amount \"…\""` | numeric parse |
| caseCount not int | `"Invalid number of cases \"…\" — must be a whole number of at least 1"` | numeric parse |
| Rectified full balance on TRANSFERRED | `"Rectified cases and amount can't equal the full finding — nothing would be outstanding …"` | 3a |
| Dimensions exhausted on only one axis | two case/amount parity messages | 3b |
| Duplicate | outcome: `duplicate` (not an error) | dedupe key section |

### I24. `Root Cause` (rootCause) — requirable

Free text, same rule as Recommendation / Evidence Note: checked for presence only when **Settings → Required Fields → Root cause** is on. It is the template's last column; columns are matched by header, so a template downloaded before this column existed still imports, unless Root cause is set to required (then every row fails with *Missing required value(s): Root Cause*; download a fresh template).
