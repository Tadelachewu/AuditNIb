# Weekly Executive Summary & Category Performance Summary

How these two report templates (Reports → Report Templates) calculate every figure, including where Category Performance Summary's **Percentage Ranges** come from.

Rules shared by both reports:
- **Only approved findings count.** A finding must have reached *Sent to Branch Manager* or later. Drafts and findings still in district review, HO review or bank-wide approval are left out, and so are rejected ones.
- **"Rectified" means formally closed.** A case counts as rectified only once it is **closed**. Being recorded by the branch or verified by the district isn't enough.
- **Source setting:** if Settings → Report Template Sources limits the report to certain sources (e.g. IC only), only findings from those sources count, and the report says so under its title.
- **Districts listed:** every active district, plus any deactivated one that still has findings.
- **Categories:** every active classified category, in the bank's report order.

Code: `getWeeklyExecutiveSummary()` and `getCategoryPerformanceSummary()` in `src/lib/reportTemplates.ts`.

---

## 1. Weekly Executive Summary

> Full guide to this report (filters, every column, worked example, what can change past weeks): [weekly-executive-summary.md](weekly-executive-summary.md).

**Purpose:** week-over-week progress of every category, district by district: what was outstanding last week, what was added, what was rectified, and what is outstanding now.

### Filters

| Filter | Meaning | Default |
|---|---|---|
| **This week (cutoff date)** | the "as of" date for this week | the Sunday ending the current week (weeks run Monday–Sunday) |
| **Previous week (cutoff date)** | the "as of" date for last week | the Sunday ending last week |

Any two dates can be chosen, e.g. to compare two past weeks or two months.

### How it counts

The report has **one section per category**. In each section, for each district, it takes two snapshots, one **as of each cutoff date**:

- **Cases as of a date** = the full case count of every approved finding whose **finding date** is on or before that date.
- **Rectified as of a date** = the cases **formally closed on or before** that date (by the closure date).

So the comparison is by dates, not reporting periods. A finding counts with all its cases, whichever period it's in now; transfers don't change these figures.

### Columns

| Column | Formula |
|---|---|
| **Previous Balance** | cases as of last week − rectified as of last week (what was outstanding last week) |
| **Additional** | cases as of this week − cases as of last week (new cases dated between the two cutoffs) |
| **Rectified** | Previous Balance + Additional − Current Balance (cases closed between the two cutoffs) |
| **Current Balance** | cases as of this week − rectified as of this week (outstanding now) |
| **This Week %** | rectified as of this week ÷ cases as of this week × 100 |
| **Last Week %** | rectified as of last week ÷ cases as of last week × 100 |
| **Difference** | This Week % − Last Week %, in percentage points (positive = improved) |

Each section ends with a **TOTAL** row. It is calculated the same way from the bank-wide sums, not by adding up the districts' percentages.

### Worked example (one category, one district)

| | As of last week | As of this week |
|---|---|---|
| Cases (finding date on/before the cutoff) | 40 | 46 |
| Closed on/before the cutoff | 10 | 18 |

- Previous Balance = 40 − 10 = **30**
- Additional = 46 − 40 = **6**
- Current Balance = 46 − 18 = **28**
- Rectified = 30 + 6 − 28 = **8** (closed during the week)
- This Week % = 18 ÷ 46 = **39.1%** · Last Week % = 10 ÷ 40 = **25.0%** · Difference = **+14.1**

### Good to know

- A finding's **approval** is checked as it is today. If a finding dated last week was approved only this week, it also appears in last week's figures when the report is viewed now.
- A percentage shows **--** when there are no cases as of that date.

---

## 2. Category Performance Summary

**Purpose:** one row per category, bank-wide: how many cases are rectified and outstanding, how districts compare (**Percentage Ranges**), the bank-wide rate (**Gross Percentage**), and the trend against the previous period.

### Filter

| Filter | Meaning |
|---|---|
| **Period** | one reporting period, or **All periods** (default) |

With a period selected, each finding counts **only the cases that belong to that period**: a transferred finding is split between the period it left and the period it moved to, so a case is never counted twice. With **All periods**, every case of every finding counts.

### Columns

| Column | How it is calculated |
|---|---|
| **Types of cases** | the category |
| **Unrectified** | cases not yet closed (total − rectified) |
| **Rectified** | cases formally closed |
| **Total Outstanding Unrectified** | the same outstanding figure, kept as in the bank's sheet |
| **Percentage Ranges** | the **lowest and highest district rate** for the category (below) |
| **Gross Percentage** | the category's **bank-wide** rate: all its closed cases ÷ all its cases × 100 |
| **Previous Period** | the category's Gross Percentage in the **previous reporting period** |

The **TOTAL** row adds up cases across categories. The overall Gross Percentage in the header is total closed ÷ total cases across every category.

### Where the Percentage Ranges come from

For **each category**:

1. **Each district's rate** is calculated separately: that district's **closed cases ÷ total cases** in this category × 100, for the selected period (or all periods).
2. **Districts with no cases** in this category are **left out**. They don't count as 0%, so a district that never had such a case can't drag the range down.
3. The range shows the **lowest** and the **highest** of those district rates, rounded to whole percents: **"lowest% up to highest%"**.
4. If no district has cases in the category, the range shows **--**. If only one district has cases, both ends are the same (e.g. "40% up to 40%").

**Example:** category *Other Case*, one period:

| District | Cases | Closed | District rate |
|---|---|---|---|
| Addis Ababa | 20 | 15 | 75% |
| Adama | 10 | 2 | 20% |
| Bahir Dar | 5 | 5 | 100% |
| Mekelle | 0 | 0 | *(left out: no cases)* |

- **Percentage Ranges** = **20% up to 100%** (Adama is the lowest, Bahir Dar the highest)
- **Gross Percentage** = (15 + 2 + 5) ÷ (20 + 10 + 5) = 22 ÷ 35 = **62.9%**

Gross is not the average of the district rates. It weights every case equally, so big districts count for more.

### Previous Period

- The **reporting period before** the selected one, in calendar order (e.g. 2026-08 for 2026-09).
- It uses the **same calculation** as Gross Percentage, for that earlier period.
- It shows **--** when "All periods" is selected, for the very first period on record, or when the category had no cases then.

---

## 3. Download CSV

Both reports' **Download CSV** contains the same figures as the page, with the same filters: the two cutoff dates for the weekly summary, the period for the category summary. Percentage Ranges appear in the CSV exactly as on screen (e.g. "20% up to 100%").
