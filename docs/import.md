# Bulk Import & Export — NIB Control360 (ICFMS)

> **Current rules (updated 2026-09-30). Where anything below disagrees, this box wins.**
> - **Every problem is reported at once:** each rejected row lists *all* its problems (`errors[]`, also joined in `error`), not just the first; the whole file is still checked before anything is saved (all-or-nothing).
> - **Case-insensitive:** district / branch / period / source / department / category codes, Status, and the list values (operation area, type of irregularity, currency, risk level, priority) match regardless of letter case and are stored in the configured spelling.
> - **Finding date:** strict `YYYY-MM-DD` real calendar date (or an Excel date cell); **not after the last day of the row's Reporting Period** (earlier is fine), and not in the future. For TRANSFERRED this is the original period.
> - **Inactive references** are reported as *"… is deactivated"*, separately from unknown codes. A Transferred To period must also be later than the Reporting Period.
> - **Duplicates** use the importer's own fixed exact-match key (branch, period, source, department, category, finding date, operation area, irregularity type, currency, amount, cases), **not** the admin's Similar Findings setting.
> - **Duplicates are the final check:** only after every row passes; nothing is imported until the importer reviews the evidence and chooses *Import without duplicates* or *Cancel* (`IMPORT_DUPLICATES_FOUND`, `src/lib/importRun.ts`).
> - **Reverse an import:** Import History → Reverse (permission *Findings › Reverse an Import*) removes the batch's findings and everything recorded against them, **whatever has happened since** (impact shown first, reason required). Then *Re-import* (stored file, all checks again) or *Delete record*. References stay reserved. Code: `src/lib/importReverse.ts`.
> - **Root Cause** is an import column (the last one).


This document describes the Findings **bulk import** feature end-to-end (template, parsing, validation, commit, permissions, edge cases) and, for contrast, the **CSV export** feature it's paired with in the UI/permission model. All citations are `file:line` relative to the repo root (`C:\Users\HP\Desktop\AdonayAudit\auditapp`).

Core files:
- `src/lib/import.ts` — template builder, `.xlsx` parser, row validator, historical fast-forward transitions
- `src/app/(app)/findings/import/page.tsx` — upload UI, preview/result tables, import history
- `src/components/findings/ImportGuide.tsx` — in-app reference guide (column register, status guide, worked test cases)
- `src/app/api/findings/import/route.ts` — POST (commit) / GET (history)
- `src/app/api/findings/import/template/route.ts` — GET (downloadable `.xlsx` template)
- `src/app/api/findings/export/route.ts` — GET (CSV export)
- `src/lib/permissions/registry.ts`, `prisma/seedData.ts` — permission catalog and default role grants
- `src/app/api/findings/similar/route.ts` — the *manual-registration* duplicate-suggestion endpoint, contrasted with import's own dedupe logic

---

## 1. Overview

Bulk import exists to **backfill findings that were already resolved (or already in progress) in a paper/Excel record that predates this system** — replacing the old workflow of exchanging Excel files by email between Branch Internal Controllers, District, and HO (see `AuditDocs/proposal.txt:32-47`, "The current process requires multiple exchanges of Excel files… using standardized Excel templates"). It is explicitly **not** a bulk way to register brand-new findings for live review: every imported row is fast-forwarded straight to a declared *resting* status (`SENT_TO_BRANCH_MANAGER`, `TRANSFERRED`, or `CLOSED`) — there is no "DRAFT, goes through District/HO review" outcome for an imported row (`src/lib/import.ts:8-20`). The in-app copy repeats this framing verbatim: "This importer exists for one purpose: bringing an already-resolved or already-in-progress finding … into it, in bulk. It is **not** a faster way to register a brand-new finding" (`src/components/findings/ImportGuide.tsx:144-153`).

**Who can use it:** gated by the single permission `findings.import` (`src/lib/permissions/registry.ts:38,126` — action code `"import"`, label "Bulk Import (Excel)" on the `findings` page). In the default seed data this permission is granted **only to the `HO_CONTROLLER` role** (`prisma/seedData.ts:298`, `:380-390`) — no other seeded role (District Controller, District Director, Branch Controller, Branch Manager, Executive) has it. Because role→permission mapping is fully dynamic admin data (editable at `/admin/roles`), an admin *could* grant `findings.import` to a DISTRICT- or BRANCH-scoped role — `validateImportRow()` has an explicit defense for that scenario (see §9).

**Entry point:** `/findings/import` (`src/app/(app)/findings/import/page.tsx`), linked from the nav as "Import Findings" gated by `permissionKey("findings","import")` (`src/lib/nav.ts:69`). The page has three parts: a "Download the template" card, an "Upload the completed file" card, and an "Import History" list of every past `ImportBatch` (`src/app/(app)/findings/import/page.tsx:146-236`).

---

## 2. The template

The template is **not a static file** — `buildImportTemplate(db)` regenerates it from live reference data on every download (`src/app/api/findings/import/template/route.ts:6-15`), so column headers and the "Reference Data" sheet's valid codes are always current. It is an `.xlsx` workbook with two sheets:

