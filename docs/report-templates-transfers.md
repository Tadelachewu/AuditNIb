# Report Templates and Transfers

Three report templates are **never affected by transfers**: moving a finding to another reporting period, or back, doesn't change their numbers. This page explains the rule, what it covers, what it means in practice, and how to check it.

| Report | Changed 2026-10-05 |
|---|---|
| **Category Detail by District** | Counts by original period |
| **Monthly Summary Report** | Counts by original period, including the official score and the Dispatched / Not dispatched columns |
| **Uncovered Branches** | Coverage by original period |

---

## 1. The rule

Every finding belongs to one period for these reports: its **original period**, the period it was first reported in.

- Never transferred → its current period.
- Transferred → the period its **first** transfer left from (every transfer records where it came from, so the earliest one shows where the finding started; later moves can't change it).

In its original period the finding counts **whole**:

| Figure | What counts |
|---|---|
| Cases | **All** its cases |
| Amount involved | Its **full** amount, per currency |
| Rectified | **Everything closed on it**, whichever period the closing happened in |
| Unrectified / Outstanding | Cases − Rectified |

In every other period it counts **nothing**.

## 2. Why

Before, a transferred finding was split between periods: the period it left kept what was closed there, and the destination got the cases carried in. So one transfer changed **two** months' reports. Sep → Oct → back changed them again, and a month-end report could show different numbers a week later just because someone moved a finding. These templates reproduce the bank's official monthly sheets; their numbers should only change when the findings themselves change.

## 3. Worked example

A finding with **10 cases** is registered in **Sep**; **4** are closed in Sep; the other 6 are transferred to **Oct**.

| | Before: Sep | Before: Oct | **Now: Sep** | **Now: Oct** |
|---|---|---|---|---|
| Cases | 4 | 6 | **10** | 0 |
| Rectified | 4 | closed in Oct | **4** + anything closed on it later, anywhere | 0 |
| Branch dispatched / covered? | yes | yes | **yes** | **no** (it reported nothing in Oct) |

The "Now" columns stay the same whether the finding stays in Oct, moves on to Nov, or comes back to Sep.

## 4. What each report counts

### Category Detail by District
Per district × active category: **Total**, **Rectified**, **Outstanding**, plus district totals, Rectified % and the TOTAL row, all by original period. Only approved findings (Sent to Branch Manager or later), from the sources chosen in Settings → Report Template Sources.

### Monthly Summary Report
- **Per-category totals** and **Amount involved**: whole, by original period.
- **Unrectified / Rectified / Rectified %** (the official score): the active scoring rule's categories and sources, approved findings, by original period, whole.
- **Dispatched / Not dispatched**: taken straight from Uncovered Branches (below), so the two always agree.

### Uncovered Branches
An active branch is **covered** in a period when one of its own findings was **originally reported** in that period.
- A finding carried **into** a period by a transfer doesn't cover the branch there.
- The branch stays covered in its original period after the finding moves away.
- Any of the branch's own findings counts, even a draft or one still in review.
- **Bank-wide registrations and imports never count** (they aren't the branch's own reporting).
- **All periods**: covered if the branch reported in any period.

## 5. Good to know

- **Rectified keeps growing after the month.** A September finding closed in December raises **September's** Rectified when viewed in December. The reports are live: a past month shows its findings *as resolved so far*. For a frozen month-end figure, export or print the report at month-end.
- **Reverse and delete still change past months.** Reverse removes closures (Rectified drops in the original period); deleting a finding or reversing an import removes it. The rule only removes the effect of *transfers*.
- **Imported findings** transferred during import count in the period their first transfer left from, the same rule.
- **These reports can differ, on purpose, from period-split views**:
  - Dashboards (cases, Performance %, Transferred Findings / Cases), the Category Performance Summary, the District Ranking templates, the Reports page and the Findings list with a period filter **follow transfers**.
  - The three reports here **don't**.

  For a period with transferred findings, Monthly Summary's Rectified % can differ from the dashboard's District Performance %. Both are correct; they answer different questions:

  | View | Question |
  |---|---|
  | Category Detail, Monthly Summary, Uncovered Branches | What was **reported in** this month, and how much of it is fixed? Which branches **reported**? |
  | Dashboards, Performance %, Ranking templates | What is this month **responsible for**, including cases carried in, minus cases carried out? |

- **Weekly Executive Summary** works from dates, not periods, so transfers never affected it.
- **Transferred Findings** (template) is the register of every transfer hop; it's meant to show transfers.

## 6. A finding moved back to its original period

A transfer normally sets the status to **Transferred**. A transfer **back to the period the finding was first reported in** doesn't: the finding isn't transferred any more, so it gets the status it would have had if it had never left. It's worked out from what is true now, since only **closed** work survives a transfer (rectified-but-not-closed work is reset and goes back to the branch):

| On return to the original period | Status |
|---|---|
| Nothing closed | **Sent to Branch Manager** |
| Some cases closed (in any period) | **Partially Rectified** |

- It isn't restored from before it left: e.g. a finding that was *Rectified* (awaiting closure) when it left lost that rectification in the transfer, so it comes back as *Sent to Branch Manager*.
- Multi-hop returns count too (10 → 11 → 9 → 10). A move to a period it visited that **isn't** its original (10 → 11 → 9 → 11) stays **Transferred**.
- A previously reversed finding comes back as plain *Sent to Branch Manager* (the "/R" reverse is already in its history).
- The history still records the move as a transfer, with the new status; the branch's rectifiers are notified along with the usual recipients.
- Automatic transfer on lock only moves forward, so it never lands back in the original period.

Code: `transferFinding()` in `src/lib/findings.ts`; tests in `tests/reverseScenarios.test.ts` ("transfer back to the original period").

## 7. Manual test cases

| # | Steps | Expected |
|---|---|---|
| T1 | Note Sep's figures in all three reports. Transfer a Sep finding to Oct | Sep's figures unchanged; Oct gains nothing from it |
| T2 | Transfer it back to Sep | Still unchanged in both months |
| T3 | Transfer it on to Nov | Still unchanged; Nov gains nothing |
| T4 | Close some of its cases while it sits in Oct | **Sep's** Rectified rises by those cases; Oct unchanged |
| T5 | A branch whose **only** finding was moved Sep → Oct | Covered / Dispatched in Sep; **Uncovered / Not dispatched** in Oct |
| T6 | Reverse a closed finding | Its original period's Rectified drops |
| T7 | Compare Monthly Summary (Sep) Not dispatched with Uncovered Branches (Sep) for a district | Same number |
| T8 | Choose **All periods** | Totals = the sum of every period's totals |
| T9 | 3 cases in 10, nothing closed: transfer 10 → 11, then back to 10 | Status **Sent to Branch Manager**; the branch can rectify all 3 |
| T10 | 3 cases in 10, close 1, transfer 10 → 11, then back to 10 | Status **Partially Rectified**; 1 closed, 2 to rectify |
| T11 | Transfer 10 → 11 → 9 → 11 | Status stays **Transferred** |

## 8. Technical reference

| | |
|---|---|
| Original period | `originalPeriodId()` in `src/lib/findings.ts` |
| Whole counts by original period | `originalPeriodTotals()` and `originalPeriodEligibleCounts()` in `src/lib/reportTemplates.ts` |
| Reports | `getCategoryDetailByDistrict()`, `getMonthlySummaryReport()`, `getUncoveredBranches()` in `src/lib/reportTemplates.ts` |
| Automated tests | `tests/reportsIgnoreTransfers.test.ts` (never transferred, Sep → Oct, Sep → Oct → back) |
| Data check | `npm run reports:verify` compares both totals with an independent count by original period |

See also: [report-templates.md](report-templates.md) (every template), [reverse-findings.md](reverse-findings.md).
