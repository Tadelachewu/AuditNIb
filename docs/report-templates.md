# Reports & Report Templates

A deep, code-grounded reference for the `/reports` and `/reports/templates/*` feature of NIB Control360 (ICFMS). Every non-trivial claim below cites the exact source file and line(s) it was verified against.

---

## 1. Overview

The app has **two distinct but related reporting surfaces**:

1. **`/reports`** (`src/app/(app)/reports/page.tsx`) — a single, filterable "Findings Report" page: a findings table, branch/district performance leaderboards, a category/risk breakdown, and a transfers table, all driven by the same `FilterBar`/`TimeRangeFilter` query-string filters used elsewhere in the app (`src/app/(app)/reports/page.tsx:28-148`). It is gated by `reports.view` (`src/app/(app)/reports/page.tsx:35`) and has its own CSV export (`/api/findings/export`, referenced at `src/app/(app)/reports/page.tsx:162`) — **not** part of the Report Templates system and out of scope for the rest of this document except where it clarifies shared conventions (Section 3/4).

2. **`/reports/templates`** (`src/app/(app)/reports/templates/page.tsx`) — the subject of this document: **11 named report templates** that reproduce the bank's own Internal Control Division Excel reports (`report/*.xlsx`) as live, permission-gated, server-rendered pages, plus one bank-specific addition (Transferred Findings) that has no legacy Excel counterpart. A user reaches this hub via the "Report Templates →" link on `/reports` (`src/app/(app)/reports/page.tsx:419-423`, itself only shown if the viewer holds `report-templates.view`).

### 1.1 Single source of truth

`src/lib/reportTemplates.ts:19-38` defines `REPORT_TEMPLATES`, an array of `{ slug, action, label, description }` — the one place that ties together a template's URL slug, its permission action name, its hub-page card copy, and (via `action`) its permission key. The hub page (`templates/page.tsx`), every individual template page, and the shared CSV export route (`src/app/api/report-templates/[slug]/export/route.ts:38`) all import this array rather than re-declaring the list, so adding/renaming a template only requires editing one place — per the file's own header comment (`src/lib/reportTemplates.ts:15-18`).

