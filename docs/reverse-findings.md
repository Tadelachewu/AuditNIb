# Reversing Closed Findings

**Reverse undoes what was closed in the period a finding is in now, and sends it back to the branch with status Sent to Branch Manager/R.** Only that one period is reversed. Previous periods are never affected.

## At a glance

| | |
|---|---|
| **Where** | The finding's page → **Reverse** |
| **Shown when** | Something (cases or amount) was **closed in the finding's current period**, and you hold the permission |
| **Permission** | **Findings › Reverse Closed / Partially Closed Findings**. The Administrator has it and can grant it to other roles. |
| **Scope** | The finding must be in your organisational scope (branch / district / bank) |
| **Locked periods** | Don't matter. A finding can be reversed whether its periods are open or locked ([locked-periods.md](locked-periods.md)). |
| **Reason** | Required (at least 5 characters), in a confirmation dialog before anything changes |
| **Resulting status** | **Sent to Branch Manager/R**: the branch must rectify it again |

## Which period is reversed

**Always and only the finding's current period**, the one it is in now.

| The finding… | Reversed in | Previous periods |
|---|---|---|
| was closed in its **originally reported period** (never transferred) | its own original period | none |
| was **transferred**, and cases were closed **after** it arrived in the current period | the current period | **unchanged**: what was closed there stays closed, and the transfer stays |
| was **transferred**, but nothing has been closed in the current period yet (only in a previous one) | **can't be reversed**: the button is hidden | unchanged |

### Example

A finding has 2 cases in 2026-09. 1 case is closed in 2026-09, the other is transferred to 2026-10 and closed there. The finding is now *Closed* in 2026-10.

| | Before Reverse | After Reverse |
|---|---|---|
| **2026-09** (previous) | 1 case, 1 closed | 1 case, 1 closed (**unchanged**) |
| **2026-10** (current) | 1 case, 1 closed | 1 case, **0 closed** (outstanding) |
| Finding's status | Closed | **Sent to Branch Manager/R** |
| Finding's totals | 2 cases: rectified 2, verified 2, closed 2 | 2 cases: rectified 1, verified 1, closed 1 (the 2026-09 case) |
| Left to rectify | 0 | **1**: exactly the case 2026-10 holds |

If only the 2026-09 case had been closed (nothing closed in 2026-10 yet), there would be nothing to reverse in the current period, so Reverse would not be offered.

## All scenarios

"Current period" = the period the finding is in now. "Previous periods" = periods it was transferred out of.

### Not reversible (button hidden)

Reverse needs something **closed in the current period**. These have nothing to reverse:

| # | Finding | Why | Use instead |
|---|---|---|---|
| N1 | Draft, Submitted, in District / HO review, Pending Bank Approval, Returned, Rejected | Never reached the branch, nothing closed | Edit / return / reject in the normal workflow |
| N2 | Sent to Branch Manager, or already Sent to Branch Manager/R | Nothing rectified or closed | — |
| N3 | Partially Rectified / Rectified: rectification recorded (verified or not) but **nothing closed** | Nothing closed | **Return Rectification for Correction** |
| N4 | Rectification Returned, nothing closed | Nothing closed | The branch corrects and resubmits |
| N5 | **Transferred**, with cases closed only in a **previous** period | Closing that period would change a previous period | — (the earlier closure is permanent) |

### Never transferred: reversed in its own (originally reported) period

| # | Finding before | After Reverse |
|---|---|---|
| A1 | **Closed** (all cases closed) | All cases outstanding again; rectified / verified / closed = 0; status **Sent to Branch Manager/R** |
| A2 | **Partially closed**: some cases closed, the rest outstanding, rectified or verified but not closed (status Partially Rectified / Rectified) | Same as A1: every closure **and** every rectification in the period is removed, including ones not yet closed; the branch re-records them all |
| A3 | Partially closed, then **Rectification Returned** | Same as A2; the return is replaced by Sent to Branch Manager/R (the return reason stays in history) |
| A4 | **Itemized** finding (individual cases), A1–A3 | Every itemized case goes back to *Outstanding* |

### Transferred: reversed in the current period only

