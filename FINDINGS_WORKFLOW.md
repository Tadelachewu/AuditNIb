# The Finding Flow — Complete Reference

Every state a `Finding` can be in, every action that moves it, who's
allowed to trigger each one, and every side-flow attached to it
(evidence, comments, notifications, transfer). This is the single
reference for "how does a finding actually move through the system" —
for the business rationale behind each stage see
[APP_DOCUMENT.md](APP_DOCUMENT.md) §10; for BRD citations see
[BRD_COMPLIANCE.md](BRD_COMPLIANCE.md); for test cases see
[SCENARIOS.md](SCENARIOS.md) §10–17.

Everything here reflects the code as it stands today (`src/lib/findings.ts`,
`src/types/index.ts`'s `FINDING_STATUSES`, and the `src/app/api/findings/`
routes) — not a plan or an aspiration.

---

## 1. The 13 states

```
DRAFT ──submit──> SUBMITTED ──auto──> DISTRICT_REVIEW
                                            │
                        ┌───────────────────┼───────────────────┐
                     approve              reject               return
                        │                   │                    │
                        v                   v                    v
                 DISTRICT_APPROVED      REJECTED              RETURNED
                        │               (terminal)         (back to DRAFT-like,
                     auto│                                  editable, resubmit)
                        v
                    HO_REVIEW
                        │
        ┌───────────────┼───────────────────┐
     approve           reject              return
        │                │                    │
        v                v                    v
   HO_APPROVED        REJECTED            RETURNED
        │auto        (terminal)
        v
SENT_TO_BRANCH_MANAGER
        │
        │  ┌─────────────────────────────────────────────┐
        │  │  while outstanding balance > 0, at any point: │
        │  │  TRANSFER ──> TRANSFERRED (periodId changes)  │
        │  │  loops back into rectification in new period  │
        │  └─────────────────────────────────────────────┘
        │
   rectify (partial)
        │
        v
PARTIALLY_RECTIFIED ──rectify (remaining)──> RECTIFIED
                                                   │
                                                close (verify)
                                                   │
                                                   v
                                                CLOSED
                                              (terminal)
```

| # | Status | Kind | Meaning |
|---|---|---|---|
| 1 | `DRAFT` | resting | Registered, not yet submitted. Only state a finding can be edited or deleted in (along with `RETURNED`). |
| 2 | `SUBMITTED` | momentary | Fired the instant Submit is clicked, immediately followed by the auto-transition below. Exists as its own row so the transition history is literally complete, not collapsed. |
| 3 | `DISTRICT_REVIEW` | resting | Sitting in the District Controller's queue. |
| 4 | `DISTRICT_APPROVED` | momentary | Fired on district approval, immediately followed by auto-transition to `HO_REVIEW`. |
| 5 | `HO_REVIEW` | resting | Sitting in the HO Controller's queue. |
| 6 | `HO_APPROVED` | momentary | Fired on HO approval, immediately followed by auto-transition to `SENT_TO_BRANCH_MANAGER`. |
| 7 | `SENT_TO_BRANCH_MANAGER` | resting | Both approvals done; waiting on the Branch Manager to fix it. |
| 8 | `PARTIALLY_RECTIFIED` | resting | Some but not all cases/amount fixed. |
| 9 | `RECTIFIED` | resting | Fully fixed; waiting on independent verification. |
| 10 | `TRANSFERRED` | resting | Outstanding balance carried into a later reporting period; rectification continues there. |
| 11 | `REJECTED` | **terminal** | Rejected at either review stage. No further transitions exist. |
| 12 | `RETURNED` | resting | Sent back to the branch; editable again, can be resubmitted. |
| 13 | `CLOSED` | **terminal** | Verified and closed. No further transitions exist. |

**Two states are load-bearing but easy to miss:** `SUBMITTED`,
`DISTRICT_APPROVED`, and `HO_APPROVED` are not skipped in code — each is a
real, separately-logged transition immediately followed by its automatic
next step, in the same request. A finding's transition history is
therefore always a strict superset of what a simplified 2-review-stage
diagram would suggest: approving at district level writes **two** rows
(`DISTRICT_APPROVE` then `QUEUE_HO_REVIEW`), not one.

---

## 2. Who can do what

