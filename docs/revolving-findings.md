# Revolving Findings: Outstanding Adjustments

Some findings are **revolving**: the number of cases can grow and the amount involved can go up or down from one reporting period to the next (e.g. dormant accounts, ATM mismatches). Instead of registering a duplicate finding, an authorized user **adjusts** the outstanding cases and amount of the existing finding. Every adjustment is a separate, approved record; the original registration is never edited.

This document is both the business specification (§1–§6) and the implementation plan (§7–§11).

---

## 1. Business rules

| # | Rule |
|---|---|
| R1 | **Eligible findings:** the finding's **operation area** is in Settings → *Revolving operation areas* (matched regardless of letter case and spacing). Existing, imported and new findings all qualify |
| R2 | **Outstanding in the current period:** the finding sits in the **current reporting period** (the one containing today) and is with the branch, not fully closed: Sent to Branch Manager (/R), Partially Rectified, Rectified (awaiting close), Rectification Returned, Transferred. A finding left in an older period must first be transferred into the current one |
| R3 | **What may change:** cases can only be **added** (+N) or left unchanged. The **amount may increase or decrease.** Both in one adjustment, or either alone; at least one change |
| R4 | **Originals never change:** the registration's case count and amount are frozen as *Originally registered*. The finding's *current* figures are original + approved adjustments |
| R5 | **Amount floor:** the new amount can never be below what is already **rectified (awaiting close or closed)**, and while any case is outstanding the outstanding amount (amount − closed) must stay **above zero** |
| R6 | **A decrease is not rectification:** it lowers the outstanding amount only; it never counts as rectified/closed and never raises performance by itself |
| R7 | **Itemized findings** (one amount per case): each added case needs its own amount, **0 or more** (as at registration; a blank box is refused, not read as 0); an existing **outstanding** case can be **increased or decreased** by an amount (± change, e.g. `-1000`; never typed over), as long as it stays > 0; rectified cases never change. The finding's amount is always the sum of its cases. Non-itemized findings take a single amount change (±) |
| R8 | **Who requests:** the original registrant's role: a user who can register and submit findings (*Findings › Create* and *Submit*) and has the finding in scope. Findings registered bank-wide (by HO) are adjusted by bank-wide users; findings registered by a branch/district are adjusted by branch/district users |
| R9 | **What they provide:** a **reason** (required, 5+ characters); evidence optional (the finding's Evidence card) |
| R10 | **When:** *submitting* requires the current period's **submission window to be open** (same as registering). **Drafts** can be saved any time |
| R11 | **Approval:** exactly the path a new finding from that requester takes: **District review → HO review**, or **Bank-wide approval** for bank-registered findings when Settings → Bank-Wide Approval is required (otherwise approved on submit, like a bank-registered finding). Each step can **Approve, Return (for correction) or Reject**; return/reject need a reason |
| R12 | **Separation of duties:** the requester can't approve, return or reject their own adjustment |
| R13 | **Before review:** while no reviewer has acted, the requester can **edit** or **withdraw** it (withdrawn ones stay in the history). A **returned** adjustment goes back to the requester to correct and resubmit, or withdraw |
| R13a | **Delete:** a **rejected, returned or withdrawn** adjustment can be deleted by its requester. A rejected one can also be deleted by anyone with *Findings › Delete Rejected*. It was never applied, so the figures don't change; the audit log keeps a copy (`FINDING_ADJUSTMENT_DELETED`). **Approved** adjustments (part of the finding's figures) and ones in review can't be deleted |
| R14 | **One open adjustment per finding:** at most one adjustment that is a draft, in review or returned. Approved, rejected and withdrawn ones are history |
| R15 | **While pending:** the finding keeps working: rectify, verify, close, transfer, reverse. The adjustment applies on top when approved, re-checked against the finding as it is then (R2-closed / R5 / R7). A finding that became fully closed meanwhile can't take it (the approver rejects it) |
| R16 | **Reported period:** an adjustment belongs to the period it was **submitted** in, even if approved after the finding was transferred |
| R17 | **De-listing an area:** pending adjustments can still finish; no new ones can be started |
| R18 | **Bulk:** one finding at a time (bulk via Excel may come later) |

## 2. Lifecycle of an adjustment

```
DRAFT --submit--> [routing as a registration from the requester]
   branch/district requester:  DISTRICT_REVIEW --approve--> HO_REVIEW --approve--> APPROVED
   bank-wide requester:        PENDING_BANK_APPROVAL --approve--> APPROVED   (or APPROVED at once when bank-wide approval isn't required)
any review step --return--> RETURNED --resubmit--> (routing again)
any review step --reject--> REJECTED
DRAFT / RETURNED / first review step before anyone acted --withdraw--> WITHDRAWN
```

Edit is allowed in DRAFT, RETURNED and the first review step (DISTRICT_REVIEW or PENDING_BANK_APPROVAL) before any reviewer acted.

## 3. What happens on approval (one transaction)