Every number these templates show is **computed live** from the existing `Finding`/`District`/`Branch`/`FindingTransfer` tables on every request — nothing is a stored snapshot (`src/lib/reportTemplates.ts:5-13`), with the single exception of `BranchCoverageNote` (Section 2.1's "reason" text), which genuinely is persisted, writable state.

### 1.2 Common UI pattern

Every one of the 11 template pages (and the hub page) follows the same structure — confirmed by reading all 11 `page.tsx` files:

- A server component that calls `getCurrentUser()`, redirects to `/login` if unauthenticated, then redirects to `/reports/templates` if the viewer lacks that template's specific permission (e.g. `src/app/(app)/reports/templates/monthly-summary/page.tsx:18-20`).
- An inline `<style>{'@media print { nav, header, .no-print { display: none !important; } main { padding: 0 !important; } }'}</style>` block, identical across all 11 pages (e.g. `.../monthly-summary/page.tsx:33`), that hides chrome when printing.
- A header row (wrapped `no-print`) with: a "← Back" link to `/reports/templates`, the page `<h1>`/description, a **Download CSV** button (a plain `<a href="/api/report-templates/<slug>/export?...">`, carrying whatever filters are currently selected as query params — e.g. `.../monthly-summary/page.tsx:49`), and a `<PrintButton />`.
- A `<form method="GET">` filter bar (also `no-print`) — period dropdown, district dropdown, date inputs, or period checkboxes depending on the template (Section 2 documents each one's exact filter set).
- One or more `Card`/`CardHeader` tables rendering the template's data, with a bold `TOTAL` row computed from the same aggregation function.

Because the filter state lives entirely in the URL query string (GET forms, no client state), every template page is a plain server component with no `"use client"` directive of its own — only the small `PrintButton` and (on Uncovered Branches) `UncoveredBranchesTable`/`UncoveredBranchNoteForm` are client components.

---

## 2. Summary table

| # | Template | Slug | Business question | Computation function | Primary scope |
|---|----------|------|--------------------|-----------------------|----------------|
| 1 | Uncovered Branches | `uncovered-branches` | Which active branches filed **zero** findings this period, and why? | `getUncoveredBranches` (`reportTemplates.ts:78`) | One reporting period, all active branches |
| 2 | Category Detail by District | `category-detail-by-district` | Per district, per category: how many cases are unrectified vs rectified? | `getCategoryDetailByDistrict` (`reportTemplates.ts:117`) | One period, all active districts × all active categories |
| 3 | Monthly Summary Report | `monthly-summary` | Category detail + money involved + branch dispatch coverage + official score, per district | `getMonthlySummaryReport` (`reportTemplates.ts:196`) | One period, all active districts |
| 4 | Monthly District History | `monthly-district-history` | Official "Other Case" performance by district, for one chosen period | `getMonthlyDistrictSeries().otherCases`, filtered (`reportTemplates.ts:288`) | One period (filter applied in the page), all periods in the underlying series |
| 5 | Monthly District Detail | `monthly-district-detail` | The same district × period history, long-format, one district block at a time | `getMonthlyDistrictSeries()` (`reportTemplates.ts:288`), both `otherCases` and `various` | All periods, optionally filtered to one district |
| 6 | District Ranking – Other Cases | `district-ranking-other-cases` | Rank districts by the official scored category, cumulative or over chosen periods | `getDistrictRankingOtherCases` (`reportTemplates.ts:377`) | Selected periods (sum) or lifetime |
| 7 | Weekly Executive Summary | `weekly-executive-summary` | For every classified category: balance carried forward this week vs. last week, by district | `getWeeklyExecutiveSummary` (`reportTemplates.ts:493`) | Two cutoff dates (rolling week by default) |
| 8 | District Ranking – All Cases | `district-ranking-all-cases` | Rank districts across **every** classified category (not just the scored one) | `getDistrictRankingAllCases` (`reportTemplates.ts:546`) | Selected periods (sum) or lifetime |
| 9 | Category Performance Summary | `category-performance-summary` | Bank-wide rectification rate per category, with the per-district min/max range | `getCategoryPerformanceSummary` (`reportTemplates.ts:620`) | One period or all periods |
| 10 | Mid-Month District Snapshot | `mid-month-district-snapshot` | District performance as of an arbitrary cutoff date inside a period | `getDistrictSnapshotAsOf` (`reportTemplates.ts:697`) | One period + one as-of date |
| 11 | Transferred Findings | `transferred-findings` | Every transfer hop, bank-wide: origin detail, what happened before it left, where it went, status today | `getTransferredFindings` (`reportTemplates.ts:779`) | Optional from-period/to-period filter, bank-wide |

Shared helpers used across most templates: `activeBranches`/`activeDistricts`/`activeCategories` (`reportTemplates.ts:40-60`, categories re-ordered per `REPORT_CATEGORY_ORDER` at line 53 to match the bank's own Excel column order — Zero Balance before Dormant, unlike `db.categories`' own creation order), `districtBranchCount` (line 63, "Total No. of Branches" column present on almost every sheet), and `districtRankingTotalRow` (line 364, the shared TOTAL-row reducer for templates 6/8/10).

---

## 3. Per-template breakdown

### 3.1 Uncovered Branches (`uncovered-branches`)

- **Question**: which ACTIVE branches submitted no findings at all this period?
- **Computation**: `getUncoveredBranches(db, periodId)` (`reportTemplates.ts:78-93`).
- **Columns**: Ser. No, Branch name, District name, recorded Reason (`BranchCoverageNote`, or blank).
- **Filters**: one reporting period (`Select` defaulting to the currently `OPEN` period, or the first period on record — `.../uncovered-branches/page.tsx:27-28`).
- **Scope rule (important, distinct from every other template)**: coverage is computed from `findingsResidentInPeriod(db, periodId, coverageCandidates)`, **not** the raw `db.findings` list (`reportTemplates.ts:84-93`) — it deliberately does **not** apply the `isHoApproved()` gate every other template uses for "official" figures, so a branch that merely submitted a DRAFT/SUBMITTED/DISTRICT_REVIEW finding (never approved) is still counted as "covered." The doc comment at `reportTemplates.ts:79-83` explains the residency choice: a finding that was partially rectified then transferred away still counts as coverage for the period it originated in.
  **`coverageCandidates` excludes bank-scope-registered and bulk-imported findings** (`f.registeredByBankScope` / `f.importBatchId`, `reportTemplates.ts:84-90`) — neither reflects the branch's own live reporting activity: a bank-scope finding was registered by HO on the branch's behalf, and an imported row is a historical backfill, not something the branch itself submitted this period. A branch whose only Finding row this period is one of these still shows up on this report as uncovered, even though a Finding row technically exists against it. This exclusion also propagates into Monthly Summary Report's Dispatched/Not Dispatched columns (§3.3), since that template calls this same function internally.
- **Extra feature — coverage notes**: this is the one report-template with genuinely writable state. `BranchCoverageNote` records *why* a branch was uncovered. `UncoveredBranchesTable` (`src/components/reports/UncoveredBranchesTable.tsx`) renders a client-side searchable table with per-row editing (`UncoveredBranchNoteForm`) plus a **bulk-apply** toolbar: select several branches via checkboxes, pick one canned reason (or type a custom one via `ReasonPicker`), and apply it to every selected branch in one call (`UncoveredBranchesTable.tsx:72-92`).
  - Single-branch upsert: `POST /api/report-templates/uncovered-branches/note` (`src/app/api/report-templates/uncovered-branches/note/route.ts:24-66`) — validates `branchId`/`periodId`/`reason`/optional `reasonId` via Zod, checks the branch and period exist, checks org-scope (a DISTRICT-scoped user may only note branches in their own district, line 47; a BRANCH-scoped user cannot use this feature at all, lines 50-52), then calls `upsertBranchCoverageNote` (`src/lib/branchCoverageNotes.ts`).
  - Bulk upsert: `POST /api/report-templates/uncovered-branches/note/bulk` (`.../note/bulk/route.ts:21-69`) — same validation/scope rules, looped over `branchIds`, **all-or-nothing**: one out-of-scope or unknown branch id fails the entire batch rather than silently skipping it (lines 17-20 doc comment, lines 39-52).
  - Both routes are gated by the same `report-templates.uncovered-branches` permission used to view the report at all (not a separate "edit" permission) — `note/route.ts:25`, `note/bulk/route.ts:22`.
  - Recording a note is **not** blocked by the period being LOCKED — the doc comment at `note/route.ts:20-23` explicitly calls out that a retrospective reason for an already-locked period is the normal case, not an edge case to guard against.
- **Currency/count formatting**: none — this template has no numeric money or count columns at all, only names and free text.

### 3.2 Category Detail by District (`category-detail-by-district`)

- **Question**: for every active district × every active classified category, how many cases are unrectified vs rectified this period?
- **Computation**: `getCategoryDetailByDistrict(db, periodId)` (`reportTemplates.ts:117-161`).
- **Columns**: SN, Total No. of Branches, District, then per category two columns (Unrectified/Rectified), then a TOTAL block (Unrectified, Rectified, unrectified Balance, Rectified %).
- **Filters**: one reporting period only (`.../category-detail-by-district/page.tsx:26`).
- **Scope rule**: per district+category, `db.findings` is filtered to `isHoApproved(f)` findings (`reportTemplates.ts:132`), then narrowed to the period via `findingsResidentInPeriod` — `total` sums `slice.eligibleCases`, `rectified` sums `slice.closedCases` (lines 137-140). **`rectified` here always means formally CLOSED cases**, never merely self-reported or district-verified (see Section 8 for why that distinction matters bank-wide). `rectifiedPct` is guarded against division by zero (`total > 0 ? ... : null`, line 151), rendered as `--`.
- **All categories, not just the scored one**: unlike the ranking/summary templates, this covers every `activeCategories(db)` entry, not just the ScoringRule's "Other Case" bucket.
- **Currency/count formatting**: purely counts — the page imports only `formatNumber` (`.../category-detail-by-district/page.tsx:7`), used for every numeric cell (branches, per-category outstanding/rectified, totals). No money column exists on this template at all.

### 3.3 Monthly Summary Report (`monthly-summary`)

- **Question**: per district — outstanding cases per category, total money (Birr) involved, branch dispatch coverage, and the district's *official* scored performance, all on one row.
- **Computation**: `getMonthlySummaryReport(db, periodId)` (`reportTemplates.ts:196-242`).
- **Columns**: SN, Total No. of Branches, District, one outstanding-count column per category, Amount involved (Birr), Unrectified, Rectified, Rectified %, Branches not dispatched, Branches dispatched, Total No. of cases.
- **Filters**: one reporting period (`.../monthly-summary/page.tsx:25`).
- **Per-category grid shows each category's TOTAL case count, not outstanding**: `MonthlySummaryCell` is `{ category, total }` (`reportTemplates.ts:196-198`) — every category's full case count for the district, including the scored one. This is what keeps every non-scored category visible on this sheet at all, now that the row-level Unrectified/Rectified (below) no longer aggregate across them.
- **`Unrectified`/`Rectified`/`Rectified %` are ALL scoped to the same official, scored-category population** — fixed from an earlier inconsistency where `Unrectified` summed *every* category's own outstanding count while `Rectified` was already scoped to just the ScoringRule's Other-Case bucket, making the two figures on the same row not actually comparable despite sitting side by side. Both now come from one `computeEligibleCaseCounts(db, { districtId, periodId })` call (`reportTemplates.ts:220-223`): `Rectified = officialCounts.rectifiedCases`, `Unrectified = officialCounts.totalCases - officialCounts.rectifiedCases`. So `Unrectified + Rectified` always equals exactly the same `officialCounts.totalCases` that `Rectified %` is a percentage of. **`Total No. of cases`** (`totalCases`, `reportTemplates.ts:226`) remains a separate, genuinely all-category figure — it is *not* expected to equal `Unrectified + Rectified` unless every category happens to be the scored one; that's intentional, not a residual inconsistency, since it answers a different question ("how many cases exist here at all" vs. "how is the official score doing").
- **The one genuinely deliberate deviation from the source Excel**: the doc comment (`reportTemplates.ts:170-175`) notes the *original* workbook's "Total No. of cases" formula was byte-identical to its "Unrectified" formula (a copy-paste bug in the bank's own Excel, confirmed by comparing the two cells' formulas) — this app's `totalCases` is the true unrectified+rectified sum instead, deliberately not reproducing that bug.
- **Extra feature**: reuses `getUncoveredBranches` internally (`reportTemplates.ts:205`) to compute `branchesDispatched`/`branchesNotDispatched` per district (lines 221-222, 232-233) — so this template's dispatch-coverage numbers share the exact same "covered" definition as template #1, including its non-`isHoApproved`-gated residency rule.
- **Currency/count formatting**: **the only genuinely money column across all 11 templates besides Transferred Findings** is `amountInvolved` (row) / `totalAmount` (TOTAL row) — rendered with `formatCurrency` (`.../monthly-summary/page.tsx:75,116,133`, always "ETB " + 2 decimals). Every other numeric column on this page — per-category `total`, `totalOutstanding`, `officialRectified`, `totalCases`, `branchesDispatched`/`branchesNotDispatched` — is a **case or branch count**, rendered with `formatNumber` (lines 109,113,117,118,122) or, for `branchesDispatched`/`branchesNotDispatched` specifically, as a **raw, un-formatted number** (lines 120-121, no `formatNumber` wrapper at all — harmless in practice since branch counts per district are small, but an inconsistency worth knowing about if that column is ever bound to a larger number).

### 3.4 Monthly District History (`monthly-district-history`)

- **Question**: for one chosen period, how did every district perform on the official "Other Case" scored category?
- **Computation**: `getMonthlyDistrictSeries(db).otherCases` (`reportTemplates.ts:288-346`), filtered client-side in the page to `r.period.id === period.id` (`.../monthly-district-history/page.tsx:35`).
- **Columns**: SN, Total No. of Branches, District, Others Cases, Unrectified, Rectified, Rectified %.
- **Filters**: one reporting period, defaulting to `OPEN` (`.../monthly-district-history/page.tsx:30`). The page comment (lines 13-17) explains this is deliberately one-period-at-a-time rather than stacking every period vertically — the long-format alternative lives in template #5.
- **Scope rule**: `otherCases` is built once per (period, district) pair bank-wide via `computeEligibleCaseCounts(db, { districtId, periodId })` (`reportTemplates.ts:298`) — i.e. **always** ScoringRule-gated, `isHoApproved`-gated, and rectified-via-`closedCases` (verified-closed), regardless of which period is selected. This is the "official" series the BRD/dashboards/ranking templates all key off.
- **Currency/count formatting**: counts only (`formatNumber` throughout, `.../monthly-district-history/page.tsx:6`), no money column — `DistrictPeriodRow` carries no amount field at all.

### 3.5 Monthly District Detail (`monthly-district-detail`)

- **Question**: the same district × period series as #4, but long-format — every district's full period history stacked, one block per district.
- **Computation**: `getMonthlyDistrictSeries(db)` (`reportTemplates.ts:288-346`), using **both** halves of the series: `otherCases` (period rows) and `various` (one closing row per district).
- **Columns**: SN, District, Month, Case Type ("Other Cases" or "Various internal Audit report"), Total Cases, Unrectified, Rectified, Rectified %.
- **Filters**: optional District dropdown ("All Districts" default, `.../monthly-district-detail/page.tsx:36-37,108-115`); no period filter — this template's whole point is to show every period at once.
- **The "Various" row — a genuinely different scope from everything else**: per the doc comment at `reportTemplates.ts:244-260`, `various` is **not** period-scoped at all — it is a **lifetime** rollup, one row per district, of that district's `isHoApproved` findings that are (a) in the active ScoringRule's own category list (i.e. "Other Case") **and** (b) sourced from the Source coded `"IA"` (Internal Audit) specifically — not "everything not Other Case," despite the row's generic-sounding name. The rationale (icfms.txt): Internal Audit findings are entered occasionally/ad-hoc by HO, not on the same monthly cadence the per-period `otherCases` series tracks, so they're rolled into one cumulative line instead of getting their own per-period row. **If no ScoringRule is active, or no Source is coded `"IA"`, every district shows zero** (`reportTemplates.ts:332-339`) — there is no fallback to a broader population. Structurally it is the literal last row of each district's block, matching the source Excel exactly. It is **never** duplicated per month — confirmed in the page by `variousByDistrict` being looked up once per district group and rendered once (`.../monthly-district-detail/page.tsx:163-176`). `various`'s `rectified` uses **`f.closedCases`** (verified-closed) — the same official basis every other figure in this file uses, not the branch's raw self-reported `rectifiedCases`. Monthly District History (#4) never shows this row at all — only #5 does.
- **Currency/count formatting**: counts only (`formatNumber`, `.../monthly-district-detail/page.tsx:7`), no money column.

### 3.6 District Ranking – Other Cases (`district-ranking-other-cases`)

- **Question**: rank every district by the official scored category's rectification %, cumulatively or over a chosen set of periods.
- **Computation**: `getDistrictRankingOtherCases(db, periodIds?)` (`reportTemplates.ts:377-423`).
- **Columns**: SN, Total No. of Branches, District, Total Others Cases, Unrectified, Rectified, Rank (rendered as the performance %, sorted descending). Ends with a bank-wide TOTAL row and an auto-generated narrative sentence.
- **Filters**: a checkbox list of every reporting period (`.../district-ranking-other-cases/page.tsx:61-67`) — **none checked = every period, cumulative lifetime totals** (explicit UI hint at line 58).
- **Scope rule**: when `periodIds` is given, sums `computeEligibleCaseCounts(db, { districtId, periodId })` across each selected period (`reportTemplates.ts:385-392`); when omitted, calls the same function with **no** `periodId` (lifetime mode, `reportTemplates.ts:398-402`, matching `computePerformance()`'s own "no periodId" convention). Because `computeEligibleCaseCounts` is always `closedCases`-based internally (`src/lib/findings.ts:895,905`), **this template's "Rectified" is always verified-closed, in both modes** — unlike #8 below.
- **Narrative**: an auto-written sentence, e.g. "Out of the total X cases, Y have been rectified, representing Z% of the total cases..." (`reportTemplates.ts:418-421`), falling back to "No eligible cases recorded yet." when `grandTotal` is 0.
- **Currency/count formatting**: counts only (`formatNumber`).

### 3.7 Weekly Executive Summary (`weekly-executive-summary`)

- **Question**: for every active classified category (not just Other Case), how did each district's outstanding balance move between last week and this week?
- **Computation**: `getWeeklyExecutiveSummary(db, thisWeekCutoff?, lastWeekCutoff?)` (`reportTemplates.ts:493-538`), one `WeeklyCategorySummary` section per active category, each with a per-district table and its own TOTAL row.
- **Columns** (per district, per category section): SN, Total No. of Branches, District, Previous Balance, Additional, Rectified, Current Balance, This Week %, Last Week %, Difference (rendered as a `DifferenceBadge` — green/red/gray by sign, `.../weekly-executive-summary/page.tsx:14-22`).
- **Filters**: two date pickers, "This week (cutoff date)" and "Previous week (cutoff date)", each independently defaulting to the real Monday-start current/last calendar week via `weekEndDate(0)`/`weekEndDate(1)` (`reportTemplates.ts:481-491`, `.../weekly-executive-summary/page.tsx:43-44`) — but a reviewer can point either cutoff at any date to reproduce a past week-over-week comparison (page doc comment, lines 29-31).
- **Not what the name implies — read the doc comment**: `reportTemplates.ts:426-461` explicitly warns this is **not** "cases logged this week" and **not** scoped to Other Case alone (both true of an earlier, wrong implementation before the full 136-row source sheet was cross-checked). The real source sheet has six differently-shaped sections; sections 2-6 use a "Previous Balance / Rectified / Additional / Current Balance" bridge anchored to a fixed historical date this app has no equivalent for. Rather than special-case category 1's simpler layout, **every** category here gets the bridge shape, generalized to a *rolling* week: `previousBalance`/`currentBalance` are outstanding-case counts *as of* the cutoff date (`findingDate <= cutoff`, same convention as template #10); `additional` is newly-logged cases this week; **`rectified` is derived algebraically** — `previousBalance + additional - currentBalance` (`reportTemplates.ts:517`) — because findings don't carry a separate "date rectified" to filter by directly, not a direct count of anything.
- **Rectified basis**: `cumulativeAsOf()` sums raw `f.caseCount`/`f.rectifiedCases` as of the cutoff (`reportTemplates.ts:504-510`) — **self-reported**, not `closedCases`. Combined with the algebraic derivation above, "Rectified" on this template is two steps removed from the verified-closed figure most other templates use (Section 8).
- **Currency/count formatting**: counts only (`formatNumber`, `.../weekly-executive-summary/page.tsx:6`) — no money tracked at all in this series.

### 3.8 District Ranking – All Cases (`district-ranking-all-cases`)

- **Question**: the same ranking shape as #6, but summing **every** category's cases, not gated by the active ScoringRule — "a secondary, broader lens" (`reportTemplates.ts:541-543`).
- **Computation**: `getDistrictRankingAllCases(db, periodIds?)` (`reportTemplates.ts:546-584`).
- **Columns**: SN, Total No. of Branches, District, Total Cases, Unrectified, Rectified, Rank in all cases.
- **Filters**: identical checkbox-list-of-periods pattern as #6 (`.../district-ranking-all-cases/page.tsx:60-67`), same "none = lifetime" convention.
- **Scope rule — genuinely different rectified basis depending on filter mode (verified directly, not assumed)**: candidates are every `isHoApproved` finding in the district (`reportTemplates.ts:552`).
  - **With `periodIds` selected**: sums each period's own `findingsResidentInPeriod` slice — `eligibleCases`/`closedCases` (lines 556-567) — i.e. **verified-closed**, same as #6.
  - **With no `periodIds` (lifetime/default)**: sums raw `candidates.reduce(f.caseCount)` / `candidates.reduce(f.rectifiedCases)` (lines 570-571) — **self-reported**, not verified-closed.
  So this template's "Rectified" column means "formally closed" when a period filter is applied, but "whatever the Branch Manager last recorded" when it isn't — a real, code-verified inconsistency worth knowing before comparing two exports of this same template taken with different filter states.
- **Currency/count formatting**: counts only (`formatNumber`).

### 3.9 Category Performance Summary (`category-performance-summary`)

- **Question**: bank-wide, per category (all 7, not just the scored one): how many cases are rectified, what's the percentage, and what's the spread of performance across districts?
- **Computation**: `getCategoryPerformanceSummary(db, periodId?)` (`reportTemplates.ts:620-678`).
- **Columns**: SN, Types of cases, Unrectified, Rectified, Total Outstanding Unrectified, Percentage Ranges (e.g. "50% up to 99%" via `formatPercentageRange`, `reportTemplates.ts:615-618`), Gross Percentage, Previous Period.
- **Filters**: a period dropdown with an explicit "All periods" option (`.../category-performance-summary/page.tsx:56`).
- **"Previous period" column — not a literal week**: the doc comment at `reportTemplates.ts:600-605` flags that the Excel's "Previous week" header actually means the same category's gross percentage for the chronologically-prior reporting period (via `previousReportingPeriodId`, `reportTemplates.ts:608-612`, sorted by year/month) — only populated in single-period mode; always `null` in "all periods" mode or for the very first period on record.
- **Scope rule — same lifetime-vs-period inconsistency as #8**: `periodTotals()` (`reportTemplates.ts:631-637`) — when a `periodId` is given, uses `findingsResidentInPeriod`'s `eligibleCases`/`closedCases` (verified-closed); when `periodId` is omitted (all-periods mode), sums raw `f.caseCount`/`f.rectifiedCases` (self-reported). This is the exact same pattern as District Ranking – All Cases (Section 3.8) — confirmed independently in this function, not inferred.
- **Currency/count formatting**: counts only (`formatNumber`).

### 3.10 Mid-Month District Snapshot (`mid-month-district-snapshot`)

- **Question**: what did each district's official performance look like as of an arbitrary cutoff date partway through a period (not just at month-end)?
- **Computation**: `getDistrictSnapshotAsOf(db, periodId, asOfDate)` (`reportTemplates.ts:697-730`).
- **Columns**: SN, District, Others Cases, Unrectified, Rectified, Rectified %.
- **Filters**: a period dropdown (defaults to `OPEN`) plus an "As of date" `<input type="date">` (defaults to today, `.../mid-month-district-snapshot/page.tsx:25-28`).
- **Scope rule**: per the doc comment at `reportTemplates.ts:680-694`, this deliberately does **not** walk the transfer-eligibility chain (`findingCasesEligibleInPeriod`) the way period-residency-aware templates do — an arbitrary as-of date doesn't compose cleanly with that machinery, and the source report is itself just a plain date cutoff. Instead it's a direct filter: `f.districtId === district.id && f.periodId === periodId && isHoApproved(f) && f.findingDate <= asOfDate && (ScoringRule category+source match)` (`reportTemplates.ts:709-716`) — i.e. **only findings still resident in their original period** (no residency-slice credit for a finding that transferred elsewhere) with a `findingDate` on or before the cutoff. `rectifiedCases` sums `f.closedCases` (line 718) — **always verified-closed**, no lifetime-mode ambiguity here since the function is always period+date scoped.
- **Currency/count formatting**: counts only (`formatNumber`).

### 3.11 Transferred Findings (`transferred-findings`)

- **Question**: a bank-wide, one-row-per-hop register of every recorded transfer — where a finding started, what was resolved before it left, where it went, and its live status today.
- **Computation**: `getTransferredFindings(db, { fromPeriodId?, toPeriodId? })` (`reportTemplates.ts:779-826`).
- **Not modeled on a bank Excel sheet** — per the doc comment (`reportTemplates.ts:733-752` and the page's own comment, `.../transferred-findings/page.tsx:15-20`), this is the one template requested directly (Document_3 §15's own "Transfer Data" fields, already shown per-finding on `FindingDetailClient.tsx`'s Transfer History card) rather than derived from a legacy report.
- **Three layers of detail per row**:
  1. **Original period data** (snapshotted on the `FindingTransfer` row itself, never recomputed): `fromPeriod`, `originalCaseCount`, `originalAmount`, `caseAgeAtTransferDays` as of that hop.
  2. **What happened before it left**: `resolvedBeforeTransferCases`/`Amount` = `originalCaseCount/Amount − casesTransferred/amountTransferred` (`reportTemplates.ts:813-814`) — the portion rectified in the origin period, never carried forward.
  3. **Where it went, and status today**: `toPeriod` plus the finding's **live, current-day** state — `currentStatus`, `currentOutstandingCases` (`finding.caseCount − finding.rectifiedCases`, line 819 — **self-reported outstanding**, not `closedCases`-based), `currentOutstandingAmount` (`finding.amount − finding.rectifiedAmount`, line 820), `caseAgeDaysNow` (via `caseAgeDays()`, line 821) — reflecting everything that's happened since, including any later hop.
- **Multi-hop findings**: findings transferred more than once show **every hop as its own row** (`hopNumber`/`totalHops`/`isLatestHop`, lines 754-777, 802-803, 815-817), sorted newest-transfer-first overall (line 825). The page flags a non-latest hop's status as "(superseded by a later hop)" (`.../transferred-findings/page.tsx:203`).
- **Filters**: independent "From period (origin)" / "To period (destination)" dropdowns (`.../transferred-findings/page.tsx:75-93`), each with an "All periods" option.
- **Extra feature — StatCards**: four summary tiles above the register — Transfer Hops (row count), Cases Transferred (sum of `transfer.casesTransferred`), Amount Transferred (sum of `transfer.amountTransferred`), and Still Outstanding (`isLatestHop && currentOutstandingCases > 0 && currentStatus !== "CLOSED"`, line 42).
- **Currency/count formatting**: this is the **only other template besides Monthly Summary with genuine money columns**. `formatCurrency` is used for Original Amount, Resolved Before Transfer (Amount), Outstanding Amount Transferred, and the "Amount Transferred" StatCard (lines 101,157,177,187). `formatNumber` is used for every case-count field (Original Case Count, Resolved Before Transfer (Cases), Outstanding Cases Transferred, Current Outstanding (Cases), "Cases Transferred" StatCard). **Gotcha**: the on-screen card does **not** render `currentOutstandingAmount` anywhere, even though it's part of the `TransferredFindingRow` type (`reportTemplates.ts:775`) and **is** included as a CSV column ("Current Outstanding Amount", `src/app/api/report-templates/[slug]/export/route.ts:324,351`) — the CSV export is a strict superset of what the page displays for this template.

---

## 4. The CSV export mechanism

`src/app/api/report-templates/[slug]/export/route.ts` is a **single shared route** (`GET /api/report-templates/[slug]/export`) that dispatches on `slug` via a big `switch` inside `buildCsv()` (lines 40-359) — there is one `case` per template, **not** a generic "dump whatever the page renders" mechanism.

- **Does it recompute, or share the page's data?** It **recomputes**, by calling the exact same `reportTemplates.ts` functions the page calls (`getUncoveredBranches`, `getCategoryDetailByDistrict`, `getMonthlySummaryReport`, `getMonthlyDistrictSeries`, `getDistrictRankingOtherCases`, `getWeeklyExecutiveSummary`, `getDistrictRankingAllCases`, `getCategoryPerformanceSummary`, `getDistrictSnapshotAsOf`, `getTransferredFindings` — all imported at lines 4-17). So the page and its CSV **can never disagree on the underlying numbers** (both call the same pure function on the same `db`), but each `case` re-implements its own column layout/ordering/row-shaping independently of its page component's JSX — the doc comment at lines 20-26 confirms this is intentional: column headers/ordering deliberately mirror the bank's own `report/*.xlsx` sheets, **down to preserved typos** ("rectified percetage" is spelled that way in the source workbook and reproduced verbatim, not a bug in this app — line 24).
- **Auth**: `requirePermission('report-templates.<action>')` (lines 366-367, via `SLUG_TO_ACTION` built from `REPORT_TEMPLATES` at line 38) — an unauthorized request gets a plain `403 { error: "Forbidden" }` JSON body (via `requirePermission`, `src/lib/guard.ts:42-49`), **not** a redirect (this is an API route, not a page). An unknown slug (not present in `REPORT_TEMPLATES`) returns `404 { error: "Unknown report template" }` (line 364).
- **File format**: `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="<slug>-<YYYY-MM-DD>.csv"` (lines 374-379). Rows are joined with `\r\n` (line 32, RFC 4180-style CSV), fields are comma-escaped/quoted only when they contain a comma, quote, or newline (`csvCell`, lines 27-30, doubling embedded quotes). Percentages are rendered as one-decimal strings or `"--"` for null via the shared `pct()` helper (lines 34-36) — the same null-safety the on-screen tables use, just formatted for plain text instead of `%` suffix/badges.
- **Filter params accepted per slug**: `periodId` (single-period templates), `periodIds` (repeated, for the two ranking templates — lines 42-43), `thisWeekDate`/`lastWeekDate` (Weekly Executive Summary, lines 209-210), `asOfDate` (Mid-Month Snapshot, line 286), `fromPeriodId`/`toPeriodId` (Transferred Findings, lines 296-299).
- **Gotcha — Monthly District Detail's export ignores its page's district filter**: the page passes `districtId` in its Download-CSV link (`.../monthly-district-detail/page.tsx:96`), but `buildCsv`'s `"monthly-district-detail"` case (lines 143-198) never reads `params.get("districtId")` at all — **the CSV for this one template always exports every district**, regardless of the page's active district filter, unlike every other template whose CSV mirrors its page's active filter state.

---

## 5. The Print feature

Every template page pairs `PrintButton` (`src/components/reports/PrintButton.tsx`) with an inline `@media print` style block repeated verbatim at the top of each page's JSX.

- `PrintButton` is a tiny client component: `<Button variant="secondary" onClick={() => window.print()}>Print / Save as PDF</Button>` (`PrintButton.tsx:8-10`). Its own comment (lines 5-7) states the design choice explicitly: the **browser's native print dialog** plus these pages' own `@media print` rules is treated as a genuine, working PDF export via "Save as PDF" — **no PDF-rendering library/dependency was added** for this feature.
- The shared rule, e.g. `.../monthly-summary/page.tsx:33`:
  ```css
  @media print {
    nav, header, .no-print { display: none !important; }
    main { padding: 0 !important; }
  }
  ```
  Every filter form, the Download CSV/Print buttons themselves, and (on Uncovered Branches) the row checkboxes/bulk-apply toolbar/search box are wrapped in a `className="no-print"` container so they vanish in the printed/PDF output, leaving just the title, description, and data table(s) — the same convention the base `/reports` page also uses (`src/app/(app)/reports/page.tsx:152`).
- There is no server-side/headless-browser PDF generation anywhere in this feature — "Print" is purely a client-side `window.print()` call relying on CSS to hide non-report chrome.

---

## 6. Currency vs. count formatting — the full picture

`src/lib/format.ts` defines the two primitives:

- `formatNumber(n)` (`format.ts:21-23`) → `n.toLocaleString("en-US")` — thousands separators, **no forced decimals**. Used for every count (cases, branches, findings, hops...).
- `formatCurrency(n)` (`format.ts:25-33`) → `n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })` — **always exactly 2 decimal places**, e.g. `"70,000.00"`, even for whole numbers. The doc comment (lines 25-30) is explicit that this is deliberately kept separate from `formatNumber` "which is also used throughout the app for plain counts ... that must never grow a fake '.00' of their own" — i.e. this is exactly the bug class this project has previously had to fix, and the codebase already has a comment codifying it.

Per-template formatting (verified by reading every page's imports/usages, not assumed from field names):

| Template | Money columns (`formatCurrency`) | Count columns (`formatNumber`) | Notes |
|---|---|---|---|
| Uncovered Branches | *none* | *none* | Only names/text, no numeric formatting at all. |
| Category Detail by District | *none* | branches, per-category outstanding/rectified, totals, TOTAL row | No amount field exists on this template. |
| Monthly Summary Report | `amountInvolved` / `totalAmount` only | per-category `total`, `totalOutstanding`, `officialRectified`, `totalCases` | `totalOutstanding` and `officialRectified` sound like they could be money given the amount column sitting next to them — they are pure **case counts**, both now scoped to the same official/scored category (Section 3.3). `totalCases` remains a separate, genuinely all-category count, by design. `branchesDispatched`/`branchesNotDispatched` are rendered raw, without `formatNumber` at all (`.../monthly-summary/page.tsx:120-121`). |
| Monthly District History | *none* | all columns | No amount field in `DistrictPeriodRow`. |
| Monthly District Detail | *none* | all columns | No amount field in the series. |
| District Ranking – Other Cases | *none* | all columns | No amount tracked. |
| Weekly Executive Summary | *none* | all columns | Balances/rectified/additional are all case counts; `Difference` is a percentage-point delta (`.toFixed(1)` + "pp"), not formatted via either helper. |
| District Ranking – All Cases | *none* | all columns | No amount tracked. |
| Category Performance Summary | *none* | all columns | No amount tracked. |
| Mid-Month District Snapshot | *none* | all columns | No amount tracked. |
| Transferred Findings | Original Amount, Resolved Before Transfer (Amount), Outstanding Amount Transferred, "Amount Transferred" StatCard | Original Case Count, Resolved Before Transfer (Cases), Outstanding Cases Transferred, Current Outstanding (Cases), "Cases Transferred"/"Transfer Hops"/"Still Outstanding" StatCards | `currentOutstandingAmount` exists in the data/CSV but is never rendered on the page (Section 3.11). |

**Bottom line**: across all 11 templates, only two — **Monthly Summary Report** and **Transferred Findings** — ever touch real money (`formatCurrency`). Every other template is pure case/branch-count data (`formatNumber`), regardless of how a field is named. The clearest trap is Monthly Summary's `totalOutstanding`/`officialRectified` pair — money-adjacent in the UI (same row as `amountInvolved`) but genuinely just case counts from two different aggregation scopes.

---

## 7. Permission model

### 7.1 Registry

`src/lib/permissions/registry.ts:138-155` defines the `report-templates` page in `PAGE_REGISTRY` with **one action per template**, plus a base `view` action: `report-templates.view`, `.uncovered-branches`, `.category-detail-by-district`, `.monthly-summary`, `.monthly-district-history`, `.monthly-district-detail`, `.district-ranking-other-cases`, `.weekly-executive-summary`, `.district-ranking-all-cases`, `.category-performance-summary`, `.mid-month-district-snapshot`, `.transferred-findings`.

The doc comment at `registry.ts:133-137` explains the design choice: one action per template so an admin can grant **any subset independently** via `/admin/roles`, not an all-or-nothing "view reports" toggle. `view` is distinct from every individual template action — holding `view` alone shows an empty hub page ("Your role doesn't currently have access to any report template...", `.../reports/templates/page.tsx:29-36`) but grants access to no actual template content.

### 7.2 Enforcement points (three layers, all independently checked)

1. **Hub page** (`.../reports/templates/page.tsx:12-17`): requires `report-templates.view`; redirects to `/dashboard` if missing. Filters the card list to only templates whose specific action the viewer also holds (line 17).
2. **Each template page** (all 11, identical pattern, e.g. `.../monthly-summary/page.tsx:18-20`): requires `report-templates.<action>` specifically; **redirects to `/reports/templates`** (the hub, not `/dashboard`) if missing — so a user without permission who navigates directly to e.g. `/reports/templates/monthly-summary` is bounced back to the hub page (which will show whatever subset they *do* have, or the empty-state message if none).
3. **CSV export route** (`export/route.ts:366-367`): requires the same `report-templates.<action>` via `requirePermission`; since this is an API route, a missing permission returns `403 Forbidden` JSON rather than a redirect (Section 4).
4. **Uncovered Branches note routes** (`note/route.ts:25`, `note/bulk/route.ts:22`): gated by `report-templates.uncovered-branches` itself — there is no separate "edit" permission for coverage notes; viewing and annotating share one gate. Additionally org-scoped: a DISTRICT-scoped user can only note branches in their own district, a BRANCH-scoped user cannot use the feature at all (Section 3.1).

This is **not** proxy-middleware-gated (unlike `/admin/*` routes) — there is no `report-templates`/`reports` entry in `src/proxy.ts`; access is enforced entirely by each page's own inline `getCurrentUser()` + `hasPermission()` + `redirect()` check, per the registry's own documented convention for non-admin, multi-role-shared routes (`registry.ts:242-248`).

### 7.3 Default role grants (from `prisma/seedData.ts`)

`reportTemplatePermissions` (`prisma/seedData.ts:29-42`) bundles `view` plus all 11 template actions as one constant, spread into whichever roles get it. Confirmed by reading the actual role permission arrays:

| Role | Gets `reportTemplatePermissions`? | Source |
|---|---|---|
| Administrator (`ADMIN`) | Yes — implicitly, via `ALL_PERMISSION_KEYS` (every permission in the system) | `seedData.ts:373` |
| Head Office Internal Controller (`HO_CONTROLLER`) | Yes, explicitly | `seedData.ts:300` |
| District Internal Controller (`DISTRICT_CONTROLLER`) | Yes, explicitly | `seedData.ts:321` |
| District Director (`DISTRICT_DIRECTOR`) | Yes, explicitly | `seedData.ts:336` |
| Executive (Read-only) (`EXECUTIVE_READONLY`) | Yes, explicitly (merged with `ALL_VIEW_PERMISSION_KEYS`) | `seedData.ts:464` |
| Branch Internal Controller (`BRANCH_CONTROLLER`) | **No** | `seedData.ts:339-353` (no `reports`/`report-templates` keys at all) |
| Branch Manager (`BRANCH_MANAGER`) | **No** | `seedData.ts:354-362` |
| Branch Sub-Manager (`BRANCH_SUB_MANAGER`) | **No** (shares `branchManagerPermissions`) | `seedData.ts:451` |

So by default, report templates are a **Head Office / District oversight / Executive** feature — branch-level roles (Controller, Manager, Sub-Manager) have no access out of the box, consistent with those roles being scoped to operating a single branch rather than reviewing bank-wide or district-wide aggregates. This is only the **seed default**; actual grants are fully dynamic per `RoleDefinition.permissions`, editable at `/admin/roles` (`registry.ts:1-14`).

---

## 8. Data scope & correctness rules

This is the most subtle part of the feature: **"outstanding" and "rectified" do not mean exactly the same thing in every template**, even though every table looks superficially similar. Verified directly against each function's code (not assumed):

| Template | "Rectified" credited by | Gated on `isHoApproved`? | Period-scoped via residency, or raw filter? |
|---|---|---|---|
| Uncovered Branches ("covered") | Any finding at all (any status) resident in the period | **No** — the one exception | Residency (`findingsResidentInPeriod`, unfiltered candidates) |
| Category Detail by District | `closedCases` (verified-closed) | Yes | Residency |
| Monthly Summary — per-category grid | `closedCases` | Yes | Residency |
| Monthly Summary — `officialRectified`/`officialPerformance` | `computeEligibleCaseCounts`'s `rectifiedCases` (`closedCases`, ScoringRule-gated to Other Case only) | Yes | Residency (via `computeEligibleCaseCounts`) |
| Monthly District Series — `otherCases` | `computeEligibleCaseCounts` → `closedCases`, ScoringRule-gated | Yes | Residency, always period-scoped |
| Monthly District Series — `various` | `closedCases` (verified-closed), further narrowed to Other-Case + Source `"IA"` only | Yes | **Not period-scoped — lifetime per district** |
| District Ranking – Other Cases | `computeEligibleCaseCounts` → `closedCases` | Yes | Residency in both "selected periods" and "lifetime" modes — **consistent** |
| District Ranking – All Cases | `closedCases` when `periodIds` given; raw `f.rectifiedCases` (self-reported) when omitted (lifetime) | Yes | Residency only when `periodIds` given — **inconsistent between modes** |
| Weekly Executive Summary | Algebraically derived (`previousBalance + additional − currentBalance`), itself built from raw `f.rectifiedCases` as of a cutoff date | Yes | Neither — a `findingDate <= cutoff` cumulative filter, no period concept at all |
| Category Performance Summary | `closedCases` when `periodId` given; raw `f.rectifiedCases` when omitted (all periods) | Yes | Residency only when `periodId` given — **inconsistent between modes**, same pattern as District Ranking – All Cases |
| Mid-Month District Snapshot | `f.closedCases`, always | Yes | Neither residency nor lifetime — direct `f.periodId === periodId && f.findingDate <= asOfDate` filter (no transfer-eligibility chain, by design) |
| Transferred Findings — `resolvedBeforeTransferCases` | `originalCaseCount − casesTransferred` (snapshotted at transfer time) | N/A (transfer already implies HO-approved origin) | N/A — per-hop snapshot |
| Transferred Findings — `currentOutstandingCases` | `finding.caseCount − finding.rectifiedCases` (**live, self-reported**, not `closedCases`) | N/A | Live, current-day |

**The recurring, genuinely important pattern**: two templates — **District Ranking – All Cases** and **Category Performance Summary** — silently switch their rectified-basis from *verified-closed* (`closedCases`, when a period/periods filter is applied) to *self-reported* (`f.rectifiedCases`, when no period filter is applied / "lifetime" mode). This is **not** true of every template that offers a lifetime option: **District Ranking – Other Cases** stays `closedCases`-based in both modes because it always routes through `computeEligibleCaseCounts`, which is internally always `closedCases`-gated regardless of whether a `periodId` is passed. So the same "select no periods → lifetime totals" UI gesture means something subtly different depending on which of these three ranking/summary templates you're looking at — confirmed independently in each function (`reportTemplates.ts:546-584` and `620-678` vs. `377-423`).

**`isHoApproved()` gate** (`src/lib/findings.ts:234`, checking membership in `HO_APPROVED_OR_LATER_STATUSES`): every template except Uncovered Branches applies this before counting a finding at all — a finding still in DRAFT, SUBMITTED, DISTRICT_REVIEW, HO_REVIEW, PENDING_BANK_APPROVAL, or one that was REJECTED/RETURNED, never contributes to any total, outstanding count, or rectification percentage on any of the other 10 templates. Uncovered Branches is the sole exception, by design (Section 3.1) — a branch that merely *submitted* something, even unreviewed, already isn't "uncovered."

**"Rectified" via `closedCases` vs. `rectifiedCases`**: per `src/lib/findings.ts:864-876`'s own doc comment (attached to `computeEligibleCaseCounts`), a case is only credited as rectified once formally **CLOSED** — District's own "verify" gate is one step short of closure, not a substitute for it. Every template's `closedCases`-based figure honors this rule; every template's `rectifiedCases`-based figure (lifetime-mode District Ranking All Cases/Category Performance Summary, Weekly Executive Summary, Transferred Findings' `currentOutstandingCases`) does **not** — it reflects the Branch Manager's own self-reported progress, which may not yet be District/HO-verified. The Monthly District Series' `various` row is now `closedCases`-based too, matching every other official figure.

**Report-category ordering**: `activeCategories()` (`reportTemplates.ts:55-60`) re-sorts `db.categories` per `REPORT_CATEGORY_ORDER` (`reportTemplates.ts:53`: `ATM_MISMATCH, ATM_LONG_OS, IT, ZERO_BALANCE, DORMANT, CK_BOOK, OTHER_CASE`) to match the bank's own Excel column order — this only affects display order on report templates, never `db.categories`' own order used by finding-registration forms elsewhere in the app (`reportTemplates.ts:47-52`). A category code not present in `REPORT_CATEGORY_ORDER` is pushed to the end (`?? REPORT_CATEGORY_ORDER.length`, line 56) rather than causing an error, so a newly-added classified category degrades gracefully.

**"Total No. of Branches"**: every district-level row's branch count is `districtBranchCount()` (`reportTemplates.ts:63-65`) — a live count of `ACTIVE` branches in that district, recomputed on every request, not a stored field.

---

## 9. Edge cases & known gotchas

- **Zero-division guards**: every percentage calculation across all 11 templates follows the same `denominator > 0 ? (numerator / denominator) * 100 : null` pattern (e.g. `reportTemplates.ts:151,159,231,373,410,417,579,643,656,665,725`), never a raw division. `null` is rendered as `"--"` both on-screen (`r.performance !== null ? \`${r.performance.toFixed(1)}%\` : "--"`, repeated in every page component) and in CSV (`pct()` helper, `export/route.ts:34-36`).
- **Empty period handling**: every single-period template (`uncovered-branches`, `category-detail-by-district`, `monthly-summary`, `monthly-district-history`, `mid-month-district-snapshot`) defaults its `periodId` to the currently `OPEN` reporting period, falling back to `db.reportingPeriods[0]?.id ?? ""` if none is open (e.g. `.../monthly-summary/page.tsx:25`). If `db.reportingPeriods` is empty entirely, `periodId` is `""`, the page renders an empty-state (`{ rows: [], categories: [], totalRow: {...zeros...} }` fallback, e.g. `.../monthly-summary/page.tsx:27-29`) and shows "No reporting period" in the card description rather than crashing.
- **Category Performance Summary / two ranking templates' "all periods" mode is a silent behavior switch**, not an edge case failure — see Section 8's table. Worth calling out again here because it's easy to miss: simply toggling every period checkbox off changes what "Rectified" *means* for those two/three templates, not just how much data is included.
- **Monthly District Detail's CSV export ignores its page's `districtId` filter** — Section 4's last bullet. Downloading the CSV from a district-filtered view of this one template still exports every district.
- **Transferred Findings' CSV has a column the page never shows** (`Current Outstanding Amount`) — Section 3.11.
- **Monthly Summary's `branchesDispatched`/`branchesNotDispatched` render without `formatNumber`** (`.../monthly-summary/page.tsx:120-121`) — a minor inconsistency (harmless today since district branch counts are small single/double-digit numbers, but inconsistent with every other count column on the same page).
- **The bank's own source-workbook typo is preserved on purpose**: `"rectified percetage"` (not "percentage") appears verbatim as a CSV header for Category Detail by District, Monthly Summary, Monthly District History/Detail, and Mid-Month Snapshot (`export/route.ts:63,97,139,197,288`) — per the file's own header comment (`export/route.ts:24-26`), this is intentional so a CSV pasted into an existing downstream workflow needs no relabeling, not a bug to "fix."
- **The bank's own source-workbook formula bug was deliberately NOT reproduced**: Monthly Summary's `totalCases` is a genuine unrectified+rectified sum, unlike the source Excel's copy-paste-broken formula for the same cell (`reportTemplates.ts:170-175`).
- **`various` (Monthly District Detail) is lifetime, not period-scoped, and is narrower than its name suggests** — it is not "every non-Other-Case finding," it is specifically the district's Other-Case findings sourced from Internal Audit (Source code `"IA"`); a district with no Source coded `"IA"`, or no active ScoringRule, always shows zero here regardless of how many non-Other-Case findings it has (Section 3.5).
- **Weekly Executive Summary has no true "week" concept in the data model** — `additional`/`rectified` are inferred from two point-in-time cumulative snapshots (`findingDate <= cutoff`), not from any stored "this happened during week N" event log; a manual data correction that shifts a finding's historical `caseCount`/`rectifiedCases` outside of real-time flow could produce a negative `additional` or `rectified` value — the code performs plain arithmetic with no floor (`reportTemplates.ts:513-521`).
- **District Ranking pages' checkbox period filter has no "select all" shortcut** — leaving every box unchecked is *not* the same UI gesture as checking every box, even though both could be read as "all periods": only the former triggers true lifetime-total mode (`computeEligibleCaseCounts` with no `periodId` / raw lifetime sums); checking every individual period box instead sums each period's own residency slice, arriving at the same final numbers for Other Cases (since `computeEligibleCaseCounts` is always `closedCases`-based) but at **different** numbers for All Cases (since its lifetime-mode uses self-reported `rectifiedCases` while its per-selected-period-sum mode uses `closedCases` — Section 8).
