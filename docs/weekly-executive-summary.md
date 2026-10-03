# Weekly Executive Summary

**Reports → Report Templates → Weekly Executive Summary**

Every case category, district by district, compared between **two cutoff dates**: what was outstanding as of the earlier date, what was added and rectified (formally closed) in between, and what is outstanding as of the later date, plus the rectified rate at both dates. By default the two dates are the Sundays ending this week and last week (a week-over-week view); **any two dates can be chosen** (see §2.1).

---

## 1. Who can see it

- Anyone with the permission **Report Templates › Weekly Executive Summary**.
- The figures are **bank-wide**, whoever opens it: every district, not just the viewer's own.

## 2. The filters

| Filter | What it is | Default |
|---|---|---|
| **This week (cutoff date)** | The "as of" date for **this week's** snapshot | The **Sunday** that ends the current week (weeks run Monday → Sunday) |
| **Previous week (cutoff date)** | The "as of" date for **last week's** snapshot | The Sunday that ended last week |

Press **View** to apply. Any two dates can be chosen, for example to compare two past weeks or the end of two months.

- The report compares **two snapshots in time**, so it doesn't use reporting periods at all; there is no period filter.
- Choose the previous-week date **before** the this-week date. Reversed dates aren't refused, but the columns then read backwards (Additional and Rectified come out negative).

### 2.1 Choosing any dates

The dates don't have to be Sundays or a week apart. The report takes two snapshots, *as of the earlier date* and *as of the later date*, and the columns describe what happened between them. The column titles still say "This Week" / "Last Week", so read them as "as of the later date" / "as of the earlier date".

| What you choose | What you get |
|---|---|
| Any day mid-week (e.g. 2026-10-01) | The snapshot at the **end of that day**: findings dated up to 1 Oct, closures made by the end of 1 Oct |
| Dates further apart (e.g. 2026-09-01 and 2026-09-30) | A month-over-month view: Additional = cases dated 2–30 Sep, Rectified = cases closed 2–30 Sep |
| A future date | The same as today (nothing exists after today) |
| A date before any finding | An empty snapshot: 0 cases, percentages **--** |
| The same date in both | Additional 0, Rectified 0, Difference 0 |
| Previous date after this-week date | Not refused, but reversed: Additional and Rectified come out negative |
| A field left empty | That field falls back to its default Sunday |

### Settings that also shape it

- **Report Template Sources** (Settings): if the administrator limits this template to certain sources (e.g. Internal Control only), only findings from those sources count, and a note under the title says so.
- **Categories:** one section per **active** classified category, in the bank's report order.
- **Districts:** every **active** district, plus any **deactivated** district that still has findings, so its numbers never disappear from the totals.

## 3. Which findings and cases count

A finding counts in a snapshot when **all** of these are true:

1. It is **approved**: it has reached *Sent to Branch Manager* or later (including Sent to Branch Manager/R, Partially Rectified, Rectified, Rectification Returned, Transferred, Closed). Drafts, findings still in district / HO / bank-wide review, returned and rejected findings are left out.
2. Its **finding date** is **on or before** the snapshot's cutoff date.
3. It matches the source setting above.

For each counted finding:

- **Cases** = all its cases (its full number of cases).
- **Rectified** = the cases **formally closed on or before the cutoff date** (by the date of the closure). A case the branch recorded as rectified, or the district verified, is **not** counted until it is closed.

The weekly summary compares **dates**, not periods, so **transfers don't change it**: a transferred finding counts with all its cases, whichever period it's in now.

## 4. What each column shows

Each section (one per category) has one row per district, then a **TOTAL** row.

Let:
- *Cases (last)* / *Closed (last)* = cases and closed cases **as of the previous-week cutoff**
- *Cases (this)* / *Closed (this)* = the same **as of the this-week cutoff**