- **`Findings`** — the header row `parseImportWorkbook()` expects, one row per finding to import (`src/lib/import.ts:24,159-167`).
- **`Reference Data`** — every currently-active district/branch/period/source/department/category code, plus the valid currency/risk-level/priority/operation-area/irregularity-type lists and a description of each Status value, so whoever fills the template has real values to copy (`src/lib/import.ts:169-219`).

Column order is defined once in `IMPORT_COLUMNS` (`src/lib/import.ts:44-84`) and mirrors the manual Register Finding form field-for-field for the first 18 columns (`src/lib/import.ts:33-43`).

### Required-ness: three different mechanisms

1. **Always required** (hard-coded, never configurable): District Code, Branch Code, Reporting Period Code, Amount, Number of Cases, and Status — these five/six columns keep a static `required: true`/`false` flag that `columnRequired()` uses directly (`src/lib/import.ts:44-59,63-67,121-124`).
2. **Admin-configurable** via **Settings → Required Fields** (`Settings.requiredFindingFields`, `src/types/index.ts:302-317,414-422`): 13 columns are looked up dynamically through `IMPORT_COLUMN_REQUIRABLE_KEY` (`src/lib/import.ts:103-117`) — **including Recommendation and Evidence Note**, whose static `required: false` in `IMPORT_COLUMNS` (`src/lib/import.ts:61-62`) is **overridden and ignored** because they have a `requirableKey`. Since every `requiredFindingFields` entry defaults to `true` on a fresh install (`src/types/index.ts:418-421`), **Recommendation and Evidence Note are required by default**, not optional — see the gotcha in §10.
3. **Status-conditional**: Transferred To Period Code is required only when Status = `TRANSFERRED`; Rectified Cases/Amount are meaningful only for `TRANSFERRED` (`src/lib/import.ts:69-82,422-440`).
4. **Always optional**: External Reference only (`src/lib/import.ts:83`).

The literal header text shown in a downloaded file also changes: for a config-driven column, `columnHeader()` appends `" (optional)"` to the label when that field is currently *not* required (`src/lib/import.ts:126-133`). When parsing an uploaded file, `normalizeHeaderText()` strips a trailing `"(optional)"` (case-insensitively) so a file downloaded under a different admin setting than what's live today still matches its column (`src/lib/import.ts:135-140,244-254`).

### Column reference table

| # | Column (header text) | Required? | Type / format | Validation rule (see §4 for exact errors) |
|---|---|---|---|---|
| 1 | District Code | **Always** | Short code, e.g. `D01` | Must match an **ACTIVE** `District.code` exactly |
| 2 | Branch Code | **Always** | Short code, e.g. `B001` | Must match an **ACTIVE** `Branch.code`; branch's `districtId` must equal the row's District Code |
| 3 | Reporting Period Code | **Always** | e.g. `2026-09` | Must match an existing `ReportingPeriod.code`. This is the finding's **own original** period — for a Transferred row this is where it started, not where it ended up |
| 4 | Source Code | Admin setting (`requiredFindingFields.sourceId`) | e.g. `IC` / `IA` | If given, must match an **active** `Source.code` |
| 5 | Department Code | Admin setting (`requiredFindingFields.departmentId`) | e.g. `OPS` | If given, must match an **active** `Department.code` AND be in scope for the row's district/branch (bank-wide departments always qualify) |
| 6 | Classified Category Code | Admin setting (`requiredFindingFields.categoryId`) | e.g. `ATM_MISMATCH` | If given, must match an **active** `ClassifiedCategory.code` |
| 7 | Title | Admin setting (`requiredFindingFields.title`) | Short free text | No format check beyond presence; not part of the dedupe key |
| 8 | Finding Date (YYYY-MM-DD) | Admin setting (`requiredFindingFields.findingDate`) | `YYYY-MM-DD` | If given, must parse as a valid date |
| 9 | Operation Area | Admin setting (`requiredFindingFields.operationArea`) | e.g. "Teller Counter" | If given, must exactly match an entry in `Settings.operationAreas` |
| 10 | Type of Irregularity | Admin setting (`requiredFindingFields.irregularityType`) | e.g. "Cash Shortage" | If given, must exactly match an entry in `Settings.irregularityTypes` |
| 11 | Amount | **Always** | Number, e.g. `61000` | Must be finite and `>= 0` |
| 12 | Currency | Admin setting (`requiredFindingFields.currency`) | e.g. `ETB` | If given, must exactly match an entry in `Settings.currencies` |
| 13 | Number of Cases | **Always** | Whole number, e.g. `3` | Must be an integer `>= 1` |
| 14 | Risk Level | Admin setting (`requiredFindingFields.riskLevel`) | Low/Medium/High/Critical | If given, must exactly match `Settings.riskLevels` |
| 15 | Priority | Admin setting (`requiredFindingFields.priority`) | Low/Medium/High/Urgent | If given, must exactly match `Settings.priorityLevels` |
| 16 | Description | Admin setting (`requiredFindingFields.description`) | Free text | Presence only |
| 17 | Recommendation | Admin setting (`requiredFindingFields.recommendation`) — **defaults to required**, despite the column's own static flag reading `false` | Free text | Presence only when required |
| 18 | Evidence Note | Admin setting (`requiredFindingFields.evidenceNote`) — **defaults to required**, same caveat as above | Free text | Presence only when required; note only — no file attachment via import |
| 19 | Status (`SENT_TO_BRANCH_MANAGER` / `TRANSFERRED` / `CLOSED`) | **Always** | One of the 3 literal values | Case-insensitive but must spell one of `ALLOWED_IMPORT_STATUSES` exactly |
| 20 | Rectified Cases (optional…) | Status-conditional — only read when Status = `TRANSFERRED` | Whole number | `0 <= n <= caseCount`, integer |
| 21 | Rectified Amount (optional…) | Status-conditional — only read when Status = `TRANSFERRED` | Number | `0 <= n <= amount`; must "complete together" with Rectified Cases (see §4) |
| 22 | Transferred To Period Code (required only if Status is TRANSFERRED) | **Required iff Status = TRANSFERRED** | Period code, e.g. `2026-10` | Must exist, must differ from column 3, and its status must be `OPEN` |
| 23 | External Reference (optional) | Always optional | Free text | Never validated or used for matching/numbering — purely informational |
| 24 | Root Cause | Admin setting (`requiredFindingFields.rootCause`) | Free text | Presence only when required. Added as the last column; files are matched by header, so older templates without it still import unless Root cause is required |

