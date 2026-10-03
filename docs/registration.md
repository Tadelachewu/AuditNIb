# Finding Registration — Technical Reference

This document covers the **Finding Registration** feature of NIB Control360 (ICFMS): the
creation of a new `Finding` record, from the `/findings/new` form through to what is
persisted server-side and who is notified. It does not attempt to re-derive the full
post-registration workflow state machine (district review, HO review, rectification,
closure, transfer) — that belongs in a separate `workflow.md` (not yet present in this
repo at the time of writing); this document only documents the *mechanism* that seeds
that workflow (`registeredByBankScope`, initial status, initial transition history).

Every claim below is cited as `file:line` against the code as read for this document.
Where behavior is ambiguous or looks like a possible inconsistency in the code, it is
called out explicitly rather than guessed at (see §11).

---

## 1. Overview

"Registering a finding" means creating a new `Finding` row via the **Register Finding**
form and either (a) leaving it as a `DRAFT` for later completion, or (b) submitting it
immediately into the review workflow.

- **Entry point / URL**: `/findings/new`, rendered by
  `src/app/(app)/findings/new/page.tsx`. The page title is "Register Finding"
  (`src/app/(app)/findings/new/page.tsx:18`) and it hosts the `NewFindingForm` component
  in "create" mode (`src/components/findings/NewFindingForm.tsx`). The same component is
  reused inline (no page nav) inside `FindingDetailClient`'s "Finding Details" card for
  **editing** an existing finding — `finding` prop set — but registration-time behavior
  (draft autosave, similar-finding lookup, case itemization) is deliberately
  create-mode-only; see the `isEditing` guards throughout `NewFindingForm.tsx`
  (e.g. lines 348, 367, 426, 489, 770).
- **Who can register**: gated by the single permission key `findings.create`
  (`permissionKey("findings", "create")`). The page redirects unauthenticated users to
  `/login` and any user lacking `findings.create` to `/findings`
  (`src/app/(app)/findings/new/page.tsx:8-10`). The POST API independently re-checks the
  same permission (`src/app/api/findings/route.ts:86`), and the Redis draft-autosave
  endpoints require it too (`src/app/api/findings/draft-autosave/route.ts:28,41,71`).
  Which *roles* hold `findings.create` is fully dynamic — it's data on
  `RoleDefinition.permissions`, editable at `/admin/roles`
  (`src/lib/permissions/registry.ts:1-14`), not a hardcoded role check.
- **What "submit" requires**: notably, the one-call create-and-submit path (the form's
  "Save & Submit" button) is gated only by `findings.create`, not by the separate
  `findings.submit` permission that the dedicated `POST /findings/[id]/submit` route
  requires (`src/app/api/findings/[id]/submit/route.ts:11`). See §11 for the implication.
- Registration always produces a finding with `status: "DRAFT"` first
  (`src/app/api/findings/route.ts:235`); submission (if requested in the same call) is a
  second, explicit step applied inside the same transaction (§9).

---

## 2. The registration form, field by field

The form (`NewFindingForm.tsx`) is populated from server-loaded reference data passed in
as props by `findings/new/page.tsx`: active sources/departments/categories
(`page.tsx:22-24`), periods filtered to `OPEN` or `draftsAllowedWhileLocked`
(`page.tsx:30`), `ACTIVE` districts/branches (`page.tsx:31-32`), and several
admin-configured string lists from `Settings` (currencies, riskLevels, operationAreas,
priorityLevels, irregularityTypes) plus two admin policy maps:
`requiredFindingFields` and `allowOtherValueFields` (`page.tsx:33-39`).

### Required-ness: two different mechanisms

Five fields are **always** hard-required, independent of any admin setting, because they
are structural rather than descriptive (`src/types/index.ts:277-301` explains why:
`periodId`/`districtId`/`branchId` are the organizational-scope security boundary and the
axis every dashboard/report/lock/transfer computation keys off; `amount`/`caseCount` are
quantities with no coherent "blank" state):

| Field | Client rule | Server rule |
|---|---|---|
| `periodId` | `required` on the `<Select>` (`NewFindingForm.tsx:600`) | `z.string().min(1, "Reporting period is required")` (`route.ts:54`) |
| `districtId` | `required` unless branch-scoped (fixed) (`NewFindingForm.tsx:623`) | required unless `session.orgScope === "BRANCH"` (`route.ts:118-138`) |
| `branchId` | `required` unless branch-scoped (fixed) (`NewFindingForm.tsx:647`) | same as above |
| `amount` | `type="number" min="0" step="0.01" required` (`NewFindingForm.tsx:719-729`) | `z.number().nonnegative()` (`route.ts:61`) |
| `caseCount` | `type="number" min="1" step="1" required` (`NewFindingForm.tsx:732-742`) | `z.number().int().positive(...)` (`route.ts:63`) |

Every other narrative/classification field's required-ness is an **admin policy
decision** stored on `Settings.requiredFindingFields` (a `Record<RequirableFindingField,
boolean>`, editable at `/admin/settings`), enumerated in `REQUIRABLE_FINDING_FIELDS`
(`src/types/index.ts:302-318`). The client applies it via the HTML `required` attribute
(`fieldLabel()`/`requiredFields[key]` throughout `NewFindingForm.tsx`, e.g. lines
272-274, 557, 569, 585…) and appends "(optional)" to the label when a field is opted out.
The **server independently re-enforces the exact same settings** via
`assertRequiredFindingFieldsPresent()` (`src/lib/findings.ts:515-527`), called from the
POST route at `route.ts:98-114`. The client-side `required` attribute is only a UX
convenience (trivially bypassable by a raw API call) — the server check is authoritative.

### Full field list