| Column | What it shows | Formula |
|---|---|---|
| **SN** | Row number | |
| **Total No. of Branches** | How many **active** branches the district has (for context; not used in any formula) | |
| **District** | The district | |
| **Previous Balance** | Cases still **outstanding at the end of last week** | Cases (last) − Closed (last) |
| **Additional** | **New** cases with a finding date **between the two cutoffs** | Cases (this) − Cases (last) |
| **Rectified** | Cases **closed between the two cutoffs** | Previous Balance + Additional − Current Balance (= Closed (this) − Closed (last)) |
| **Current Balance** | Cases **outstanding now** (as of this week's cutoff) | Cases (this) − Closed (this) |
| **This Week %** | Share of all cases closed, as of this week | Closed (this) ÷ Cases (this) × 100 |
| **Last Week %** | Share of all cases closed, as of last week | Closed (last) ÷ Cases (last) × 100 |
| **Difference** | Change in the rate, in **percentage points** (green = up, red = down) | This Week % − Last Week % |

- The balance always adds up: **Previous Balance + Additional − Rectified = Current Balance**.
- A percentage shows **--** when there are no cases as of that date (nothing to divide by); then Difference shows **--** too.
- The **TOTAL** row is calculated the same way from the **sums** of all districts. Its percentages are the bank-wide rate, **not** an average of the district percentages.
- The **section header** repeats the TOTAL row's Current Balance, Rectified and Additional for a quick read.

## 5. Worked example

Category *Other Case*, Addis Ababa District. Previous-week cutoff 2026-09-27, this-week cutoff 2026-10-04.

| | As of 2026-09-27 | As of 2026-10-04 |
|---|---|---|
| Cases (finding date on or before the cutoff) | 40 | 46 |
| Closed on or before the cutoff | 10 | 18 |

| Column | Value |
|---|---|
| Previous Balance | 40 − 10 = **30** |
| Additional | 46 − 40 = **6** (new cases dated 28 Sep – 4 Oct) |
| Current Balance | 46 − 18 = **28** |
| Rectified | 30 + 6 − 28 = **8** (closed 28 Sep – 4 Oct) |
| This Week % | 18 ÷ 46 = **39.1%** |
| Last Week % | 10 ÷ 40 = **25.0%** |
| Difference | 39.1 − 25.0 = **+14.1 pp** |

## 6. Good to know

- **It's live.** Every time it's opened, both snapshots are recalculated from today's data. Nothing is saved per week.
- **So past weeks can change**, in these cases:
  - **Approval is checked as it is today.** A finding dated last week but approved only this week also appears in last week's figures when you look now.
  - **Reverse** (undoing a finding's closure) removes those closures, so they disappear from every snapshot, including past weeks (see `reverse-findings.md`).
  - **Deleting** a finding or **reversing an import** removes its cases from every snapshot.
- **Cases, not findings:** every figure counts **cases**. A finding with 3 cases adds 3.
- **"Rectified" means closed.** It is not the branch's recorded rectification, and not the district's verification.
- **Default dates and time zone:** the default Sundays are worked out on the server. In the first hours after midnight on a Monday, the default can still point to the previous week. Pick the dates explicitly if it matters.

## 7. Download CSV and Print

- **Download CSV** contains the same rows for the same two cutoff dates, with these columns: Section, Types of Cases, SN, Total No. of Branches, District, Previous Balance, Additional, Rectified, Current Balance, This Week Rectified %, Last Week Rectified %, Difference. Each section ends with its TOTAL row.
- **Print / Save as PDF** prints the report without the filters and buttons.

## 8. Technical reference

| | |
|---|---|
| Page | `src/app/(app)/reports/templates/weekly-executive-summary/page.tsx` (URL parameters `thisWeekDate`, `lastWeekDate`) |
| Calculation | `getWeeklyExecutiveSummary()` and `weekEndDate()` in `src/lib/reportTemplates.ts` |
| CSV | `GET /api/report-templates/weekly-executive-summary/export?thisWeekDate=…&lastWeekDate=…` |
| "Approved" | `isHoApproved()` in `src/lib/findings.ts` |
| Closed as of a date | `closedAsOf()`: closures whose local date is on or before the cutoff |
| Check | `npm run reports:verify` compares the template with the raw data |

See also: `weekly-executive-and-category-performance.md` (this report alongside the Category Performance Summary).