Row/column source: `IMPORT_COLUMNS` (`src/lib/import.ts:44-84`), condensed further in the in-app guide table (`src/components/findings/ImportGuide.tsx:17-76`).

Root Cause has **no import column at all**, even though it is one of the admin-configurable `REQUIRABLE_FINDING_FIELDS` (`src/types/index.ts:315`) — a pre-existing gap the code calls out explicitly: "rootCause has no import column at all…so a required/optional toggle for it has nothing to affect on this path" (`src/lib/import.ts:100-102`). It can only be added afterward from the finding's own detail page.

---

## 3. Upload & parse flow, step by step

1. **File picker** (`src/app/(app)/findings/import/page.tsx:164`): `<FileInput accept=".xlsx" .../>`. `handleFileChange()` additionally checks the filename client-side and rejects anything not ending in `.xlsx` before it's even selected (`page.tsx:86-94`).
2. **Upload**: `handleImport()` builds a `FormData` with the file under key `"file"` and POSTs it to `/api/findings/import` (`page.tsx:96-125`).
3. **Server-side gate**: `POST` first requires `findings.import` (`src/app/api/findings/import/route.ts:40-41`), then reads the multipart body — if `request.formData()` throws (e.g. body too large for the runtime to buffer), the route returns `400 "File exceeds the 10 MB limit"` (`route.ts:43-48`).
4. **Size limit**: `MAX_IMPORT_BYTES = 10 * 1024 * 1024` (10 MB) is checked explicitly against `file.size` too (`src/lib/import.ts:27`, `route.ts:54-56`).
5. **Parsing**: `parseImportWorkbook(buffer)` loads the buffer with **ExcelJS** (`import ExcelJS from "exceljs"`, `src/lib/import.ts:1`; only Excel/`.xlsx` is supported — there is no CSV/Papaparse/csv-parse path anywhere in this feature; `package.json` lists only `"exceljs": "^4.4.0"` for spreadsheet parsing). If `workbook.xlsx.load()` throws, it returns `{ error: "Could not read this file - upload the .xlsx template file" }` (`src/lib/import.ts:231-237`).
6. **Sheet resolution**: reads the sheet literally named `"Findings"`, falling back to the workbook's first sheet if unrenamed; if the workbook has no sheets at all, returns `"The workbook has no sheets"` (`src/lib/import.ts:239-240`).
7. **Header matching**: for every cell in row 1, the (optional-suffix-stripped) text is matched case-insensitively against `IMPORT_COLUMNS` header text; unmatched columns are silently ignored (column order in the file doesn't matter). If **zero** columns are recognized, returns `"No recognized columns found - use the downloaded template's header row unchanged"` (`src/lib/import.ts:242-257`).
8. **Row extraction**: from row 2 onward, any row with at least one non-empty recognized cell becomes a raw row (`src/lib/import.ts:259-273`); a fully-blank row is skipped rather than becoming an error.
9. **Post-parse checks in the route**: empty parse result → `400 "No data rows found below the header"`; more than `MAX_IMPORT_ROWS = 2000` data rows → `400` naming the actual count and asking the file be split into batches of 2000 or fewer (`route.ts:63-68`, cap defined at `src/lib/import.ts:31`).
10. **Dry run (validate-before-commit)**: the whole parsed file is validated once against a `structuredClone()` of the live database (never persisted) using a throwaway `importBatchId: "dry-run"` (`route.ts:70-88`). If **any** row comes back `outcome: "error"`, the request is rejected wholesale with `400` and the full per-row breakdown; **nothing is written to the database at all** (`route.ts:89-104`).
11. **Real commit**: only if the dry run had zero errors does the route re-run `validateImportRow()` for every row inside a real `updateDb()` transaction, this time actually pushing findings and recording an `ImportBatch` (`route.ts:106-156`).

Malformed-file behavior summary: wrong extension → blocked client-side; corrupt/non-xlsx bytes → `400` "Could not read this file"; no `Findings`-shaped header row → `400` "No recognized columns found"; empty sheet → `400` "No data rows found below the header"; >2000 rows → `400` naming the count; >10 MB → `400` "File exceeds the 10 MB limit".

---

## 4. Row-level validation rules (exhaustive)

All of the following live in `validateImportRow()` (`src/lib/import.ts:353-666`), evaluated **all together** — every failing rule is collected and the row gets `outcome: "error"` with all the messages (`errors[]`); a row that passes every rule is either `outcome: "duplicate"` or `outcome: "imported"`.

1. **Required-field presence** (`import.ts:378-381`): every column whose `columnRequired(db, col)` is true must have a non-blank (after `.trim()`) value. Error: `Missing required value(s): <comma-joined column headers>`.
2. **Status value** (`import.ts:383-391`): uppercased, must be one of `SENT_TO_BRANCH_MANAGER`, `TRANSFERRED`, `CLOSED`. Error: `Invalid status "<raw>" - must be one of SENT_TO_BRANCH_MANAGER, TRANSFERRED, CLOSED`.
3. **District Code** (`import.ts:393-394`): must match an **ACTIVE** district. Error: `Unknown or inactive district code "<code>"`.
4. **Branch Code** (`import.ts:396-400`): must match an **ACTIVE** branch. Error: `Unknown or inactive branch code "<code>"`. If found but its `districtId` doesn't match the row's district: `Branch "<code>" does not belong to district "<code>"`.
5. **Importer org-scope check** (`import.ts:402-407`, see §9 for full rationale): if the importer's session `orgScope === "BRANCH"`, the row's branch must equal the importer's own branch, else `Branch "<code>" is outside your assigned branch`; if `orgScope === "DISTRICT"`, the row's district must equal the importer's own district, else `District "<code>" is outside your assigned district`. (BANK-scoped importers — HO Controller by default — have no such restriction.)
6. **Reporting Period Code** (`import.ts:409-410`): must exist. Error: `Unknown reporting period code "<code>"`. Notably **no locked-period check** here at all (unlike live writes) — every import row is historical by design, and the period being long-since locked is usually *why* it's being backfilled (`import.ts:411-415`).
7. **Transferred-To-Period rules** — only evaluated when Status = `TRANSFERRED` (`import.ts:421-440`):
   - Blank Transferred To Period Code → `Status "TRANSFERRED" requires Transferred To Period Code`.
   - Code doesn't match any period → `Unknown reporting period code "<code>"`.
   - Same period as the origin (column 3) → `Transferred To Period Code must differ from Reporting Period Code`.
   - Destination period's status isn't `OPEN` → `Transferred To Period "<code>" must be open`.
8. **Source Code** (`import.ts:447-449`): only looked up if non-blank (config-optional); if given, must match an **active** source. Error: `Unknown or inactive source code "<code>"`.
9. **Department Code** (`import.ts:451-456`): only looked up if non-blank; must match an **active** department (`Unknown or inactive department code "<code>"`), and must be in org-scope for the row's district/branch via `isDepartmentInScope()` (`src/lib/org.ts:141-145` — BANK-scoped departments always qualify, DISTRICT-scoped must match the row's district, BRANCH-scoped must match the row's branch). Error: `Department "<code>" is not available for branch "<code>"`.
10. **Classified Category Code** (`import.ts:458-460`): only looked up if non-blank; must match an **active** category. Error: `Unknown or inactive classified category code "<code>"`.
11. **Currency** (`import.ts:465-467`): only checked if non-blank; must be a member of `Settings.currencies`, case-insensitive. Error: `Unknown currency "<value>"`.
12. **Risk Level** (`import.ts:468-470`): must be an exact member of `Settings.riskLevels`. Error: `Unknown risk level "<value>"`.
13. **Priority** (`import.ts:471-473`): must be an exact member of `Settings.priorityLevels`. Error: `Unknown priority "<value>"`.
14. **Operation Area** (`import.ts:474-476`): must be an exact member of `Settings.operationAreas`. Error: `Unknown operation area "<value>"`.
15. **Type of Irregularity** (`import.ts:477-479`): must be an exact member of `Settings.irregularityTypes`. Error: `Unknown type of irregularity "<value>"`.
16. **Finding Date** (`import.ts:481-484`): if non-blank, must parse via `new Date(value)` to a valid timestamp. Error: `Invalid finding date "<value>" - use YYYY-MM-DD`.
17. **Amount** (`import.ts:486-489`): `Number(row.amount)` must be finite and `>= 0`. Error: `Invalid amount "<value>"`.
18. **Number of Cases** (`import.ts:490-493`): `Number(row.caseCount)` must be an integer `>= 1`. Error: `Invalid number of cases "<value>" - must be a whole number of at least 1`.
19. **Rectified Cases / Rectified Amount** — only evaluated when Status = `TRANSFERRED` (`import.ts:510-551`); blank defaults to `0`:
    - Rectified Cases must be an integer with `0 <= n <= caseCount`, else `Invalid rectified cases "<value>" - must be a whole number from 0 to <caseCount>`.
    - Rectified Amount must be finite with `0 <= n <= amount`, else `Invalid rectified amount "<value>" - must be from 0 to <amount>`.
    - If both equal the full case count and full amount → `Rectified cases and amount can't equal the full finding (<caseCount> / <amount>) - nothing would be outstanding to transfer; use CLOSED instead`.
    - If Rectified Cases = full caseCount but Rectified Amount ≠ full amount → `Rectified cases equals the full case count (<n>) - rectified amount must equal the full amount (<n>) too`.
    - If Rectified Amount = full amount but Rectified Cases ≠ full caseCount → `Rectified amount equals the full amount (<n>) - rectified cases must equal the full case count (<n>) too`.
    - **Zero/zero is valid** for TRANSFERRED (a finding can transfer having had no progress at all).
    - For Status = `CLOSED`, Rectified Cases/Amount are **not read from the file at all** — they're forced to the full `caseCount`/`amount` (`import.ts:552-555`), i.e. CLOSED always implies full resolution.
20. **Duplicate check** (`import.ts:563-582`, see §7 below): computed only after every other rule passes. If the row's `dedupeKey()` matches a key already seen (either a pre-existing finding, or an earlier row *in the same file*), `outcome: "duplicate"` — this is **not** a validation error and does not block the file.

Every error above is returned as a single-row result `{ rowNumber, outcome: "error", error: "<message>" }`; `rowNumber` is `i + 2` (accounting for the header row), matching the spreadsheet's own row numbering (`route.ts:81-88,110-117`).

---

## 5. Preview / confirm step

There is **no separate "preview" screen with per-row status before an explicit confirm click** — the UI is a single upload action, but the backend performs a full **dry run** first (against a `structuredClone()` of the DB, never persisted) purely to decide whether the file is acceptable, and if it's not, the response carries the entire row-by-row breakdown so the user can see exactly what to fix without a second round trip (`route.ts:70-104`).

- **Import is all-or-nothing at the file level**: "every row is checked first, and if even one has a real error, nothing is imported — fix every row shown below and re-upload the whole file" (`page.tsx:161`, enforced by `route.ts:89-104`). There is **no partial-import / skip-bad-rows option** — a single `error` outcome anywhere in the file rejects the whole batch.
- **Duplicates are the one exception**: "a row that merely already exists (duplicate) doesn't block the rest" (`page.tsx:161`) — duplicates are skipped individually but don't stop the other rows from importing.
- **Rejected result** (any error present): shown in a red-bordered card "Import rejected — nothing was imported" with the full row table (Row / Outcome badge / Detail) (`page.tsx:183-190`, table component `BatchRowsTable` at `page.tsx:25-54`). Row outcomes are color-coded: `imported` → green, `duplicate` → amber, `error` → red (`page.tsx:14-18`).
- **Successful commit result**: a card showing `"<fileName> — <totalRows> row(s): <importedCount> imported, <duplicateCount> duplicate(s)"` plus the same per-row table (`page.tsx:192-202`).
- **Import History**: every past `ImportBatch` (successful commits only — a rejected dry run never becomes a batch) is listed permanently, expandable to the same per-row table, fetched from `GET /api/findings/import` (`page.tsx:204-236`, `route.ts:18-25` — comment: "every past run, kept permanently…document any transformation").

---

## 6. What happens on a successful import (per row)

For each row that validates and isn't a duplicate, `validateImportRow()` builds and pushes a real `Finding` record directly (`import.ts:599-643`), then fast-forwards it through the exact same transition/audit machinery a live user action would use — **never a bare status assignment** (`import.ts:668-693`):

- **Reference number**: always system-generated via `nextFindingReference(db, branch, period)` (`src/lib/findings.ts:546-560`) — `"<branchCode>-<periodCode>-<5-digit-seq>"`, computed against the row's **origin** period even for a Transferred row (`import.ts:601`, comment at `import.ts:33-39`). Never taken from the file — there is no reference column in the template at all.
- **`status` on creation**: every row starts as `"DRAFT"` (`import.ts:625`), identical to a manually-registered finding, then is immediately transitioned onward within the same call.
- **`registeredByBankScope`**: hard-set to **`false`** on every imported finding (`import.ts:626-630`), regardless of the importing user's own org scope. The code comment is explicit about why: "A historical import always targets a real district/branch through the normal chain (there's no bank-scope import path) - set for real by submitFinding() if/when this ever gets submitted through the live workflow rather than imported pre-transitioned" (`import.ts:626-629`). Contrast with the live single-record path, where `submitFinding()` sets it to `Boolean(opts?.registeredByBankScope)` based on the *submitting* user's session `orgScope === "BANK"` (`src/lib/findings.ts:401-415`) — import never calls `submitFinding()` at all, so this flag is always `false` for imported rows even when an HO (BANK-scoped) Controller does the import.
- **`createdAt` backdating**: set to the row's own **Finding Date** (parsed as that date's midnight UTC) when one was supplied, falling back to the import moment only if Finding Date was left blank (only possible when that field was opted out of `requiredFindingFields`) — done specifically so `caseAgeDays()`/backlog-age metrics reflect the record's real historical age, not the import run's timestamp (`import.ts:584-598`).
- **Category/department/source/etc. resolved to real ids**: `sourceId`, `departmentId`, `categoryId` are the **matched record's id**, not the raw code from the file, falling back to `""` only when the column was left blank under an admin opt-out (`import.ts:602-618`).
- **Fast-forward transitions** (`fastForwardHistoricalImport()`, `import.ts:694-801`), all stamped with a distinct `IMPORT_*` action and the shared reason string `"Historical import - backfilled from an already-resolved external record, not reviewed live."` (`import.ts:708`), each going through the real `transitionFinding()`/`transferFinding()` functions in `src/lib/findings.ts` so `FindingTransition` history rows and `AuditLogEntry` rows are created exactly as they would be for a live action:
  - Every row: `DRAFT → SUBMITTED` (`IMPORT_SUBMIT`) → `SENT_TO_BRANCH_MANAGER` (`IMPORT_APPROVE`) — skipping `DISTRICT_REVIEW`/`HO_REVIEW`/`PENDING_BANK_APPROVAL` entirely (`import.ts:711-713`).
  - If any rectified progress was declared (always true for `CLOSED`; only when Rectified Cases/Amount > 0 for `TRANSFERRED`): a real `RectificationEntry`-equivalent row is pushed to `db.rectifications`, the finding transitions to `RECTIFIED` (if target is `CLOSED`) or `PARTIALLY_RECTIFIED` (if target is `TRANSFERRED`) via `IMPORT_RECTIFY`, `districtVerifiedCases/Amount` are set to match (a historical import is "treated as already verified"), and a `FindingClosure` row is pushed with `closedCases/Amount` set the same way — mirroring a live `PARTIAL_CLOSE` (`import.ts:715-770`).
  - If target is `CLOSED`: one more transition to `CLOSED` via `IMPORT_CLOSE` (`import.ts:771-772`); otherwise (partial progress on a `TRANSFERRED` row) an `IMPORT_PARTIAL_CLOSE` audit-log entry is appended without a status transition (`import.ts:773-783`).
  - If target is `TRANSFERRED`: the real `transferFinding()` is called with `action: "IMPORT_TRANSFER"`, which pushes a `FindingTransfer` ledger row and moves `finding.periodId` to the destination period, then transitions to `TRANSFERRED` (`import.ts:786-800`, mechanism in `src/lib/findings.ts:37-86`).
