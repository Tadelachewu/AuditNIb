# Reverse: Manual Test Cases

Step-by-step checks for **Reverse** in the app, one per scenario in [reverse-findings.md](reverse-findings.md) (same IDs). The automated version is `tests/reverseScenarios.test.ts`.

**Rule under test:** Reverse undoes only what was closed in the period the finding is in **now**, sets the status to **Sent to Branch Manager/R**, and never changes previous periods.

---

## 0. Setup (once)

### Users

| Role | Does | Needs |
|---|---|---|
| **Branch Manager** (branch B) | Record Rectification | `findings.rectify` |
| **District Controller** (district of B) | Verify, Transfer | `findings.verify-rectification`, `findings.transfer` |
| **HO Controller** | Close (Accept) | `findings.close` |
| **Administrator** | Reverse, Import, lock periods | Reverse Closed / Partially Closed Findings, Bulk Import |
| **Tester without Reverse** | Negative check | everything above **except** Reverse |

### Periods

In **Admin → Reporting Periods**, have **2026-09, 2026-10, 2026-11** open.

### Test findings

Use category **Other Case**, branch B, **1,000 per case** (amount = cases × 1,000), so the figures are easy to read. Findings can be registered and approved normally, or imported (**Findings → Import**), which is faster:
- **Status SENT_TO_BRANCH_MANAGER** gives a finding ready for the branch.
- **Status CLOSED** gives a finding closed in its Reporting Period.
- **Status TRANSFERRED**, with *Transferred To Period Code* and *Rectified Cases/Amount*, gives a finding whose given cases are closed in the first period and whose remainder is in the second.

### Shorthand used below

| Term | Means |
|---|---|
| **Close N** | Branch Manager: **Record Rectification** for N cases (N × 1,000) → District Controller: **Verify** → HO Controller: **Verify & Close → Accept** |
| **Transfer → P** | District Controller: **Transfer to Another Period** → choose P → reason → **Transfer** |
| **Reverse** | Administrator: **Reverse** → enter a reason (5+ characters) → **Reverse Finding** |
| **Period figures for P** | **Reports → Report Templates → Category Performance Summary**, Period = P, row *Other Case*: **Rectified** and **Unrectified** |

Before each Reverse, write down the period figures for **every** period the finding has been in, so you can compare them afterwards.

---

## N. Not reversible: the Reverse button must NOT appear

| ID | Setup | Steps | Expected | Result |
|---|---|---|---|---|
| N1 | One finding each in **Draft**, **Submitted / District Review**, **HO Review**, **Returned**, **Rejected** | As Administrator, open each finding | No **Reverse** button | ☐ Pass ☐ Fail |
| N2 | A finding in **Sent to Branch Manager** with nothing rectified | Open it as Administrator | No **Reverse** button | ☐ Pass ☐ Fail |
| N3 | 2-case finding. Branch records 1 case; district **Verifies**; nobody closes | Open it as Administrator | No **Reverse** button | ☐ Pass ☐ Fail |
| N4 | 2-case finding. Branch records 1 case; district **Return for Correction** | Open it as Administrator | Status *Rectification Returned*; no **Reverse** button | ☐ Pass ☐ Fail |
| N5 | 2-case finding in 2026-09: **Close 1**, then **Transfer → 2026-10**. (Import: TRANSFERRED, Rectified Cases 1) | Open it as Administrator | No **Reverse** button. The 1 case closed in 2026-09 can't be reversed from 2026-10 | ☐ Pass ☐ Fail |
| N6 | Any finding from A1 below (closed) | Open it as **Tester without Reverse** | No **Reverse** button | ☐ Pass ☐ Fail |

---

## A. Never transferred: reversed in its own period

