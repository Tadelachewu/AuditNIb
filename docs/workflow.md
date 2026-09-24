# Finding Lifecycle / Workflow State Machine

This is the authoritative reference for how a `Finding` moves through NIB
Control360 (ICFMS), from registration to a terminal state. This workflow is
the app's core value proposition — every rule below is enforced **server-side**
in the API routes, not just in the UI. The UI (`FindingDetailClient.tsx` +
`findings/[id]/page.tsx`) only decides which buttons to *show*; the routes
themselves are the actual authority and re-derive every gate independently.

All file:line citations refer to the repository at
`C:\Users\HP\Desktop\AdonayAudit\auditapp` as of this writing.

---

## 1. Overview — every `FindingStatus` value

Defined as `FINDING_STATUSES` and the derived `FindingStatus` union type in
`src/types/index.ts:440-474`, and mirrored exactly in the Postgres enum
`FindingStatus` in `prisma/schema.prisma:60-76` (verified identical, 15
values, same order).

| Status | Meaning |
|---|---|
| `DRAFT` | Being authored; not yet submitted. Only status (besides `RETURNED`) that is editable/deletable. |
| `SUBMITTED` | Momentary pass-through the instant a finding is submitted — never a finding's resting status (see §10). |
| `DISTRICT_REVIEW` | Awaiting the District Internal Controller's decision (branch/district-originated findings only). |
| `DISTRICT_APPROVED` | Momentary pass-through immediately followed by `HO_REVIEW` in the same call. |
| `HO_REVIEW` | Awaiting the Head Office Internal Controller's decision. |
| `HO_APPROVED` | Momentary pass-through immediately followed by `SENT_TO_BRANCH_MANAGER`. |
| `PENDING_BANK_APPROVAL` | The optional single approval step for a bank-scope-registered finding (`Settings.hoApproval.required`). Only ever reached by bank-registered findings, never by the normal district/HO chain. |
| `SENT_TO_BRANCH_MANAGER` | Fully approved (by whichever path); the branch may now record rectification. Nothing rectified yet. |
| `PARTIALLY_RECTIFIED` | Some, but not all, of `caseCount`/`amount` has been rectified. |
| `RECTIFIED` | 100% of `caseCount` and `amount` rectified (self-reported by the branch — not yet necessarily verified or closed). |
| `TRANSFERRED` | Outstanding (unclosed) balance carried into a new reporting period via the Transfer Engine. Still an active, workable finding — not terminal. |
| `RECTIFICATION_RETURNED` | A District/HO Controller sent a recorded rectification back to the branch for correction. Blocks close/transfer until resubmitted. |
| `REJECTED` | Terminal. A review-stage (District/HO/Bank) decision that stops the finding outright — cannot be resubmitted. |
| `RETURNED` | A review-stage decision sending the finding back to the branch *before* rectification ever started, for the branch to edit and resubmit. Editable/submittable, like `DRAFT`. |
| `CLOSED` | Terminal. `closedCases`/`closedAmount` have reached `caseCount`/`amount`. |

Three statuses — `SUBMITTED`, `DISTRICT_APPROVED`, `HO_APPROVED` — are real
rows in the `FindingTransition` audit trail but can never be observed as
`Finding.status` when read back, because `transitionFinding()` is called
twice in the same request/`updateDb()` call for each (see
`FILTERABLE_FINDING_STATUSES`, `src/types/index.ts:496-517`, and §10 below).

---

## 2. The state machine, in prose

### 2.1 Registration and the fork at Submit

Every finding starts life as `DRAFT` (`src/app/api/findings/route.ts:235`,
`status: "DRAFT"`). A `DRAFT` (or a `RETURNED` finding being resubmitted) is
editable/deletable only by its own creator
(`src/app/api/findings/[id]/route.ts:101-103`, `:253-255`) and only while the
finding's reporting period is writable (`assertPeriodWritable`,
`src/lib/findings.ts:463-471`).

Submitting (`POST /api/findings/[id]/submit`,
`src/app/api/findings/[id]/submit/route.ts`) requires:
- `findings.submit` permission, ownership (`createdBy === session.userId`, line 24-26),
- current status in `SUBMITTABLE_STATUSES = ["DRAFT", "RETURNED"]` (line 8, 28-30),
- the period is writable (`assertPeriodWritable`, line 32-33) **and** currently
  open for submission (`assertPeriodOpenForSubmission`, line 35-36 — a
  narrower, independent window inside the period's own
  `submissionStartsAt`/`submissionEndsAt`, `src/lib/findings.ts:473-502`).

The actual routing fork happens inside `submitFinding()`
(`src/lib/findings.ts:401-429`), keyed off **the submitting user's current
session `orgScope`**, not who originally created the finding
(doc comment at `src/lib/findings.ts:389-400`):

```
registeredByBankScope = session.orgScope === "BANK"   // decided at submit time, re-decided on every resubmit
finding.registeredByBankScope = registeredByBankScope  // persisted (Finding.registeredByBankScope)
transitionFinding(... toStatus: "SUBMITTED" ...)

if (registeredByBankScope) {
  if (settings.hoApproval.required) → toStatus "PENDING_BANK_APPROVAL"
  else                               → toStatus "SENT_TO_BRANCH_MANAGER"
} else {
  → toStatus "DISTRICT_REVIEW"
}
```

This is the **fork** the task asked to nail exactly:

- **Path A — branch/district-scope submission** (`registeredByBankScope === false`,
  i.e. the submitter's session `orgScope` is `DISTRICT` or `BRANCH`):
  `DRAFT/RETURNED → SUBMITTED → DISTRICT_REVIEW`
  (`src/lib/findings.ts:428`, action `QUEUE_DISTRICT_REVIEW`).

- **Path B — bank-scope submission** (`registeredByBankScope === true`, the
  submitter's session `orgScope` is `BANK` — e.g. an HO Controller or Admin
  registering a finding directly): skips `DISTRICT_REVIEW`/`HO_REVIEW`
  entirely (doc comment `src/lib/findings.ts:389-400`: "there's no natural
  'district' to review a finding HO itself registered"), and instead:
  - if `Settings.hoApproval.required` is **true**:
    `DRAFT/RETURNED → SUBMITTED → PENDING_BANK_APPROVAL`
    (`src/lib/findings.ts:421`, action `QUEUE_BANK_APPROVAL`);
  - if `Settings.hoApproval.required` is **false**:
    `DRAFT/RETURNED → SUBMITTED → SENT_TO_BRANCH_MANAGER`
    (`src/lib/findings.ts:423`, action `QUEUE_BRANCH_MANAGER`) — i.e. it
    lands directly on the same destination status the normal chain would
    eventually reach anyway, with no approval step at all.

`registeredByBankScope` is **persisted on the Finding row**
(`prisma/schema.prisma:440`) and re-read much later by
`return-rectification/route.ts` to decide return-for-correction eligibility
(see §5). It is re-computed and overwritten on every call to
`submitFinding()` (line 415), so a finding originally registered bank-scope
that gets `RETURNED` and is later resubmitted by a branch-scoped user
correctly flips back to `false` — and vice versa.

### 2.2 Path A: District Review → HO Review

`DISTRICT_REVIEW` (`POST /api/findings/[id]/district-review`,
`src/app/api/findings/[id]/district-review/route.ts`) — requires
`findings.district-review`, status must be exactly `DISTRICT_REVIEW`
(line 42-44), and the finding must be in the reviewer's org scope
(`assertFindingInScope`). Three decisions (`reviewSchema`, line 9-17;
`reason` required, min 5 chars, unless `APPROVE`):

- **APPROVE** → `districtApproveFinding()` (`src/lib/findings.ts:431-434`):
  `DISTRICT_REVIEW → DISTRICT_APPROVED → HO_REVIEW` (two transitions in one
  call). Notifies HO reviewers.
- **RETURN** → `DISTRICT_REVIEW → RETURNED`, action `DISTRICT_RETURN`
  (line 76-77). **Blocked** if the reviewer is the finding's own creator
  (line 53-58 — "meaningless no-op," separation-of-duties). Notifies the creator.
- **REJECT** → `DISTRICT_REVIEW → REJECTED`, action `DISTRICT_REJECT`
  (line 76-77). Self-rejection is allowed (only self-*return* is blocked).
  Notifies the creator.

`HO_REVIEW` (`POST /api/findings/[id]/ho-review`,
`src/app/api/findings/[id]/ho-review/route.ts`) — requires
`findings.ho-review`, status must be exactly `HO_REVIEW` (line 40-42). HO is
BANK-scoped so `assertFindingInScope` allows any district/branch (comment,
line 20-21).

- **APPROVE** → `hoApproveFinding()` (`src/lib/findings.ts:436-444`):
  `HO_REVIEW → HO_APPROVED → SENT_TO_BRANCH_MANAGER` (two transitions, one
  call). Notifies branch-level `rectify` holders at `f.branchId`.
- **RETURN** → `HO_REVIEW → RETURNED`, action `HO_RETURN` (line 72-74).
  Blocked for self-created findings (line 50-55). Notifies **both** the
  creator **and** the District Controller(s) of that district (line 79-95 —
  doc comment: Document_3 §9/§30 depicts HO's return as
  "HO → District → Branch Controller," so District must be kept in the loop
  even though the finding itself routes straight back to the creator).
- **REJECT** → `HO_REVIEW → REJECTED`, action `HO_REJECT`. Same dual
  notification as Return (comment line 87-91: District already approved
  this finding at their own stage, so HO overriding that approval — whether
  by Return or Reject — is news to them either way).

A `RETURNED` finding, once edited and resubmitted, **always re-enters at
`DISTRICT_REVIEW`** (assuming it's still a non-bank-scope resubmission) —
`submitFinding()` has no memory of "how far it previously got"; it always
restarts the chain from the top appropriate to the *current* submitter's
`orgScope`.

### 2.3 Path B: Bank Approval

`PENDING_BANK_APPROVAL` (`POST /api/findings/[id]/bank-approval`,
`src/app/api/findings/[id]/bank-approval/route.ts`) — requires
**two independent gates** (doc comment line 19-32): (1) `findings.bank-approval`
permission (role-level eligibility) **and** (2) the specific user must be
individually listed in `Settings.hoApproval.approverUserIds` (line 39-41,
checked before even parsing the body). Status must be exactly
`PENDING_BANK_APPROVAL` (line 55-57).

- **APPROVE** → `PENDING_BANK_APPROVAL → SENT_TO_BRANCH_MANAGER`, action
  `BANK_APPROVE` (line 81-86) — a single transition (no intermediate
  pass-through status, unlike HO's two-hop `HO_APPROVED → SENT_TO_BRANCH_MANAGER`).
  Notifies branch-level `rectify` holders. Doc comment (line 62-67): this is
  actually the *common* case — a HO Controller self-approving their own
  Internal Audit finding.
- **RETURN** → `PENDING_BANK_APPROVAL → RETURNED`, action `BANK_RETURN`.
  Blocked for self-created findings (line 68-73). Also notifies district's
  `district-review` holders even though this finding never went through
  district review (line 102-111 — "may still care that a bank-registered
  finding for their district just got sent back").
- **REJECT** → `PENDING_BANK_APPROVAL → REJECTED`, action `BANK_REJECT`.

Both branches of Path B converge on `SENT_TO_BRANCH_MANAGER` — from that
point on, the workflow is **identical** regardless of which path a finding
took to get there (rectify/verify/return/close/transfer all operate purely
on `Finding.status` and the accumulated case/amount counters, with no branch
on `registeredByBankScope` except in return-rectification, see §5).

### 2.4 Rectification → Verification → Close/Transfer (shared by both paths)

Once at `SENT_TO_BRANCH_MANAGER`, the finding enters the rectify/verify/close
loop described in detail in §4-§7. In prose, the possible paths from here:

```
SENT_TO_BRANCH_MANAGER
   │  RECTIFY (partial)                         RECTIFY (exhausts caseCount & amount)
   ├────────────────────► PARTIALLY_RECTIFIED ─────────────────► RECTIFIED
   │                            │  RECTIFY (more)  ▲                  │
   │                            └───────────────────┘                 │
   │                                                                   │
   │  (any of SENT_TO_BRANCH_MANAGER / PARTIALLY_RECTIFIED /           │
   │   RECTIFIED / RECTIFICATION_RETURNED / TRANSFERRED can be         │
   │   TRANSFERRED, manually or automatically — see §7)                │
   ▼                                                                   ▼
TRANSFERRED ◄──────────────────────────────────────────────────────────┘
   │ (still rectifiable/verifiable/closable/re-transferable in its new period)
   │
   │  RETURN_RECTIFICATION (District or HO, only once something is
   │  rectified — PARTIALLY_RECTIFIED/RECTIFIED/TRANSFERRED only)
   ▼
RECTIFICATION_RETURNED
   │  RESUBMIT_RECTIFICATION (no new numbers) ──► back to RECTIFIED /
   │                                              PARTIALLY_RECTIFIED /
   │                                              (defensive-only) SENT_TO_BRANCH_MANAGER
   │  RECTIFY (records new numbers directly) ──► PARTIALLY_RECTIFIED / RECTIFIED
   ▼
(loop continues)

Any of PARTIALLY_RECTIFIED / RECTIFIED / TRANSFERRED / (SENT_TO_BRANCH_MANAGER
 is NOT close-eligible until something is verified) → CLOSE (partial, status
 unchanged) or CLOSE (full, status → CLOSED, terminal) once District has
 verified the rectified portion.
```

Status alone does **not** fully describe rectification/close progress — see
§4 for why `closedCases`/`closedAmount`/`districtVerifiedCases`/
`districtVerifiedAmount` can lag behind `status` (a finding can sit at
`PARTIALLY_RECTIFIED` while already having some `closedCases` from an
earlier partial close).

---

## 3. Every transition, in detail

Notation: **Permission** is the `findings.<action>` key
(`src/lib/permissions/registry.ts:85-127`) checked by `requirePermission()`.
**Scope** is `assertFindingInScope()` (`src/lib/findings-scope.ts:12-24`) —
`BANK` orgScope sees everything, `DISTRICT` only its own `districtId`,
`BRANCH` only its own `branchId`.

| # | Action | Input status(es) | Output status | Permission | Extra checks | Route |
|---|---|---|---|---|---|---|
| 1 | Submit | `DRAFT`, `RETURNED` | `SUBMITTED` → (fork, see §2.1) | `findings.submit` | Ownership (`createdBy`); period writable; period open-for-submission window | `submit/route.ts` |
| 2 | District Review – Approve | `DISTRICT_REVIEW` | `DISTRICT_APPROVED` → `HO_REVIEW` | `findings.district-review` | Scope; period writable | `district-review/route.ts` |
| 3 | District Review – Return | `DISTRICT_REVIEW` | `RETURNED` | `findings.district-review` | Reviewer ≠ creator; reason ≥5 chars; period writable | `district-review/route.ts` |
| 4 | District Review – Reject | `DISTRICT_REVIEW` | `REJECTED` | `findings.district-review` | Reason ≥5 chars; period writable | `district-review/route.ts` |
| 5 | HO Review – Approve | `HO_REVIEW` | `HO_APPROVED` → `SENT_TO_BRANCH_MANAGER` | `findings.ho-review` | Scope (BANK-wide); period writable | `ho-review/route.ts` |
| 6 | HO Review – Return | `HO_REVIEW` | `RETURNED` | `findings.ho-review` | Reviewer ≠ creator; reason ≥5 chars; period writable | `ho-review/route.ts` |
| 7 | HO Review – Reject | `HO_REVIEW` | `REJECTED` | `findings.ho-review` | Reason ≥5 chars; period writable | `ho-review/route.ts` |
| 8 | Bank Approval – Approve | `PENDING_BANK_APPROVAL` | `SENT_TO_BRANCH_MANAGER` | `findings.bank-approval` **+** listed in `Settings.hoApproval.approverUserIds` | Period writable | `bank-approval/route.ts` |
| 9 | Bank Approval – Return | `PENDING_BANK_APPROVAL` | `RETURNED` | same as #8 | Approver ≠ creator; reason ≥5 chars; period writable | `bank-approval/route.ts` |
| 10 | Bank Approval – Reject | `PENDING_BANK_APPROVAL` | `REJECTED` | same as #8 | Reason ≥5 chars; period writable | `bank-approval/route.ts` |
| 11 | Rectify | `SENT_TO_BRANCH_MANAGER`, `PARTIALLY_RECTIFIED`, `TRANSFERRED`, `RECTIFICATION_RETURNED` | `PARTIALLY_RECTIFIED` or `RECTIFIED` (see §4) | `findings.rectify` | Period writable; exhaustion rule; per-case bounds (itemized) | `rectify/route.ts` |
| 12 | Verify Rectification | any except `RECTIFICATION_RETURNED`/`CLOSED` | *(no status change)* — bumps `districtVerifiedCases`/`Amount` | `findings.verify-rectification` | `rectifiedCases > districtVerifiedCases` or `rectifiedAmount > districtVerifiedAmount` (something unverified) | `verify-rectification/route.ts` |
| 13 | Return for Correction | `PARTIALLY_RECTIFIED`, `RECTIFIED`, `TRANSFERRED` | `RECTIFICATION_RETURNED` | `findings.return-rectification` (legacy) / `findings.district-return-rectification` / `findings.ho-return-rectification` | See §5 in full | `return-rectification/route.ts` |
| 14 | Resubmit Rectification | `RECTIFICATION_RETURNED` | `RECTIFIED` / `PARTIALLY_RECTIFIED` / (defensive) `SENT_TO_BRANCH_MANAGER` | `findings.rectify` | Period writable; re-derives from existing totals, no new numbers | `resubmit-rectification/route.ts` |
| 15 | Close | any except `CLOSED`/`RECTIFICATION_RETURNED` | `CLOSED` if fully closed, else unchanged (`PARTIAL_CLOSE` audit only) | `findings.close` | Closable amount bounded by `min(rectified, districtVerified) - closed` | `close/route.ts` |
| 16 | Transfer | `SENT_TO_BRANCH_MANAGER`, `PARTIALLY_RECTIFIED`, `RECTIFIED`, `RECTIFICATION_RETURNED`, `TRANSFERRED` | `TRANSFERRED` | `findings.transfer` | Destination period ≠ current, must be `OPEN` | `transfer/route.ts`, or automatic via `autoTransferOnLock()` |
| 17 | Edit | `DRAFT`, `RETURNED` | *(no status change)* | `findings.edit` | Ownership; period writable (both source and, if changed, target period) | `[id]/route.ts` PATCH |
| 18 | Delete | `DRAFT` only | *(row removed)* | `findings.delete` | Ownership; period writable | `[id]/route.ts` DELETE |
| 19 | Comment | any (viewable) | *(no status change)* | `findings.comment` | One level of reply threading only | `comments/route.ts` |
| 20 | Evidence upload | any (viewable) | *(no status change)* | `findings.evidence` (finding-level) or `findings.comment` (comment-level attachment) | 10 MB limit; allow-listed MIME + magic-byte content check | `evidence/route.ts` |

**Every** review-stage action (#2-#10) and every rectify/verify/return/
resubmit/close/transfer action (#11-#16) is additionally gated by
`assertPeriodWritable()` (`src/lib/findings.ts:463-471`): once a finding's
reporting period is `LOCKED`, *no* mutating action works — including
rectify/verify/close — with the sole intended escape hatch being **Transfer**,
which deliberately **skips** `assertPeriodWritable()` on the source period
(`transfer/route.ts:24-25`: "transfer is the intended path once a period
locks with the finding still outstanding").

---

## 4. Rectification rules in depth

### 4.1 The three counters — what each one tracks

These are easily confused; here is the precise distinction
(`src/types/index.ts:559-583`, `prisma/schema.prisma:441-446`):

| Field pair | Set by | Meaning | Ordering guarantee |
|---|---|---|---|
| `rectifiedCases` / `rectifiedAmount` | `rectify/route.ts` (Branch Manager/Controller, `findings.rectify`) | Cumulative **self-reported** rectification by the branch. "Outstanding" = `caseCount - rectifiedCases` / `amount - rectifiedAmount`. | Baseline — everything else is bounded by this. |
| `districtVerifiedCases` / `districtVerifiedAmount` | `verify-rectification/route.ts` (District Controller, `findings.verify-rectification`) | Cumulative amount of the *rectified* total that District has reviewed and approved as correct — "a required gate before any of it becomes closable" (`src/types/index.ts:573-581`). | Always `<= rectifiedCases`/`rectifiedAmount` (`verifiableCases = rectifiedCases - districtVerifiedCases`, never negative by construction). |
| `closedCases` / `closedAmount` | `close/route.ts` (District/HO Controller, `findings.close`) | Cumulative **formal closure** — the only thing that counts as "truly resolved" for dashboards, performance %, and what a transfer excludes. | Always `<= min(rectifiedCases, districtVerifiedCases)` — `closableCases = min(rectifiedCases, districtVerifiedCases) - closedCases` (`close/route.ts:51-54`). |

So the strict invariant is:
`closedCases ≤ districtVerifiedCases ≤ rectifiedCases ≤ caseCount` (and the
amount analogue). A case can be self-reported rectified by the branch,
sitting un-verified for weeks, while `status` stays `PARTIALLY_RECTIFIED`/
`RECTIFIED` the whole time — status tracks rectify/transfer progress only,
**not** verify/close progress (comment, `close/route.ts:24-29`).

Dashboards only ever count something as "rectified" once it is **CLOSED**,
never merely `rectifiedCases`/districtVerified (`findingCaseTotals()`,
`src/lib/findings.ts:238-269`; `computeEligibleCaseCounts()`,
`:862-909` — "A rectification the manager recorded, even one District has
already verified, is still not something the scoring formula can credit
until HO ... has actually closed it").

### 4.2 The rectify request itself (`rectify/route.ts`)

`RECTIFIABLE_STATUSES = ["SENT_TO_BRANCH_MANAGER", "PARTIALLY_RECTIFIED", "TRANSFERRED", "RECTIFICATION_RETURNED"]`
(line 20). `TRANSFERRED` is included because "transfer moves the finding
forward, it doesn't pause its workflow" (comment line 11-14).
`RECTIFICATION_RETURNED` is included so the branch can address a return by
recording *more* rectification directly, which naturally re-derives
`PARTIALLY_RECTIFIED`/`RECTIFIED` (comment line 14-19) without a separate
"un-return" step.

Two input shapes, chosen by whether the finding has `FindingCase` rows
(itemized, Document_3 §12/§34) or not:

- **Itemized**: caller sends `caseIds[]`; every id must belong to the
  finding and be currently `OUTSTANDING` (lines 97-115). `rectifiedCases`/
  `rectifiedAmount` for this entry are derived from the selected cases —
  no manual amount typed, so the exhaustion rules below can never be
  violated on this path (comment line 44-46: "an itemized finding's amount
  is always the exact sum of whichever case(s) were picked").

- **Non-itemized**: caller sends `rectifiedCases`/`rectifiedAmount` as
  plain numbers, validated by several rules in order (lines 117-188):
  1. At least one of cases/amount must be nonzero (line 120-122).
  2. A positive amount with zero cases is rejected — "money resolved
     without any case to attach it to makes no sense" (line 123-134). The
     reverse (cases > 0, amount == 0) **is** allowed — "a case can
     genuinely rectify to zero monetary impact."
  3. **The exhaustion rule** (the core anti-orphaning rule, lines 135-172):
     - If this entry's `rectifiedCases === outstandingCases` (every
       remaining case), then `rectifiedAmount` **must** equal
       `outstandingAmount` exactly (line 150-157) — you cannot claim "all
       cases done" while leaving money unaccounted for, since a
       non-itemized finding has no per-case amount to attach a leftover
       balance to.
     - Symmetrically, if this entry's `rectifiedAmount === outstandingAmount`
       (every remaining birr), then `rectifiedCases` **must** equal
       `outstandingCases` exactly (line 165-172) — **guarded by
       `outstandingAmount > 0 &&`**. This is the exact fix the task asked
       to document: without that guard, a zero-amount finding (or one
       whose amount portion was already fully rectified by an earlier
       entry, leaving `outstandingAmount === 0`) would have
       `rectifiedAmount === 0 === outstandingAmount` trivially true on
       *every single partial entry*, forcing the entry to also finish
       every remaining case in one go — even though there was never any
       money to "exhaust" in the first place, not because this entry is
       genuinely the last one. The doc comment (lines 158-164) states this
       explicitly: *"not because this entry is genuinely the last one."*
  4. Both `rectifiedCases`/`rectifiedAmount` must individually not exceed
     `outstandingCases`/`outstandingAmount` (lines 177-188) — this is what
     actually catches the canonical bug example the code comment cites:
     *"2 of 2 cases rectified for only 7,000 of a 70,000 balance"* passes
     the simple bounds checks but is caught by rule 3 above (line 142-149).

On success (`updateDb` block, lines 190-266):
```
f.rectifiedCases += rectifiedCases
f.rectifiedAmount += rectifiedAmount
fullyRectified = f.rectifiedCases >= f.caseCount && f.rectifiedAmount >= f.amount
toStatus = fullyRectified ? "RECTIFIED" : "PARTIALLY_RECTIFIED"
```
Note the comparison is `>=`, not `===` — belt-and-suspenders against any
future floating-point drift, though the validation above should make it
exactly `==` in practice. A `RectificationEntry` row is appended
(immutable, one row per rectify call, `periodId` **snapshotted** at that
moment — `src/types/index.ts:616-623` — so a later transfer never
retroactively reattributes it to a different period). Notifies the other
branch-level `rectify` holder(s) (excluding the actor) and District's
`verify-rectification`/`return-rectification` holders.

### 4.3 Verify Rectification (`verify-rectification/route.ts`)

Blocked only when status is `RECTIFICATION_RETURNED` or `CLOSED` (line 31-33
— otherwise available at any status, since verification tracks its own
counter independent of `status`). Requires at least something unverified:
`verifiableCases = rectifiedCases - districtVerifiedCases > 0` or the amount
analogue (line 34-38). On success, both counters are bumped by the full
unverified remainder in one call — there's no "partial verify" concept, only
"verify everything currently outstanding" (lines 43-44). This action **does
not** call `transitionFinding()` — it never changes `Finding.status`, only
writes an `AuditLogEntry` with action `DISTRICT_VERIFY_RECTIFICATION`
(lines 47-54), which is why `userPerformedApprovalOrVerifyAction()` (§5)
must search `auditLogs`, not `findingTransitions`.

---

## 5. Return-for-Correction rules

### 5.1 Why `SENT_TO_BRANCH_MANAGER` is deliberately excluded

`RETURNABLE_STATUSES = ["PARTIALLY_RECTIFIED", "RECTIFIED", "TRANSFERRED"]`
(`return-rectification/route.ts:25`; mirrored in
`findings/[id]/page.tsx:80`). The doc comment (lines 15-24) is precise and
should be quoted directly:

> "Deliberately excludes SENT_TO_BRANCH_MANAGER - 'return for correction'
> only ever makes sense once the Branch Manager has actually recorded
> something to react to. Before that, the finding is just waiting on the
> branch; there's nothing yet for a Controller to judge as correct or not,
> so nobody (District or HO, on any finding, bank-registered or not) can
> return it at that stage. A mistake in the finding's own earlier approval
> belongs to District/HO Review's own Return ... instead - that only works
> while still at that review stage, which is exactly the point: this
> endpoint is about the recorded rectification, not a do-over of the
> approval decision."

This is the exact rule the task specifically asked to nail: **there is no
path to "return for correction" at `SENT_TO_BRANCH_MANAGER`** — that stage's
only "send it back" mechanism is the review-stage Return actions (§3, #3/#6/#9),
which are a structurally different action (returning the *finding's
approval*, not a *rectification*) and only work while the finding is still
literally sitting at `DISTRICT_REVIEW`/`HO_REVIEW`/`PENDING_BANK_APPROVAL`.

### 5.2 The permission split: legacy / District / HO

Three permission keys gate this one endpoint
(`src/lib/permissions/registry.ts:116-121`):
- `findings.return-rectification` — legacy, kept for backward compatibility, treated as unrestricted (same as District).
- `findings.district-return-rectification` — District Controller: unrestricted across all of `RETURNABLE_STATUSES`.
- `findings.ho-return-rectification` — HO Controller: **gated**.

The route accepts any of the three (`requirePermission` with three keys,
`return-rectification/route.ts:56-60`), then computes which variant applies:

```js
hasHoOnly = hasHo && !hasLegacy && !hasDistrict
if (hasHoOnly) {
  // HO's extra gate — the second rule the task asked to document:
  if (districtVerifiedCases <= 0 && districtVerifiedAmount <= 0) → 409 blocked
}
```
(lines 84-103). This is enforced **twice** — server-side in the route, and
mirrored in the page's permission computation
(`findings/[id]/page.tsx:119-123`, `districtHasVerified =
finding.districtVerifiedCases > 0 || finding.districtVerifiedAmount > 0`) so
the button is hidden client-side too, but the route is authoritative.

**Why this gate exists** (route doc comment, lines 31-49, and page comment
lines 82-92): District is the first-level reviewer of a recorded
rectification; HO only steps in *after* District has already engaged with
it — HO cannot leapfrog District's own review. Concretely: HO cannot return
a finding for correction while it's sitting at `PARTIALLY_RECTIFIED` with
`districtVerifiedCases === 0` — District must verify *something* first
(even a partial verify is enough to unlock HO's return capability for the
whole finding, not just the verified portion).

### 5.3 Two further gates that apply regardless of which permission variant

1. **Separation of duties, scoped to *this* rectification**
   (`userPerformedApprovalOrVerifyAction()`, `src/lib/findings.ts:589-623`):
   whoever already ran `DISTRICT_VERIFY_RECTIFICATION`, `CLOSE`, or
   `PARTIAL_CLOSE` on this finding **after its most-recent
   RectificationEntry** cannot also be the one to Return it — "one person
   shouldn't be able to sign off on a rectification and then flip to
   'actually it's wrong' as the same identity" (doc comment lines 566-581).
   Critically, this check is **bounded to after the latest
   RectificationEntry's `createdAt`** (line 598-609) — an *older*
   verify/close from a prior round doesn't count, otherwise a District
   Controller who verified an earlier round would be permanently locked out
   of ever returning a *later* round on the same finding (e.g. after a
   transfer brings it back for a second cycle). It also explicitly does
   **not** count `DISTRICT_APPROVE`/`HO_APPROVE`/`BANK_APPROVE` — those are
   the finding's own earlier *review-stage* approvals, "a different and
   unrelated decision" (lines 570-581); otherwise the District Controller
   who approved the finding at District Review (routinely the same person
   who later verifies its rectification) would be locked out of ever
   returning that rectification at all.

2. **Post-transfer gate** (`hasRectificationAfterLastTransfer()`,
   `src/lib/findings.ts:625-631`): if the finding is at `TRANSFERRED`, it
   cannot be returned until the branch has recorded **new** rectification
   *after* that transfer (`return-rectification/route.ts:124-137`) —
   "otherwise 'return' would just be re-litigating the outstanding balance
   the transfer already carried forward untouched, with nothing new on
   record to actually be wrong."

### 5.4 On success

`transitionFinding(... toStatus: "RECTIFICATION_RETURNED", action: "RETURN_RECTIFICATION", reason ...)`
(lines 145-151) — `reason` is mandatory, min 5 chars (`returnSchema`, line
27-29). Notifies branch-level `rectify` holders always; additionally
notifies District's `verify-rectification` holders when it was HO who
returned it (`hasHoOnly` branch, lines 172-183 — "the District Controller
who already verified this rectification needs to know their sign-off just
got overridden").

### 5.5 Resubmission out of `RECTIFICATION_RETURNED`

Two ways out:
- **Record new rectification directly** via `rectify/route.ts` (it's in
  `RECTIFIABLE_STATUSES`) — this naturally re-derives `RECTIFIED`/
  `PARTIALLY_RECTIFIED` from the updated totals.
- **`POST .../resubmit-rectification`** (`resubmit-rectification/route.ts`)
  for when the correction didn't involve any new numbers (e.g. it was a
  documentation/evidence fix) — doc comment lines 9-23. Requires
  `findings.rectify`, status must be exactly `RECTIFICATION_RETURNED`.
  Re-derives from the **existing, unchanged** totals:
  ```
  fullyRectified = rectifiedCases >= caseCount && rectifiedAmount >= amount
  nothingRectifiedYet = rectifiedCases === 0 && rectifiedAmount === 0
  toStatus = fullyRectified ? "RECTIFIED"
           : nothingRectifiedYet ? "SENT_TO_BRANCH_MANAGER"   // defensive fallback, see below
           : "PARTIALLY_RECTIFIED"
  ```
  The `nothingRectifiedYet → SENT_TO_BRANCH_MANAGER` branch is explicitly
  called out in the code as **dead in practice but kept defensive**: quoting
  the comment directly (lines 17-23), *"a defensive fallback, not a
  reachable case today - return-rectification/route.ts's RETURNABLE_STATUSES
  no longer accepts a finding with zero ever rectified, so
  RECTIFICATION_RETURNED can no longer be reached with nothing on record -
  but landing here with zero would be a lie (PARTIALLY_RECTIFIED implies
  something was rectified) if that ever changes, so this stays a safe
  default rather than assuming it can't."* This is exactly the kind of
  "defensive/unreachable" code comment the task asked to surface — see §10.

---

## 6. Close rules

`close/route.ts`, permission `findings.close`. Not self-service by the
Branch Manager — closure is always a District/HO Controller action (route
doc comment, lines 11-29).

**Blocked outright** when:
- status is already `CLOSED` (line 42-44), or
- status is `RECTIFICATION_RETURNED` (line 45-50 — "sent back for
  correction and can't be closed until it's resubmitted").

**Not gated to "fully RECTIFIED"** — a controller can close whatever's
currently rectified-**and**-verified-but-not-yet-closed at *any* time,
including while the overall finding is still `PARTIALLY_RECTIFIED` (this is
what makes **partial close** possible):

```js
verifiedCases  = min(rectifiedCases, districtVerifiedCases)
verifiedAmount = min(rectifiedAmount, districtVerifiedAmount)
closableCases  = verifiedCases - closedCases
closableAmount = verifiedAmount - closedAmount
if (closableCases <= 0 && closableAmount <= 0) → 409
  ("Awaiting district verification before this can be closed" if rectified > verified,
   else "Nothing rectified is awaiting closure yet")
```
(lines 51-62). Note the `min(rectified, districtVerified)` bound — closure
can never race ahead of District's own verify gate, "before it reaches HO"
(§3.6 plan doc reference in the comment).

On success (lines 64-115): a `FindingClosure` row is appended (immutable,
`periodId` snapshotted at that moment, mirroring `RectificationEntry`'s
convention), then:
```js
f.closedCases  += closableCases
f.closedAmount += closableAmount
fullyClosed = f.closedCases >= f.caseCount && f.closedAmount >= f.amount
if (fullyClosed) transitionFinding(... toStatus: "CLOSED", action: "CLOSE" ...)
else appendAuditLog(... action: "PARTIAL_CLOSE" ...)   // status NOT changed
```
A partial close leaves `Finding.status` completely untouched — it keeps
tracking rectify/transfer progress as before (`PARTIALLY_RECTIFIED`,
`RECTIFIED`, `TRANSFERRED`, whatever it already was); only a **full**
close (reaching `caseCount`/`amount` exactly) writes `CLOSED` via
`transitionFinding()`. `PARTIAL_CLOSE` is audit-log-only, exactly like
`DISTRICT_VERIFY_RECTIFICATION` — neither ever appears in
`FindingTransition` history, only in `AuditLogEntry`. `CLOSED` is terminal:
no route accepts it as an input status for any further mutation (the
transfer route's `TRANSFERABLE_STATUSES` and rectify's
`RECTIFIABLE_STATUSES` both omit it).

---

## 7. Transfer rules

### 7.1 What "outstanding" means for a transfer — the current (final) rule

`transferFinding()` (`src/lib/findings.ts:37-86`), called by both the manual
route (`transfer/route.ts`) and the automatic sweep
(`autoTransferOnLock()`):

```js
outstandingCases  = finding.caseCount - finding.closedCases
outstandingAmount = finding.amount - finding.closedAmount
```
(lines 56-57). This is the exact rule the task asked to confirm: **only
formally `CLOSED` work is excluded** from what transfers forward — it is
**not** based on `rectifiedCases`/`rectifiedAmount`. The doc comment
(lines 17-35) is the authoritative explanation and should be quoted:

> "'Outstanding' here means caseCount/amount minus closedCases/closedAmount,
> not rectifiedCases/rectifiedAmount - a case the branch has self-reported
> as rectified (and District may have even verified) but HO hasn't formally
> closed yet is NOT done; leaving it out of the transferred total would
> silently understate what's actually still open ... and orphan it from ever
> being counted as outstanding again post-transfer. Only a formally CLOSED
> case is truly finished and excluded from what moves forward."

So a `RECTIFIED`-but-not-yet-`CLOSED` finding, transferred, still carries
its **full** `caseCount`/`amount` forward as `casesTransferred`/
`amountTransferred` (since `closedCases`/`closedAmount` are 0) — even though
it says `RECTIFIED`. This is intentional and matches the field semantics in
§4.1.

The transfer also snapshots `originalCaseCount`/`originalAmount` (the
finding's totals *at this specific hop*, not read live later) and
`caseAgeAtTransferDays` (`caseAgeDays()`, `src/lib/findings.ts:194-196` —
days since `createdAt`, unaffected by any transfer). `finding.periodId`
itself is reassigned to `toPeriodId` **immediately**
(`src/lib/findings.ts:78`), which is described as "the entire mechanism
behind 'no double-counting'" (doc comment lines 17-25) — every performance
query filters by `Finding.periodId`, so the source period's queries stop
seeing it and the destination period's start seeing it automatically, no
separate bookkeeping. Finally `transitionFinding(... toStatus: "TRANSFERRED" ...)`.

### 7.2 Manual transfer (`transfer/route.ts`)

`TRANSFERABLE_STATUSES = ["SENT_TO_BRANCH_MANAGER", "PARTIALLY_RECTIFIED", "RECTIFIED", "RECTIFICATION_RETURNED", "TRANSFERRED"]`
(line 14, duplicated by hand — not imported — in three places: this route,
`src/lib/findings.ts`'s `AUTO_TRANSFERABLE_STATUSES`, and
`findings/[id]/page.tsx`'s own copy; all three are kept in lockstep
manually). Permission `findings.transfer`. Requires:
- destination period id differs from current (line 48-49),
- destination period exists and is `status === "OPEN"` (line 51-54).

Notably **skips `assertPeriodWritable()` on the source period** — comment
(lines 21-25): "Deliberately skips assertPeriodWritable() on the *source*
period: transfer is the intended path once a period locks with the finding
still outstanding." This is the one mutating action that still works after
a finding's own period has been `LOCKED`.

`CLOSED` is the only status excluded from `TRANSFERABLE_STATUSES` — the doc
comment on `AUTO_TRANSFERABLE_STATUSES` (`src/lib/findings.ts:88-108`)
explains the history: `RECTIFIED` and `RECTIFICATION_RETURNED` were
*previously* excluded (reasoning: "a fully-rectified finding has nothing
left to move" / "a pending correction couldn't silently move out from under
the return") but are **now included** by explicit instruction — "a period
being locked should be able to sweep out *every* finding still open in some
way." A `RECTIFICATION_RETURNED` finding transfers with its return (and its
reason) traveling along with it, same as any other in-flight state.

### 7.3 Automatic transfer on period lock

Two independent admin controls gate this (doc comments,
`src/lib/findings.ts:123-178`):
- `Settings.autoTransferOnLock` — bank-wide "is this feature allowed at
  all" switch (Admin Settings).
- Per-lock, the locking user is asked via a `transferOverdueCases` checkbox
  in the Lock dialog (surfaced through the reporting-periods PATCH route) —
  locking no longer transfers silently just because the switch is on; it
  only runs "when they said yes."

When both apply, `autoTransferOnLock()` sweeps every finding still in
`AUTO_TRANSFERABLE_STATUSES` and resident in the locked period
(`outstandingTransferableFindings()`, line 119-121) into the **earliest
`OPEN` period with a later year/month** (`findAutoTransferDestination()`,
lines 114-118), tagged `method: "AUTOMATIC"` (vs. `"MANUAL"` for the
person-driven route) in the `FindingTransfer` row. A finding transferred
manually earlier in that period is naturally excluded — the moment it
transfers, `periodId` changes, so it's no longer in
`db.findings.filter(f => f.periodId === period.id)` by the time the sweep
runs (line 150-155). If no `OPEN` destination period exists, the sweep
no-ops and reports `skippedNoDestination: true` (line 165).

### 7.4 A transferred finding is not paused

`TRANSFERRED` remains fully workable: it's in `RECTIFIABLE_STATUSES` (§4.2),
eligible for `verify-rectification` (§4.3, excluded only for
`RECTIFICATION_RETURNED`/`CLOSED`), eligible for `close` (§6, same
exclusions), returnable (§5, it's in `RETURNABLE_STATUSES` with the extra
post-transfer gate), and can itself be transferred again
(`TRANSFERABLE_STATUSES` includes `TRANSFERRED`), producing a multi-hop
transfer chain all sharing the same `findingId`
(`src/types/index.ts:668-672`).

---

## 8. Reject vs. Return — the difference

| | **Reject** | **Return** |
|---|---|---|
| Where it's available | Only at a review stage: District Review, HO Review, Bank Approval (§3, actions #4/#7/#10) | Two different mechanisms: (a) review-stage Return (#3/#6/#9), which sends the *finding itself* back before any rectification; (b) `return-rectification` (§5), which sends a *recorded rectification* back |
| Resulting status | `REJECTED` — **terminal** | `RETURNED` (review-stage) or `RECTIFICATION_RETURNED` (rectification-stage) — **both recoverable** |
| Editable after? | No route accepts `REJECTED` as an input status anywhere (`EDITABLE_STATUSES`/`SUBMITTABLE_STATUSES` are `["DRAFT","RETURNED"]` only, `[id]/route.ts:10`, `submit/route.ts:8`) — confirmed by grep: `REJECTED` never appears as a from-status in any transition target other than the review routes writing *into* it. | Yes — `RETURNED` is explicitly in `EDITABLE_STATUSES`/`SUBMITTABLE_STATUSES`, so the creator can edit and resubmit. `RECTIFICATION_RETURNED` accepts new `rectify` calls or `resubmit-rectification`. |
| Reason required? | Yes, ≥5 chars (all three review routes' shared `reviewSchema.refine`, e.g. `district-review/route.ts:9-17`) | Yes, ≥5 chars, same pattern (review-stage) or the dedicated `returnSchema` (rectification-stage, `return-rectification/route.ts:27-29`) |
| Self-action allowed? | Yes — a reviewer can reject their own registered finding (only self-*return* is blocked) | No, at every stage — self-return is blocked as a "meaningless no-op" (district/ho/bank-approval routes each check `createdBy === session.userId`) |

In short: **Reject is a hard stop** (dashboards explicitly exclude it from
"outstanding" counts, e.g. `!["RECTIFIED","CLOSED","REJECTED"].includes(status)`
across every dashboard component); **Return sends the finding — or just its
in-progress rectification — back into the workflow** for another attempt,
always with a mandatory reason and never as a self-action.

---

## 9. Notifications triggered per transition

All notifications go through `notifyUsers()`/`notifyFindingsPermissionHolders()`
(`src/lib/notifications.ts`), which also fires a mirrored, non-blocking email
per recipient (`sendNotificationEmail`, doc comment lines 14-22, master.txt
§12: "Notifications for submit, approve, reject, return, assignment,
rectification, transfer and period events").

| Transition | Notifies | Source |
|---|---|---|
| Submit (Path A) | District's `district-review` holders | `submit/route.ts:62-68` |
| Submit (Path B, approval required) | `Settings.hoApproval.approverUserIds` | `submit/route.ts:44-51` |
| Submit (Path B, no approval required) | Branch's `rectify` holders | `submit/route.ts:52-59` |
| District Approve | HO's `ho-review` holders (bank-wide) | `district-review/route.ts:67-73` |
| District Return / Reject | The creator | `district-review/route.ts:82-88` |
| HO Approve | Branch's `rectify` holders | `ho-review/route.ts:64-70` |
| HO Return / Reject | Creator **+** district's `district-review` holders | `ho-review/route.ts:92-102` |
| Bank Approve | Branch's `rectify` holders | `bank-approval/route.ts:87-93` |
| Bank Return / Reject | Creator (+ district's `district-review` holders, Return only) | `bank-approval/route.ts:102-119` |
| Rectify (any entry) | Other branch `rectify` holder(s), excluding actor | `rectify/route.ts:233-246` |
| Rectify (any entry) | District's `verify-rectification`/`return-rectification` holders | `rectify/route.ts:253-261` |
| Verify Rectification | District's `close` holders ("ready to close") | `verify-rectification/route.ts:56-62` |
| Return for Correction | Branch `rectify` holders | `return-rectification/route.ts:153-162` |
| Return for Correction (HO specifically) | + District's `verify-rectification` holders | `return-rectification/route.ts:172-183` |
| Resubmit Rectification | District's `verify-rectification`/`return-rectification` holders | `resubmit-rectification/route.ts:60-66` |
| Close (full or partial) | The creator (if not the actor) | `close/route.ts:102-112` |
| Transfer | Creator **+** district's `transfer` holders | `transfer/route.ts:67-77` |
| Comment | Parent comment's author (if reply) + finding's creator (excluding actor) | `comments/route.ts:73-84` |
| Rectification Reminder (time-based, lazy-checked) | Branch's `rectify` holders, for findings stuck in `SENT_TO_BRANCH_MANAGER`/`PARTIALLY_RECTIFIED`/`TRANSFERRED`/`RECTIFICATION_RETURNED` past `thresholdDays` | `notifications.ts:97-155` |

`usersWithFindingsPermission()` (`notifications.ts:50-73`) narrows recipients
by org scope automatically: `DISTRICT`-scoped roles are narrowed to the
given `districtId`, `BRANCH`-scoped roles to `branchId`, and `BANK`-scoped
roles (e.g. HO Controller) are **never narrowed** — a bank-wide reviewer is
notified regardless of which district/branch a finding belongs to.

---

## 10. Edge cases & known gotchas

1. **Three statuses never actually persist as `Finding.status`.**
   `SUBMITTED`, `DISTRICT_APPROVED`, `HO_APPROVED` are always immediately
   followed, within the same call, by a second `transitionFinding()` to the
   status that actually sticks (`submitFinding()`, `districtApproveFinding()`,
   `hoApproveFinding()` — `src/lib/findings.ts:401-444`, comment lines
   383-388: "two FindingTransition rows and two AuditLogEntry rows per call
   ... so the history stays complete without requiring a separate 'claim'
   action"). `FILTERABLE_FINDING_STATUSES` (`src/types/index.ts:496-517`)
   explicitly excludes these three from any status filter dropdown because
   filtering by one would always return zero rows — a "dead filter option."
   They remain legitimate as **transition/action** values though (e.g.
   `FindingStatusDistribution`'s "Draft / In Review" bucket groups them
   alongside `DRAFT`/`DISTRICT_REVIEW`/`HO_REVIEW`).

2. **The zero-amount rectification guard is a real, documented fix, not
   incidental.** See §4.2 rule 3 — the `outstandingAmount > 0 &&` guard in
   `rectify/route.ts:165` exists specifically so a zero-amount (or
   already-amount-exhausted) finding can still be rectified case-by-case in
   genuine partial entries, instead of being forced to finish every
   remaining case in a single call.

3. **`resubmit-rectification`'s `SENT_TO_BRANCH_MANAGER` branch is dead code
   kept defensively.** Quoted verbatim in §5.5 — the author left it in
   specifically in case `RETURNABLE_STATUSES` is ever loosened again to
   allow returning a finding with nothing rectified yet.

4. **`DISTRICT_VERIFY_RECTIFICATION` and `PARTIAL_CLOSE` never touch
   `Finding.status` and never appear in `FindingTransition` history** — only
   in the `AuditLogEntry` table (`entityType: "Finding"`). Any code that
   needs to know "did this user verify or close something on this finding"
   must query `auditLogs`, not `findingTransitions` — this is precisely why
   `userPerformedApprovalOrVerifyAction()` is implemented against
   `db.auditLogs` (`src/lib/findings.ts:589-623`, explicit doc comment
   explaining the discrepancy between the two tables).

5. **Two permission checks stacked for Bank Approval**, not one — holding
   `findings.bank-approval` makes a role merely *eligible*; the specific
   user must additionally be hand-picked into
   `Settings.hoApproval.approverUserIds`. A role losing the permission
   immediately stops even a still-listed user from approving
   (`bank-approval/route.ts:19-32` doc comment).

6. **`AUTO_TRANSFERABLE_STATUSES` / `TRANSFERABLE_STATUSES` are duplicated by
   hand in three separate files** (`src/lib/findings.ts`, `transfer/route.ts`,
   `findings/[id]/page.tsx`) rather than imported from one shared constant —
   explicitly called out in the code (`src/lib/findings.ts:88-90`) as
   "duplicated three times rather than imported, but kept in lockstep." A
   future change to one must be mirrored in all three or the UI and the API
   will silently disagree about which statuses are transferable.

7. **`RETURNABLE_STATUSES` is likewise duplicated** between
   `return-rectification/route.ts:25` and `findings/[id]/page.tsx:80` (both
   `["PARTIALLY_RECTIFIED", "RECTIFIED", "TRANSFERRED"]`) — same
   hand-lockstep pattern, same risk if one is edited without the other.

8. **Self-action asymmetry is deliberate and consistent across all three
   review stages**: Approve and Reject are always allowed on a
   self-registered finding; only Return is blocked, at District Review, HO
   Review, and Bank Approval alike, with near-identical error messages
   pointing the user at Reject instead (e.g.
   `district-review/route.ts:53-58`, `ho-review/route.ts:50-55`,
   `bank-approval/route.ts:68-73`).

9. **`registeredByBankScope` plays no role in the rectification-return
   gating** (§5) — explicitly noted in the route's doc comment
   (`return-rectification/route.ts:50-54`): District's standing to
   verify/return a rectification is "the same routine oversight job
   regardless of how the original finding was approved," and because
   `RETURNABLE_STATUSES` excludes `SENT_TO_BRANCH_MANAGER`, there's no
   earlier "nothing rectified yet" stage left for a bank-scope distinction
   to matter at by the time this endpoint is ever reachable.

10. **Locked periods block almost everything except Transfer.**
    `assertPeriodWritable()` is a hard stop for every mutating action on an
    existing finding (submit, review, rectify, verify, close) once the
    period is `LOCKED`, with one narrow exception: a `DRAFT` finding can
    still be edited/deleted if the period's own
    `draftsAllowedWhileLocked` flag is set (`src/lib/findings.ts:446-471`).
    No "exceptional correction" override exists for anything past `DRAFT` —
    doc comment: "left for a future phase; for now a locked period is a
    hard stop for everyone." Transfer is the sole designed way to keep
    moving a finding forward once its period locks.

11. **`HO_APPROVED_OR_LATER_STATUSES` is a separately-defined constant in
    `src/types/index.ts` (not `src/lib/findings.ts`)** purely so
    dependency-free client components (`FilterBar.tsx`) can import it
    without pulling in `src/lib/findings.ts`'s server-only dependency chain
    (which reaches `node:crypto` via `src/lib/audit.ts`) — a build-boundary
    reason, not a logical one; the value is identical in spirit to
    `isHoApproved()`'s `HO_APPROVED_OR_LATER` set in `findings.ts:212-236`.

12. **A "single remaining case" is effectively atomic in the UI** (though
    not separately enforced server-side beyond the general exhaustion
    rule): `FindingDetailClient.tsx:172` locks the rectify form's inputs to
    exactly `1` case / the full remaining amount when only one case is left
    outstanding on a non-itemized finding, since any other combination
    would be rejected by the exhaustion rule anyway.