- **Notifications**: **none fire.** `transitionFinding()`/`transferFinding()` in `src/lib/findings.ts` contain no notification calls at all — every live route that does notify (submit, district-review, ho-review, rectify, transfer, close, etc.) calls `notifyUsers()`/`notifyFindingsPermissionHolders()` itself, from `src/lib/notifications.ts`, after calling the shared transition function (e.g. `src/app/api/findings/[id]/submit/route.ts`, `.../transfer/route.ts`). `src/app/api/findings/import/route.ts` never imports `@/lib/notifications` and calls `validateImportRow()` directly — so an imported finding produces no notification to anyone.
- **Audit log**: two things are logged — every individual `IMPORT_*` transition inside `transitionFinding()`/`appendAuditLog()` (per finding, per hop), plus one summary `IMPORT` audit-log entry for the whole batch (`entityType: "ImportBatch"`, with fileName/importedCount/duplicateCount/errorCount/totalRows) written once the transaction completes (`route.ts:146-153`).
- **`ImportBatchRow.finding` is discarded before persisting**: the committed `ImportBatch.rows` array only stores `rowNumber/outcome/findingId/reference/duplicateOfReference/error` — the resolved `Finding` object itself is intentionally not duplicated into the ledger (`route.ts:132-141`).

---

## 7. Duplicate handling