| ID | Setup | Steps | Expected | Result |
|---|---|---|---|---|
| A1 | 2-case finding in 2026-09, **Close 2** (status *Closed*). Note 2026-09 figures: Rectified 2, Unrectified 0 | 1. Open it as Administrator, click **Reverse** → confirm dialog names 2026-09. 2. Click **Reverse Finding** **without** a reason. 3. Enter a reason, confirm | 1. Dialog says it is reversed in **2026-09 only**. 2. Refused: reason required. 3. Success toast **"Finding reversed successfully."**; status badge **SENT TO BRANCH MANAGER/R**; Rectified / District Verified / Closed = **0**; 2026-09: Rectified **0**, Unrectified **2**; Reverse button gone | ☐ Pass ☐ Fail |
| A1-h | Same finding | Scroll to **Workflow History**; open **Admin → Audit Log** | History has a **reverse** step *CLOSED → SENT TO BRANCH MANAGER/R* with the reason; earlier steps still there. Audit Log has **FINDING_REVERSED** with the reason | ☐ Pass ☐ Fail |
| A1-n | Same finding | Log in as the Branch Manager and as the registrant; open the bell | Both have a **"Finding … reversed"** notification naming 2026-09 and the reason | ☐ Pass ☐ Fail |
| A2 | 3-case finding in 2026-09: **Close 1**; then branch records 1 more and district Verifies (not closed) | **Reverse** | Rectified / Verified / Closed all **0**; **Rectification Ledger** empty; 2026-09: Rectified 0, Unrectified 3 | ☐ Pass ☐ Fail |
| A3 | 2-case finding: **Close 1**; branch records 1 more; district **Return for Correction** with reason "wrong evidence" | **Reverse** | Status **SENT TO BRANCH MANAGER/R**; all figures 0; Workflow History still shows the return with "wrong evidence" | ☐ Pass ☐ Fail |
| A4 | Itemized finding (2 individual cases), both rectified by selecting the cases, verified, closed | **Reverse** | Both cases show **Outstanding** in the cases list | ☐ Pass ☐ Fail |

---

## B. Transferred: only the current period is reversed

| ID | Setup | Steps | Expected | Result |
|---|---|---|---|---|
| B1 | 2-case finding in 2026-09, **Transfer → 2026-10** (nothing closed), then **Close 2** in 2026-10 | **Reverse** | Dialog names **2026-10**. Status **…/R**; figures 0. 2026-10: Rectified 0, Unrectified 2. 2026-09: shows no cases for this finding, same as before. Transfer History still lists the transfer | ☐ Pass ☐ Fail |
| B2 | 2-case finding in 2026-09: **Close 1**, **Transfer → 2026-10**, **Close 1** (status *Closed*). Note 2026-09: Rectified 1, Unrectified 0 | **Reverse** | **2026-09 unchanged** (Rectified 1, Unrectified 0). 2026-10: Rectified 0, Unrectified 1. Finding: Rectified 1, Verified 1, Closed 1. Transfer History kept | ☐ Pass ☐ Fail |
| B2-gap | Continue from B2 | As Branch Manager, **Record Rectification** for **2** cases | Refused: cannot exceed the outstanding **1**. Recording 1 case works | ☐ Pass ☐ Fail |
| B3 | 3-case finding: **Close 1** in 2026-09, **Transfer → 2026-10**, **Close 1** in 2026-10 (1 left open) | **Reverse** | 2026-09 unchanged (1 rectified). 2026-10: Rectified 0, Unrectified 2. Finding: Closed 1 | ☐ Pass ☐ Fail |
| B4 | 2-case finding: branch records 1 case in 2026-09 (**not** closed), **Transfer → 2026-10**, then branch records 1 more, district Verifies, HO closes 2 | **Reverse** | 2026-10: Unrectified 2, Rectified 0. Finding figures 0. Rectification Ledger still shows the 2026-09 entry; the 2026-10 entry is gone | ☐ Pass ☐ Fail |
| B5 | 3-case finding in 2026-09: **Close 1**, **Transfer → 2026-10**, **Close 1**, **Transfer → 2026-11**, **Close 1** | **Reverse** | Dialog names **2026-11**. 2026-09 and 2026-10 unchanged (1 rectified each). 2026-11: Rectified 0, Unrectified 1. Finding: Closed 2 | ☐ Pass ☐ Fail |
| B6 | 3-case finding in 2026-09: **Close 1**, **Transfer → 2026-10**, **Close 1**, **Transfer → 2026-09** (back; pick the "earlier period" option), **Close 1** | **Reverse** | Dialog names **2026-09**. 2026-10 unchanged (1 rectified). 2026-09: Rectified 0, Unrectified 2 (both 2026-09 closures removed). Finding: Closed 1 | ☐ Pass ☐ Fail |
| B7 | Itemized 2-case finding: Case 1 rectified, verified and closed in 2026-09; **Transfer → 2026-10**; Case 2 rectified, verified and closed there | **Reverse** | Case 1 **Rectified**, Case 2 **Outstanding** | ☐ Pass ☐ Fail |