| Field | UI control | Required (client) | Required (server) | Default | Notes |
|---|---|---|---|---|---|
| `title` | text `Input` | `requiredFields.title` (`NewFindingForm.tsx:557`) | `assertRequiredFindingFieldsPresent` (title) | `""` | — |
| `sourceId` | `Select` of active `Source`s, sorted A–Z | `requiredFields.sourceId` (`:569`) | same, plus "source is active" check (`route.ts:169-171`) | `""` | — |
| `departmentId` | `Select`, filtered client-side to bank-wide + district/branch-scoped departments (`departmentOptions`, `:474-485`) | `requiredFields.departmentId` (`:585`) | same, plus active + `isDepartmentInScope()` re-check (`route.ts:172-183`, `src/lib/org.ts:141-145`) | `""`, deliberately **not** pre-selected even when only one option exists (`:302-306` comment: "which department is even valid depends on district/branch") | Helper text: "Bank-wide departments, plus any scoped to the district/branch below" (`:596`) |
| `periodId` | `Select` of periods eligible for at least a draft | always required | always required | `""` | Options show `" (locked - drafts only)"` suffix for `LOCKED`/`draftsAllowedWhileLocked` periods (`:605`) |
| `districtId` | `Select`, or a locked read-only label when `fixedDistrict` is set | always required (unless fixed) | forced from session for `BRANCH` scope, else required (`route.ts:116-138`) | `fixedDistrict?.id ?? ""` | Changing it clears `branchId`/`departmentId` (`:625`) |
| `branchId` | `Select` filtered to the chosen district (`branchOptions`, `:462-468`), or a locked label | always required (unless fixed) | see above | `fixedBranch?.id ?? ""` | Changing it clears `departmentId` (`:647`) |
| `findingDate` | `type="date"` | `requiredFields.findingDate` | same | **today's date**, `new Date().toISOString().slice(0,10)` (`:224`) | — |
| `categoryId` | `CategorySelectOrOther` over active `ClassifiedCategory` rows, sorted A–Z, id-valued | `requiredFields.categoryId` | same, plus "active" check **only if it resolves to a real category id** (`route.ts:184-191`) | `""` | See "Other" handling below |
| `operationArea` | `SelectOrOther` over `Settings.operationAreas`, sorted A–Z | `requiredFields.operationArea` | same | first item of `operationAreas` (`:309`) | — |
| `irregularityType` | `SelectOrOther` over `Settings.irregularityTypes`, sorted A–Z | `requiredFields.irregularityType` | same | first item of `irregularityTypes` (`:311`) | — |
| `currency` | `SelectOrOther` over `Settings.currencies`, sorted A–Z | `requiredFields.currency` | same | first item of `currencies` (`:307`) | Currency **can be admin-configured optional** — see §5 gotcha |
| `amount` | number input | always required, `min="0"` | `z.number().nonnegative()` — **0 is allowed** | `""` | See §5 |
| `caseCount` | number input | always required, `min="1"` | `z.number().int().positive()` — **must be ≥ 1** | `"1"` | See §5 |
| `riskLevel` | `SelectOrOther` over `Settings.riskLevels`, **kept in configured severity order, not sorted** (`:455-459` comment) | `requiredFields.riskLevel` | same | first item of `riskLevels` (`:308`) | — |
| `priority` | `SelectOrOther` over `Settings.priorityLevels`, kept in configured order | `requiredFields.priority` | same | first item of `priorityLevels` (`:310`) | — |
| `description` | `Textarea` (3 rows) | `requiredFields.description` | same | `""` | — |
| `rootCause` | `Textarea` (2 rows), placeholder "Why did this happen? - distinct from the description of what happened" (`:826`) | `requiredFields.rootCause` | same | `""` | — |
| `recommendation` | `Textarea` (2 rows) | `requiredFields.recommendation` | same | `""` | — |
| `evidenceNote` | text `Input`, placeholder "e.g. filed in branch cabinet, ref #4 - no file upload yet" (`:846`) | `requiredFields.evidenceNote` | same | `""` | Free text only — no file attached here; see §8 |
| *(itemized case amounts)* | checkbox + per-case number inputs, shown only when not editing and `caseCount > 1` (`:770`) | client blocks save if sum ≠ amount (`caseAmountsMatch`, `:335`, error at `:489-492`) | `caseAmounts.length === caseCount` and `Σ caseAmounts ≈ amount` (±0.01) re-checked server-side (`route.ts:192-206`) | unchecked / empty | Create-mode only; see §5 |

### The "Other (type in)" fallback

Six fields — `operationArea`, `irregularityType`, `priority`, `riskLevel`, `currency`,
`categoryId` — are rendered as a dropdown over an admin-configured list, with an optional
"Other (type in)" escape hatch (`OTHER_VALUE_ALLOWED_FIELDS`,
`src/types/index.ts:338-346`). Whether the escape hatch is offered *for a brand-new
value* is itself admin policy (`Settings.allowOtherValueFields`, per-field boolean).
Turning it off never hides or corrupts an *existing* value that was typed in before the
field was locked down (`allowOther` field's own doc comment,
`NewFindingForm.tsx:41-57`) — it only blocks choosing a fresh custom value from a blank
start. For `categoryId` specifically, a typed "Other" value is stored as plain text
directly in `Finding.categoryId` with **no backing `ClassifiedCategory` record** — this
trades away referential integrity (no `ScoringRule` match, no real category grouping in
reports) for never blocking registration on an incomplete admin list
(`src/types/index.ts:330-337`; DB-level this column isn't even a foreign key —
`prisma/schema.prisma:408-420`).

---

## 3. Reference number generation

Format: **`<branchCode>-<periodCode>-<5-digit zero-padded sequence>`**, e.g.
`BR01-2026-09-00007`.

Implemented in `nextFindingReference(db, branch, period)`
(`src/lib/findings.ts:546-560`):