Bulk import uses a **stricter, different mechanism** than manual registration's duplicate *suggestion*:

- **Import's `dedupeKey()`** (`src/lib/import.ts:285-311`) is a hard, exact-match gate over **branch, period, source, department, category, finding date, operation area, irregularity type, currency, amount, and case count** — deliberately excluding free text (title/description/recommendation/evidenceNote, "too easy to differ by whitespace/wording for an exact-match key to be meaningful") and reference (always system-generated). A `TRANSFERRED` row dedupes by its **destination** period (where it ended up), not its origin, so re-uploading a file recognizes its own previously-imported Transferred rows correctly (`import.ts:557-578`).
- The key is checked against **both** pre-existing live findings (via `existingDedupeKeys(db)`, built from every current `db.findings` entry, `import.ts:313-334`) **and** every row already processed earlier in the same file (`seenKeys` is mutated in-place as each row is validated, `import.ts:562-579,642`) — so two duplicate rows within one file are caught against each other too.
- A duplicate match produces `outcome: "duplicate"` with `duplicateOfReference` set to the matching finding's reference — it is **not** a validation error, does not block the rest of the file, and nothing is created for that row (`import.ts:579-582`).
- Contrast with **manual registration's** `GET /api/findings/similar` (`src/app/api/findings/similar/route.ts`): that endpoint is a **non-blocking suggestion** shown on the Register Finding form while typing — it matches on an **admin-configured subset** of fields (`Settings.similarFindingFields`, potentially different from and looser than import's fixed 10-field key), requires every configured field to have a value, returns up to 5 candidates, and never prevents submission; the registrar decides. Bulk import's dedupe key is fixed in code, not admin-configurable, and is a hard skip rather than a soft prompt.

