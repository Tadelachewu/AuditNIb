# Registration Form — Field-by-Field Reference

Every field on the Register Finding form (`src/components/findings/NewFindingForm.tsx`), one dedicated
section each: **what it is**, **why it exists** (traced to the BRD where a direct citation exists, and
honestly flagged as an application-level addition where it doesn't), **what's allowed**, and **what's
rejected and why**. `docs/registration.md` covers the mechanism of registration end-to-end (reference
numbers, bank-scope routing, draft autosave); this document is the single place to look up one specific
field in isolation.

BRD citations reference `AuditDocs/master.txt` §6 "Finding Data Requirements" and `AuditDocs/icfms.txt`
§9 "Business Rules" — both plain-text extractions of the original PDF specs. Where the PDF's table
formatting garbled a row's alignment (a known artifact of PDF-to-text extraction on multi-column tables),
that's noted rather than silently "corrected" by guessing.

Every allow/reject rule below is cited `file:line`; every rule is enforced **both** client-side (HTML5
constraint or one JS check) **and** independently server-side in `POST /api/findings` — the client layer
is convenience only, per this codebase's standing rule that UI scope is never a security boundary.

---

## 1. Title

**What it is**: a short, free-text `Input` (`NewFindingForm.tsx:557` area).

**Why it exists**: not a distinct row in the BRD's Finding Data Requirements table — an
application-level addition. Its job is to be the short, human-readable label shown everywhere a finding
is listed in summary form (the Findings table, notification titles, dashboards' recent-activity feed) —
the system-generated `reference` (e.g. `BR01-2026-09-00007`) is unique and traceable but not something a
person can parse at a glance.

**Allowed**: any non-empty string, no length cap in the schema (`z.string().optional()` at the
structural layer, `route.ts:51`).

**Not allowed**: blank, **only if** the admin has `Settings.requiredFindingFields.title = true`
(the default) — rejected by `assertRequiredFindingFieldsPresent()` (`route.ts:98-114`). An admin can
opt this field out entirely, in which case a blank title is accepted and stored as `""`.

---

## 2. Source

**What it is**: a `Select` populated from every currently **active** `Source` record, sorted A–Z.

**Why it exists**: directly BRD-mandated. `master.txt` §6: *"Finding Source — Yes — Internal Control,
Internal Audit and future configurable sources."* `icfms.txt` §9 is more specific: *"The system shall
support two finding sources: Internal Control, Internal Audit... Internal Audit findings will initially
be entered into the system by Head Office Internal Controllers until direct integration is
implemented."* Source is a classification/report-filter dimension (`master.txt`'s "Common filters"
list includes Finding Source) — it is **not** itself what routes a finding through district/HO review
vs. straight to bank approval; that routing is driven by the *submitting user's own session org scope*
(`registeredByBankScope`, see `docs/registration.md` §4), independent of which Source is picked. An HO
Controller could in principle log a finding with Source = "Internal Control" while still being
bank-scoped — Source and routing are related in practice (HO logs Internal Audit findings) but not
mechanically coupled in code.

**Allowed**: any active `Source.id` from the dropdown.

**Not allowed**: an inactive or nonexistent source id → `400` (`route.ts:169-171`, "is active" check,
only run if the value is non-blank). Required unless the admin opts it out
(`Settings.requiredFindingFields.sourceId`).

---

## 3. Department

**What it is**: a `Select` filtered client-side to bank-wide departments plus whatever's scoped to the
currently-chosen district/branch (`departmentOptions`, `NewFindingForm.tsx:474-485`).

**Why it exists**: not a distinct row in the BRD's field table — an organizational classification axis
this app adds on top of the BRD minimum, letting a finding be attributed to a specific department (e.g.
Operations, IT) independent of which branch/district it belongs to, for department-level filtering and
reporting.

**Allowed**: any department that is (a) active, and (b) in scope for the finding's district/branch —
bank-wide departments always qualify; a district-scoped department only for a finding in that exact
district; a branch-scoped department only for a finding at that exact branch (`isDepartmentInScope()`,
`src/lib/org.ts:141-145`, re-checked server-side at `route.ts:172-183` after the client's own filtering).

**Not allowed**: an inactive department, or one out of scope for the chosen district/branch → `400`
(`route.ts:172-183`). Required unless opted out (`Settings.requiredFindingFields.departmentId`) —
**deliberately never pre-selected even when exactly one option exists**, since "which department is even
valid depends on the district/branch chosen below it" (`NewFindingForm.tsx:302-306` comment).

---

## 4. Reporting Period

**What it is**: a `Select` of periods eligible for at least a draft — `OPEN` periods, or `LOCKED`
periods with `draftsAllowedWhileLocked` set (`new/page.tsx:25-30`); a fully-locked period never appears.

**Why it exists**: BRD `master.txt` §6: *"Reporting Month/Period — Yes — Controlled reporting period."*
This is one of the five fields the codebase treats as structural rather than descriptive
(`REQUIRABLE_FINDING_FIELDS`'s own doc comment, `src/types/index.ts:277-298`): every dashboard, report,
period-lock check, and the entire Transfer Engine filters by `Finding.periodId` — a finding with none
would be invisible everywhere and unreachable by any of those mechanisms. This is **never**
admin-optional, unlike every field above it.

**Allowed**: any period id that currently exists and is writable per the rule above.

**Not allowed**: blank (`z.string().min(1, "Reporting period is required")`, `route.ts:54`); a period
that's fully `LOCKED` with drafts disallowed → `409` (`route.ts:141-154`); if submitting immediately,
the period must also currently be inside its own submission window
(`assertPeriodOpenForSubmission()`, `route.ts:35-36`, `src/lib/findings.ts:473-502`) — a narrower,
independent check than merely "not locked."

---

## 5. District & 6. Branch

**What they are**: paired `Select`s (District first, Branch filtered to the chosen district), or —
for a session already fixed to one org unit — locked, non-editable labels instead of dropdowns at all.

**Why they exist**: BRD `master.txt` §6: *"District / Branch — Yes — Validated against organizational
scope."* These are the other two of the five structural fields (`REQUIRABLE_FINDING_FIELDS`'s doc
comment): not descriptive content a registrant fills in, but the **identity of whose data this is** —
`assertFindingInScope()`/`findingsInScope()` key off exactly these two fields for every permission check
in the app. Leaving either blank would break the org-scope boundary every dashboard and permission check
relies on.

**Allowed / who can set what** (full detail in `docs/registration.md` §10):
- A `BRANCH`-scoped registrant never sees these as editable fields at all — both are forced from their
  own session (`route.ts:118-123`).
- A `DISTRICT`-scoped registrant must supply both; the branch must belong to the chosen district, and the
  district must equal their own session district (`route.ts:128-135`) — any branch **within** their own
  district, never another district.
- A `BANK`-scoped registrant (HO Controller, Admin) may pick any active district/branch bank-wide, with
  only the branch-belongs-to-district consistency check applied (`route.ts:128-131`) — this is the exact
  mechanism that later sets `registeredByBankScope: true` on submit.

**Not allowed**: a branch that doesn't belong to the stated district → `400`; a district outside a
DISTRICT-scoped user's own assignment → `400`; either left genuinely blank for a non-branch-fixed session
→ `400` (`route.ts:116-138`). Only `ACTIVE`-status districts/branches are ever offered in the dropdown
(`new/page.tsx:31-32`).

---

## 7. Finding Date

**What it is**: a `type="date"` input, defaulting to today's date.

**Why it exists**: BRD `master.txt` §6, "Finding Date — Yes — Date identified" — the date the
irregularity was actually **discovered/occurred**, distinct from `createdAt` (when the record was
entered into the system, which can lag the real finding date, especially for a bulk-imported historical
record). This date drives case-age calculations (`caseAgeDays()`) used in reports and dashboards, and —
specifically for bulk import — is the value `createdAt` gets backdated to (see `docs/import.md` §6),
so age-based metrics reflect the record's real history rather than the moment it was keyed in.

**Allowed**: any parseable date string.

**Not allowed**: blank, unless the admin opts the field out (`Settings.requiredFindingFields.findingDate`).
No format validation beyond required-ness at the manual-registration layer (the browser's native date
picker constrains the format); bulk import applies a stricter `new Date(value)`-parses check (see
`docs/import-fields.md`).

---

## 8. Operation Area & 9. Type of Irregularity

**What they are**: `SelectOrOther` controls over `Settings.operationAreas` / `Settings.irregularityTypes`
respectively — admin-configurable string lists, each with an optional "Other (type in)" escape hatch.

**Why they exist**: BRD `master.txt` §6 lists both as required fields with the notes *"Process/area
involved"* (Operation Area) and *"Detailed issue type"* (Type of Irregularity) — the extracted PDF
table's row alignment is imperfect around this section (a known multi-column-table extraction artifact),
so the specific example values in that row of the source text are not reliably attributable to one field
or the other; the two short descriptive phrases above are the reliably-aligned part. In practice:
Operation Area names *where* in branch operations the issue was found (e.g. "Teller Counter," "ATM
Operations"); Type of Irregularity names *what kind* of issue it was (e.g. "Cash Shortage").

**Allowed**: any value currently in the admin's configured list; if `Settings.allowOtherValueFields`
permits it for this field, a freely-typed value not currently on the list.

**Not allowed**: blank, unless opted out. There is no format restriction on a typed "Other" value beyond
non-blank — unlike Classified Case (§10 below), neither of these fields has a backing record to preserve
referential integrity for, so a typed value is simply stored as plain text either way.

---

## 10. Classified Case (Category)

**What it is**: `CategorySelectOrOther` over every active `ClassifiedCategory`, id-valued when a real
category is chosen.

**Why it exists**: this is the field with the strongest, most consequential BRD grounding of any on the
form. `icfms.txt` §9: *"Internal Control performance is initially calculated using findings classified
as Other Cases. ATM, IT, Dormant, and Zero Balance findings shall be reported separately and stored for
future inclusion in scoring."* `master.txt` names the same set: *Dormant Account; Zero Balance; CK Book;
Other Case* (plus ATM Mismatch, ATM Long Outstanding, IT — the full 7-category set the app ships with,
`REPORT_CATEGORY_ORDER` in `src/lib/reportTemplates.ts:53`, documented in `docs/report-templates.md`
§8). This field is what actually determines whether a finding counts toward the district's **official
scored performance** (the "Other Case" category, gated through `ScoringRule` + `computeEligibleCaseCounts()`)
or is tracked and reported separately without affecting the score — the single most consequential
classification choice on the entire form.

**Allowed**: any active `ClassifiedCategory.id`; **or**, if `Settings.allowOtherValueFields.categoryId`
permits it, a freely-typed value — stored as **plain text directly in `Finding.categoryId`**, with no
backing `ClassifiedCategory` record at all (`src/types/index.ts:330-337`; the DB column isn't even a
real foreign key, `prisma/schema.prisma:408-420`, specifically to never block registration on the
admin's list being incomplete).

**Not allowed**: blank, unless opted out. An inactive or nonexistent category id (when it *is* meant to
resolve to a real record) → `400` — but this check is **skipped entirely** when the value doesn't
resolve to a real category id at all, i.e. a typed "Other" value is exempt by design (`route.ts:184-191`).

**The tradeoff, stated plainly**: a typed "Other" category value will never match any `ScoringRule`'s
category list, and will never group correctly into category-based reports/dashboards beyond appearing as
its own ad-hoc text bucket. This is a deliberate cost accepted in exchange for never hard-blocking
registration.

---

## 11. Currency

**What it is**: `SelectOrOther` over `Settings.currencies`.

**Why it exists**: BRD `master.txt` §6 groups Amount and Currency together as *"Amount / Currency —
Conditional — Financial details"* — notably the **only** field in the BRD's own required-column marked
"Conditional" rather than a flat "Yes," which lines up with this being the one descriptive field the app
lets an admin make fully optional even though it looks like it should always travel with a nonzero
amount.

**Allowed**: any configured currency code, or a typed one if the admin allows it.

**Not allowed**: blank, unless the admin has specifically turned off
`Settings.requiredFindingFields.currency`. **If it is turned off**, a finding can be registered with a
nonzero `amount` and a genuinely blank `currency` — nothing in the create or submit path cross-checks
that `currency` is set whenever `amount > 0`; the two fields validate completely independently
(`docs/registration.md` §11).

---

## 12. Amount

**What it is**: a `type="number"` input, `min="0" step="0.01"`.

**Why it exists**: BRD-grounded (paired with Currency above, *"Financial details"*) — the monetary
exposure of the finding, the figure every performance percentage, rectification entry, verification, and
closure arithmetic ultimately sums. One of the five structural fields (`REQUIRABLE_FINDING_FIELDS`'s doc
comment) — a finding fundamentally represents "N cases worth some amount," so unlike a narrative field it
has no coherent blank state.

**Allowed**: any number **`>= 0`** — `z.number().nonnegative()` (`route.ts:61`). **Zero is a fully valid
amount** — a finding can represent a procedural/documentation issue with no monetary shortage at all.
This was specifically verified and fixed for during this project's development so that a zero-amount
finding can still be partially rectified case-by-case rather than being forced into an all-or-nothing
rectification (see `docs/rectification.md` §7 for the exact mechanism).

**Not allowed**: negative, or non-numeric. No upper bound anywhere in the schema.

---

## 13. Number of Cases

**What it is**: a `type="number"` input, `min="1" step="1"`.

**Why it exists**: BRD `master.txt` §7 "Partial Rectification Rules" is built entirely around this field
— *"A finding may represent multiple similar cases with a combined amount"*, with the worked example of
3 cases totaling ETB 45,000, later partially rectified to 1 case / ETB 10,000 resolved, 2 cases / ETB
35,000 still outstanding. This field is the entire basis for the app's case-count-vs-amount rectification
machinery (`docs/rectification.md`).

**Allowed**: any positive integer, **`>= 1`** — `z.number().int().positive()` (`route.ts:63`,
error: *"Number of cases must be at least 1"*).

**Not allowed**: `0` or a non-integer, unlike Amount, which explicitly allows `0` — a finding must
represent at least one real case, but that one case is allowed to be worth nothing in `amount`. No
upper bound in the schema, though the itemized-case-amounts array (§17) is capped at 500 entries.

---

## 14. Risk Level

**What it is**: `SelectOrOther` over `Settings.riskLevels`, **kept in the admin's configured severity
order rather than alphabetically sorted** (`NewFindingForm.tsx:455-459` comment) — so "Low → Medium →
High → Critical" reads correctly rather than "Critical, High, Low, Medium."

**Why it exists**: BRD `master.txt` §6, directly: *"Risk Level — Yes — Low/Medium/High/Critical."* Drives
the risk-distribution widgets on every dashboard (`docs/dashboard.md`).

**Allowed**: any configured risk-level string, in the admin's own order; a typed value if allowed.

**Not allowed**: blank, unless opted out.

---

## 15. Priority

**What it is**: `SelectOrOther` over `Settings.priorityLevels`, same ordering treatment as Risk Level.

**Why it exists**: **not** a distinct row in the BRD's Finding Data Requirements table (only Risk Level
is listed there) — this is an application-level addition, distinguishing "how severe is this" (Risk
Level) from "how urgently should it be acted on" (Priority), two related but not identical dimensions a
bank might reasonably want to track separately even though only one was BRD-mandated.

**Allowed / not allowed**: identical shape to Risk Level — any configured value or typed "Other" if
allowed; blank only if opted out.

---

## 16. Description

**What it is**: a 3-row `Textarea`.

**Why it exists**: BRD `master.txt` §6, *"Description — Yes — Finding narrative"* — the actual narrative
of what happened, the core content a District/HO reviewer reads to understand the finding at all.

**Allowed**: any free text, no length cap in the schema.

**Not allowed**: blank, unless opted out.

---

## 17. Root Cause

**What it is**: a 2-row `Textarea`, placeholder *"Why did this happen? - distinct from the description
of what happened"* (`NewFindingForm.tsx:826`).

**Why it exists**: **not** its own row in the BRD table — an application-level addition for audit rigor,
separating "what happened" (Description) from "why it happened" (Root Cause), a standard internal-audit
practice not explicitly called out as a distinct BRD field but a natural extension of one.

**Allowed**: any free text.

**Not allowed**: blank, only if the admin requires it (`Settings.requiredFindingFields.rootCause`) —
**optional by default**, unlike Description.

---

## 18. Recommendation

**What it is**: a 2-row `Textarea`.

**Why it exists**: BRD `master.txt` §6, *"Recommendation — Optional — Corrective recommendation"* — the
suggested fix, explicitly marked optional in the source spec itself (one of the few fields the BRD
itself, not just this app's admin policy, calls optional).

**Allowed**: any free text.

**Not allowed**: blank, only if the admin has specifically turned this field's default-optional status
into required (`Settings.requiredFindingFields.recommendation`).

---

## 19. Evidence Note

**What it is**: a plain text `Input`, placeholder *"e.g. filed in branch cabinet, ref #4 - no file
upload yet"* (`NewFindingForm.tsx:846`).

**Why it exists**: BRD `icfms.txt` §9, directly: *"Evidence upload is optional. Verification may rely on
physical inspection, documentary evidence, or both."* This field is the **textual pointer** to where
physical/documentary evidence actually lives — it does not itself carry a file. Real file attachment is
a separate, separately-permissioned feature (`findings.evidence`) reachable only after the finding
already exists (`docs/platform-and-access.md` §4) — so a registrant can (and per the BRD, legitimately
may) describe evidence that was verified physically, without ever uploading a scan.

**Allowed**: any free text.

**Not allowed**: blank, only if the admin requires it — **can be made required even though there's
nowhere on this same form to attach an actual file**, a known gotcha documented in `docs/registration.md`
§11.

---

## 20. Itemized Case Amounts (optional per-case breakdown)

**What it is**: a checkbox ("Track individual case amounts") revealing one number input per case,
shown only in create mode when Number of Cases `> 1` (`NewFindingForm.tsx:770`).

**Why it exists**: this is the direct implementation of BRD `master.txt` §7's own worked example —
*"three similar cases of ETB 15,000 + ETB 10,000 + ETB 20,000 = ETB 45,000. If only the ETB 10,000 case
is corrected, record 1 rectified case/ETB 10,000 and 2 outstanding cases/ETB 35,000."* Without
itemization, a finding only tracks aggregate `caseCount`/`amount` — rectifying "the ETB 10,000 case
specifically" is only a real, stored fact if each case has its own amount to select against. Itemizing
creates one `FindingCase` row per case (`status: "OUTSTANDING"` initially), which is what later lets a
rectification target specific cases by checkbox instead of typing a count/amount pair that merely
happens to add up (`docs/rectification.md` §2).

**Allowed**: one number per case, each `>= 0`; must sum, within a `±0.01` floating-point tolerance, to
the finding's own `amount` field (`caseAmountsMatch`, `NewFindingForm.tsx:334-335`, re-checked
server-side at `route.ts:192-206`). Capped at 500 entries (`z.array(...).max(500)`, `route.ts:76`,
matching the client's own `setCaseCount()` clamp).

**Not allowed**: a per-case sum that doesn't match `amount` within tolerance — blocked client-side before
the request is even sent (*"Case breakdown must add up to the amount involved before saving"*,
`NewFindingForm.tsx:489-492`) and re-verified server-side regardless. **This is a create-time-only,
one-way decision**: once a finding has `FindingCase` rows, no edit can change its `caseCount` or `amount`
without a `409` (`[id]/route.ts:194-209`) — there is no UI to re-itemize an already-itemized finding, or
to itemize a non-itemized one after the fact.

---

## Field-by-field summary table

| Field | BRD-grounded? | Structural (never optional) | Admin-optional by default? | "Other" typed value allowed? |
|---|---|---|---|---|
| Title | No — app addition | No | No (required by default) | N/A (free text) |
| Source | Yes (`icfms.txt` §9) | No | No | No (real record only) |
| Department | No — app addition | No | No | No (real record only) |
| Reporting Period | Yes (`master.txt` §6) | **Yes** | N/A — never optional | N/A |
| District | Yes (`master.txt` §6) | **Yes** | N/A — never optional | N/A |
| Branch | Yes (`master.txt` §6) | **Yes** | N/A — never optional | N/A |
| Finding Date | Yes (`master.txt` §6) | No | No | N/A (date) |
| Operation Area | Yes (`master.txt` §6) | No | No | If admin allows |
| Type of Irregularity | Yes (`master.txt` §6) | No | No | If admin allows |
| Classified Case | Yes (`icfms.txt` §9, strongest) | No | No | If admin allows — stored as plain text |
| Currency | Yes, marked "Conditional" (`master.txt` §6) | No | No | If admin allows |
| Amount | Yes (`master.txt` §6) | **Yes** | N/A — never optional | N/A (number, 0 allowed) |
| Number of Cases | Yes (`master.txt` §6, §7) | **Yes** | N/A — never optional | N/A (number, 0 NOT allowed) |
| Risk Level | Yes (`master.txt` §6) | No | No | If admin allows |
| Priority | No — app addition | No | No | If admin allows |
| Description | Yes (`master.txt` §6) | No | No | N/A (free text) |
| Root Cause | No — app addition | No | **Yes, optional by default** | N/A (free text) |
| Recommendation | Yes, BRD marks it Optional | No | **Yes, optional by default** | N/A (free text) |
| Evidence Note | Yes (`icfms.txt` §9) | No | No | N/A (free text) |
| Itemized case amounts | Yes (`master.txt` §7 worked example) | No | N/A — opt-in checkbox | N/A |
