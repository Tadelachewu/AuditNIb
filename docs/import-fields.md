# Bulk Import Template — Column-by-Column Reference

Every column in the bulk-import `.xlsx` template (`IMPORT_COLUMNS`, `src/lib/import.ts:44-84`), one
dedicated section each. `docs/import.md` covers the mechanism of bulk import end-to-end (upload/parse
flow, dedupe, what a successful row writes); this document is the single place to look up one specific
column in isolation — how a user should fill it in, what's allowed, what gets rejected and why, and why
the column exists at all.

**18 of the 23 columns mirror the manual Register Finding form field-for-field** (`import.ts:33-43`) —
for those, this document states only the **import-specific** differences (exact-match code lookup
instead of a dropdown, no client-side hinting, the column's exact position and header text) and points
to `docs/registration-fields.md` for the full "why this field exists" business rationale, rather than
repeating it. The remaining 5 columns — **Status, Rectified Cases, Rectified Amount, Transferred To
Period Code, External Reference** — have no manual-registration equivalent at all and get full,
standalone treatment here.

Every rule is cited `file:line` against `validateImportRow()` (`src/lib/import.ts:353-666`) and
`IMPORT_COLUMNS` (`src/lib/import.ts:44-84`).

---

## Why bulk import's fields work differently from the manual form at all

Bulk import exists to **backfill already-resolved or already-in-progress historical findings**, not to
register a brand-new finding for live review (`docs/import.md` §1). This single fact explains every
structural difference between this document and `registration-fields.md`:
- There is no interactive dropdown giving instant feedback — every reference-data column (District,
  Branch, Source, Department, Category, Currency, Risk Level, Priority, Operation Area, Irregularity
  Type) is matched by **exact code/text lookup** against what exists in the database at import time, not
  chosen from a live-filtered UI control.
- Three columns exist purely to describe the finding's **already-known outcome** (Status, Rectified
  Cases/Amount, Transferred To Period Code) — concepts the manual form has no equivalent for, since a
  freshly-registered finding always starts at `DRAFT` and has no rectification history yet.
- One column (External Reference) exists purely to **preserve external identity**, per `master.txt` §22:
  *"Preserve historical source and identifiers where available."*

---

## Columns 1–18: shared with manual registration

| # | Column | Registration field | What differs on the import path |
|---|---|---|---|
| 1 | District Code | District (§5) | Exact-match against **active** `District.code` (e.g. `D01`) — not a dropdown selection, a literal code string in the spreadsheet cell. |
| 2 | Branch Code | Branch (§6) | Exact-match against **active** `Branch.code` (e.g. `B001`); the branch's own `districtId` must equal the row's District Code — same consistency rule as manual registration, checked against the code pairing instead of a filtered dropdown. |
| 3 | Reporting Period Code | Reporting Period (§4) | Exact-match against `ReportingPeriod.code` (e.g. `2026-09`). Critically, **this is always the finding's own *origin* period**, even for a row whose Status is `TRANSFERRED` — the destination lives in its own separate column (§22 below), never here. |
| 4 | Source Code | Source (§2) | Exact-match against **active** `Source.code` (e.g. `IC`, `IA`) — only looked up if the cell is non-blank. |
| 5 | Department Code | Department (§3) | Exact-match against **active** `Department.code`, plus the same `isDepartmentInScope()` org-scope check as manual registration. |
| 6 | Classified Category Code | Classified Case (§10) | Exact-match against **active** `ClassifiedCategory.code` (e.g. `ATM_MISMATCH`). **No "Other" typed-value escape hatch on the import path** — unlike manual registration, an import row's category must resolve to a real, active category or the row errors; there is no equivalent of typing a free-text category value into a spreadsheet cell that the importer treats specially. |
| 7 | Title | Title (§1) | No format check beyond presence — not part of the duplicate-detection key (`docs/import.md` §7). |
| 8 | Finding Date (YYYY-MM-DD) | Finding Date (§7) | Must parse as a valid date if present (`new Date(value)`); this is also the value `createdAt` gets backdated to on a successful import (`docs/import.md` §6), so a blank Finding Date on an otherwise-permitted row makes the import moment itself the record's apparent age. |
| 9 | Operation Area | Operation Area (§8) | Must **exactly** match an entry in `Settings.operationAreas` — case-sensitive exact string match, no "Other" typed-value path on import (unlike manual registration, where an admin-permitted typed value is accepted). |
| 10 | Type of Irregularity | Type of Irregularity (§9) | Same exact-match-only rule as Operation Area. |
| 11 | Amount | Amount (§12) | Same rule: finite, `>= 0`. Zero is valid here too. |
| 12 | Currency | Currency (§11) | Exact match against `Settings.currencies`, case-sensitive. |
| 13 | Number of Cases | Number of Cases (§13) | Same rule: integer `>= 1`. |
| 14 | Risk Level | Risk Level (§14) | Exact match against `Settings.riskLevels`. |
| 15 | Priority | Priority (§15) | Exact match against `Settings.priorityLevels`. |
| 16 | Description | Description (§16) | Presence only, when required. |
| 17 | Recommendation | Recommendation (§18) | Presence only, when required — **and required by default on import**, contradicting the in-app `ImportGuide.tsx`'s own labeling of it as "never required" (a known, documented discrepancy, see `docs/import.md` §10). |
| 18 | Evidence Note | Evidence Note (§19) | Presence only, when required — same default-required gotcha as Recommendation. **No file attachment is possible via import at all** — this column is text-only, same limitation as the manual form's own Evidence Note field. |