---

## 8. Export (for contrast)

`GET /api/findings/export` (`src/app/api/findings/export/route.ts`) is a plain CSV download, gated by **`reports.view`** (`route.ts:16-17`) — a *different* permission from `findings.import`.

- **Format**: `text/csv; charset=utf-8`, filename `findings-export-<YYYY-MM-DD>.csv` (`route.ts:120-125`); values are quoted/escaped only when they contain a comma, quote, or newline (`csvCell()`, `route.ts:10-13`).
- **Scope**: starts from `findingsInScope(db, auth.session)` — the same org-scope filter used by the Findings list itself, so an export always matches what's visible to that user (`route.ts:20`, comment `route.ts:8-9`).
- **Filters** (all optional query params, same names as the Findings list/report filters): `periodId`, `districtId`, `branchId`, `sourceId`, `categoryId`, `risk`, `status`, `dateFrom`, `dateTo` (`route.ts:23-40`).
- **Period-slice behavior**: when `periodId` is given, a finding that has since transferred **out** of that period is still included, exported with that period's own slice of eligible cases/amount via `findingsResidentInPeriod()` (`src/lib/findings.ts`), and its Status column is replaced with `TRANSFERRED_OUT (<destinationPeriodCode>)` rather than a possibly-stale live status (`route.ts:42-50,81-103`).
- **Columns**: Reference, Title, District, Branch, Department, Period, Source, Category, Risk, Status, Amount, Currency, Cases, Rectified Amount, Rectified Cases, Outstanding Amount, Outstanding Cases, Finding Date, Updated At (`route.ts:59-79`) — Outstanding = Amount − Rectified Amount / Cases − Rectified Cases, computed inline, not stored.
- **Who can access it**: any role holding `reports.view` — per `prisma/seedData.ts`, that's `HO_CONTROLLER` (`:299`), `DISTRICT_CONTROLLER` (`:320`), `DISTRICT_DIRECTOR` (`:335`), and `EXECUTIVE_READONLY` (via `ALL_VIEW_PERMISSION_KEYS`, `:464`) — plus `ADMIN` (all permissions, `:373`). Notably `BRANCH_CONTROLLER` and `BRANCH_MANAGER` do **not** have `reports.view` by default (`:339-362`), so they cannot export, even though `BRANCH_CONTROLLER` can create/submit findings.
- There is no import-shaped counterpart to export's filtering — import always processes 100% of the uploaded rows, export always lets the caller narrow the slice first.