1. The finding's **current** case count and amount change (cases + N; amount ± X; itemized: new case rows *Outstanding*, numbered after the existing ones, and changed case amounts). The originals stay as they were.
2. **Status:** a *Rectified* (awaiting close) or *Partially Rectified* finding is re-evaluated: still all rectified → Rectified, otherwise **Partially Rectified** (added cases are new work). Other statuses are unchanged.
3. The finding's history gets an **Adjustment applied** step; the audit log gets `FINDING_ADJUSTMENT_APPROVED` with before/after.
4. The branch's rectifiers and the requester are notified.

## 4. Effect on figures

| Area | Rule |
|---|---|
| **Period split** (dashboards, Performance %, Reports with a period filter, Findings list per period) | Added cases/amount join the finding's **stay in the period where it is when the adjustment is approved** (that's where the branch must work them), so a period never closes more than it holds. Totals across periods always equal the current case count |
| **Monthly Summary, Category Detail by District, Uncovered Branches** (original-period reports) | Original cases/amount in the original month; each approved adjustment's cases/amount in **the month it was submitted** (R16). Closed cases are allocated first to the original cases, then to adjustments in order, so no month shows more rectified than cases. A decrease shows as a negative amount in its month (the totals stay right) |
| **Weekly Executive Summary** (by date) | Cases as of a date = original cases + cases of adjustments **approved on or before** that date → added cases appear as **Additional** in the week they were approved |
| **Reported Cases** (HO / Executive dashboards) | Cases reported in the period: original cases of findings reported then + cases added by adjustments submitted then |
| **Dashboards** (Branch, District, HO, Executive) | **Adjustments Awaiting You**: the adjustments **this user** must act on: ones at a review step they can decide (never their own, the same check as the review API), plus their own returned ones to correct. Underneath: the total in review with its cases and amount. On click: the split (to review / returned to you), the count at each step, and a link to Show My Queue. **Adjustment Diff**: approved adjustments reported (submitted) in the selected period, as cases added plus net amount change per currency; increases and decreases on click. Both follow the dashboard's scope and filters (`src/lib/adjustments/dashboard.ts`) |
| **Transfers** | Carry the current outstanding (adjustments included) |
| **Reverse** | Undoes closures only; adjustments stay |
| **Delete finding / reverse import / Dev Reset** | Adjustments go with the finding |

## 5. Screens

- **Finding page**
  - Header figures show **Originally registered** and **Current** when they differ.
  - **Adjust outstanding** button, shown when R1, R2, R8 and R14 hold. If the submission window is closed it still opens and allows **Save draft**, with the reason submit isn't possible.
  - The dialog shows current → adjustment → result side by side: cases to add, amount change (or, itemized: new case amounts and changed outstanding case amounts), reason; **Save draft** / **Submit**.
  - **Adjustments** card: every adjustment with status, figures, reason, requester, reviewers and dates; actions for whoever may act (edit, submit, withdraw, approve, return, reject).
- **Show My Queue:** reviewers see findings with an adjustment at their step; requesters see their returned adjustments.
- **Settings → Revolving Findings:** the operation-area checklist (its own Save).
- **Email Events:** *Adjustment submitted / approved / returned / rejected*.

## 6. Permissions

No new permission keys:

| Action | Permission |
|---|---|
| Request / edit / submit / withdraw | *Findings › Create* + *Submit*, finding in scope, same registrant level (R8) |
| District step | *Findings › District Review*, in scope |
| HO step | *Findings › HO Review* |
| Bank-wide step | *Findings › Bank-wide Approval* + listed approver (Settings → Bank-Wide Approval) |
| Settings list | *Settings › View / Edit* |

---

## 7. Design