- Scans every existing `Finding.reference` that starts with `"<branchCode>-<periodCode>-"`
  and parses the numeric suffix, taking **`MAX(parsed suffix) + 1`** — not a plain count.
  This is deliberate: count-based sequencing would collide the moment any finding in the
  same branch+period is deleted (its old number would be "reissued"), which would violate
  the `reference` `@unique` DB constraint (`prisma/schema.prisma:385`, doc comment at
  `findings.ts:533-536`).
  - Deleting the *only* other finding with that reference is a real, documented path here:
    `DELETE /api/findings/[id]` genuinely removes DRAFT findings (§7), so this MAX-based
    scheme is load-bearing, not defensive-only.
- The suffix is 5 digits, zero-padded (`String(seq).padStart(5, "0")`); once past 99999
  the pad naturally grows to 6+ digits rather than wrapping (`findings.ts:539-541`).
- The regex-equivalent match is anchored to the *end* of the string (a plain
  `startsWith`/`slice` pair) specifically so a branch code that happens to itself contain
  a `-NNNNN`-shaped suffix can't poison the max calculation (`findings.ts:542-543`).

**Generation point**: exclusively server-side, at `POST /api/findings` — computed once,
right before the `Finding` object is constructed (`route.ts:211`), using the already
db-resolved `branch` and `period` records. It is **never client-visible before submit**:
the registration form's `emptyForm` has no `reference` field at all
(`NewFindingForm.tsx:217-237`), and the create button never receives one back until the
server response (`res.finding.id` is used to redirect to `/findings/{id}` after creation,
`NewFindingForm.tsx:526`, where the newly-assigned reference is then visible).

**Edit-time regeneration** (context, not part of registration itself): the reference is
never user-editable, but `PATCH /api/findings/[id]` regenerates it if the finding's
`branchId` or `periodId` changes (`[id]/route.ts:211-222`) — same algorithm, applied
against the finding set with the record's *old* reference already excluded (it's about to
be overwritten).

---

## 4. Bank-scope vs branch/district-scope registration

`Finding.registeredByBankScope` is a persisted boolean that routes a submitted finding
either through the normal District→HO review chain, or past it entirely. It is set (and
**re-set on every submission**, not just the first) by `submitFinding()`
(`src/lib/findings.ts:401-429`), based on **the submitting session's `orgScope` at the
moment of submit** — not who originally registered the finding:

```
finding.registeredByBankScope = Boolean(opts?.registeredByBankScope);
```
(`findings.ts:415`, opts passed as `{ registeredByBankScope: session.orgScope === "BANK" }`
from both call sites — `route.ts:269` for create-and-submit, and
`[id]/submit/route.ts:40-41` for submitting an existing draft.)

- **At creation time**, before any submission has happened, the field is hard-coded to
  `false` regardless of who is registering, with an explicit comment: "Not yet decided - a
  DRAFT hasn't been submitted, so there's no submitting session's orgScope to read yet"
  (`route.ts:236-239`).
- **If `submit: true`** is sent in the same POST call, `submitFinding()` runs inside the
  same `updateDb()` transaction against the just-persisted record (`route.ts:264-270`),
  and `registeredByBankScope` becomes `true` iff the registering user's session
  `orgScope === "BANK"`.
- **Downstream effect** (mechanism only — full state machine lives in `workflow.md`):
  inside `submitFinding()`, after the DRAFT→SUBMITTED transition:
  - if `registeredByBankScope` is true: goes to `PENDING_BANK_APPROVAL` when
    `Settings.hoApproval.required` is on, otherwise straight to
    `SENT_TO_BRANCH_MANAGER` (`findings.ts:419-426`) — skipping `DISTRICT_REVIEW` and
    `HO_REVIEW` entirely, because "there's no natural 'district' to review a finding HO
    itself registered" (`findings.ts:390-399`).
  - otherwise: goes to `DISTRICT_REVIEW` (`findings.ts:428`), the normal chain.
- Because it's re-evaluated on every submit, a finding originally bank-registered that is
  later `RETURNED` and resubmitted **by a branch-scoped user** correctly falls back to the
  normal district/HO chain on that resubmission (`findings.ts:391-393` doc comment) — the
  field reflects the latest submitter, not history.
- It is also read much later in the lifecycle by `return-rectification/route.ts` to decide
  who may return a rectification for correction (cross-referenced only —
  `findings.ts:409-414`; full detail belongs in `workflow.md`).

Practically, which org scope a *registering* user has is what makes bank-scope
registration possible at all: only a `BANK`-scoped session can leave `districtId`/
`branchId` free to name *any* branch bank-wide (§10); a `DISTRICT`- or `BRANCH`-scoped
registrant is always constrained to their own org unit, so their submissions always take
the normal district/HO review path.

---

## 5. Case count & amount rules

- **`amount`**: `z.number().nonnegative()` server-side (`route.ts:61`) — **`0` is a valid
  amount**. Client HTML input has `min="0" step="0.01"` (`NewFindingForm.tsx:723-724`).
  No currency-aware rounding/precision logic exists anywhere in the read code — it's a
  plain JS/Prisma `Float` (`prisma/schema.prisma:421`).
- **`caseCount`**: `z.number().int().positive()` server-side (`route.ts:63`) — **must be
  a positive integer, `0` is rejected** (unlike `amount`). Client `min="1" step="1"`
  (`:736-737`). So a finding must represent at least one case, but that one case is
  allowed to be worth `0` in `amount`.
- **`currency`**: interestingly, `currency` **is** in `REQUIRABLE_FINDING_FIELDS`
  (`src/types/index.ts:310`), meaning an admin can configure it as *not required*. If so,
  a finding can be registered with a nonzero `amount` and a blank `currency` — see §11.
- **Case-amount tolerance**: all sum/equality comparisons use a `±0.01` float tolerance
  rather than exact equality, both client (`Math.abs(caseAmountsSum - amount) < 0.01`,
  `NewFindingForm.tsx:335`) and server (`Math.abs(sum - input.amount) > 0.01`,
  `route.ts:200`) — a defensive allowance for floating-point summation error, not a
  business-rule rounding rule.