---

## 9. Permission & scope rules

- **Permission gate**: all three import endpoints (`GET`/`POST /api/findings/import`, `GET /api/findings/import/template`) require `findings.import` via `requirePermission()` (`src/app/api/findings/import/route.ts:19,40`; `template/route.ts:11`). By default only `HO_CONTROLLER` (BANK-scoped) holds it (`prisma/seedData.ts:298,380-390`).
- **Per-row org-scope enforcement** (`validateImportRow()`, `import.ts:402-407`): the importer's own session scope is passed in as `opts.importerScope` (built in the route from `auth.session.orgScope/districtId/branchId`, `route.ts:74-78`) and checked **per row**, mirroring the identical rule `POST /api/findings` already applies to single-record creation:
  - `orgScope === "BRANCH"` → every row's resolved branch must equal `importerScope.branchId`, else rejected with `Branch "<code>" is outside your assigned branch`.
  - `orgScope === "DISTRICT"` → every row's resolved district must equal `importerScope.districtId`, else rejected with `District "<code>" is outside your assigned district`.
  - `orgScope === "BANK"` → **no restriction**; a BANK-scoped importer (the seeded HO Controller) can import for any district/branch, matching icfms.txt's design that HO registers/imports Internal Audit findings bank-wide.
  - This check exists specifically to close a **horizontal privilege-escalation gap**: because `findings.import` is *dynamic, admin-editable* role data, nothing in the code stops an admin from granting it to a DISTRICT- or BRANCH-scoped role too; without this check, such a misconfigured role could import a finding into *any other* district/branch just by putting a different code in the spreadsheet — a gap the single-record create path already closed but the bulk path originally didn't (`import.ts:358-376`, and documented as a fixed finding in `security/SECURITY.md:206-214`: "Fixed — bulk import had no org-scope check").
