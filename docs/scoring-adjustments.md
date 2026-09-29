# Scoring Adjustments: What They Really Do, and Test Cases

**Admin → Scoring Adjustments**

---

## 1. In one sentence

A scoring adjustment **replaces the calculated performance %** of **one branch or one district** for **one reporting period** with a number an authorised person types in. It stays in force while it's **Active**.

It does **not** change any finding, case count or rectification. It only changes the **performance percentage that is displayed** for that target and period.

---

## 2. Why it exists

Performance is normally calculated automatically by the active scoring rule:

```
performance % = rectified eligible cases ÷ total eligible cases × 100
```

This only counts cases that were **closed in that period**. Sometimes that number is unfair or wrong for reasons the data can't show: a case that was fixed but closed late, a system outage, a disputed finding. An adjustment lets management **correct the published score** without editing or faking the findings themselves. The correction is recorded with a reason and the person who made it.

---

## 3. How it works, rule by rule

| # | Rule | Example |
|---|---|---|
| 1 | **Exact target + period.** It applies only to the chosen branch or district, in the chosen period. | "Bole Branch, 2026-09 → 85%" affects nothing but Bole in 2026-09. |
| 2 | **It replaces the figure outright.** It isn't added to or averaged with the calculated figure. | Calculated 33.33% → shows **85%**. |
| 3 | **It works even when there's nothing to calculate.** A branch with no eligible cases normally shows "—"; with an adjustment it shows the adjusted value. | "—" → **50%** |
| 4 | **Only Active adjustments count.** Deactivating one returns the target to the calculated figure immediately. It's never deleted. | Deactivate → back to 33.33% |
| 5 | **One active at a time.** Adding (or re-activating) an adjustment automatically **deactivates** any other active one for the same target and period, with an audit entry naming the adjustment that replaced it. | 60% active, add 80% → 60% becomes Inactive, **80%** shows |
| 6 | **Branch and district are separate.** A branch adjustment doesn't change its district's figure, and a district adjustment doesn't change its branches' figures. | District stays 33.33% although Bole shows 85%. |
| 7 | **Bank-wide totals are never adjusted.** The overall HO / Executive performance is always calculated. | Bank-wide stays 33.33%. |
| 8 | **Only for a single period.** With **"All periods"** selected in the filter, adjustments are ignored and the calculated figure is shown. | — |
| 9 | **Not for source-filtered views.** An adjustment is one figure for the whole target, so views narrowed to one finding source show the calculated figure. | — |
| 10 | **Value 0–100.** The adjusted score must be between 0 and 100, with at most two decimals. Anything else is refused. | 150 or −20 → refused |
| 11 | **Audit.** Creating, activating and deactivating all need a reason and are written to the audit log. Adjustments can't be deleted. | — |
| 12 | **Protects its period.** A reporting period that has adjustments can't be deleted. | — |

**Who can use it:** anyone whose role has **Scoring Adjustments › View / Create / Activate-Deactivate** (Administrator by default).

---

## 4. Where the adjusted figure shows, and where it doesn't

| Place | Shows the adjusted % ? |
|---|---|
| Branch / District Dashboard performance card | ✅ Yes, labelled **"Manually overridden"** with the reason |
| Branch ranking, branch performance table, district ranking table | ✅ Yes, with an **Adjusted** badge (reason on hover). Clicking the % explains the override and the formula's figure. |
| HO / Executive / District dashboards: top and bottom performers, rankings | ✅ Yes, with an **Adjusted** badge |
| Top / lowest performer callouts above the branch table | ✅ Yes, marked "(adjusted)" |
| Monthly performance trend | ✅ Yes, for the adjusted period's point |
| Reports page: branch and district performance lists | ✅ Yes, with an **Adjusted** badge |
| **Report templates: Monthly District History, Monthly District Detail** | ✅ Yes, for each district/period with an adjustment, with an **Adjusted** badge; CSV export shows `85.0 (adjusted)` |
| **Report template: District Ranking – Other Cases** | ✅ Yes, when **one** period is selected (badge + CSV mark). With several periods, or none, the figure is a sum across periods and stays calculated. |
| Report templates narrowed to specific **sources** (Settings → Report Template Source Filters) | ❌ No. An adjustment is one whole-district figure, the same rule as source-filtered dashboard views. |
| District Ranking – All Cases, Category Performance, Mid-Month Snapshot, Monthly Summary | ❌ No. They measure something different (all categories, a mid-period cutoff, or counts only), not the official performance an adjustment corrects. |
| **Bank-wide overall performance** (HO / Executive headline) | ❌ No, always calculated (by design, rule 7) |
| **Case counts** (total / rectified / outstanding) | ❌ Never adjusted. The badge explains why a % can differ from its counts. |