- **Optional per-case itemization** (Document_3 §12/§34, comment at
  `NewFindingForm.tsx:317-320`): shown only in create mode when `caseCount > 1`
  (`:770`) — "there's no case-breakdown-edit flow yet, and an already-itemized finding
  can't have its totals changed via edit at all" (same comment). Checking "Track
  individual case amounts" reveals one number input per case (`setCaseCount()` clamps the
  itemized array to `Math.max(0, Math.min(500, caseCount))` entries, `:324-332`, matching
  the server's `z.array(...).max(500)` bound at `route.ts:76`). Each entry must sum
  (within tolerance) to the total `amount`; the live running total and mismatch are shown
  inline (`:801-804`). If itemized, `POST /api/findings` also inserts one `FindingCase`
  row per case, `status: "OUTSTANDING"` (`route.ts:253-263`), which later lets a
  rectification target specific cases (e.g. "only Case 2") instead of just an aggregate
  count/amount (`FindingCase` doc comment, `src/types/index.ts:643-653`).
- Once itemized at creation, the case count/amount can never be changed via edit without
  a 409 (`[id]/route.ts:194-209`) — itemization is a create-time-only decision.

---

## 6. Similar/duplicate finding detection

Non-blocking duplicate-suggestion lookup: `GET /api/findings/similar`
(`src/app/api/findings/similar/route.ts`).

- **Which fields count** is entirely admin config: `Settings.similarFindingFields`, a
  subset of `SIMILAR_FINDING_FIELDS` (`src/types/index.ts:254-275`, editable at
  `/admin/settings`). If the admin has configured **zero** fields, the route returns no
  matches at all, unconditionally (`similar/route.ts:56`).
- **Matching is AND, exact-equality only** — every configured field must match exactly
  (`FIELD_ACCESSORS`, `similar/route.ts:13-33`, compared via plain `===` at line 73);
  there is no fuzzy or numeric-range matching. This is deliberately looser/softer than
  the bulk-import path's `dedupeKey()` (`src/lib/import.ts`), which hard-rejects an
  exact-match row — here it's a human prompt, not a validation gate
  (`similar/route.ts:36-44`).
- **All configured fields must have a value on the in-progress form**, or nothing is
  suggested — a partially-filled form never triggers a false-positive suggestion based on
  a subset of fields (`similar/route.ts:65-70`).
- **Org-scoped**: results are filtered through `findingsInScope(db, session)`
  (`similar/route.ts:72`, `src/lib/findings-scope.ts:27-29`) — never surfaces a finding
  outside the caller's own district/branch/bank scope.
- **`externalReference` is deliberately excluded** from the candidate menu even though
  it's a real `Finding` field — it only exists on imported findings and has no input on
  the interactive form, so the "every configured field must have a value" rule could
  never be satisfied for it (`src/types/index.ts:245-253`).
- **Client behavior**: debounced 400ms after any candidate field changes
  (`NewFindingForm.tsx:431`), request cancelled via `AbortController` on rapid further
  changes (`:430,441-444`). Not run in edit mode (`:426-429`). Results capped at the 5
  most recent matches (`similar/route.ts:74-76`, sorted `createdAt` descending then
  sliced).
- **UI**: an amber, dismissible banner listing each match's reference/title/status/date,
  each linking to that finding in a new tab (`NewFindingForm.tsx:852-876`). Dismissal is
  per distinct field-combination (`similarKey`, `:423`, resets `similarDismissed` on
  change, `:425`) rather than global, so changing a field re-surfaces the check instead of
  staying silently suppressed.
- **Never blocks submission**: it's purely advisory — there is no check anywhere in
  `save()` or the POST route that consults `/similar` results before allowing Save Draft
  or Save & Submit to proceed.

---

## 7. Draft saving / autosave

There are **two distinct, unrelated mechanisms**, easy to conflate:

### 7a. Real "Save Draft" — a genuine `Finding` row, `status: "DRAFT"`

Clicking **Save Draft** (or plain form submit, `NewFindingForm.tsx:537-541`) calls
`save(false)`, POSTing to `/api/findings` with `submit: false`. The server:

- Always writes `status: "DRAFT"` on creation (`route.ts:235`), regardless of the
  `submit` flag — `DRAFT` is the universal starting status.
- Runs the **exact same field validation** as a submit (required-fields, org-scope,
  active-reference checks, case-amount cross-check) — a draft is not exempt from any of
  the field-level rules in §2/§5, only from the *workflow* progression rules
  (`assertPeriodOpenForSubmission` is skipped for a plain draft save, `route.ts:161-164`
  only runs `if (input.submit)`).
- Produces **no `FindingTransition` row and no `AuditLogEntry`** for the creation itself —
  the object is inserted directly with `status: "DRAFT"` as a literal
  (`route.ts:209-249`), with no call to `transitionFinding()`/`appendAuditLog()` on this
  path. Only `createdBy`/`createdAt` on the `Finding` row itself records who registered it
  and when (§9 gotcha).
- A period that is `LOCKED` still accepts a draft save as long as
  `draftsAllowedWhileLocked` is set on that period (`route.ts:143-154`); a period that's
  fully locked (drafts not allowed) rejects creation outright with a 409
  (`route.ts:152-154`) — the period dropdown itself excludes fully-locked periods so this
  case shouldn't normally be reachable from the UI (`new/page.tsx:25-30`).