- **Export permission** is entirely separate (`reports.view`, see §8) — a user can hold one without the other (e.g. District Director has `reports.view` but not `findings.import`; conversely nothing prevents an admin from granting `findings.import` without `reports.view`, though the default HO Controller role has both).

---

## 10. Edge cases & known gotchas

- **Recommendation / Evidence Note default to *required*, contradicting the in-app Import Guide's own labeling.** `IMPORT_COLUMNS` marks their static `required` flag as `false` (`import.ts:61-62`), but both columns also appear in `IMPORT_COLUMN_REQUIRABLE_KEY` (`import.ts:115-116`), so `columnRequired()` actually resolves their required-ness from `Settings.requiredFindingFields.recommendation` / `.evidenceNote` (`import.ts:121-124`) — and every `requiredFindingFields` key, including these two, **defaults to `true`** on a fresh install (`src/types/index.ts:414-421`, `REQUIRABLE_FINDING_FIELDS` entries at `src/types/index.ts:314,316`). Meanwhile the UI's own reference table (`ImportGuide.tsx`) hard-codes both as `req: "opt"` — "never required" (`src/components/findings/ImportGuide.tsx:51-52`). In practice: on a default install, a row missing Recommendation or Evidence Note **will** be rejected with `Missing required value(s): Recommendation, Evidence Note`, even though the in-app guide the user is reading says they're optional. (The downloaded template's own header text is accurate — it *will* show `(optional)` only when the admin has actually turned the setting off — it's specifically the static `ImportGuide` component's badge that's stale/wrong.)
- **All-or-nothing, no partial commit.** One `error`-outcome row anywhere in a 2000-row file blocks the entire file; there's no way to import "just the good rows" from a single upload — the whole file must be fixed and re-uploaded (`route.ts:89-104`, `page.tsx:161`).
- **Row cap**: `MAX_IMPORT_ROWS = 2000` (`import.ts:31`) is described in code as "a generous ceiling, not an expected volume — guards against a single request trying to create an unreasonable number of findings in one `updateDb()` transaction" (`import.ts:28-30`). A file with more data rows is rejected outright with no auto-batching — the user must split it manually.
- **File size cap**: `MAX_IMPORT_BYTES = 10 * 1024 * 1024` (10 MB) (`import.ts:27`), checked twice — once implicitly if `formData()` itself throws, once explicitly against `file.size` (`route.ts:43-56`).
- **Only `.xlsx` is accepted** — there is no CSV import path. The client blocks non-`.xlsx` filenames before upload (`page.tsx:88-92`), and the server's own parser only understands the ExcelJS `.xlsx` format (`import.ts:231-237`); a `.xls` or `.csv` file with a renamed extension would still fail at `workbook.xlsx.load()`.
- **Header-row column order doesn't matter, but header *text* must match** (modulo the `(optional)` suffix normalization) — a file with renamed or reordered-but-relabeled headers, or one missing the template's exact wording, either drops that column silently (if some other headers still match) or is rejected wholesale if *no* headers match at all (`import.ts:242-257`).
- **Completely blank rows are silently skipped**, not reported as an error (`import.ts:262,272` — `hasAnyValue` guard).
- **Locked periods don't block import** by design — see rule 6 in §4; a locked origin period is normal for a historical backfill, unlike a live create/edit which `assertPeriodWritable()` would reject (`src/lib/findings.ts:463-471`).
- **No itemized case amounts via import** — the live Register Finding form supports an optional "itemized case amounts" breakdown; bulk import always produces the plain, non-itemized shape (documented directly in `ImportGuide.tsx:198-201`).
- **`exceljs`'s bundled `uuid` dependency was a known security concern** on this exact upload surface: "a buffer-bounds-check vulnerability sat directly on this app's untrusted-file-upload surface (the findings import feature parses attacker-supplied `.xlsx` files)" — mitigated via a `package.json` `overrides` pin to `uuid@14.x`, since `exceljs@4.4.0` itself still depends on the vulnerable `uuid@^8.3.0` (`security/SECURITY.md:335-340`).
- **`ImportBatchRow.finding` is never persisted** — only `rowNumber/outcome/findingId/reference/duplicateOfReference/error` are stored on the batch ledger (`route.ts:132-141`, type at `src/types/index.ts:734-741`); re-reading a finding's full detail always requires following `findingId`, not the import history.
- **Reference numbers are strictly append-only per branch+period**, computed via `MAX(parsed suffix) + 1` rather than `COUNT + 1` specifically so a deleted finding's old number is never reissued (`src/lib/findings.ts:530-560`) — this applies identically to import- and manually-created findings, since both call the same `nextFindingReference()`.
