# Finding Registration & Edit — Field Validation Rules

Covers every field accepted by:

- `POST /api/findings` — create a new finding (DRAFT, or submit-in-one-call)
- `PATCH /api/findings/[id]` — edit an existing DRAFT/RETURNED finding
- Cross-field invariants (amount + caseCount, reference regeneration, etc.)

Every field below includes:
- **Where validated** — Zod schema line(s), server-side line(s).
- **Type / format / bounds** — allowed values, regex, enum, min/max.
- **Required?** — hard-required vs admin-configurable via
  `Settings.requiredFindingFields`.
- **Why it exists** — business/auditing reason.
- **What's rejected, and the HTTP status / error shape** — so operators
  know whether an error is "fix the data" (400) vs "fix the policy" (403/409).

---

## 0. Before field-level rules: actors & gating

### Create (`POST /api/findings`)
Permission required: `findings.create` — [route.ts#L86](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/route.ts#L86).

Additionally:
- **BRANCH-scoped roles** (Branch Controller, Branch Manager):
  `districtId` / `branchId` are **NOT** read from the body — they are
  forced to the session's own branch.  You literally cannot create a
  finding for another branch even by tampering with the request JSON.
  See [route.ts#L118-L123](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/route.ts#L118-L123).
- **DISTRICT-scoped roles**: you may pick any branch inside *your*
  district.  Attempting to write a districtId that's not your own →
  403 *"Outside your organizational scope"*.
  [route.ts#L133-L135](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/route.ts#L133-L135).
- **BANK-scoped roles** (HO Controller, Admin): any branch.

### Edit (`PATCH /api/findings/[id]`)
Permission: `findings.edit` — same actor scope rules as create, plus:

1.  **Status gate.** Only `DRAFT` and `RETURNED` findings are editable.
    Any other status → 409 *"Only draft or returned findings can be edited."*
    [[route.ts#L105-L107](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/%5Bid%5D/route.ts#L105-L107)]
2.  **Author gate.** `existing.createdBy !== session.userId` → 403
    *"You can only edit findings you registered yourself."* Two people at
    the same branch both pass the org-scope check; this prevents them
    from scribbling on each other's drafts. [[route.ts#L101-L103](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/%5Bid%5D/route.ts#L101-L103)]
3.  **Locked-period gate.** `assertPeriodWritable(db, existing.periodId, existing.status)`:
    LOCKED periods *only* accept DRAFT writes if `draftsAllowedWhileLocked`
    is true; they never accept a submission.  See §0c Period states below.
4.  **Itemized-case guard.** If `FindingCase` rows already exist for this
    finding (the user created it with per-case itemization), you can't
    change `caseCount` or `amount` via PATCH — it would leave stale
    itemized rows that no longer sum.  409 *"This finding's cases are
    itemized…"*.  There's no UI yet to re-itemize on edit; when there
    is, this gate is lifted.  [[route.ts#L199-L209](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/%5Bid%5D/route.ts#L199-L209)]

### Period states (used by both create & edit)

Three boolean checks compose:

| Check | Function | Applies to | Error if fail |
|-------|----------|------------|---------------|
| LOCKED + not draftable | `assertPeriodWritable` | Any non-DRAFT write on a LOCKED period | 409 `${period.code} is locked and cannot accept changes` |
| LOCKED + draftable flag OFF + DRAFT write | `assertPeriodWritable` | Any DRAFT write on a LOCKED period when `draftsAllowedWhileLocked=false` | 409 same as above |
| Submission window | `assertPeriodOpenForSubmission` | Only `POST …?submit=true` (creates + submits in one call) on an OPEN period but outside today's date ∈ [submissionStartsAt, submissionEndsAt] | 409 *"Submissions for <code> are closed"* |

Definitions: [findings.ts#L463-L501](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/findings.ts#L463-L501).

### 0a. Hard vs admin-configurable required fields

A field is either:
- **Hard-required.** Always required, no admin toggle.  Period, district,
  branch, amount, caseCount, submit, caseAmounts.
- **Requirable.** Configurable per-install at **Admin → Settings →
  Required Finding Fields**.  Admin sets the toggle; at runtime
  `assertRequiredFindingFieldsPresent()` walks the
  `REQUIRABLE_FINDING_FIELDS` list from types/index.ts and rejects with
  400 `<label> is required` if the field is blank AND the toggle is on.
  On PATCH the `skipUnset` flag is passed so a missing key in the JSON
  means "leave existing value alone," not "clear it" — an explicit empty
  string sent on a requirable-required field still triggers the error.
  Helper at [findings.ts#L515-L527](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/findings.ts#L515-L527), called at [route.ts create](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/route.ts#L98-L114)
  and [route.ts patch](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/%5Bid%5D/route.ts#L172-L192).

The 13 requirable fields (all plain strings on Finding):
`title, sourceId, departmentId, findingDate, operationArea,
irregularityType, categoryId, currency, riskLevel, priority,
description, recommendation, evidenceNote`.

---

## 1. Field-level rules (create + edit — same rules)

Every field listed here: "schema — `createSchema` / `updateSchema`" line
numbers refer to the Zod blocks at [route.ts#L43-L77](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/route.ts#L43-L77)
and [route.ts#L42-L69](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/%5Bid%5D/route.ts#L42-L69).

---

### F1. `reference` — not a user field

**System-only.** Generated by `nextFindingReference()` from branch code +
period code + max(seq)+1.  5-digit pad (00001 .. 99999 per branch-period
pair, naturally grows after).  **Never** sent in create/edit bodies.

**Regenerated on edit when:** `branchId` or `periodId` is changed via
PATCH.  `referenceNeedsRegeneration` check at
[route.ts#L211-L223](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/%5Bid%5D/route.ts#L211-L223).  The old reference is not kept as a row, but all
prior `AuditLogEntry.oldValue.reference` / `FindingTransitions` snapshots
retain it so the chain is auditable.

**Why:** every (branch, period) pair has a human-scannable monotonic
sequence for month-end reports; branch managers / auditors reference the
code verbally and in papers — not a UUID.

See **[REFERENCE_ID.md](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/REFERENCE_ID.md)** for full rules, collision behavior, and
overflow-capacity analysis.

---

### F2. `periodId` — UUID

| | |
|---|---|
| Schema | `.string().min(1, "Reporting period is required")` create; `.string().min(1).optional()` patch |
| Required | **Hard.** Never part of the admin toggle. |
| Server lookup | Must resolve to a real `ReportingPeriod.id`. Period code missing / not found → 400 *"Selected reporting period does not exist"*. [[create](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/route.ts#L141-L142) / [patch](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/%5Bid%5D/route.ts#L131-L133)] |
| Server status gate | **Create:** if period is LOCKED + `draftsAllowedWhileLocked=false` → 409 *"<code> is locked and cannot accept new findings"*. If `submit:true` on a LOCKED period (regardless of drafts-allowed) → 409 *"<code> is locked — save as a draft instead…"*. If `submit:true` on OPEN but outside `submissionStartsAt / submissionEndsAt` window → 409 from `assertPeriodOpenForSubmission`. [[create](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/route.ts#L152-L164)] |
| Server status gate (patch) | `assertPeriodWritable(db, targetPeriodId, existing.status)`. Same LOCKED/draftable rules apply to the *target* when the user is moving the finding to another period. [[patch](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/%5Bid%5D/route.ts#L134-L141)] |
| Why exists | Reporting periods are the primary slice on almost every dashboard, the basis for lock/transfer, and the sequence key for `reference`. |

---

### F3. `districtId` — UUID + F4. `branchId` — UUID

Treated as a pair — changing either independently is allowed, but the
pair must be consistent with the org tree (branch.districtId matches
districtId).

| | |
|---|---|
| Schema (create) | `.string().optional()` each — *structurally* optional here because BRANCH-scoped roles have them injected, not read from the body. Server-side rules (below) make them hard-required for BANK/DISTRICT roles. |
| Schema (patch) | `.string().min(1).optional()` each — if omitted, keep existing value. |
| BRANCH-role rule | Overwritten by `session.districtId/session.branchId` → you cannot tamper with this. |
| Server rule (BANK/DISTRICT create) | `if (!input.districtId \|\| !input.branchId) → 400 "District and branch are required"` [[route.ts#L125-L127](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/route.ts#L125-L127)] |
| Org tree consistency | Branch must exist and `branch.districtId === districtId`; mismatched → 400 *"Selected branch does not belong to the selected district"*. [[create](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/route.ts#L128-L132) / [patch](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/%5Bid%5D/route.ts#L125-L129)] |
| DISTRICT-scope rule (patch) | `districtId !== session.districtId` → 403 Outside org scope. [[patch](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/%5Bid%5D/route.ts#L121-L123)] |
| BRANCH-scope rule (patch) | `districtId` or `branchId` differ from session → 403 *"You can only edit findings within your own branch"*. [[patch](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/%5Bid%5D/route.ts#L118-L120)] |
| Why exists | Branch = where the irregularity happened (every report is grouped by branch). District = the first-level org reporting unit. |

---

### F5. `sourceId` — UUID

| | |
|---|---|
| Schema | `.string().optional()` — requirable. Admin can require via Settings. |
| Rule | If provided, must resolve to an **ACTIVE** `Source.id` in `db.sources`. Inactive → 400 *"Selected source is not active"*. [[create](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/route.ts#L169-L171) / [patch](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/%5Bid%5D/route.ts#L148-L151)] |
| Why exists | Seed has `IC` (Internal Control) and `IA` (Internal Audit). The source changes who's expected to register + follow up on a finding, and is a common report filter. |

---

### F6. `departmentId` — UUID

| | |
|---|---|
| Schema | `.string().optional()` — requirable. |
| Rule 1 | If provided, must resolve to an ACTIVE `Department.id`. Inactive → 400. |
| Rule 2 | Must pass `isDepartmentInScope(department, { districtId, branchId })`. Departments have `orgScope: BANK \| DISTRICT \| BRANCH`; a DISTRICT-scoped department is only offered in that district; a BRANCH-scoped one is only offered at that one branch. Out of scope → 400 *"Selected department is not available for this district/branch"*. [[create](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/route.ts#L172-L183) / [patch](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/%5Bid%5D/route.ts#L152-L161)] |
| Why exists | Segregates findings by the business-function area at fault — the exact department that has to implement recommendations. |

---

### F7. `categoryId` — string (UUID, or "Other" free text!)

**Unique rule vs other reference fields.** It's a string that can be:
- A real `ClassifiedCategory.id` UUID → must be ACTIVE (if matched and inactive → 400 *"Selected classified case is not active"*); OR
- A value that matches **no** category at all → treated as an admin-enabled
  *"Other (type in)"* free-text value, stored as-is.  The `matchedCategory`
  variable only triggers the inactive-check when a match is found.

Code at [[create](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/route.ts#L188-L191) / [patch](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/%5Bid%5D/route.ts#L162-L170)].

**Configured by admin:** `Settings.allowOtherValueFields.categoryId`. If
the admin toggles this to false, the UI dropdown doesn't render the
"Other" option — but the server-side rule still permits free-text values
(since the server rule only enforces "if it's a known UUID, it must be
active"). So disabling the UI toggle is **policy**, not a server guard.
That's intentional — older data that was typed in while the toggle was
ON must still load and pass re-saves even after the toggle is turned OFF.

**Why exists:** master.txt §25's 7 codes (ATM Mismatch, ATM Long
Outstanding, IT Case, Dormant Account, Zero Balance, CK Book, Other
Case) are the seed; "Other (type in)" covers a one-off irregularity an
admin doesn't want to formalize as its own code.

---

### F8. `amount` — number (currency amount)

| | |
|---|---|
| Schema | `.number().nonnegative()` create; `.number().nonnegative().optional()` patch. |
| Required | **Hard.** Always. |
| Allowed | `>= 0`. Negative → Zod 400. NaN / strings → Zod 400. |
| 0-amount semantics | `amount = 0` is accepted. It's a valid way to record a purely procedural / non-monetary finding. See §"zero-amount finding" edge behavior in findings.ts — transfer still works, close/verify still work via case-count dimensions; only rectification for non-itemized 0-amount findings has a documented edge where the (count>0)==(amount>0) parity check has to be interpreted carefully (see ZERO_AMOUNT_FINDINGS.md if that's a real workflow). |
| Why exists | Financial exposure of the finding — primary input into every ETB-denominated dashboard, rectification progress %, top-10 branches by exposure, etc. |

---

### F9. `caseCount` — integer (>= 1)

| | |
|---|---|
| Schema | `.number().int().positive("Number of cases must be at least 1")` create; `.int().positive().optional()` patch. |
| Required | **Hard.** Always. |
| Allowed | Integer, >= 1. Floats like 2.5 → Zod 400. 0 → Zod 400. Max is **500** *only* when paired with `caseAmounts.length` (see below). A bare caseCount of 600 passes the Zod — it's later only bounded by the itemization array if the user itemizes. |
| Why exists | A finding can represent multiple instances of the same irregularity (e.g. "50 dormant accounts" — 50 cases, 1 aggregate finding). |

---

### F10. `caseAmounts` — number[] (optional itemization)

If provided, this creates one `FindingCase` row per entry (the "case-level
itemization" per master.txt §12/§34).

| | |
|---|---|
| Schema | `.array(z.number().nonnegative()).max(500).optional()` — max 500 entries. |
| Rule 1 | `caseAmounts.length === caseCount`. Length mismatch → 400 *"Case breakdown has N entries but the case count is M"*. [[create](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/route.ts#L192-L198)] |
| Rule 2 | `sum(caseAmounts) === amount` (within `0.01` tolerance to handle binary-float rounding). Off → 400 with both numbers formatted. [[create](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/route.ts#L199-L205)] |
| Rule 3 (patch-only) | If `findingCases.any()` rows exist for this finding already (it was itemized) → `caseCount` / `amount` CANNOT be changed via PATCH (would leave stale case rows out of sync). 409 *"This finding's cases are itemized…"* [[patch](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/%5Bid%5D/route.ts#L199-L209)] |
| Why exists | One 45,000 ETB finding over 3 cases with distinct individual amounts (15k, 10k, 20k) is audited differently than "3 cases, same behavior" treated as a lump — rectification, closure, and evidence all attach to a specific case row, not the aggregate. |

---

### F11. `title` — string / F12. `description` / F13. `recommendation` / F14. `rootCause` / F15. `evidenceNote`

These are the text fields.

| | Schema (create + patch) | Required? | Other rules |
|---|---|---|---|
| `title` | `.string().optional()` create; same patch. | **Requirable** (admin toggle). | Trimmed and stored as plain string. No explicit max length today; 128-200 chars is the UI-visible convention. |
| `description` | same | Requirable. | Primary narrative. |
| `recommendation` | same | Requirable. | Written by the auditor, acted on by the branch. |
| `rootCause` | same | Requirable. | **Finding-only field** (not on import CSV today — a pre-existing noted gap in import.ts comments). |
| `evidenceNote` | same | Requirable. | Optional free-text context for evidence attachments. |

All are stored as plain UTF-8 strings; `null` / `undefined` on create
falls back to `""` (empty string) for fields that are typed as plain
strings in the Finding type; `recommendation`, `rootCause`, `evidenceNote`
are typed `string | null` and stored as `undefined → null`. See
[findings/route.ts#L208-L249](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/route.ts#L208-L249) for the "" / null assignment block.

---

### F16. `findingDate` — string (ISO date)

| | |
|---|---|
| Schema | `.string().optional()` — requirable. |
| Validation | If present, stored as whatever text was sent (no date parse on create — because requirable fields can be set non-date empty strings). It is **parsed** for import and for `caseAgeDays()` metrics: `new Date(findingDate)`. Invalid dates reaching the metric → caseAgeDays silently becomes 0, not a crash. |
| Why exists | BRD §case-age. Case age tracks from `findingDate`, not `createdAt` — critical for historical imports (§import rules) where a finding was created in 2024 and backfilled now. |

---

### F17. `operationArea` / F18. `irregularityType` — free strings (from admin lists, "Other" allowed)

Both stored as plain strings. **No server-side validation beyond admin
required/optional toggle** — the UI dropdown is populated from
`Settings.operationAreas` / `Settings.irregularityType`, but a typed-in
value is allowed the same way as `categoryId`'s "Other" because the
admin toggle `Settings.allowOtherValueFields.{operationArea, irregularityType}`
controls the UI dropdown only, server-side is permissive.

Why: same reason as category — admins need the ability to add new values
on the fly via Settings without a schema migration, and legacy typed-in
values must still round-trip after a list is edited.

---

### F19. `currency` — string

| | |
|---|---|
| Schema | `.string().optional()` — requirable. |
| Server rule | **None on create.** Settings.currencies is the admin-configured list; the client restricts the dropdown but the server doesn't 400 a code outside it. Intentionally lenient because a brand-new currency may be needed before an admin updates Settings. |
| Why exists | ETB / USD / EUR / GBP seed. Affects formatting + report-currency conversion (today, display only; no FX conversion, each finding is stored in its native currency). |

---

### F20. `riskLevel` / F21. `priority`

Both plain strings, requirable. Same pattern as currency/operationArea —
admin-configured lists, no server enforcement (lenient so the lists can
be edited independently of saved data). Intended values from seed:

- `riskLevel`: Low / Medium / High / Critical
- `priority`: Low / Medium / High / Urgent

---

### F22. `submit` — boolean (CREATE ONLY — has no field on PATCH)

| | |
|---|---|
| Schema | `.boolean().default(false)` |
| Allowed | true / false. Default false. |
| If `true` at create time | After writing the DRAFT row, immediately calls `submitFinding(db, f, session)` → transitions DRAFT → SENT_TO_BRANCH_MANAGER (or DISTRICT_REVIEW if the role is bank-scoped), writes the transition, and is subject to the *extra* period-open submission-window check at line ~161-164. |
| Why exists | The "Register & Submit Now" button in one form vs the 2-step Save Draft → Submit. |
| Rejected with | 409 — see period-gate rules at §0c. |

---

## 2. Cross-field invariants (summary)

| Invariant | Enforced at |
|-----------|-------------|
| `branch.districtId === districtId` | create + patch 400 |
| `periodId` exists and is writeable for this status | create + patch 409 |
| `caseAmounts.length === caseCount` | create 400 |
| `sum(caseAmounts) ≈ amount` | create 400 |
| If `caseAmounts` or `FindingCase` exist → PATCH caseCount/amount blocked | patch 409 |
| Reference regenerates IFF branchId or periodId changed | patch |
| Status must be DRAFT/RETURNED to edit anything at all | patch 409 |
| Editing author must == createdBy | patch 403 |
| Org scope (district/branch) bounds of editor match | create 403 / patch 403 |

---

## 3. HTTP status summary for create/edit

| Status | Meaning (for finding endpoints) |
|--------|----------------------------------|
| 400 | Bad shape — Zod schema (wrong type / missing hard field) OR a server-side reference lookup / cross-field invariant rejected it. Fix the payload. |
| 401 | Not logged in. Fix: log in. |
| 403 | Permission fail (no findings.create/edit), OR org scope fail, OR author fail. Fix: use an account with wider role. |
| 404 | PATCH: finding id doesn't exist. |
| 409 | Period locked (for non-draft writes), or outside submission window for `submit:true`, or status isn't editable, or itemized-case PATCH tried to change totals. Fix: advance/retract period state, make a copy, or re-approach as itemization. |
| 200/201 | Success. Response shape: `{ finding }` with the full row including its new `reference`. |