| # | Finding before | After Reverse |
|---|---|---|
| B1 | Nothing closed before the transfer; **closed fully** in the current period | All cases outstanding in the current period; totals = 0. The previous period holds no cases for this finding (everything moved), so it shows nothing before or after |
| B2 | Some cases closed in the previous period, the rest transferred and **closed** in the current period | Current period: its cases outstanding again. Previous period: **unchanged**, its closed cases stay closed. Totals = what the previous period closed (see Example above) |
| B3 | Same as B2, but the current period is only **partially closed** | Same as B2: the current period's closures and rectifications are removed; all its cases are outstanding |
| B4 | A case was **rectified (not closed)** in the previous period, transferred, then closed in the current period | The case was carried forward as outstanding, so it is outstanding again in the current period. The previous period's rectification record stays as history but counts nowhere |
| B5 | **Several hops** (e.g. 2026-08 → 2026-09 → 2026-10), closures in each | Only 2026-10 is reversed; 2026-08 and 2026-09 keep their closures |
| B6 | **Return trip** (2026-09 → 2026-10 → back to 2026-09), closures in both visits to 2026-09 | Every closure credited to 2026-09 is removed (it's the same period); 2026-10 is untouched |
| B7 | Itemized finding, B2–B6 | Cases covered by a previous period's closure stay *Rectified* (earliest first); all others go back to *Outstanding* |

### After a reversal

| # | What happens next | Effect |
|---|---|---|
| C1 | Branch rectifies, district verifies, HO closes again | New closures are credited to the current period; Reverse becomes available again |
| C2 | The finding is **transferred** before being closed again | Its outstanding cases move as usual; a later Reverse applies to the new period only |
| C3 | Reverse is used **again** after a re-closure | Only that period's new closures are removed again |
| C4 | Any period involved is **locked** | Makes no difference to Reverse or to the follow-up work, except submission ([locked-periods.md](locked-periods.md)) |

### Effect on figures

| Where | Effect |
|---|---|
| **Current period**: performance %, dashboards, Monthly / Category / District reports | Its closed cases drop to 0 for this finding; its total cases are unchanged; the finding counts as outstanding, not closed |
| **Previous periods** | **No change**: same cases, same closed cases, same % |
| **All periods** (lifetime figures) | Closed cases drop by what the current period had closed |
| **Weekly Executive Summary** | Closures are counted by date, so the removed closures also disappear from **past weekly snapshots** of the current period |
| **Findings list / status filter** | Shows **SENT TO BRANCH MANAGER/R**; counts as outstanding and in progress |
| **Reminders** | The rectification-reminder timer starts again |

## What changes, in the current period only

| | After reversing |
|---|---|
| Status | **Sent to Branch Manager/R** (stored as `REVERSED`) |
| Closures credited to the current period | removed, so they no longer count in that period's performance %, dashboards or reports |
| Rectification records made in the current period | removed |
| Rectified / district-verified / closed cases and amounts | set back to what **previous periods** closed (0 for a finding that never moved). Every case the current period holds is outstanding again. |
| Itemized cases | the ones closed in a previous period stay *Rectified*; all others go back to *Outstanding* |
| Transfers | kept |
| The finding's period | unchanged (it stays in its current period) |

**Not changed:** previous periods' closures and rectification records, the transfer records, and therefore every previous period's figures (cases, rectified, %).

## The Sent to Branch Manager/R status

It is the same state as **Sent to Branch Manager**, and the workflow treats it the same way:
- The branch sees it in its work queue and must rectify it again.
- It then moves on as usual (Partially Rectified → Rectified → verified → Closed). The new closures are credited to the current period.
- It can be transferred, reminded about and reversed again later.
- It counts as an official, outstanding finding on the dashboards.

The "/R" shows it was reversed. It appears like this on badges, in the status filter, in search and in the workflow history. CSV exports show `SENT_TO_BRANCH_MANAGER/R`.

## What is kept

- The **full workflow history**, including earlier transfers, plus a **Reverse** step (old status → Sent to Branch Manager/R) with the reason.
- The **audit log** entry `FINDING_REVERSED` (older reversals show as `REOPEN_REVERSED`). It holds the reason, the period reversed, a snapshot of every removed rectification and closure, and the previous figures.

## Who is told

The branch's rectifiers and the registrant get a **Reversed** notification naming the period that was reversed. Its email can be switched on or off in Settings → Email Events.

## Technical reference

| | |
|---|---|
| Logic | `src/lib/findingReverse.ts`: `canReverse()`, `closedInCurrentPeriod()`, `reverseFinding()` |
| API | `POST /api/findings/[id]/reverse` with `{ "reason": "…" }` (`src/app/api/findings/[id]/reverse/route.ts`) |
| Error | `FINDING_NOT_REVERSIBLE` (409): nothing was closed in the current period |
| Permission key | `findings.reopen` (stored in roles, so the key keeps its old name) |
| Notification type | `REOPENED` (stored in the email-event settings, so the type keeps its old name; shown as "Reversed") |
| Tests | Manual: [reverse-manual-test-cases.md](reverse-manual-test-cases.md). Automated: `tests/reverseScenarios.test.ts`, one test per scenario above (N1–N5, A1–A4, B1–B7, C1–C4, effect on figures); also `tests/importFlows.test.ts` (reverse block), `tests/lockedPeriod.test.ts` |