| Action | Permission key | Who holds it by default |
|---|---|---|
| Register (create) | `findings.create` | Branch Controller, HO Controller |
| Edit (draft/returned only) | `findings.edit` | Branch Controller |
| Delete (draft only) | `findings.delete` | Branch Controller |
| Submit | `findings.submit` | Branch Controller |
| District review (approve/reject/return) | `findings.district-review` | District Controller |
| HO review (approve/reject/return) | `findings.ho-review` | HO Controller |
| Rectify (partial or full) | `findings.rectify` | Branch Controller, Branch Manager |
| Close (verify) | `findings.close` | District Controller, HO Controller |
| Transfer to next period | `findings.transfer` | District Controller |
| Upload evidence | `findings.evidence` | Branch Controller, Branch Manager |
| Comment | `findings.comment` | Branch Controller, Branch Manager, District Controller, District Director, HO Controller |
| View | `findings.view` | Every role (including Executive, read-only) |

District Director holds **only** `view` and `comment` — proposal.txt §6's
explicit exception to "cannot modify findings or scores." Executive
(Read-only) holds only `view`. All of this is admin-editable at
`/admin/roles`; the table above is the seeded default, not a hard rule.

Every one of these is enforced **server-side**, independently of the UI —
the fact that a button isn't shown is a convenience, not the actual
access-control boundary. Every route also re-checks the caller's org
scope (`assertFindingInScope`) — a district/branch-scoped user cannot act
on, or even see, a finding outside their own org unit, regardless of
which permissions their role holds.

---

## 3. Registration — the fields, in order

`POST /api/findings` (`src/app/api/findings/route.ts`), form at
`/findings/new`:

| Field | Required | Source of options |
|---|---|---|
| Title | ✅ | free text — the first field on the form |
| Source | ✅ | `/admin/sources` (Internal Control, Internal Audit, …) |
| Department | ✅ | `/admin/departments`, filtered to bank-wide + whatever matches the finding's own district/branch |
| Reporting period | ✅ | must be `OPEN` |
| District / Branch | ✅ | locked to the registering user's own org unit for branch-scoped roles; freely pickable for HO (registering an Internal Audit finding on any branch's behalf) |
| Finding date | ✅ | date picker |
| Classified case (category) | ✅ | `/admin/categories` |
| Operation area | ✅ | `/admin/settings`'s configurable list (Teller Counter, Vault, ATM Operations, …) |
| Type of irregularity | ✅ | `/admin/settings`'s configurable list (Cash Shortage, Fraud, …) |
| Currency | ✅ | `/admin/settings`'s configurable list |
| Amount involved | ✅ | numeric |
| Number of cases | ✅ | numeric, ≥ 1 |
| Risk level | ✅ | `/admin/settings`'s configurable list |
| Priority | ✅ | `/admin/settings`'s configurable list (Low/Medium/High/Urgent) |
| Description | ✅ | free text |
| Recommendation | optional | free text |
| Evidence note | optional | free text — a note alongside the real uploaded files (§7) |

The reference (`<branchCode>-<periodCode>-<seq>`) is auto-generated, never
user-entered. "Save Draft" creates the finding at `DRAFT`; "Save & Submit"
creates it and immediately runs the submit transition in the same
request.

**Once created, most of this is locked in.** `PATCH /api/findings/[id]`
only ever accepts `title`, `operationArea`, `irregularityType`, `amount`,
`caseCount`, `priority`, `description`, `recommendation`, `evidenceNote` —
and only while the finding is `DRAFT` or `RETURNED`. Source, Department,
Category, District, Branch, and Period are set once at registration and
never change afterward (a transfer changes `periodId`, but that's a
distinct, audited mechanism — §6 — not an edit).

---

## 4. Submit → District Review → HO Review

1. **Submit** (`POST /api/findings/[id]/submit`) — only from `DRAFT` or
   `RETURNED`. Runs `submitFinding()`: `DRAFT/RETURNED → SUBMITTED → DISTRICT_REVIEW`.
   Notifies every district-review holder in that district.
2. **District review** (`POST /api/findings/[id]/district-review`,
   `{ decision: "APPROVE" | "REJECT" | "RETURN" }`) — only from
   `DISTRICT_REVIEW`.
   - **Approve** → `districtApproveFinding()`: `DISTRICT_APPROVED → HO_REVIEW`. Notifies every HO-review holder bank-wide.
   - **Reject** → `REJECTED`, terminal. Requires a reason (≥5 chars). Notifies the finding's creator.
   - **Return** → `RETURNED`. Requires a reason. Notifies the creator; they can now edit and resubmit.