For every column above, "required" resolves through the identical `Settings.requiredFindingFields`
admin policy the manual form uses (`docs/registration-fields.md`'s summary table) — a bank only
configures this once and both paths honor it identically.

---

## 19. Status

**What it is**: a required text column, one of three literal (case-insensitive) values —
`SENT_TO_BRANCH_MANAGER`, `TRANSFERRED`, or `CLOSED`.

**Why it exists**: this column has no equivalent on the manual form because a manually-registered
finding always starts life as `DRAFT` and progresses through live review — there is nothing to declare
up front. A **bulk-imported** finding, by contrast, is backfilling a record whose outcome is already
known (it predates this system), so the importer must state where that history ends: still waiting on
the branch (`SENT_TO_BRANCH_MANAGER`), already carried into a later period (`TRANSFERRED`), or already
fully resolved (`CLOSED`). This one column is what drives the entire "fast-forward" transition sequence
described in `docs/import.md` §6 — every imported row is walked through the real
`transitionFinding()`/`transferFinding()` machinery up to this declared resting state, never given a
bare status assignment.

**Allowed**: `SENT_TO_BRANCH_MANAGER`, `TRANSFERRED`, `CLOSED` — matched case-insensitively
(`import.ts:383-391`).

**Not allowed**: any other value, including any of the app's other live-workflow statuses (`DRAFT`,
`DISTRICT_REVIEW`, `PARTIALLY_RECTIFIED`, `RECTIFICATION_RETURNED`, etc.) — none of those represent a
stable "already resolved" resting point a historical backfill could land on. Error: `Invalid status
"<raw>" - must be one of SENT_TO_BRANCH_MANAGER, TRANSFERRED, CLOSED`. Blank → caught by the general
required-field-presence rule, same error shape as any other missing required column.

---

## 20. Rectified Cases & 21. Rectified Amount

**What they are**: two numeric columns, only ever read when Status = `TRANSFERRED`.

**Why they exist**: mirror `docs/registration-fields.md` §20's itemized-case rationale, generalized to
the whole finding rather than per-case — a historical finding being backfilled as still-outstanding
(carried into a new period) may already have had **some** progress recorded against it before it left
its original period. These two columns are how the importer declares that partial progress, matching
the same `rectifiedCases`/`rectifiedAmount` counters a live rectification entry would produce
(`docs/rectification.md` §4.1).

**Allowed**: blank defaults both to `0`. Rectified Cases must be an integer with `0 <= n <= caseCount`
(column 13); Rectified Amount must be finite with `0 <= n <= amount` (column 11)
(`import.ts:510-551`).

**Not allowed, and why each rule exists** — this is the bulk-import equivalent of the rectify
endpoint's own exhaustion rule (`docs/rectification.md` §3), applied once at import time instead of
incrementally across multiple entries:
- Rectified Cases outside `[0, caseCount]` → `Invalid rectified cases "<value>" - must be a whole number
  from 0 to <caseCount>`.
- Rectified Amount outside `[0, amount]` → `Invalid rectified amount "<value>" - must be from 0 to
  <amount>`.
- **Both equal the full case count and full amount** → rejected outright: `Rectified cases and amount
  can't equal the full finding (<caseCount> / <amount>) - nothing would be outstanding to transfer; use
  CLOSED instead`. A fully-resolved finding has no outstanding balance left to transfer — that's what
  Status = `CLOSED` is for.
