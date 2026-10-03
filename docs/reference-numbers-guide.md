# Finding Reference Numbers: How They Are Given

Every finding gets a reference number such as **`B001-2026-10-00003`**. This guide explains how the number is chosen when a finding is **registered by hand** or **imported from Excel**, and what happens to it when a finding is **edited, transferred, deleted, or removed by reversing an import**. In short: a finding gets the **lowest free number** in its branch + period, and any finding that's removed frees its number.

## 1. What the number is made of

```
B001 - 2026-10 - 00003
 │        │        └── sequence number: 5 digits, counted separately for each branch + period
 │        └─────────── reporting period code (the period the finding was registered / imported in)
 └──────────────────── branch code
```

- Each **branch + period** pair has its own sequence: `B001-2026-10-…` and `B002-2026-10-…` both start at `00001`.
- Above 99999 the number simply gets longer (`100000`); it never wraps around.
- The number is **unique in the whole system**. The database refuses a second finding with the same number.

## 2. The one rule: lowest free number

When a finding needs a number, the system looks at its branch + period and takes the **lowest number from 00001 upward that is free**.

A number is **not free** only when a finding **exists** with that number, in any status: draft, in review, closed, transferred and so on.

Every other number is free, including the numbers of findings that were **deleted by hand** (§5) or **removed by reversing an import** (§6). The audit log keeps every removed finding's number and details, so nothing is lost.

**Example:** in Bole (B001), 2026-10:

| Existing numbers | Next new finding gets |
|---|---|
| none (also when all earlier findings were deleted or reversed) | `00001` |
| 00001, 00002, 00003 | `00004` |
| 00001, 00003 (00002 was deleted or reversed) | **`00002`** (the gap is filled) |

The same rule is used everywhere. Code: `nextFindingReference()` in `src/lib/findings.ts`.

## 3. Registering a finding by hand

**Findings → Register Finding**

- **When the number is given:** when the finding is first saved, whether as **Save Draft** or **Save & Submit**. A draft already has its final number.
- **Which period:** the **Reporting period** chosen in the form. The **branch** is the one chosen, or your own branch if you're a branch user.
- **Number:** the lowest free number for that branch + period (§2).
- **It never changes** through the workflow (submit, review, approve, rectify, close, reverse), except in the edit case below.

### Editing a draft or returned finding

Only the registrant can edit, and only while the finding is a Draft or Returned.

| What you change | Reference number |
|---|---|
| Anything except branch / period | **Unchanged** |
| The **branch** or the **reporting period** | **A new number is given** for the new branch + period (lowest free there). The old number becomes free again in its old branch + period. |

Example: draft `B001-2026-10-00002` moved to period 2026-09, where 00001–00004 exist → it becomes `B001-2026-09-00005`. In 2026-10, `00002` is free again for the next finding.

## 4. Importing findings from Excel

**Findings → Import**

Each imported row is numbered with **the same rule** as a manual registration (§2), using the row's **Branch Code** and **Reporting Period Code**.

- **Order:** rows are numbered **top to bottom** in the file. Each imported row takes its number before the next row is processed, so two rows for the same branch + period get consecutive numbers and never collide.
  - Example: 2026-10 already has 00001 and 00003, and the file has three rows for B001 / 2026-10. They get **00002, 00004, 00005**: the first row fills the gap.
- **Imported and manual findings share the sequence.** An imported finding and a registered one in the same branch + period never get the same number.
- **TRANSFERRED rows:** the number uses the row's **Reporting Period Code**, the period the finding *started* in, not the *Transferred To* period. This matches a live transfer, which never changes a finding's number. Example: a row with Reporting Period 2026-09, Transferred To 2026-10 → `B001-2026-09-000NN`.
- **Only imported rows get a number.** Rows with errors are not imported and use no number. Rows flagged as possible duplicates get one only if the importer chooses **Import anyway**.
- **Preview / duplicate check:** before importing, the system does a trial run on a copy, to find errors and duplicates. Numbers shown or used in that trial are **not** kept. The real numbers are given when the import actually runs, by the same rule. If someone registers a finding in between, the import simply takes the next free numbers.
- **Import History:** each row's number appears in the import's history and results file.

## 5. Deleting a finding by hand