---

## C. After a reversal

| ID | Setup | Steps | Expected | Result |
|---|---|---|---|---|
| C1 | A finding reversed in A1 | **Close 2** again | Each step works; status **Closed**; 2026-09: Rectified 2; **Reverse** button visible again | ☐ Pass ☐ Fail |
| C2 | A finding reversed in B2 (in 2026-10, 1 outstanding) | **Transfer → 2026-11**, **Close 1**, then **Reverse** | Transfer carries **1** case. After Reverse, dialog names **2026-11**; 2026-09 and 2026-10 unchanged; 2026-11: Unrectified 1 | ☐ Pass ☐ Fail |
| C3 | Finding from C1 (closed again) | **Reverse** with reason "second" | Figures 0 again; Workflow History has **two** reverse steps (first and "second"); Audit Log has two FINDING_REVERSED entries | ☐ Pass ☐ Fail |
| C4 | A finding set up like B2; then lock **2026-09 and 2026-10** (Admin → Reporting Periods → Lock, without transferring outstanding cases) | **Reverse**, then **Close 1** | Reverse works (no "locked" error); rectify, verify and close all work; 2026-09 unchanged | ☐ Pass ☐ Fail |
| C5 | A **Draft** finding in a locked period | **Submit** | Refused: period is locked. Submission is the only action a lock blocks | ☐ Pass ☐ Fail |

---

## F. Effect on figures and screens

| ID | Setup | Steps | Expected | Result |
|---|---|---|---|---|
| F1 | Before/after notes from B2 | Category Performance Summary with Period = **All periods** | Rectified total for the finding drops by **1** (what 2026-10 had closed); total cases unchanged | ☐ Pass ☐ Fail |
| F2 | A finding closed this week, as in A1 | **Weekly Executive Summary** with this week's cutoff, before and after Reverse | Before: the cases count as Rectified. After: they move to **Current Balance**; **This Week %** drops | ☐ Pass ☐ Fail |
| F3 | Any reversed finding | **Findings** list: search "/R", or filter Status = **SENT TO BRANCH MANAGER/R** | The finding is listed with that badge | ☐ Pass ☐ Fail |
| F4 | Same | **Findings → Download CSV** and **Reports → Download CSV** | Status column shows **SENT_TO_BRANCH_MANAGER/R** | ☐ Pass ☐ Fail |
| F5 | Same | Dashboards (Branch / District / HO) | Counted as **outstanding / in progress**, not closed | ☐ Pass ☐ Fail |
| F6 | Same | Branch Manager's work queue | The finding appears there to rectify | ☐ Pass ☐ Fail |
| F7 | Settings → Email Events: **Reversed** switched on, then off | Reverse a finding each time | Email sent only when it's on; the in-app notification arrives both times | ☐ Pass ☐ Fail |

---

## Sign-off

| Tester | Date | Build / commit | All passed? | Notes |
|---|---|---|---|---|
| | | | ☐ Yes ☐ No | |
