# Rectification — Technical Reference

This document is the deep, standalone reference for **rectification**: the branch's act of recording
that some or all of a finding's outstanding cases/amount have been resolved, District's act of
verifying that recorded work, and everything that can happen to a rectification afterward (return for
correction, resubmission, closure). It goes one level deeper than `workflow.md` §4-§6, which places
rectification in the context of the full status state machine — this document instead treats
rectification as its own subsystem: every validation rule, both input shapes (itemized vs.
non-itemized), the data model behind it, and the UI that drives it.

Every non-trivial claim is cited `file:line`. Where the client-side and server-side logic must stay in
sync (they are two independent implementations of the same rule), both copies are cited and compared.

---

## 1. Where rectification fits

A finding becomes rectifiable the moment it reaches `SENT_TO_BRANCH_MANAGER` (see `workflow.md` §2 for
how it gets there — either via District→HO review, or directly if HO registered it bank-scope). From
that point on, rectification is an open-ended, incremental process: a Branch Manager or Branch
Controller (anyone holding `findings.rectify`) can record rectification entries one at a time, each one
covering some or all of what's still outstanding, until the finding is fully rectified (`RECTIFIED`) —
or partially rectified across several entries (`PARTIALLY_RECTIFIED`), transferred while still partially
open, returned for correction and resubmitted, and so on.

**Not self-service by District/HO** — recording a rectification is exclusively a branch-level action.
District's and HO's only involvement with a rectification entry itself is to *verify* it (§5) or *return*
it (§6) — they never record one themselves.

---

## 2. The two input shapes: itemized vs. non-itemized

Whether a finding is rectified by typing numbers or by picking specific cases is decided **once, at
registration time**, by whether the finding has `FindingCase` rows at all — not by anything the person
rectifying chooses.

### 2.1 How a finding becomes itemized

On the registration form (`NewFindingForm.tsx`), a create-mode-only "Itemize cases" toggle
(`itemizeCases` state, `NewFindingForm.tsx:321`) lets the registrant enter one amount per case instead
of a single lump `amount`. If enabled, the live sum of every per-case amount must match the finding's
total `amount` field to within 0.01 (`caseAmountsMatch`, `NewFindingForm.tsx:334-335`) — submission is
blocked otherwise (`NewFindingForm.tsx:489`). On success, the server creates one `FindingCase` row per
entry, each starting at `status: "OUTSTANDING"` (`src/app/api/findings/route.ts:253-263`). **This choice
is permanent** — there is no code path that itemizes an already-registered finding, or that converts an
itemized finding back to plain totals; the doc comment at `NewFindingForm.tsx:319-321` notes the
itemize toggle is hidden entirely once `isEditing` is true.

### 2.2 Itemized rectification