3. **HO review** (`POST /api/findings/[id]/ho-review`, same shape) — only
   from `HO_REVIEW`.
   - **Approve** → `hoApproveFinding()`: `HO_APPROVED → SENT_TO_BRANCH_MANAGER`. Notifies every rectify-holder at that branch.
   - **Reject** / **Return** — same rules as district review.

Every one of these also runs `assertPeriodWritable()` first — if the
finding's period has been locked in the meantime, the action is blocked
with a `409` (see §8).

---

## 5. Rectification

`POST /api/findings/[id]/rectify`, `{ rectifiedCases, rectifiedAmount, note? }`
— from `SENT_TO_BRANCH_MANAGER`, `PARTIALLY_RECTIFIED`, or `TRANSFERRED`
(a transfer doesn't pause rectification, it continues in the new period).

- Validated independently: `rectifiedCases` cannot exceed what's still
  outstanding (`caseCount - rectifiedCases`), same for amount. Rejected
  with `400` before anything changes if either is exceeded.
- Each call appends a `RectificationEntry` (its own row — the running
  total lives on the `Finding` itself, kept in lockstep).
- If the cumulative total now covers the full case count **and** full
  amount → `RECTIFIED`. Otherwise → `PARTIALLY_RECTIFIED`. Either way the
  entry is recorded; only the finding's status differs.
- Becoming fully `RECTIFIED` fires a notification to every close-holder
  in that district.

The BRD's own worked example (3 cases / ETB 45,000 → 1 case / ETB 10,000
rectified → 2 cases / ETB 35,000 outstanding) is exactly this mechanism,
reproduced digit-for-digit in `PHASE6.md`'s verification log.

---

## 6. Transfer — carrying a balance into a new period

`POST /api/findings/[id]/transfer`, `{ toPeriodId, reason }` — the
District Controller's action, from `SENT_TO_BRANCH_MANAGER`,
`PARTIALLY_RECTIFIED`, or `TRANSFERRED` (a finding can be transferred more
than once, chaining).

**What actually happens** (`transferFinding()` in `src/lib/findings.ts`):
this is a continuation, not a new record.
1. A `FindingTransfer` row is written — the outstanding cases/amount at
   the moment of transfer, permanently, plus who/why/when.
2. `finding.periodId` is reassigned to the destination period.
3. Status transitions to `TRANSFERRED`.
4. `finding.createdAt` is **never** touched — "case age" (shown on the
   detail page) is always measured from original registration, regardless
   of how many times a finding has been transferred.

"No double-counting" isn't a separate check — it falls straight out of
the mechanism: every report/dashboard query filters by `Finding.periodId`,
and a finding only ever has one live value of it, so the source period's
queries stop seeing it and the destination period's start seeing it,
automatically.

