# Report Templates and Transfers

Since 2026-10-21, every case figure in the app **follows transfers**:
- the dashboards;
- the Findings list;
- the report templates, including Category Detail by District and the Monthly Summary.

A period shows the cases that are **in it**, and the cases **closed in it**. The one exception is **dispatch coverage** ("was something reported in this period?"), which stays by the period a branch reported in.

| Report | What follows transfers | What stays by the reporting period |
|---|---|---|
| **Category Detail by District** | Total, Rectified, Outstanding, Rectified % | — |
| **Monthly Summary Report** | Per-category totals, Amount involved, Unrectified / Rectified / Rectified % | **Dispatched / Not dispatched** |
| **Uncovered Branches** | — | Coverage (a branch is covered in the period it reported in) |
| **District Ranking (All / Other Cases)**, Monthly District History / Detail, dashboards, Findings list | everything | — |

---

## 1. The rule

| Figure, for one period | What counts |
|---|---|
| **Cases** | Cases that are in the period: registered there or transferred in, minus what was transferred out. Approved adjustments add their cases to the period the finding was in when they were approved |
| **Rectified** | Cases **closed in that period** (each closure records its period) |
| **Outstanding** | Cases − Rectified |
| **Amount involved** | The same, by amount, per currency |
| **All periods** | Every case once and every closure once, i.e. the findings' current figures |

**Example:** 10 cases registered in 2026-09, 4 closed there, the other 6 transferred to 2026-10, then 2 closed in 2026-10:

| Period | Cases | Rectified | Outstanding |
|---|---|---|---|
| 2026-09 | 4 | 4 | 0 |
| 2026-10 | 6 | 2 | 4 |
| All periods | 10 | 6 | 4 |

**A round trip** (2026-09 → 2026-10 → back to 2026-09) leaves everything in 2026-09 again and nothing in 2026-10. In the Findings list, the return **cancels** the transfer, so both periods show In 0 / Out 0.

## 2. Dispatch coverage stays by the reporting period

**Monthly Summary's Dispatched / Not dispatched** and **Uncovered Branches** answer whether the branch *reported* anything in a month. A finding transferred into a month doesn't mean the branch reported in it, so coverage counts the period the finding was registered in. It stays covered there after the finding moves on.

## 3. Transferred Findings report

- **The register:** lists every transfer hop, for the audit trail.
- **The totals count what really moved:**
  - **each finding once**;
  - **a return cancels the transfer it undoes:** a finding moved Sep → Oct → back to Sep has moved 0 cases;
  - **a finding moved several times counts once:** Sep → Oct → Nov with 20 cases counts 20, not 40.
- **The filters:** "Transferred out of" / "Transferred into" match each hop's own periods.
- **Dashboards:** the "Transferred Findings / Cases" cards use the same net movement (`netTransferMovement()` in `src/lib/findings.ts`).

## 4. Checking it

- **Automated:** `tests/reportsFollowTransfers.test.ts` covers never transferred, transferred with closures before and after, all periods, a round trip, and coverage staying by registration. `tests/findingsInOut.test.ts` and `tests/transferTotals.test.ts` cover In / Out netting and the transferred totals.
- **By hand:**
  1. Register a finding in the current period and close part of it.
  2. Transfer the rest to the next period and close some there.
  3. Category Detail and the Monthly Summary for each period should match the Findings list filtered to that period: Total Cases and Closed Cases.