Who can delete what is set by permissions; see `docs/permissions-clarified.md`.

| Status when deleted | Who | What happens to its number |
|---|---|---|
| **Draft** | the registrant | **Free again**: the next new finding in that branch + period gets it |
| **Returned** | the registrant | **Free again** |
| **Rejected** | holders of *Delete Rejected* | **Free again** |

- The deleted finding, its workflow history and itemized cases are removed. The **audit log keeps a DELETE entry** with the full finding, including its old number, so the history is never lost.
- "Free again" means the **lowest-free-number rule** (§2) will give it out. The next finding registered *or imported* in that branch + period takes it if it's the lowest gap.

**Example:** 00001, 00002, 00003 exist in B001 / 2026-10. You delete 00002 (draft, returned or rejected). The next finding registered or imported there gets **00002**, and the one after that **00004**.

## 6. Reversing an Excel import

**Findings → Import → Import History → Reverse** (permission: *Reverse an Import*)

Reversing removes **every finding the import created** and everything recorded against them since.

| Choice | What happens to the import record | Numbers of the removed findings |
|---|---|---|
| **Reverse import** | kept in Import History, marked *Reversed* | **Free again** |
| **Reverse and delete record** | removed from Import History (the audit log keeps the list) | **Free again** |
| **Delete record** (of an import already reversed) | removed from Import History (the audit log keeps the list) | **Free again** |

The import's history and the audit log still show which numbers its findings had.

### Re-importing a reversed import, or importing the same file again

Whether you use **Import History → Re-import** or upload the file again, the findings are numbered by the normal rule (§2). If nothing else took those numbers in the meantime, they **get the same numbers back**.

Example: an import created 00001–00003 and was reversed. Importing the same 3 rows again gives **00001, 00002, 00003**. If a draft took 00001 in between, the 3 rows get **00002, 00003, 00004**.

**Testing tip:** importing and reversing a test file any number of times never "uses up" numbers. On an empty branch + period, the next import always starts at 00001.

## 7. Things that never change a number

- Submitting, reviewing, approving, returning, rejecting
- Recording / verifying / returning a rectification, closing
- **Transferring** to another period, forward or back, manually or automatically when a period is locked. A transferred finding keeps its number, including the original period's code.
- **Reverse** (undoing what was closed in the current period)
- Locking / unlocking the period

## 8. Quick reference

| Event | Number |
|---|---|
| Register (Save Draft or Save & Submit) | Lowest free for the chosen branch + period |
| Import a row | Lowest free for the row's branch + Reporting Period, rows in file order |
| Import a TRANSFERRED row | Uses the **Reporting Period** (where it started), not Transferred To |
| Edit a draft / returned finding, branch or period **unchanged** | Unchanged |
| Edit a draft / returned finding, branch or period **changed** | New number for the new branch + period; old one freed |
| Transfer / workflow actions / reverse | Unchanged |
| Delete a Draft / Returned / Rejected finding | **Freed**: reused by the next new finding (lowest gap first) |
| Reverse an import (with or without deleting its record) | **Freed**: reused by the next new finding |
| Re-import a reversed import | Normal rule: usually the same numbers again |

## 9. Technical notes

- Generator: `nextFindingReference(db, branch, period)` in `src/lib/findings.ts`. It collects the numbers of existing findings with the `<branch>-<period>-` prefix and returns the lowest positive number not in that set, zero-padded to 5 digits.
- Uniqueness: `Finding.reference` is `@unique` in the database. If two people save at exactly the same moment and would get the same number, the second save is refused with *"A record with the same unique value already exists."* and simply needs to be saved again.
- Where it's called: register (`POST /api/findings`), edit with a branch/period change (`PATCH /api/findings/[id]`), import rows (`validateImportRow()` in `src/lib/import.ts`).
- Tests: `tests/importReferenceNumbers.test.ts` (every import rule in §4-§6, run through the real import, reverse, re-import, delete-record and delete-finding code) and `tests/openPeriodDrafts.test.ts` (manual registration: gap filling, deleted draft / returned / rejected reuse).
- See also: `docs/REFERENCE_ID.md` (design history and capacity), `docs/import.md`, `docs/permissions-clarified.md` (Reverse an Import).