- **A DRAFT finding is fully mutable and deletable, but only by its own author**:
  `PATCH /api/findings/[id]` allows editing while `status` is `DRAFT` or `RETURNED`
  (`EDITABLE_STATUSES`, `[id]/route.ts:10,105-107`), gated by `findings.edit` **and** an
  ownership check (`existing.createdBy !== session.userId`, `[id]/route.ts:101-103`).
  `DELETE /api/findings/[id]` similarly requires `findings.delete`, ownership, and
  status `DRAFT` **or `RETURNED`** (a returned finding is back with its registrant, like a
  draft). Deleting also cascades removal of its `FindingTransition`/`FindingCase` rows; the
  audit log keeps a `DELETE` entry. Any deleted finding's reference number (draft,
  `RETURNED` or `REJECTED`) goes to the next new finding in that branch and period
  (lowest free number - `nextFindingReference()` in `src/lib/findings.ts`). The same goes for
  findings removed by reversing an import.
- A draft appears in its author's own work queue via `queueStatusesForSession()`
  whenever they hold `findings.edit` or `findings.submit`
  (`src/lib/findings.ts:653-656`).

### 7b. Redis "draft-autosave" — an unsaved, in-progress form buffer (create mode only)

`src/app/api/findings/draft-autosave/route.ts` is a **client-convenience scratch buffer
for the registration form before either a real Draft save or Submit has happened at
all** — explicitly *not* for editing an already-persisted finding
(`draft-autosave/route.ts:5-13`).

- **Storage**: Redis, not the database — key `finding-draft-autosave:<userId>`
  (`:14-16`), one slot per user (not per in-progress finding). Chosen specifically because
  this is "disposable, per-browser-session scratch state… it should vanish on its own"
  rather than accumulate in a DB table (`:11-13`).
- **TTL**: 24 hours, sliding — refreshed on every autosave write
  (`redis.set(..., "EX", TTL_SECONDS)`, `:55`, `TTL_SECONDS = 24*60*60` at `:18`).
- **Trigger**: `PATCH` fires 800ms after any change to `form`, `itemizeCases`, or
  `caseAmounts` (`NewFindingForm.tsx:376-380`).
- **Restore**: on mount (create mode only), `GET` is called once; if a draft exists, the
  form state is repopulated and a dismissible amber "Restored an unsaved draft from
  earlier (e.g. after a refresh or connection loss)" banner is shown
  (`NewFindingForm.tsx:348-365,544-551`). `skipNextAutosave` prevents the restore from
  immediately re-triggering a redundant autosave write (`:369-374`).
- **Discard**: clicking "Discard" resets the form to `emptyForm` (respecting any
  `fixedDistrict`/`fixedBranch`) and issues `DELETE` (`discardRestoredDraft()`,
  `:382-388`).
- **Cleared on real success**: the moment either a real Draft save or a Submit succeeds,
  `DELETE /api/findings/draft-autosave` is fired (fire-and-forget) — "the autosave copy's
  only job was to survive until this point" (`NewFindingForm.tsx:524-525`).
- **Fails open/silent in every direction**: if Redis is down, `GET` returns
  `{ draft: null }`, `PATCH` returns `{ ok: false }`, and `DELETE` swallows the error —
  never surfaced to the user, never blocks the actual registration flow
  (`draft-autosave/route.ts:24-26,34-37,57-63,76-78`).
- Crucially: **this is not a `Finding` row and has no `FindingStatus`**. It never becomes
  a real, queryable, reportable record unless the user explicitly clicks Save Draft or
  Save & Submit.

---

## 8. Evidence/attachments at registration time

**The registration form itself has no file-upload control.** The only evidence-adjacent
field on `NewFindingForm` is `evidenceNote` — a plain text input, whose placeholder says
outright: *"e.g. filed in branch cabinet, ref #4 - no file upload yet"*
(`NewFindingForm.tsx:846`). It's optional unless the admin turns on
`Settings.requiredFindingFields.evidenceNote`, and is never itself required for a finding
to be registered or submitted.

Real file attachment is a **separate feature, only reachable after the finding already
exists**: `POST /api/findings/[id]/evidence` (`src/app/api/findings/[id]/evidence/route.ts`).
It is gated by its own permission, `findings.evidence` (distinct from `findings.create`),
unless the upload is attached to a comment instead, in which case `findings.comment`
applies (`evidence/route.ts:16-23,44-49`). This means registering a finding and attaching
supporting files to it are two independently permissioned actions, performed in two
different places in the UI (the registration form vs. wherever the finding-detail page's
evidence widget lives, e.g. `FindingDetailClient.tsx`).

Constraints on that upload path (for completeness, since it's the only place "evidence"
in the file-attachment sense enters the app):

- **Size limit**: 10 MB (`MAX_EVIDENCE_BYTES = 10 * 1024 * 1024`, `src/lib/evidence.ts:9`).
  A `formData()` parse failure (the runtime itself rejecting a body over ~10MB before the
  route even runs) is treated as "file exceeds the 10 MB limit" rather than a generic
  parse error (`evidence/route.ts:27-41`).
- **Allowed types**: PDF, PNG, JPG, XLSX, DOCX, CSV
  (`ALLOWED_EVIDENCE_TYPES`, `evidence.ts:11-18`).
- **Content-sniffing, not just Content-Type trust**: the claimed MIME type is verified
  against the file's actual leading bytes (`evidenceContentMatchesType()`,
  `evidence.ts:54-68`) — PDF magic bytes, PNG signature, JPEG SOI marker, ZIP + `xl/`/`word/`
  marker for XLSX/DOCX, and a "no control bytes" heuristic for CSV — specifically to stop
  someone uploading, say, an HTML file relabeled `application/pdf`
  (`evidence.ts:44-53`, enforced at `evidence/route.ts:79-89`).
- **Storage**: local disk under `data/uploads/` (`UPLOADS_DIR`, `evidence.ts:7`), under a
  **server-generated UUID filename**, never the user-supplied one, specifically to rule
  out path traversal (`evidence.ts:70-73`; write at `evidence/route.ts:91-93`).