---

## 5. Test cases

### 5.1 Automated checks (run against the real calculation)

These were run on the development database. Adjustments were added **in memory only**, and nothing was saved. The base scenario: **Bole Branch, Addis Ababa District, period 2026-09**, where the formula gives **33.33%** (2 of 6 eligible cases rectified). The district and bank-wide figures are also 33.33%.

| ID | Scenario | Expected | Result |
|---|---|---|---|
| TC01 | No adjustment | 33.33% (formula) | ✅ PASS |
| TC02 | Active branch adjustment 95% | 95% | ✅ PASS |
| TC03 | Adjustment exists but **Inactive** | 33.33% (ignored) | ✅ PASS |
| TC04 | Active adjustment for a **different period** | 33.33% (ignored) | ✅ PASS |
| TC05 | Two Active adjustments, 60% then 80% | 80% (newest wins). With the fix, adding the second one deactivates the first, so only one is ever active. | ✅ PASS |
| TC06 | Branch adjustment 95%, look at the **district** | 33.33% (unchanged) | ✅ PASS |
| TC07 | Active **district** adjustment 70% | 70% for the district | ✅ PASS |
| TC08 | District adjustment 70%, look at a **branch** in it | 33.33% (unchanged) | ✅ PASS |
| TC09 | District adjustment, view narrowed to district + one branch | 33.33% (ignored) | ✅ PASS |
| TC10 | Branch and district adjustments, look at **bank-wide** | 33.33% (unchanged) | ✅ PASS |
| TC11 | Branch adjustment, **"All periods"** selected | 18.18% (lifetime formula, ignored) | ✅ PASS |
| TC12 | Branch adjustment, view filtered to **one source** | formula result (ignored) | ✅ PASS |
| TC13 | Adjustment 50% for a branch with **no eligible cases** | 50% (instead of "—") | ✅ PASS |
| TC14 | Adjustment **150%** | Refused by the API: "The adjusted score must be between 0 and 100 (at most 2 decimals)" | ✅ PASS (fixed) |
| TC15 | Adjustment **−20%** | Refused by the API | ✅ PASS (fixed) |
| TC16 | Values 0, 100, 85.5, 33.33 | Accepted | ✅ PASS |
| TC17 | Value 33.333 (three decimals), NaN | Refused | ✅ PASS |
| TC18 | Two older Active adjustments for the same branch and period, then a new one | Both older ones become **Inactive**, the new one stays **Active**, one audit entry each | ✅ PASS |
| TC19 | Same, but one older adjustment is for **another period** and one for **another branch** | Those two stay Active (untouched) | ✅ PASS |
| TC20 | District adjustment 77% → **Monthly District History** for that district and period | 77%, marked adjusted; case counts unchanged; no other row adjusted | ✅ PASS |
| TC21 | Same adjustment → **District Ranking – Other Cases**, **one** period selected | 77%, marked adjusted | ✅ PASS |
| TC22 | Same → District Ranking – Other Cases, **several** periods selected | Calculated (not adjusted) | ✅ PASS |
| TC23 | Same → **District Ranking – All Cases** | Calculated (different metric) | ✅ PASS |
| TC24 | Same, template narrowed to specific sources | Calculated (not adjusted) | ✅ PASS |

**All 24 pass.** TC14–TC24 cover the fixes in §6.

**Your current data:** two Active adjustments exist, **Bole Branch 2026-09 → 85%** (reason "chenge bole %") and **Markos Branch 2026-09 → 80%** (reason "adjusted"). So Bole's dashboards show **85%** while its real figure is **2 of 6 cases = 33.33%**.