- **Rectified Cases equals the full case count but Rectified Amount doesn't** → `Rectified cases equals
  the full case count (<n>) - rectified amount must equal the full amount (<n>) too` — the same
  anti-orphaning logic as the live rectify exhaustion rule: claiming every case is done while leaving
  money unaccounted for makes no sense on a non-itemized finding.
- **The symmetric case** (Rectified Amount full, Rectified Cases not) → the mirror error.
- **Zero and zero is explicitly valid** for a `TRANSFERRED` row — a finding can legitimately transfer
  having had no progress recorded at all before it left its original period.

**Not read from the file at all when Status = `CLOSED`**: both are silently forced to the full
`caseCount`/`amount` regardless of what (if anything) the columns contain (`import.ts:552-555`) — `CLOSED`
always implies full resolution by definition, so there's nothing left for these two columns to add.

---

## 22. Transferred To Period Code

**What it is**: a period-code column, **required if and only if** Status = `TRANSFERRED`.

**Why it exists**: has no manual-registration equivalent because a live transfer is its own separate
action (`POST /api/findings/[id]/transfer`) performed against an already-existing finding, not something
chosen at registration time. A bulk-imported row declaring itself already-transferred needs to state
both ends of that transfer in one shot: column 3 (Reporting Period Code) is where it started, this
column is where it ended up.

**Allowed**: any existing period code that (a) differs from column 3's origin period, and (b) currently
has `status === "OPEN"`.

**Not allowed**: blank when Status = `TRANSFERRED` → `Status "TRANSFERRED" requires Transferred To
Period Code`; a code that doesn't match any period → `Unknown reporting period code "<code>"`; the same
code as the origin period → `Transferred To Period Code must differ from Reporting Period Code`; a
destination period that isn't `OPEN` (e.g. already locked) → `Transferred To Period "<code>" must be
open` (`import.ts:421-440`). Entirely ignored (never read) for any row whose Status isn't `TRANSFERRED`.

---

## 23. External Reference

**What it is**: a free-text column, always optional, never validated.

**Why it exists**: the one column with a direct BRD citation of its own, distinct from every other
field's rationale: `master.txt` §22, *"Preserve historical source and identifiers where available"* —
the source system's own id/tracking number for this finding (e.g. a legacy Internal Audit reference), so
an institution migrating historical records into this system doesn't lose the ability to cross-reference
back to whatever they were tracking finding identity with before. This is stored in
`Finding.externalReference` (`src/types/index.ts:584-589`) and is **never** touched by manual
registration at all — there is no such field on the Register Finding form; it exists purely as an
import-time provenance marker.

**Allowed**: any text, or blank.

**Not allowed**: nothing — this column has no rejection rule of any kind. It is also **never part of the
duplicate-detection key** (`docs/import.md` §7) and is never used for reference-number generation
(`docs/import.md` §6) — `Finding.reference` is always system-generated, independent of whatever this
column contains.

---

## Column-by-column summary table

| # | Column | Always required? | Exact-match only (no "Other")? | Has a manual-registration equivalent? |
|---|---|---|---|---|
| 1 | District Code | Yes | Yes | Yes — District |
| 2 | Branch Code | Yes | Yes | Yes — Branch |
| 3 | Reporting Period Code | Yes | Yes | Yes — Reporting Period |
| 4 | Source Code | Admin setting | Yes | Yes — Source |
| 5 | Department Code | Admin setting | Yes | Yes — Department |
| 6 | Classified Category Code | Admin setting | **Yes — no "Other" on import** | Yes — Classified Case (which *does* allow "Other") |
| 7 | Title | Admin setting | N/A (free text) | Yes — Title |
| 8 | Finding Date | Admin setting | N/A (date) | Yes — Finding Date |
| 9 | Operation Area | Admin setting | **Yes — no "Other" on import** | Yes — Operation Area (which *does* allow "Other") |
| 10 | Type of Irregularity | Admin setting | **Yes — no "Other" on import** | Yes — Type of Irregularity (which *does* allow "Other") |
| 11 | Amount | Yes | N/A (number) | Yes — Amount |
| 12 | Currency | Admin setting | **Yes — no "Other" on import** | Yes — Currency (which *does* allow "Other") |
| 13 | Number of Cases | Yes | N/A (number) | Yes — Number of Cases |
| 14 | Risk Level | Admin setting | **Yes — no "Other" on import** | Yes — Risk Level (which *does* allow "Other") |
| 15 | Priority | Admin setting | **Yes — no "Other" on import** | Yes — Priority (which *does* allow "Other") |
| 16 | Description | Admin setting | N/A (free text) | Yes — Description |
| 17 | Recommendation | **Admin setting, defaults true** | N/A (free text) | Yes — Recommendation |
| 18 | Evidence Note | **Admin setting, defaults true** | N/A (free text) | Yes — Evidence Note |
| 19 | Status | Yes | Yes (3 literal values) | **No — import-only** |
| 20 | Rectified Cases | Status-conditional | N/A (number) | **No — import-only** |
| 21 | Rectified Amount | Status-conditional | N/A (number) | **No — import-only** |
| 22 | Transferred To Period Code | Status-conditional | Yes | **No — import-only** |
| 23 | External Reference | Never | N/A (free text) | **No — import-only** |

**Not present on the import template at all**: `Root Cause` — despite being one of the admin-configurable
`REQUIRABLE_FINDING_FIELDS`, there is no import column for it whatsoever (`import.ts:100-102`, a gap the
code itself calls out explicitly). A required/optional toggle for Root Cause has nothing to affect on
this path; it can only ever be added to an imported finding afterward, from the finding's own detail
page. **Itemized case amounts** (registration §20) are likewise entirely absent from bulk import — every
imported finding is created in the plain, non-itemized shape regardless of `Number of Cases`
(`ImportGuide.tsx:198-201`).