- Metadata is recorded as an `Evidence` row (`fileName`, `mimeType`, `size`,
  `storagePath`, `uploadedBy`, optional `commentId`) — `src/types/index.ts:766-777`,
  `prisma/schema.prisma:588-604`.

---

## 9. What happens on submit

Two API paths both end up calling the same `submitFinding()` helper, but they are **not
equivalent** in what else they do (see gotcha in §11):

1. **Create-and-submit-in-one-call**: `POST /api/findings` with `submit: true` — what the
   registration form's **Save & Submit** button actually does.
2. **Submit-an-existing-draft**: `POST /api/findings/[id]/submit` — used later, e.g. from
   the finding-detail page, to submit a `DRAFT` or `RETURNED` finding that was saved
   earlier. Not reachable from the registration form itself.

### Server-side validation order in `POST /api/findings` (route.ts)

1. `requirePermission("findings.create")` (`:86`).
2. Zod schema parse of the request body (`:90-93`) — structural checks only (types,
   `periodId` non-empty, `amount` non-negative, `caseCount` positive integer, `caseAmounts`
   array bound).
3. `assertRequiredFindingFieldsPresent()` against the admin's `requiredFindingFields`
   (`:98-114`).
4. Resolve/validate `districtId`+`branchId` against `session.orgScope` (`:116-138`) — see
   §10.
5. Period existence, `LOCKED`-without-drafts-allowed rejection, and (only if
   `submit: true`) `assertPeriodOpenForSubmission()` window check (`:141-164`).
6. `sourceId` "is active" check, only if non-blank (`:169-171`).
7. `departmentId` "is active" + `isDepartmentInScope()` check, only if non-blank
   (`:172-183`).
8. `categoryId` "is active" check — **only if it actually resolves to a real
   `ClassifiedCategory` id** (a typed "Other" value is exempt by design) (`:184-191`).