### 5.2 Manual test cases (in the app)

Sign in as **admin**. Use a period and a branch that already have findings.

| ID | Steps | Expected |
|---|---|---|
| M01 | Note the branch's performance % on the District Dashboard (filter: that period). | e.g. 33.33% |
| M02 | Admin → Scoring Adjustments → **New Adjustment**: target = that branch, period = that period, value = 90, reason "QA test". Save. | Listed as **Active**. |
| M03 | Reopen the District Dashboard, same period filter. | The branch shows **90%**. The **district's** own % is unchanged. |
| M04 | Branch ranking / top–bottom performers on the HO Dashboard. | The branch ranks at 90%. |
| M05 | Reports page, same period. | The branch's performance is 90%. |
| M06 | Set the dashboard filter to **All periods**. | The branch shows its calculated lifetime %, not 90%. |
| M07 | Create a **district** adjustment, then open **District Ranking – Other Cases** with that one period selected, and **Monthly District History**. | The district shows the adjusted % with an **Adjusted** badge; **Export CSV** shows `(adjusted)`. |
| M08 | Deactivate the adjustment (enter a reason). | Listed as **Inactive**; the dashboards show the calculated % again. |
| M09 | Reactivate it. | 90% again. |
| M10 | Create a second adjustment for the same branch and period, value 75. | Dashboards show **75%**. The earlier 90% adjustment is now **Inactive**, and the Audit Log shows it was automatically deactivated. |
| M11 | Create a **district** adjustment of 60% for the branch's district. | The district shows 60%; its branches keep their own figures (75% for the test branch). |
| M12 | Try to delete the reporting period used. | Refused, because the period has adjustments. |
| M13 | Admin → Audit Log. | Entries for each create, activate and deactivate, with reasons. |
| M14 | Enter value **150** or **−20**. | Refused: "The adjusted score must be between 0 and 100 (at most 2 decimals)". |
| M15 | Sign in as a role **without** Scoring Adjustments permission and open the page. | Page not available. |

**Clean-up:** deactivate the test adjustments (they can't be deleted).

---

## 6. Issues found, and how they were fixed

| # | Issue (before) | Fix |
|---|---|---|
| 1 | Any number was accepted, so 150% or −20% could be published. | The API accepts only **0–100, at most 2 decimals**. The form limits the input to 0–100. |
| 2 | Report templates ignored adjustments, although the page said they applied to reports. | **Monthly District History / Detail** and **District Ranking – Other Cases** (single period) now use the adjusted figure, with a badge on screen and `(adjusted)` in CSV exports. Templates that measure something else stay calculated (see §4). The page text now says exactly where adjustments apply. |
| 3 | Rankings and tables showed an adjusted % unmarked, next to real counts ("2 of 6 — 85%"). | An **Adjusted** badge (reason on hover) wherever an adjusted % appears. Clicking the % in the ranking tables explains the override and shows the formula's own figure. |
| 4 | Several adjustments could be Active for one target and period; only the newest counted. | Adding or re-activating one **automatically deactivates** the others for the same target and period, with an audit entry for each. |
| 5 | Bank-wide totals are never adjusted. | Unchanged, by design; stated on the admin page and in §4. |

**Existing data:** your two current adjustments (Bole 85% and Markos 80%, period 2026-09) are each the only active one for their branch and within 0–100, so nothing about them changes. They now show the **Adjusted** badge.

---

## 7. For developers

| File | Role |
|---|---|
| `src/lib/findings.ts`: `getActiveScoringAdjustment()`, `computePerformance()` | Matching rules and the override |
| `src/app/api/admin/scoring-adjustments/route.ts` | List, create |
| `src/app/api/admin/scoring-adjustments/[id]/route.ts` | Activate / deactivate |
| `src/app/(app)/admin/scoring-adjustments/page.tsx` | Admin page |
| `src/lib/scoringAdjustments.ts` | Value check (0–100) and the one-active-at-a-time rule |
| `src/lib/reportTemplates.ts`: `withDistrictAdjustment()` | Applies adjustments in the district report templates |
| `src/components/ui/AdjustedBadge.tsx` | The **Adjusted** badge |