If `db.findingCases` has any rows for this finding (`existingCases.length > 0`,
`rectify/route.ts:97`), the finding **must** be rectified by selecting specific case IDs — a plain
count/amount pair is rejected outright, even if the numbers would otherwise add up correctly
(`rectify/route.ts:98-99`, error: *"This finding's cases are itemized - select which case(s) to
rectify"*). The request body is `{ caseIds: string[] }`.

Server-side validation, in order (`rectify/route.ts:101-115`):
1. Every `caseId` in the request must resolve to a `FindingCase` belonging to this finding
   (`rectify/route.ts:101-104`) — error: *"One or more selected cases don't belong to this finding"*.
2. Every selected case must currently be `OUTSTANDING`, not already `RECTIFIED` by an earlier entry
   (`rectify/route.ts:106-112`) — error names the offending case number(s) explicitly:
   *"Case(s) {seq, seq, ...} are already rectified"*.
3. `rectifiedCases`/`rectifiedAmount` for this entry are **derived**, never typed: `rectifiedCases =
   selected.length`, `rectifiedAmount = sum(selected case amounts)` (`rectify/route.ts:113-114`). Because
   the amount is always the exact sum of whichever cases were picked, **the exhaustion rule (§3.3) can
   never be violated on this path** — there is no way to pick "all the cases" while leaving money
   unaccounted for, since the money picked is always exactly the money attached to the cases picked
   (doc comment, `rectify/route.ts:42-44`).

UI (`FindingDetailClient.tsx:713-746`): a checkbox list of every currently-`OUTSTANDING` `FindingCase`
(`outstandingFindingCases`, `FindingDetailClient.tsx:141`), each row showing `Case {seq} — {currency}
{amount}`. A running "Selected: N case(s) / amount" summary updates live as boxes are checked
(`FindingDetailClient.tsx:736-745`). The Record button is disabled until at least one case is selected
(`FindingDetailClient.tsx:799`, `isItemized && selectedCaseIds.length === 0`) — there is no client-side
mirror of the server's itemized validation beyond that, because there's nothing to mirror: the two
rules above (belongs-to-finding, currently-outstanding) are already enforced by only ever rendering
outstanding cases as checkable in the first place.

### 2.3 Non-itemized rectification

If the finding has zero `FindingCase` rows, rectification is a plain `{ rectifiedCases: number,
rectifiedAmount: number }` pair — this is the original, still-default flow, and the one with the
exhaustion rule described in full in §3.

---

## 3. Non-itemized validation, in exact order

This is the most rule-dense part of the feature and the part most likely to reject a well-intentioned
entry for a non-obvious reason. All rules live in `rectify/route.ts`'s non-itemized branch
(`rectify/route.ts:116-175`) and are mirrored client-side in `FindingDetailClient.tsx`'s `handleRectify()`
(`FindingDetailClient.tsx:278-314`) so a doomed request is caught before it round-trips to the server —
**the server route remains the sole authority**; the client copy exists purely to give faster feedback
and must be kept in lockstep by hand (there is no shared/imported validation function).

Given `outstandingCases = finding.caseCount - finding.rectifiedCases` and `outstandingAmount =
finding.amount - finding.rectifiedAmount` (`rectify/route.ts:94-95`, `FindingDetailClient.tsx:155-156`
— note this is the *rectify-outstanding* pair, distinct from the *transfer-outstanding* pair described
in `workflow.md` §7.1 and §4.1's field table):

1. **At least one of cases/amount must be present and nonzero.**
   `rectifiedCases === undefined || rectifiedAmount === undefined` → 400, *"Enter a rectified case count
   and amount"* (`rectify/route.ts:117-119`, server-only — the client always sends both fields, defaulting
   empty inputs to `0` via `Number(rectifyForm.rectifiedCases || 0)`, `FindingDetailClient.tsx:284-285`).
   Then `rectifiedCases === 0 && rectifiedAmount === 0` → 400, *"Enter at least a rectified case count or
   amount"* (`rectify/route.ts:120-122`, server-only; the client has no equivalent check, relying on the
   server here since a genuinely empty double-zero submission is an edge case the UI doesn't specifically
   guard).