9. `caseAmounts` cross-field re-check (`:192-206`).
10. Build the `Finding` object: new `uuid()`, `reference` via `nextFindingReference()`,
    every optional field defaulted to `""` rather than left undefined ("an
    admin-opted-out-of-required field is still a real field on the record, just possibly
    blank" — `:212-215`), `status: "DRAFT"`, `registeredByBankScope: false`,
    every rectification/closure/verification counter zeroed, `createdBy: session.userId`
    (`:208-249`).
11. Single `updateDb()` transaction: push the `Finding`; push `FindingCase` rows if
    itemized; **if `input.submit`**, re-resolve the just-pushed record from the live
    transactional array (not the outer closure) and call `submitFinding()` on it
    (`:251-271`, comment explains why it must re-resolve from `current` rather than close
    over the outer `finding` variable).

### `submitFinding()` (`src/lib/findings.ts:401-429`)

- Sets `finding.registeredByBankScope = (session.orgScope === "BANK")` (see §4).
- `transitionFinding()` DRAFT → **SUBMITTED**, action `"SUBMIT"`.
- Then, in the *same call*, immediately transitions again to whichever status actually
  sticks:
  - bank-scope + `hoApproval.required` → **PENDING_BANK_APPROVAL**, action
    `"QUEUE_BANK_APPROVAL"`;
  - bank-scope, no HO approval required → **SENT_TO_BRANCH_MANAGER**, action
    `"QUEUE_BRANCH_MANAGER"`;
  - not bank-scope → **DISTRICT_REVIEW**, action `"QUEUE_DISTRICT_REVIEW"`.
- Each `transitionFinding()` call (`findings.ts:348-381`) does three things: updates
  `finding.status`/`updatedAt`, **unshifts a `FindingTransition` row** (from/to status,
  action, user, reason), and calls `appendAuditLog()` to append a hash-chained
  `AuditLogEntry` (`entityType: "Finding"`). So a single create-and-submit call writes
  **two** `FindingTransition` rows and **two** `AuditLogEntry` rows (SUBMITTED is a
  documented "momentary pass-through status" that's real in history but never a resting
  value — `src/types/index.ts:496-517`).
- If `submit: false` (plain Save Draft), **none** of the above runs — see §7a's note that
  a plain draft insert writes no transition/audit history at all.

### Who gets notified

**This is where the two submit paths diverge.** `POST /api/findings/[id]/submit`
(the *existing-draft* submit route) explicitly notifies, inside the same `updateDb()`
call:

- bank-scope + `hoApproval.required` → the configured `Settings.hoApproval.approverUserIds`
  ("`<ref>` awaiting approval") (`[id]/submit/route.ts:43-51`);
- bank-scope, no approval required → every holder of `findings.rectify` scoped to the
  finding's branch ("sent straight to the branch (no approval required)")
  (`:52-60`);
- not bank-scope → every holder of `findings.district-review` scoped to the finding's
  district (`:61-68`).

**`POST /api/findings`'s create-and-submit path does *not* call `notifyUsers()` or
`notifyFindingsPermissionHolders()` anywhere** — reviewed the full handler
(`src/app/api/findings/route.ts:1-277`) and there is no notification call on the
`input.submit` branch (`:264-270`). This means using the registration form's **Save &
Submit** button does not notify district reviewers / HO approvers / the branch manager,
even though it drives the finding into exactly the same status
(`DISTRICT_REVIEW`/`PENDING_BANK_APPROVAL`/`SENT_TO_BRANCH_MANAGER`) that the other route
*does* notify for. See §11 — this reads as an inconsistency rather than an intentional
design choice, but nothing in the code comments explains it, so it is reported as
observed rather than asserted as a bug.

---

## 10. Permission & scope rules

- **Base gate**: `findings.create` is required to view `/findings/new`
  (`new/page.tsx:10`), to `POST /api/findings` (`route.ts:86`), and to use the
  draft-autosave endpoints (`draft-autosave/route.ts:28,41,71`).
- **`BRANCH`-scoped session** (e.g. Branch Internal Controller): `districtId`/`branchId`
  are **forced** from the session, never taken from client input — both server-side
  (`route.ts:118-123`, erroring if the account isn't assigned to an active branch) and by
  the form itself, which never even renders district/branch pickers when `fixedDistrict`/
  `fixedBranch` are passed (`new/page.tsx:40-41`, `NewFindingForm.tsx:611-656`), and which
  strips any stale form value before sending (`districtId: fixedDistrict ? undefined :
  form.districtId`, `NewFindingForm.tsx:500-501`). A branch-scoped registrant can
  therefore only ever register findings against their own branch.
- **`DISTRICT`-scoped session**: `districtId`/`branchId` must be supplied by the caller
  (not fixed); the chosen branch must exist and belong to the chosen district
  (`route.ts:128-131`); additionally, `input.districtId` must equal
  `session.districtId` (`route.ts:133-135`) — i.e. a district-scoped registrant may
  register for **any branch inside their own district**, never another district.
- **`BANK`-scoped session**: same branch/district existence+consistency check
  (`route.ts:128-131`), but **no further narrowing** — a bank-scoped user (HO Controller,
  Admin) may register a finding attributed to any active district/branch bank-wide. This
  is exactly the mechanism that later produces `registeredByBankScope: true` on submit
  (§4) — icfms.txt is cited in-code as: "Register Internal Audit findings received from
  the Internal Audit Department" (`route.ts:79-84`).
- **Departments**: filtered client-side to bank-wide plus whatever's scoped to the
  currently-chosen district/branch (`departmentOptions`, `NewFindingForm.tsx:474-485`),
  and independently re-verified server-side via `isDepartmentInScope()`
  (`route.ts:180-183`, `src/lib/org.ts:141-145`) — a `DISTRICT`-scoped department is only
  selectable for findings in that exact district; a `BRANCH`-scoped department only for
  findings at that exact branch; a `BANK`-scoped department is available everywhere.
- **Reference-data visibility**: only `active` sources/departments/categories
  (`new/page.tsx:22-24`) and only `ACTIVE`-status districts/branches
  (`new/page.tsx:31-32`) are offered at all. Only `OPEN` periods, or `LOCKED` periods with
  `draftsAllowedWhileLocked` set, are offered (`new/page.tsx:25-30`) — a fully-locked
  period never appears in the dropdown.
- **Submit permission gap**: the create-and-submit path checks only `findings.create`,
  not `findings.submit` — see §11.
- **Edit/delete of a just-created draft** are further restricted by *ownership*
  (`createdBy === session.userId`), not just org scope — see §7a. Two Branch Controllers
  at the same branch (or a bank-registered finding sitting in that branch) would both
  pass the org-scope check but only the original author may edit/delete/submit it via
  the dedicated per-record routes (`[id]/route.ts:93-103,252-255`,
  `[id]/submit/route.ts:22-26`).

---

## 11. Edge cases & known gotchas

- **`findings.create` alone is enough to submit, bypassing `findings.submit`.** The
  registration form's "Save & Submit" button (`NewFindingForm.tsx:895-897`) calls
  `save(true)`, which POSTs `{ ..., submit: true }` to `/api/findings`
  (`route.ts:522`). That route only checks `requirePermission("findings.create")`
  (`route.ts:86`) — there is no additional `findings.submit` check anywhere in the create
  handler, even though `input.submit` drives the finding straight through
  `submitFinding()` into `DISTRICT_REVIEW`/`PENDING_BANK_APPROVAL`/
  `SENT_TO_BRANCH_MANAGER`. By contrast, the dedicated `POST /findings/[id]/submit` route
  — used to submit an *already-saved* draft — explicitly requires `findings.submit`
  (`[id]/submit/route.ts:11`). A role granted `findings.create` but deliberately denied
  `findings.submit` (e.g. to force "draft only, someone else reviews and submits") can
  still fully submit via the one-call registration path. Nothing in the code comments
  indicates this is intentional.
- **Create-and-submit fires no notifications** (§9) even though it reaches exactly the
  statuses (`DISTRICT_REVIEW`, `PENDING_BANK_APPROVAL`, `SENT_TO_BRANCH_MANAGER`) that the
  separate existing-draft submit route notifies reviewers/approvers/the branch manager
  for. A finding registered and immediately submitted via "Save & Submit" therefore
  produces no in-app notification or email to whoever needs to act on it next — they'd
  only discover it by checking their queue. A finding saved as a draft first and
  submitted later (via the finding-detail page's submit action) *does* notify correctly.
- **Plain draft creation writes no `FindingTransition`/`AuditLogEntry` at all** (§7a,
  §9) — the only record of a draft's registration is the `Finding` row's own
  `createdBy`/`createdAt`. The transition/audit history only begins once the finding is
  actually submitted for the first time (DRAFT → SUBMITTED → …). This means a finding
  that sits in `DRAFT` and is later deleted (`DELETE /api/findings/[id]`) leaves nothing
  behind in `findingTransitions` (which is filtered out anyway on delete,
  `[id]/route.ts:266`) but **does** leave a `"DELETE"` `AuditLogEntry` with the full
  `oldValue` snapshot (`[id]/route.ts:268-275`) — so a deleted draft is still forensically
  recoverable from the audit log even though its own transition history was always empty.
- **`currency` can be blank on a real, submitted finding with a nonzero `amount`.**
  `currency` is one of `REQUIRABLE_FINDING_FIELDS` (`src/types/index.ts:310`), so an
  admin can turn off `Settings.requiredFindingFields.currency`. Nothing else in the
  create or submit path checks that `currency` is non-blank when `amount > 0` — the two
  fields are validated completely independently.
- **`caseCount` and `amount` have asymmetric zero-handling**: `caseCount` must be a
  positive integer (`0` rejected, `z.number().int().positive()`, `route.ts:63`) but
  `amount` explicitly allows `0` (`z.number().nonnegative()`, `route.ts:61`) — a finding
  can legitimately represent "1 case, $0 involved" but never "0 cases."
  no upper bound on `amount` anywhere in the schema.
- **Similar-finding detection is gated by `findings.view`, not `findings.create`**
  (`similar/route.ts:51`) — a design choice, not obviously a bug, but worth noting since
  it means the endpoint itself doesn't require the ability to register findings, only to
  view them; it's the registration form's own client code that happens to be the only
  caller during create.
- **`evidenceNote` can be required even though there's nowhere to attach an actual file
  from the same form** — an admin can set `Settings.requiredFindingFields.evidenceNote =
  true`, forcing every registrant to type a text note describing evidence, while the
  actual evidence file upload (§8) remains a completely separate, separately-permissioned
  action available only after the finding is created.
- **Itemized case amounts are a create-only, one-way door.** Once a finding has
  `FindingCase` rows, `PATCH /api/findings/[id]` refuses any change to `caseCount` or
  `amount` that doesn't exactly match the existing totals (409, `[id]/route.ts:194-209|`)
  — there is no UI to re-itemize, so the only way to change an itemized finding's totals
  is presumably a data-layer intervention outside this document's scope.
- **`DELETE` cascades `findingCases` too** (`[id]/route.ts:267`) even though a plain draft
  with no itemization has none — defensive/always-correct cleanup rather than a
  conditional check.
- **The reference-number sequence is per (branch, period), not global** — two different
  branches (or the same branch across two periods) can and routinely will produce
  findings with the same numeric suffix, e.g. `BR01-2026-09-00001` and
  `BR02-2026-09-00001` coexist without conflict, since uniqueness is enforced on the full
  `reference` string, not the suffix alone.

---

## 12. Validation rules — consolidated reference, in execution order

Everything below is already documented in full, with rationale, in §2/§5/§9 above. This
section exists purely as a flat, scannable checklist of **every rule that can reject a
registration**, in the exact order it's actually evaluated — mirroring `import.md`'s §4
structure so the two documents are easy to cross-check against each other.

### 12.1 Client-side (before any network request)

Two layers, both bypassable by a direct API call — neither is authoritative:

1. **Native HTML5 constraint validation** — the browser blocks form submission if any
   field with a `required`/`min`/`max`/`step` attribute fails it (full per-field list in
   §2's "Full field list" table). This covers: `title`, `sourceId`, `departmentId`,
   `periodId`, `districtId`, `branchId`, `findingDate`, `categoryId`, `operationArea`,
   `irregularityType`, `currency`, `amount` (`min="0" step="0.01"`), `caseCount`
   (`min="1" step="1"`), `riskLevel`, `priority`, `description`, `rootCause`,
   `recommendation`, `evidenceNote` — each gated `required` only when
   `requiredFields[key]` is true per admin config (§2's "Required-ness" subsection),
   except the five/six structural fields which are always `required`.
2. **`itemizeCases && !caseAmountsMatch`** → *"Case breakdown must add up to the amount
   involved before saving"* (`NewFindingForm.tsx:489-492`) — the only rule implemented in
   JS on the client; everything else client-side is native-attribute-only.

### 12.2 Server-side — `POST /api/findings`, in exact order

1. `requirePermission("findings.create")` → 401/403 if missing (`route.ts:86`).
2. `createSchema.safeParse()` (`route.ts:43-77,90-93`) — structural only:
   - `periodId`: `min(1)` → *"Reporting period is required"*.
   - `amount`: `nonnegative()` (no message override — Zod default).
   - `caseCount`: `int().positive()` → *"Number of cases must be at least 1"*.
   - `caseAmounts`: array of `nonnegative()` numbers, `max(500)` entries.
   - Every other field: `z.string().optional()` — structurally always valid at this
     layer regardless of admin required-ness (that's enforced next).
3. `assertRequiredFindingFieldsPresent(db, input)` (`route.ts:98-114`) — for every field
   in `REQUIRABLE_FINDING_FIELDS` where `Settings.requiredFindingFields[key] === true`,
   the corresponding input must be non-blank.
4. District/branch resolution against `session.orgScope` (`route.ts:116-138`, full detail
   in §10):
   - `BRANCH` scope: forced from session, never from input.
   - `DISTRICT` scope: both required from input; branch must belong to the chosen
     district; `districtId` must equal the session's own district.
   - `BANK` scope: both required from input; branch must belong to the chosen district;
     no further ownership narrowing.
5. Period checks (`route.ts:141-164`): period must exist; if `LOCKED` and
   `!draftsAllowedWhileLocked`, rejected outright; if `input.submit`, additionally
   `assertPeriodOpenForSubmission()` must pass (the submission window, independent of
   whether the period is merely open for drafts).
6. `sourceId` active-record check, only if non-blank (`route.ts:169-171`).
7. `departmentId` active-record + `isDepartmentInScope()` check, only if non-blank
   (`route.ts:172-183`).
8. `categoryId` active-record check — **skipped entirely** if the value doesn't resolve
   to a real `ClassifiedCategory` id (i.e. a typed "Other" value is exempt by design)
   (`route.ts:184-191`).
9. `caseAmounts` cross-field re-check, only if `caseAmounts` was sent (`route.ts:192-206`):
   array length must equal `caseCount`, and `Σ caseAmounts` must equal `amount` within
   `±0.01`.
10. (Only if `input.submit`) `submitFinding()`'s own internal step — not a rejection rule,
    but the final write that follows every check above: sets
    `registeredByBankScope`, then the two-hop status transition described in §4/§9.

No rule beyond these ten can reject a `POST /api/findings` call. Editing an existing
finding (`PATCH /api/findings/[id]`) re-runs the same field-level rules (2-3, 6-9) plus
the ownership/status/itemization-immutability checks described in §7a and §11.