**Why it exists**: it's the intended escape hatch once a reporting period
locks with a finding still outstanding. Rectification is blocked against
a locked period (§8) — transfer is the only way forward at that point.
The destination period must be `OPEN` and different from the current one;
transfer itself is **not** blocked by the *source* period being locked
(that's the entire point of it).

---

## 7. Evidence & Comments — collaboration, not workflow state

These two don't move the state machine at all; they run alongside it.

**Evidence** (`POST` / `GET /api/findings/[id]/evidence`,
`GET .../evidence/[evidenceId]` to download): real files on local disk
(`data/uploads/`), allow-listed to PDF/PNG/JPG/XLSX/DOCX/CSV, 10 MB cap,
server-generated filenames (never the user's own, to rule out path
traversal). Uploading needs `findings.evidence`; **viewing/downloading
only needs `findings.view`** — so a reviewer without upload rights can
still see what's attached.

**Comments** (`GET` / `POST /api/findings/[id]/comments`): one level of
threading — a top-level comment, and replies to it, but no deeper nesting.
Needs `findings.comment`. A new comment or reply notifies the parent
comment's author and the finding's creator (skipping whoever just posted
it).

**Comments can carry their own attachment** (BR-WF-018, master.txt §12:
*"Users may add attachments to comments where permitted"*): the composer
and reply box each have an optional file field. This reuses the Evidence
upload endpoint with an added `commentId` field — same storage, same
allow-list, same 10 MB cap — but the required permission is
`findings.comment`, not `findings.evidence`, since attaching to your own
comment is part of the comment action itself. This is why District
Director and District Controller can attach a file to a comment despite
holding no `findings.evidence` permission at all. Comment attachments
render inline under their comment (📎 filename), separately from the main
Evidence card, which only ever shows finding-level attachments.

---

## 8. Reporting-period locking's effect on the flow

A period can be locked at `/admin/reporting-periods` (requires a reason,
audit-logged). Once locked, **every mutating action against an existing
finding in that period is blocked** — edit, delete, submit, district
review, HO review, rectify — all return `409`. This is checked via
`assertPeriodWritable()` at the top of each route.

Two deliberate exceptions:
- **Transfer** is *not* blocked by the source period being locked — it's
  the designed way to keep an outstanding finding moving once its period
  closes (§6).
- **Close** is *not* blocked either — verifying and closing a
  fully-rectified finding doesn't change any reportable case/amount
  total, so it isn't the kind of change period-locking is protecting
  against.

Locking or unlocking a period itself notifies every district- and
HO-review-holder bank-wide.

---

## 9. Verification & Closure

`POST /api/findings/[id]/close` — only from `RECTIFIED`. Deliberately
**not** self-service: the Branch Manager who recorded the rectification
cannot close their own finding (`findings.close` isn't in their default
permission set) — a District or HO Controller, independent of who did the
fixing, must verify and close it. This is standard separation-of-duties,
made structural rather than a paper rule. Closing notifies the finding's
original creator. `CLOSED` is terminal — every further mutation attempt
returns `409`.

---

## 10. Notifications — every trigger point

| Event | Recipients |
|---|---|
| Submit | District-review holders in that district |
| District approve | HO-review holders, bank-wide |
| District/HO reject or return | The finding's creator |
| HO approve | Rectify-holders at that branch |
| Fully rectified | Close-holders in that district |
| Transfer | Creator + district's transfer-holders |
| Close | Creator |
| New comment / reply | Parent comment's author + creator (excluding whoever just posted) |
| Reporting period locked/unlocked | District- and HO-review holders, bank-wide |

In-app only (bell icon, polled every 30s) — no email/Outlook delivery
exists (`BRD_COMPLIANCE.md` §5).

---

## 11. One full trace, start to end

The BRD's own numbers, followed through every stage:

1. Branch Controller registers a 3-case / ETB 45,000 "Other Case" finding → `DRAFT`.
2. Submit → `SUBMITTED` → `DISTRICT_REVIEW`. District Controller's queue now shows it; it was absent before.
3. District Controller approves → `DISTRICT_APPROVED` → `HO_REVIEW`. HO Controller's queue now shows it.
4. HO Controller approves → `HO_APPROVED` → `SENT_TO_BRANCH_MANAGER`.
5. Admin locks the reporting period mid-workflow (a month-end close).
6. Branch Manager's rectify attempt → `409` (period locked).
7. District Controller transfers the outstanding balance into the next open period, with a reason → `TRANSFERRED`, `periodId` now the new period. Confirmed absent from the old period's queries, present in the new one's.
8. Branch Manager records 1 case / ETB 10,000 → `PARTIALLY_RECTIFIED`, outstanding correctly 2 cases / ETB 35,000.
9. Branch Manager records the remaining 2 cases / ETB 35,000 → `RECTIFIED`.
10. Branch Manager attempts to close it → `403` (not their permission).
11. District Controller closes → `CLOSED`. Terminal — any further mutation now returns `409`.

Every step above notifies the relevant party and is fully reconstructable
from the finding's own transition history (`GET /api/findings/[id]`
returns it) and the bank-wide audit log.

---

## 12. Business Rules cross-check (BR-WF-001–020)

Verified against the running code, not from memory — each row cites where
the rule is actually enforced. **18 of 20 were already fully satisfied;
two gaps (BR-WF-018, BR-WF-020) were found during this check and fixed.**