2. **A positive amount needs at least one case attached to it.** `rectifiedAmount > 0 && rectifiedCases
   === 0` → 400, *"A rectified amount must have at least one rectified case attached to it"*
   (`rectify/route.ts:129-134`, mirrored `FindingDetailClient.tsx:291-294`). Money resolved with no case
   to attach it to doesn't represent a real rectification. **The reverse is explicitly allowed**: `cases >
   0` with `amount === 0` is valid — a case can genuinely rectify to zero monetary impact (e.g. a
   discrepancy that turns out to be a documentation error, not an actual shortage). This is also the rule
   that makes **rectifying a zero-total-amount finding possible at all** (see §7).

3. **The exhaustion rule — the core anti-orphaning rule** (`rectify/route.ts:135-172`, mirrored
   `FindingDetailClient.tsx:295-313`). A non-itemized finding tracks only two running totals, with no
   per-case amount to attach a "leftover" balance to. So whenever one dimension of *this entry* would
   exhaust everything currently outstanding, the other dimension must exhaust too, or the excess would be
   permanently unattachable to anything:
   - **Cases-exhausting direction**: if `rectifiedCases === outstandingCases` (this entry claims every
     remaining case), then `rectifiedAmount` must equal `outstandingAmount` exactly, or → 400: *"This
     rectifies every remaining case ({outstandingCases}) - the amount must be the full remaining balance
     ({outstandingAmount}), not a partial amount"* (`rectify/route.ts:150-157`).
   - **Amount-exhausting direction, guarded**: if `rectifiedAmount === outstandingAmount` **and
     `outstandingAmount > 0`**, then `rectifiedCases` must equal `outstandingCases` exactly, or → 400:
     *"This rectifies the full remaining amount ({outstandingAmount}) - the case count must be the full
     remaining {outstandingCases} case(s), not a partial count"* (`rectify/route.ts:165-172`).

   **The `outstandingAmount > 0 &&` guard is the specific fix this project made to support zero-amount
   findings** (see §7 for the full worked example) — without it, a finding with `outstandingAmount === 0`
   would have `rectifiedAmount === 0 === outstandingAmount` trivially true on *every single partial
   entry*, wrongly forcing each one to also finish every remaining case in one go, purely because there
   was never any money to exhaust in the first place — not because that entry was genuinely the last one
   (doc comment, `rectify/route.ts:158-164`).

   This is the rule that catches the canonical bug case cited directly in the code comment: *"2 of 2
   cases rectified for only 7,000 of a 70,000 balance"* — both of rule 4's simple bounds checks below
   pass that input (2 ≤ 2, 7,000 ≤ 70,000) without this rule (`rectify/route.ts:46-51,142-149`).

4. **Bounds checks — neither dimension may exceed what's outstanding.** Checked *after* the itemized/
   non-itemized branch, so they apply to both paths uniformly (though for itemized entries these can
   never actually fire, since a selection can never exceed what's outstanding by construction):
   - `rectifiedCases > outstandingCases` → 400, *"Rectified cases ({rectifiedCases}) cannot exceed the
     outstanding {outstandingCases}"* (`rectify/route.ts:177-182`).
   - `rectifiedAmount > outstandingAmount` → 400, *"Rectified amount ({rectifiedAmount}) cannot exceed the
     outstanding {outstandingAmount}"* (`rectify/route.ts:183-188`).

### 3.1 Status and scope gates (apply to both input shapes)

Before any of the above runs:
- **Permission**: `findings.rectify` (`rectify/route.ts:53`).
- **Scope**: `assertFindingInScope()` — the finding must be within the actor's branch/district/bank
  scope (`rectify/route.ts:67-68`).
- **Status**: must be one of `RECTIFIABLE_STATUSES = ["SENT_TO_BRANCH_MANAGER", "PARTIALLY_RECTIFIED",
  "TRANSFERRED", "RECTIFICATION_RETURNED"]` (`rectify/route.ts:20`), else 409, *"This finding isn't
  awaiting rectification"* (`rectify/route.ts:70-72`). `TRANSFERRED` is included because a transfer
  moves the finding forward without pausing its workflow (§8); `RECTIFICATION_RETURNED` is included so
  a branch responding to a return can simply record more rectification directly, which naturally
  re-derives `PARTIALLY_RECTIFIED`/`RECTIFIED` without a separate "un-return" step (`rectify/route.ts:11-19`).
- **Period writable**: `assertPeriodWritable()` — once the finding's reporting period is `LOCKED`, rectify
  is blocked; the Transfer Engine is the intended escape hatch instead (`rectify/route.ts:74-79`).

### 3.2 Client/server sync status

As of this writing, the client mirror (`FindingDetailClient.tsx:283-314`) covers rules 2 and 3 above
exactly, using identical thresholds and near-identical error text. It does **not** duplicate rule 1
(the "at least one field present/nonzero" checks) or rule 4 (the plain bounds checks) — those are left
to the server round-trip. This is a real, currently-accurate asymmetry, not a stale copy — both files
were checked against each other directly for this document. If either file's rules change in the
future, the other must be updated by hand; there is no shared validation function imported by both.

---

## 4. What a successful rectification writes

On success (`rectify/route.ts:190-264`), inside one `updateDb()` transaction:

1. **A `RectificationEntry` row is appended** (`rectify/route.ts:194-206`) — immutable, one row per
   `rectify` call, never edited or deleted afterward. Fields: `id`, `findingId`, `periodId` (**snapshotted
   at this exact moment** — `f.periodId`, not re-read later — so a later transfer never retroactively
   reattributes an old entry to a different period, per `RectificationEntry`'s own doc comment,
   `prisma/schema.prisma:498-502`), `rectifiedCases`, `rectifiedAmount`, optional `note`, `submittedBy`/
   `submittedByName`, `createdAt`, and (itemized only) `caseIds` — the scalar list of which specific
   `FindingCase` ids this entry claimed. `caseIds` is stored as a plain scalar array, not a join table,
   because it's a point-in-time snapshot of a decision, not a live relation (schema comment,
   `prisma/schema.prisma:498-502`) — a case can only ever be claimed by one rectification, ever.

2. **Itemized only — the claimed `FindingCase` rows flip to `RECTIFIED`** (`rectify/route.ts:208-218`):
   `status: "RECTIFIED"`, `rectificationId` set to the new entry's id, plus `rectifiedAt`/`rectifiedBy`/
   `rectifiedByName` stamped on each case row individually.

3. **The finding's running totals are incremented** (`rectify/route.ts:220-221`): `f.rectifiedCases +=
   rectifiedCases`, `f.rectifiedAmount += rectifiedAmount` — cumulative across every entry ever recorded,
   never reset.

4. **Status is re-derived from the new totals** (`rectify/route.ts:223-225`): `fullyRectified =
   f.rectifiedCases >= f.caseCount && f.rectifiedAmount >= f.amount`; `toStatus = fullyRectified ?
   "RECTIFIED" : "PARTIALLY_RECTIFIED"`. Note the comparison is `>=`, not `===` — belt-and-suspenders
   against any future floating-point drift, though the validation in §3 should make it exactly equal in
   practice. `transitionFinding()` records this as a `FindingTransition` row, action `"RECTIFY"`.

5. **Notifications** (`rectify/route.ts:227-261`): every entry — partial or full — notifies (a) the
   *other* `findings.rectify` holder(s) at the same branch, excluding whoever just recorded it (Branch
   Manager and Branch Controller both typically hold this permission, so each sees the other's work), and
   (b) District's `verify-rectification`/`return-rectification` holders, so District has something to act
   on regardless of whether this entry finished the job or was only partial.

---

## 5. Verifying a rectification

`POST /api/findings/[id]/verify-rectification` (`verify-rectification/route.ts`) is District's gate on a
recorded rectification, **before any of it is closable by anyone, including HO**
(doc comment, `verify-rectification/route.ts:8-18`).

- **Permission**: `findings.verify-rectification` (`verify-rectification/route.ts:20`).
- **Status gate**: blocked only when status is `RECTIFICATION_RETURNED` or `CLOSED`
  (`verify-rectification/route.ts:31-33`) — otherwise available at *any* status, since verification
  tracks its own counter independently of `Finding.status`.
- **Something-to-verify gate**: `verifiableCases = rectifiedCases - districtVerifiedCases`,
  `verifiableAmount = rectifiedAmount - districtVerifiedAmount`; blocked with 409, *"Nothing rectified is
  awaiting verification yet"* if both are `<= 0` (`verify-rectification/route.ts:34-38`).
- **No partial-verify concept**: on success, *both* counters are bumped by the **full** unverified
  remainder in one call (`verify-rectification/route.ts:43-44`) — there is no way to verify only some of
  what's currently outstanding-and-rectified; it's all-or-nothing per call, though a District Controller
  can call it again later after more rectification has been recorded.
- **Does not change `Finding.status`** — this action never calls `transitionFinding()`. It only appends an
  `AuditLogEntry` with action `DISTRICT_VERIFY_RECTIFICATION` (`verify-rectification/route.ts:47-54`).
  This is why any code needing to know "did this user verify something on this finding" must query
  `auditLogs`, not `findingTransitions` (see `workflow.md` §10 item 4 and §5.3 item 1 for where this
  matters — the separation-of-duties check on Return for Correction).
- **Notifies**: District's own `close` permission holders — "ready to close" (`verify-rectification/route.ts:56-62`).

UI (`FindingDetailClient.tsx:259-276`, `821-835`): a "Verify Rectification" card shows `{verifiableCases}
case(s) / {currency} {verifiableAmount}` awaiting verification, with a single "Verify" button (a confirm
dialog, no extra input) — clicking it always claims the full unverified remainder, matching the
all-or-nothing server behavior. This card only renders once real rectification exists — see `workflow.md`
§5.1 for why `SENT_TO_BRANCH_MANAGER` can never show it.

---

## 6. Returning a rectification, and resubmitting

These two actions are fully documented as part of the state machine in `workflow.md` §5 (Return for
Correction rules — including the `RETURNABLE_STATUSES` restriction, the District/HO permission split, the
separation-of-duties gate, and the post-transfer gate) and §5.5 (Resubmit Rectification). This document
only adds the rectification-specific framing:

- **What "returning a rectification" means concretely**: it does not undo or delete any
  `RectificationEntry` row — those remain in the ledger permanently (§4, §9). It only moves
  `Finding.status` to `RECTIFICATION_RETURNED`, which blocks close/transfer until addressed
  (`workflow.md` §3, action #13).
- **Two ways to resolve a return**, both already covered above: record a brand-new `rectify` call
  directly (§2-§4 — `RECTIFICATION_RETURNED` is a valid `RECTIFIABLE_STATUSES` entry, §3.1), which
  naturally re-derives `PARTIALLY_RECTIFIED`/`RECTIFIED` from the *updated* totals; or call
  `resubmit-rectification` when nothing numeric needs to change (e.g. a documentation/evidence fix) — see
  `workflow.md` §5.5 for the exact re-derivation logic and its one dead defensive branch.
- **A return does not touch `districtVerifiedCases`/`districtVerifiedAmount`** — if District had already
  verified part of the rectification before returning it (only possible for HO's return, since HO's gate
  requires `districtVerifiedCases/Amount > 0`, `workflow.md` §5.2), that verified figure is untouched by
  the return and remains valid; only the un-verified remainder is what's actually in dispute.

---

## 7. Worked example: rectifying a zero-amount, multi-case finding

This is the exact scenario this project's zero-amount fix was built and verified against, walked through
step by step against the actual validation code in §3.

A finding has `caseCount: 3`, `amount: 0` (e.g. three procedural/documentation cases with no monetary
shortage attached). At `SENT_TO_BRANCH_MANAGER`: `outstandingCases = 3`, `outstandingAmount = 0`.

**Attempt: rectify 1 case, $0 amount** (`{ rectifiedCases: 1, rectifiedAmount: 0 }`):
- Rule 1: not both zero-and-zero as a *pair check* — wait, `rectifiedCases=1` is nonzero, so this passes.
- Rule 2: `rectifiedAmount (0) > 0`? No — skipped, this rule only fires for a *positive* amount with zero
  cases.
- Rule 3, cases-exhausting direction: `rectifiedCases (1) === outstandingCases (3)`? No — skipped.
- Rule 3, amount-exhausting direction: **guard `outstandingAmount > 0`** — `outstandingAmount` is `0`, so
  this whole branch is skipped entirely, regardless of whether `rectifiedAmount === outstandingAmount`
  would otherwise be trivially true (`0 === 0`).
- Rule 4: `1 <= 3` ✓, `0 <= 0` ✓.
- **Result: accepted.** Finding moves to `PARTIALLY_RECTIFIED`, `rectifiedCases: 1`, `rectifiedAmount: 0`.

Without the `outstandingAmount > 0 &&` guard, rule 3's amount-exhausting check would have fired
here — `rectifiedAmount (0) === outstandingAmount (0)` is trivially true — and demanded `rectifiedCases
=== outstandingCases (3)`, rejecting this perfectly reasonable single-case entry with *"the case count
must be the full remaining 3 case(s)"*, even though there was never any money to exhaust in the first
place. This exact request (`{rectifiedCases: 1, rectifiedAmount: 0}` against a 3-case, $0 finding) was
used to verify the fix live against a disposable test finding during this project's development.

---

## 8. Rectification and other lifecycle actions

- **Transfer** (`workflow.md` §7): does **not** exclude a finding based on rectification progress —
  `TRANSFERABLE_STATUSES` includes `SENT_TO_BRANCH_MANAGER`, `PARTIALLY_RECTIFIED`, `RECTIFIED`,
  `RECTIFICATION_RETURNED`, and `TRANSFERRED` itself. Critically, what transfers forward is based on
  `closedCases`/`closedAmount` (formal closure), **not** `rectifiedCases`/`rectifiedAmount` — a
  `RECTIFIED`-but-not-yet-`CLOSED` finding still carries its full `caseCount`/`amount` forward when
  transferred, because none of it has been formally closed yet (`workflow.md` §7.1).
  **A transfer also resets rectification that isn't closed yet** - cases awaiting district
  verification, verified but not closed, or returned for correction: `rectified`/`districtVerified`
  go back to what was closed, itemized cases not covered by a closure go back to *Outstanding*, and
  the branch rectifies every transferred case again in the new period. Closed work stays in the
  period it was closed in; the old rectification records stay as that period's history. Logged as
  `TRANSFER_RESET_PENDING` in the audit log, and the Transfer confirmation says how many cases are
  reset (`transferFinding()` in `src/lib/findings.ts`; tests in `tests/reverseScenarios.test.ts`).
- **Close** (`workflow.md` §6): bounded by `min(rectifiedCases, districtVerifiedCases) - closedCases` —
  closure can never race ahead of either the branch's own rectification or District's verification of it.
  A finding can be partially closed (leaving `Finding.status` untouched) at any point once *some* rectified
  work is also verified, even while more remains outstanding.
- **Dashboards and scoring never credit `rectifiedCases`/`rectifiedAmount` directly** — every
  official/eligible-case calculation (`computeEligibleCaseCounts`, referenced throughout `report-
  templates.md` §8) counts only `closedCases`. A rectification the branch has recorded, even one District
  has already verified, is not yet something the scoring formula credits until HO has formally closed it.

---

## 9. The Rectification Ledger (UI)

Every finding's detail page shows a **Rectification Ledger** card once at least one entry exists
(`rectifications.length > 0`, `FindingDetailClient.tsx:1266-1282`) — a flat, chronological, read-only list
of every `RectificationEntry` ever recorded against this finding, across every rectify call, return, and
resubmission cycle it's ever been through. Each row: `{submittedByName} recorded {rectifiedCases} case(s)
/ {currency} {formatCurrency(rectifiedAmount)}`, the entry's `note` if one was given, and a timestamp
(`FindingDetailClient.tsx:1270-1279`). There is no way to edit or delete a ledger entry from the UI or any
API route — the ledger is append-only by design, matching `RectificationEntry`'s immutability at the data
layer (§4).

For an itemized finding, a separate **Cases** card (`FindingDetailClient.tsx:1152-1177`) lists every
`FindingCase` (sorted by `seq`), each tagged `Outstanding` (amber) or `Rectified` (green), and — once
rectified — who rectified it and when. This is the per-case complement to the ledger's per-entry view:
the ledger shows *when and by whom* rectification happened in aggregate; the Cases card shows the current
*state of each individual case*.

---

## 9.1 A fully-rectified finding can still be `TRANSFERRED`/`RECTIFICATION_RETURNED` — the card must check for real outstanding work, not just status

`RECTIFIABLE_STATUSES` includes `TRANSFERRED` and `RECTIFICATION_RETURNED`, and neither of
those transitions resets `rectifiedCases`/`rectifiedAmount`:

- A `RECTIFIED` (100% self-reported) finding that hasn't been formally closed yet is still
  eligible to be swept by the Transfer Engine (`TRANSFERABLE_STATUSES` includes `RECTIFIED`,
  `workflow.md` §7.2) — `transferFinding()` only reassigns `periodId` and flips `status`; it
  never touches `rectifiedCases`/`rectifiedAmount` (`src/lib/findings.ts:78-85`). So a
  `TRANSFERRED` finding can perfectly well have `rectifiedCases === caseCount` and
  `rectifiedAmount === amount` already — nothing left to rectify, even though `TRANSFERRED`
  is a "rectifiable" status.
- A `RECTIFICATION_RETURNED` finding can likewise already be fully rectified — `Return for
  Correction` never resets the totals it's returning (`workflow.md` §5.4); it only flips
  status.

**Status membership alone is therefore not sufficient to gate the Record Rectification
card.** The permission computed in `src/app/(app)/findings/[id]/page.tsx` (`canRectify`)
now additionally requires `rectifiedCases < caseCount || rectifiedAmount < amount` — i.e.
`!fullyRectified` — on top of the status check. Without this, the card stays open on an
already-fully-rectified finding and every entry a user types is guaranteed to fail
server-side with *"Rectified cases (N) cannot exceed the outstanding 0"* — a dead end, not
a real choice. This does not strand a fully-rectified `RECTIFICATION_RETURNED` finding:
`canResubmitRectification` is gated purely on `status === "RECTIFICATION_RETURNED"`
(`page.tsx:245`), independent of outstanding totals, so Resubmit remains the correct,
always-available way out of that state.

---

## 10. Permission summary

| Action | Permission | Who typically holds it |
|---|---|---|
| Record a rectification (itemized or not) | `findings.rectify` | Branch Manager, Branch Controller |
| Verify a rectification | `findings.verify-rectification` | District Controller |
| Return a rectification for correction | `findings.return-rectification` (legacy/unrestricted), `findings.district-return-rectification`, or `findings.ho-return-rectification` (gated — see `workflow.md` §5.2) | District Controller, HO Controller |
| Resubmit after a return | `findings.rectify` (same permission as recording) | Branch Manager, Branch Controller |
| Close (verified) rectified work | `findings.close` | District Controller, HO Controller |

All permissions are role-data, not hardcoded — see `admin-settings.md` for the full registry and default
role grants.