### Data
- **`findings`**: new `registered_case_count`, `registered_amount` (backfilled from today's values). `case_count` / `amount` remain the **current** figures, so every existing calculation (outstanding, rectify, close, transfer) works unchanged.
- **`finding_adjustments`** (new): id, finding_id (cascade delete), period_id (submitted period), status, added_cases, amount_change, new_case_amounts (itemized), case_amount_changes (itemized, with before/after), reason, requester (id/name/scope level), submitted_at, decisions (step, decision, by, at, reason) as JSON history, applied snapshot (before/after), approved_at, created/updated.
- **`adjustment_config`** (new, singleton): `revolving_operation_areas`.

### Code (a module with clear boundaries)
| Part | File |
|---|---|
| Types | `src/lib/adjustments/types.ts` (client-safe) |
| Pure rules: eligibility, validation, routing, period allocation | `src/lib/adjustments/rules.ts` |
| Workflow: create, edit, submit, withdraw, review, apply | `src/lib/adjustments/service.ts` (operates on the Database model inside `updateDb`) |
| Config store | `src/lib/adjustments/config.ts` |
| API | `src/app/api/findings/[id]/adjustments/...`, `src/app/api/admin/adjustments/config` |
| UI | `AdjustmentsCard.tsx` (+ dialog) on the finding page, `RevolvingSettings.tsx` in Settings |
| Core math touch points | `findingResidencyInPeriod()` (stays include approved adjustments), original-period totals, weekly cases-as-of, reported cases |

### As built
| Part | File |
|---|---|
| Rules (pure) | `src/lib/adjustments/rules.ts`: `eligibilityProblem`, `resolveChange`, `submitProblem`, `firstStep` / `nextStep`, `reviewerProblem`, `isEditableByRequester`, `rectificationStatusAfter` |
| Workflow | `src/lib/adjustments/service.ts`: `createAdjustment`, `editAdjustment`, `submitAdjustment`, `withdrawAdjustment`, `reviewAdjustment` (apply is internal, run on final approval) |
| Config store | `src/lib/adjustments/config.ts` (a missing table reads as "no areas listed") |
| Page data | `src/lib/adjustments/view.ts` (`adjustmentsView`: list plus what this user may do) |
| Request schemas | `src/lib/adjustments/schemas.ts` |
| API | `GET/POST /api/findings/[id]/adjustments`, `PATCH /api/findings/[id]/adjustments/[adjId]` (`edit` / `submit` / `withdraw`), `POST /api/findings/[id]/adjustments/[adjId]/review`, `GET/PATCH /api/admin/adjustments/config` |
| UI | `src/components/findings/AdjustmentsCard.tsx` (card + Adjust outstanding dialog, on the finding page); `src/components/admin/RevolvingSettings.tsx` (Settings → Revolving Findings) |
| Queue | `queueStatusesForSession()` in `src/lib/findings.ts` |
| Notifications | `ADJUSTMENT_SUBMITTED / APPROVED / RETURNED / REJECTED` (Settings → Email Events → Revolving findings) |
| Tests | `tests/adjustments.test.ts` |

Audit log actions:
- `FINDING_ADJUSTMENT_CREATED`, `_EDITED`, `_SUBMITTED`, `_REVIEWED` (an approval at an intermediate step), `_RETURNED`, `_REJECTED`, `_WITHDRAWN`, `_APPROVED` (applied, with before/after).
- The finding's Transition History shows `ADJUSTMENT_APPLIED`.

Only the requester edits, submits or withdraws their adjustment. A draft whose area was de-listed can't be submitted (withdraw it). A returned adjustment can still be resubmitted.

### Install
1. Apply the migration from the app folder: `npx prisma migrate deploy` (or `npx prisma migrate dev`). It adds the columns and tables, and copies today's case count and amount into *Originally registered*.
2. Restart `npm run dev` (or the server).
3. Settings → **Revolving Findings**: tick the operation areas → **Save revolving findings**.

Until step 1, the app can't load data: it reads the new columns.

## 8. Implementation steps

1. Schema + migration (`20261007120000_revolving_findings`): columns, tables, backfill.
2. Types + `db.ts` mapping (`findingAdjustments` collection; finding registered fields); create/import/draft-edit set the registered fields.
3. Core math: residency stays, original-period reports, weekly summary, reported cases.
4. Module: rules, service, config store.
5. API routes with permission, scope, separation-of-duties and window checks.
6. Notifications (4 event types) and Show My Queue matchers.
7. UI: finding page (figures, Adjust dialog, Adjustments card), Settings list.
8. Dev Reset clears adjustments; exports show original vs current.
9. Tests (§9) and docs.

## 9. Test cases

**Automated** (`tests/adjustments.test.ts`):
1. Eligibility: listed area; not listed; wrong period; closed finding; draft/review finding; one open adjustment only.
2. Validation: cases negative refused; no change refused; amount below rectified refused; outstanding amount zero refused; itemized: per-case amounts required, changed case must be outstanding.
3. Routing: branch requester → District → HO → Approved; bank requester → Bank approval / approved at once when not required; return → resubmit; reject; withdraw before review; edit only before review.
4. Separation of duties: requester can't review own.
5. Apply: current cases/amount change, originals unchanged; itemized rows added; Rectified → Partially Rectified when cases added; history + audit.
6. Re-check on approval: finding closed meanwhile → refused.
7. Figures: residency split (added cases in the approval stay; totals = current), original-period report (added in submitted month, FIFO closures), weekly summary (Additional on approval date).
8. Settings list round-trip; de-listed area: pending can finish, new refused.

**Manual**
| # | Steps | Expected |
|---|---|---|
| M1 | List "Account Opening" in Settings → Revolving; open an outstanding Account Opening finding in the current period | **Adjust outstanding** visible |
| M2 | Branch Controller adds +2 cases, +5,000; submits | Adjustment *District review*; District sees it in Show My Queue |
| M3 | District approves, HO approves | Finding current = original + 2 cases / +5,000; Original unchanged; branch notified |
| M4 | Decrease amount below rectified | Refused with the reason |
| M5 | Rectified finding + 1 case approved | Status Partially Rectified |
| M6 | Return at HO with reason; requester edits and resubmits | Back to District review |
| M7 | Submission window closed | Save draft only; submit explains why |
| M8 | Monthly Summary for the adjustment month | Shows the added cases there; original month unchanged |
| M9 | Requester tries to approve own | Refused |