| ID | Rule | Status | Where it's enforced |
|---|---|---|---|
| BR-WF-001 | Branch Internal Controller can create findings only for their assigned Branch | ✅ | `POST /api/findings` forces `districtId`/`branchId` from the session for `orgScope === "BRANCH"` — never from client input |
| BR-WF-002 | A Branch has one Branch Manager and one Branch Internal Controller | ✅ | `RoleDefinition.branchSingleton` + `assertBranchRoleAvailable()` (`src/lib/org.ts`), enforced on every user create/edit |
| BR-WF-003 | A District may have multiple District Internal Controllers | ✅ | No singleton constraint exists for `DISTRICT`-scoped roles — verified directly by assigning two `DISTRICT_CONTROLLER` users to the same district |
| BR-WF-004 | A user is assigned to only one Branch or District according to their role | ✅ | `resolveOrgAssignment()`/`resolveOrgScope()` — a role's `orgScope` determines exactly one of `districtId`/`branchId`/neither, never a combination |
| BR-WF-005 | A submitted Branch finding must enter District review | ✅ | `submitFinding()`: `DRAFT/RETURNED → SUBMITTED → DISTRICT_REVIEW`, unconditionally |
| BR-WF-006 | District approval sends the finding to Head Office review | ✅ | `districtApproveFinding()`: `DISTRICT_APPROVED → HO_REVIEW` |
| BR-WF-007 | Head Office approval sends the finding to Branch Manager rectification | ✅ | `hoApproveFinding()`: `HO_APPROVED → SENT_TO_BRANCH_MANAGER` |
| BR-WF-008 | Head Office return sends the finding through District back to Branch Controller for correction | ✅ | An HO return sets `RETURNED` and notifies the creator; resubmission (the only way back to HO) always re-enters `DISTRICT_REVIEW` first via `submitFinding()` — a finding can never reach `HO_REVIEW` again without passing through District review |
| BR-WF-009 | Partial rectification must be supported | ✅ | `PARTIALLY_RECTIFIED` status; `rectify` route validates cases/amount independently against what's outstanding |
| BR-WF-010 | Outstanding cases can continue into subsequent reporting periods | ✅ | Transfer Engine (§6) |
| BR-WF-011 | Transferred cases must retain their original history | ✅ | `transferFinding()` never touches `createdAt` or the finding's `id`; every prior `FindingTransition` row stays attached to the same finding |
| BR-WF-012 | Transferred cases must not be treated as entirely new cases | ✅ | No new `Finding` row is ever created by a transfer — only `periodId` changes on the existing one, plus a permanent `FindingTransfer` record of the hop |
| BR-WF-013 | Performance scoring must be configurable | ✅ | `ScoringRule` is versioned, admin-editable (categories/sources/formula) at `/admin/scoring-rules` |
| BR-WF-014 | Only authorized administrators may change scoring rules | ✅ | `scoring-rules.create`/`.activate` are in no non-admin role's default permission set |
| BR-WF-015 | All users must see only information permitted by their organizational scope | ✅ | `assertFindingInScope`/`findingsInScope` (`src/lib/findings-scope.ts`), enforced server-side on every findings route, independent of the UI |
| BR-WF-016 | Reporting-period locking must prevent unauthorized changes | ✅ | `assertPeriodWritable()` — blocks edit/delete/submit/district-review/ho-review/rectify on a `LOCKED` period (§8) |
| BR-WF-017 | Comments and replies must remain associated with the finding | ✅ | `Comment.findingId` always set; every comment route scopes its query by it |
| BR-WF-018 | Attachments must be supported within the communication/finding workflow | ✅ **fixed this pass** | Was: Evidence only attached to a Finding, never a Comment. Now: `Evidence.commentId` (optional) lets a file attach to a specific comment, gated by `findings.comment` rather than `findings.evidence` — see §7 |
| BR-WF-019 | All major workflow actions must be auditable | ✅ | Every `transitionFinding()` call appends both a `FindingTransition` row and a bank-wide `AuditLogEntry`; all admin CRUD is audit-logged too |
| BR-WF-020 | District dashboards must aggregate authorized branches while preserving branch-level drilldown | ✅ **fixed this pass** | Was: the District Dashboard's branch-ranking table showed plain text, no click-through. Now: each branch name links to `/findings?branchId=<id>`, landing on that branch's filtered finding list |

Rule BR-WF-004's phrasing ("only one Branch or District") and BR-WF-015's
scope enforcement both have one *intentional* carve-out worth naming
explicitly: reference/config data (Districts, Branches, Sources,
Categories, Departments) is bank-wide-visible to anyone holding the
relevant `.view` permission, regardless of their own org scope — that
data describes the org itself, not a district's operational records, so
it's deliberately not scoped the way Findings are. This is already
documented in `BRD_COMPLIANCE.md` §7 as a considered decision, not an
oversight.
