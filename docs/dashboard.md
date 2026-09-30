# Dashboards — Reference Documentation

> **Reported Cases vs Total Cases (2026-09-30).** Every dashboard shows both:
> - **Reported Cases** - the full case count of findings originally registered in the period. Never changed by transfers.
> - **Total Cases** - the cases the period holds after transfers in and out (what performance is measured on).
> Across *All periods* the two are equal. Example: 2026-09 reported 38 cases; after transfers it holds 29.

NIB Control360 (ICFMS) renders a different dashboard per role/org-scope combination, all reached through the single route `/dashboard`. This document is a code-grounded reference to every stat card, chart, table, filter, and permission gate involved. Every non-trivial claim below cites `file:line` in this repository.

---

## 1. Overview

### 1.1 How the app picks which dashboard to render

The routing logic lives entirely in `src/app/(app)/dashboard/page.tsx:24-97`, a server component. It:

1. Loads the current user's session (`getCurrentUser()`) and redirects to `/login` if there is none (`src/app/(app)/dashboard/page.tsx:29-36`).
2. Reads the whole database via `readDb()` (`src/app/(app)/dashboard/page.tsx:37`) — see §6 for why this is a fresh, uncached read.
3. Parses two independent sets of URL query params into typed objects: `parseDateRange(params)` (Today/Week/Month/Custom range from `TimeRangeFilter`) and `parseDashboardFilters(params)` (the `FilterBar`'s Period/District/Branch/Source/Category/Risk/Status selections) — `src/app/(app)/dashboard/page.tsx:39-40`.
4. Picks a dashboard component using **`user.orgScope`**, not `user.role` — a custom branch/district-scoped role still gets the right dashboard (`src/app/(app)/dashboard/page.tsx:42-53`):
   - `role === "EXECUTIVE_READONLY"` → `ExecutiveDashboard` (checked **first**, even though this role's `orgScope` is `"BANK"` like `HO_CONTROLLER`, because it must not fall into the HO branch) — `src/app/(app)/dashboard/page.tsx:55-61`.
   - `orgScope === "BRANCH"` (and not ADMIN) → `BranchDashboard` — `src/app/(app)/dashboard/page.tsx:63-69`.
   - `orgScope === "DISTRICT"` (and not ADMIN) → `DistrictDashboard` — `src/app/(app)/dashboard/page.tsx:71-77`.
   - `orgScope === "BANK"` (and not ADMIN) → `HODashboard` — `src/app/(app)/dashboard/page.tsx:79-85`.
   - Anyone left (only `ADMIN`) → redirected to `/admin`, which renders `AdminDashboard` (shared component, not duplicated) — `src/app/(app)/dashboard/page.tsx:87-96`.
5. **Every** dashboard is gated by its own `"<code>-dashboard.view"` permission (`branch-dashboard`, `district-dashboard`, `ho-dashboard`, `executive-dashboard`, `admin-dashboard`) checked via `hasPermission(user.permissions, permissionKey(code, "view"))` — `src/app/(app)/dashboard/page.tsx:53`. `orgScope` decides *which* dashboard would apply; the permission decides whether the user may actually see it, so an admin can revoke dashboard access from a role without touching its org scope (comment at `src/app/(app)/dashboard/page.tsx:48-52`). If the permission is missing, a generic "no access" card is rendered instead (`noAccessCard()`, `src/app/(app)/dashboard/page.tsx:13-22`).

### 1.2 The five dashboards, at a glance

| Component | File | Who sees it | Scope |
|---|---|---|---|
| `BranchDashboard` | `src/components/dashboard/BranchDashboard.tsx` | Branch Manager / Sub-Manager / Controller (any `orgScope: "BRANCH"` role) | The user's own branch only |
| `DistrictDashboard` | `src/components/dashboard/DistrictDashboard.tsx` | District Controller/Director (`orgScope: "DISTRICT"`) | The user's own district and its branches |
| `HODashboard` | `src/components/dashboard/HODashboard.tsx` | HO Internal Controller (`orgScope: "BANK"`) | Whole bank, every district/branch |
| `ExecutiveDashboard` | `src/components/dashboard/ExecutiveDashboard.tsx` | `EXECUTIVE_READONLY` role specifically | Whole bank, read-only, concise |
| `AdminDashboard` | `src/components/dashboard/AdminDashboard.tsx` | `ADMIN` role (shared by `/dashboard` and `/admin`) | System configuration, not findings data |

- **BranchDashboard** (`src/components/dashboard/BranchDashboard.tsx:37-527`) is the operational, day-to-day view for one branch: total/rectified/outstanding findings and cases, Branch Performance %, Total/Resolved/Outstanding Amount, an "Other Case Summary" (the scored category), a Category Totals table, a Branch Ranking table against peer branches in the same district, a work queue, and recent activity — implementing master.txt §10's requirement list quoted verbatim in the file's own comment (`BranchDashboard.tsx:34-36`).
- **DistrictDashboard** (`src/components/dashboard/DistrictDashboard.tsx:37-515`) is "the same widget set as BranchDashboard, one org level up" (comment at `DistrictDashboard.tsx:34-36`): district-wide totals, a workflow-progress breakdown (Requiring Review / Approved / Rejected / Returned), District Performance %, a "Pending Verify" queue (the district's distinctive second-stage gate — verifying a self-reported rectification before it can be closed), Top/Bottom Performer branch callouts, District Ranking (bank-wide, for competitive visibility), Branch Performance table, Findings-by-Branch chart, Category Totals, and the same work queue/recent-activity pair as Branch.
- **HODashboard** (`src/components/dashboard/HODashboard.tsx:31-696`) is the bank-wide operational view for the Head Office Internal Controller: master.txt §10's "bank + district aggregates, district ranking, IC-vs-IA source comparison, reporting-period status, work queue" (comment at `HODashboard.tsx:28-30`). It replaces the generic work queue with two dedicated queues (Pending Approval / Pending Close-Accept) specific to HO's own two review gates, adds an Average Backlog Age stat, a Source Comparison table (Internal Control vs Internal Audit), District/Branch Ranking with Top/Bottom callouts, and a Reporting Period Status list.
- **ExecutiveDashboard** (`src/components/dashboard/ExecutiveDashboard.tsx:28-409`) is deliberately "concise" — fewer *operational* widgets (no work queue, no per-branch edit links, matching the view-only `EXECUTIVE_READONLY` permission set) but the same bank-wide financial/comparative context leadership needs: Bank-wide Performance, High/Critical Exceptions count, Total/Resolved/Outstanding Amount, Top/Bottom District and Branch callouts, Source Comparison, and Reporting Period Status (comment at `ExecutiveDashboard.tsx:20-27`).
- **AdminDashboard** (`src/components/dashboard/AdminDashboard.tsx:34-129`) shows no findings data at all — it is a system-configuration summary: Active Users/Districts/Branches/Open Periods/Active Scoring Rule counts, a data-integrity warning banner for branches missing a Manager/Controller, Users-by-Role, Quick Links to every admin page the user can access, and Recent (audit log) Activity. It is shared verbatim between `/dashboard` (an Admin's fallthrough) and `/admin` (comment at `AdminDashboard.tsx:25-33`).

---

## 2. Per-dashboard breakdown

### 2.0 Shared computation vocabulary (used by every operational dashboard)

Before the per-dashboard tables, these `src/lib/findings.ts` functions are the actual "truth" behind almost every number, and are cited repeatedly below:

- **`isHoApproved(f)`** (`src/lib/findings.ts:234-236`) — true iff `f.status` is one of `HO_APPROVED_OR_LATER_STATUSES` = `SENT_TO_BRANCH_MANAGER, PARTIALLY_RECTIFIED, RECTIFICATION_RETURNED, RECTIFIED, CLOSED, TRANSFERRED` (`src/types/index.ts:487-494`). Every "official" figure on every dashboard (Total Findings, Total Amount, Category Totals, Risk/Category Distribution, etc.) is gated by this — a finding still sitting in DRAFT/SUBMITTED/DISTRICT_REVIEW/HO_REVIEW/PENDING_BANK_APPROVAL/REJECTED/RETURNED does not count yet. The one deliberate exception is `FindingStatusDistribution`, which intentionally shows the *whole* in-flight workflow (§4 below).
- **`findingCaseTotals(findings)`** (`src/lib/findings.ts:256-269`) — returns `{ totalFindings, totalCases, rectifiedFindings, rectifiedCases }` from a plain (non-period-residency) findings array, already `isHoApproved`-filtered internally. `rectifiedFindings`/`rectifiedCases` are `status === "CLOSED"` / `f.closedCases` — **never** the self-reported `rectifiedCases` field, and never merely district-verified. "Unless it's closed, it never counts as rectified" is the rule repeated throughout the codebase.
- **`findingCaseTotalsInPeriod(db, periodId, candidates)`** (`src/lib/findings.ts:305-317`) — the period-residency-aware version, used whenever a specific `openPeriod` (not "All periods") is selected. A finding partially rectified in a period and then transferred has its case/amount totals *split* between the period it left and the period it arrived in via `findingsResidentInPeriod()`/`findingSliceInPeriod()`, rather than being attributed wholly to one period.
- **`computeEligibleCaseCounts(db, scope)`** (`src/lib/findings.ts:878-909`) — the numerator/denominator behind Performance %. Candidates are findings whose category **and** source are both included in the active `ScoringRule`, are `isHoApproved()`, and match the given `branchId`/`districtId`/`sourceId`/`periodId` scope. Returns `null` if there is no active scoring rule or zero eligible cases (an honest "not computable," never a fabricated 0%).
- **`computePerformance(db, scope)`** (`src/lib/findings.ts:959-965`) — `rectifiedCases ÷ totalCases × 100` from `computeEligibleCaseCounts()`, **unless** an active `ScoringAdjustment` matches the exact scope (`getActiveScoringAdjustment()`, `src/lib/findings.ts:925-934`), in which case the adjustment's manually-entered value wins unconditionally.
- **`transferTotals(transfers)`** (`src/lib/findings.ts:327-337`) — `transferredFindings` (distinct finding records with ≥1 transfer) and `transferredCases`/`transferredAmount` (the real per-case/amount sum via `FindingTransfer.casesTransferred`/`amountTransferred`) — these are two different numbers, both shown.
- **`averageCaseAgeDays(findings)`** (`src/lib/findings.ts:207-210`) — mean of `caseAgeDays()` (days since `createdAt`, unaffected by transfers) across the given set; `null` on an empty set rather than a misleading `0`.
- **`queueStatusesForSession(session, db)`** (`src/lib/findings.ts:653-688`) — returns a predicate matching whichever statuses the *current session's own permissions* make actionable (edit/submit → DRAFT/RETURNED; district-review → DISTRICT_REVIEW; ho-review → HO_REVIEW; bank-approver → PENDING_BANK_APPROVAL; rectify → SENT_TO_BRANCH_MANAGER/PARTIALLY_RECTIFIED/RECTIFICATION_RETURNED; verify/return-rectification → rectified-but-not-verified; close → verified-but-not-closed). Drives the generic "Work Queue" card on Branch/District dashboards.
- **`sumAmountByCurrency` / `sumOutstandingByCurrency` / `sumAmountByCurrencyInPeriod` / `sumOutstandingByCurrencyInPeriod`** — see §2.1 below (currency grouping).

Every dashboard also resolves an **effective period** the same way (comment block e.g. `BranchDashboard.tsx:50-71`):
```
allPeriodsSelected = filters.periodId === ALL_PERIODS_VALUE        // "ALL" sentinel, never ""
openPeriod = allPeriodsSelected
  ? undefined
  : filters.periodId
    ? db.reportingPeriods.find(p => p.id === filters.periodId)     // an explicitly picked (possibly locked) period
    : db.reportingPeriods.find(p => p.status === "OPEN")           // default: current open period
hasPeriodScope = allPeriodsSelected || Boolean(openPeriod)
```
Every StatCard reading `hasPeriodScope ? value : "--"` is applying this rule (see §8, "no period" empty state).

### 2.1 BranchDashboard — `src/components/dashboard/BranchDashboard.tsx`

Header: branch name/code, district name, Manager/Sub-Manager/Controller names (`BranchDashboard.tsx:288-295`, via `findBranchManager`/`findBranchSubManager`/`findBranchController` from `src/lib/org.ts`).

Findings feeding this dashboard are pre-scoped to `f.branchId === branch.id` (`BranchDashboard.tsx:95-98`) — this is the org-scope boundary; see §7.

| Stat Card | Computation | Scope | Tone |
|---|---|---|---|
| Total Findings | `findingCaseTotals`/`findingCaseTotalsInPeriod(...).totalFindings` (`BranchDashboard.tsx:111-112,314-319`) | Branch, current/selected period | `totalFindings` → blue |
| Total Cases | `.totalCases`, same call (`BranchDashboard.tsx:320`) | Branch | `totalCases` → blue |
| Rectified Findings | `.rectifiedFindings` — the whole finding formally `CLOSED`, counted **only in its final period** (`findingCaseTotalsInPeriod()` in `src/lib/findings.ts`). A finding that transferred out of a period never counts as closed there, even if the cases it left behind were closed: 2 cases in 10/2026, 1 closed, 1 transferred to 11/2026 → 0 closed findings in 10/2026, 1 in 11/2026 once the last case closes. The closed *case* still counts in 10/2026's Rectified Cases and Performance %. | Branch | `rectified` → emerald |
| Rectified Cases | `.rectifiedCases` — `closedCases` (`BranchDashboard.tsx:322`) | Branch | `rectified` → emerald |
| Outstanding Cases | `totalCases - rectifiedCases` (`BranchDashboard.tsx:323`) | Branch | `outstandingCases` → amber |
| Outstanding | count of `approvedPeriodFindings` not in `RECTIFIED/CLOSED/REJECTED` (`BranchDashboard.tsx:123,324`) | Branch | `outstanding` → amber |
| Transferred Findings | `transferTotals(branchTransfers).transferredFindings` — from `FindingTransfer` rows, not `periodFindings` (`BranchDashboard.tsx:220-226,325`) | Branch, out of this period | `transferred` → blue |
| Transferred Cases | `.transferredCases` (`BranchDashboard.tsx:326`) | Branch | `transferred` → blue |
| High-Risk Findings | `approvedPeriodFindings` filtered to open + top-2 `Settings.riskLevels` tiers, case-insensitive (`BranchDashboard.tsx:208-211,327`) | Branch | `highRisk` → red |
| Branch Performance | `computePerformance(db, {branchId, periodId})`, click-to-expand shows `rectifiedCases ÷ totalCases × 100` math or the active `ScoringAdjustment` reason (`BranchDashboard.tsx:126-137,328-360`) | Branch | `performance` → gold |
| Total Amount | `sumAmountByCurrencyInPeriod(..., "eligible")` (period mode) or `sumAmountByCurrency(..., "amount")` (all-periods mode) (`BranchDashboard.tsx:143-146,361`) | Branch, currency-grouped | `totalAmount` → slate |
| Resolved Amount | `..."closed"` / `closedAmount` — cumulative **closed-only** amount (`BranchDashboard.tsx:151-157,362`) | Branch | `resolvedAmount` → emerald |
| Outstanding Amount | eligible − closed, via `sumOutstandingByCurrencyInPeriod`/`sumOutstandingByCurrency` (`BranchDashboard.tsx:147-150,363`) | Branch | `outstandingAmount` → red |
| Draft | `ownFindings` (createdBy = session user) with `status === DRAFT` (`BranchDashboard.tsx:245-246,364`) — only shown if `canRegister` | Own registrations only, not period-scoped | `draft` → slate |
| Pending Approval | own findings in `DISTRICT_REVIEW/HO_REVIEW/PENDING_BANK_APPROVAL` (`BranchDashboard.tsx:247-249,365-367`) — only if `canRegister` | Own registrations only | `pendingApproval` → amber |
| Pending Rectification | branch findings in `SENT_TO_BRANCH_MANAGER/PARTIALLY_RECTIFIED/RECTIFICATION_RETURNED` (`BranchDashboard.tsx:251-253,368-370`) — only if `canRegister` or `canRectify` | Whole branch (not just own), not period-scoped | `pendingRectification` → amber |

Other widgets:
- **Case-Based Performance** (`CaseBasedPerformance`, `BranchDashboard.tsx:373`) — a visually distinct Card (blue-tinted) restating Total Eligible / Rectified / Outstanding as three proportional bars, from the exact same `computeEligibleCaseCounts()` call as the headline Performance % — see §2.6.
- **Branch Ranking** table (`BranchDashboard.tsx:375-419`) — every branch in the same district, `computePerformance()` per branch, sorted descending; gated by `db.settings.rankingVisibility.branches` (an admin toggle — if off, shows a disabled message instead). The current branch's row is highlighted blue with a "Your Branch" badge.
- **Other Case Summary** (`BranchDashboard.tsx:421-441`) — Total/Rectified/Outstanding for whatever category the active `ScoringRule` scores (via the same `computeEligibleCaseCounts()` result reused as `scoredCounts`, `BranchDashboard.tsx:172-177` — explicitly **not** a hardcoded "OTHER_CASE" category id, since categories are admin-configurable).
- **Category Totals table** — see §4.
- **FindingsByCategoryChart, SourcePerformanceSummary, MonthlyTrend, FindingStatusDistribution, RiskDistribution, CategoryDistribution** — shared components, documented once in §2.6.
- **Work Queue** (`BranchDashboard.tsx:497-508`) — up to 8 findings matching `queueStatusesForSession()`, branch-scoped, most-recently-updated first; links to `/findings/[id]`.
- **Recent Activity** (`BranchDashboard.tsx:510-523`) — up to 8 most recent `FindingTransition` rows whose finding is in the currently-filtered branch set (`inScopeFindingIds`, so a Source/Category/Risk/Status filter narrows this too).

### 2.2 DistrictDashboard — `src/components/dashboard/DistrictDashboard.tsx`

Findings pre-scoped to `f.districtId === district.id` (`DistrictDashboard.tsx:76,85`).

| Stat Card | Computation | Scope | Tone |
|---|---|---|---|
| Total Findings | `findingCaseTotals`/`InPeriod(...).totalFindings` (`DistrictDashboard.tsx:109-110,277-282`) | District | blue |
| Total Cases | `.totalCases` (`DistrictDashboard.tsx:283`) | District | blue |
| Requiring Review | `periodFindings` with `status === "DISTRICT_REVIEW"` (`DistrictDashboard.tsx:91,284`) | District | `requiringReview` → amber |
| Approved | `periodFindings` in `HO_REVIEW/HO_APPROVED/SENT_TO_BRANCH_MANAGER/PARTIALLY_RECTIFIED/RECTIFIED/TRANSFERRED/CLOSED` — deliberately a *wider* set than `isHoApproved()` since this card tracks workflow progress, not "is it official yet" (`DistrictDashboard.tsx:92-99,285`) | District | `approved` → emerald |
| Outstanding | `approvedPeriodFindings` not in `RECTIFIED/CLOSED/REJECTED` (`DistrictDashboard.tsx:118,286`) | District | amber |
| Rejected | `periodFindings` with `status === "REJECTED"` (`DistrictDashboard.tsx:100,287`) | District | `rejected` → red |
| Returned | `periodFindings` with `status === "RETURNED"` (`DistrictDashboard.tsx:101,288`) | District | `returned` → amber |
| Rectified Findings / Cases | same closed-only definition as Branch (`DistrictDashboard.tsx:289-290`) | District | emerald |
| Outstanding Cases | `totalCases - rectifiedCases` (`DistrictDashboard.tsx:291`) | District | amber |
| Transferred Findings / Cases | `transferTotals(districtTransfers)`, from `FindingTransfer` rows (`DistrictDashboard.tsx:119-133,292-293`) | District | blue |
| District Performance | `computePerformance(db, {districtId, periodId})` (`DistrictDashboard.tsx:134-136,294-305`) | District | gold |
| Total / Resolved / Outstanding Amount | same currency-grouped functions as Branch, scoped to district (`DistrictDashboard.tsx:137-157,306-308`) | District | slate / emerald / red |

Other widgets:
- **Pending Verify** (`DistrictDashboard.tsx:239-245,311-325`) — the district's own distinctive gate: findings where `rectifiedCases > districtVerifiedCases || rectifiedAmount > districtVerifiedAmount` and status isn't `RECTIFICATION_RETURNED`/`CLOSED`. Not period-scoped ("what needs action right now"). This *replaces* a separate "Pending Approval" card, since Requiring Review already covers `DISTRICT_REVIEW`.
- **Case-Based Performance** — same shared widget, scoped `{districtId, branchId: filters.branchId}` (`DistrictDashboard.tsx:327-332`).
- **Top/Bottom Performers** (`DistrictDashboard.tsx:334-376`) — branches in this district at/above `Settings.performanceThresholds.topPercent`, or at/below `bottomPercent`; threshold-based, not a fixed top-5 cut (comment `DistrictDashboard.tsx:199-202`). Gated by `rankingVisibility.branches`.
- **District Ranking** — `RankedBarChart` + `DistrictRankingTable`, **bank-wide** (every district, not just this one — deliberate "competitive visibility," comment `DistrictDashboard.tsx:158-163`), gated by `rankingVisibility.districts`.
- **Branch Performance table** (`BranchPerformanceTable`) — every branch in this district, gated by `rankingVisibility.branches`. See §2.6.
- **SourcePerformanceSummary, Findings by Branch (ColumnChart), Category Totals, FindingsByCategoryChart, MonthlyTrend, FindingStatusDistribution, RiskDistribution** — see §2.6/§4.
- **Work Queue / Recent Activity** — same shape as Branch, district-scoped, "every finding awaiting your action, all categories" (`DistrictDashboard.tsx:485`).

### 2.3 HODashboard — `src/components/dashboard/HODashboard.tsx`

No fixed org scope — `db.findings` filtered only by `dateRange`+`FilterBar` filters (`HODashboard.tsx:67-70`).

| Stat Card | Computation | Scope | Tone |
|---|---|---|---|
| Total Findings / Total Cases | `findingCaseTotals`/`InPeriod` (`HODashboard.tsx:80-81,326-331`) | Bank-wide | blue |
| Rectified Findings / Cases | closed-only (`HODashboard.tsx:332-333`) | Bank-wide | emerald |
| Outstanding Cases | `totalCases - rectifiedCases` (`HODashboard.tsx:334`) | Bank-wide | amber |
| Outstanding | `approvedPeriodFindings` open count (`HODashboard.tsx:89,335`) | Bank-wide | amber |
| Bank-wide Performance | `computePerformance(db, {periodId})` — no branch/district filter (`HODashboard.tsx:90-92,336-341`) | Bank-wide | gold |
| High-Risk Findings | top-2 risk tiers, open, `isHoApproved` (`HODashboard.tsx:247-257,342`) | Bank-wide | red |
| Transferred Findings / Cases | `transferTotals(bankTransfers)`, narrowed by the currently-filtered set (fixed from a prior bug where this ignored district/branch filters — comment `HODashboard.tsx:259-267`) | Bank-wide (filterable) | blue |
| Total / Resolved / Outstanding Amount | same currency functions, bank-wide (`HODashboard.tsx:93-112,345-347`) | Bank-wide | slate/emerald/red |
| Avg. Backlog Age | `averageCaseAgeDays()` over **all periods** (deliberately not period-restricted — "a stale finding that transferred forward is still part of the same outstanding backlog") (`HODashboard.tsx:113-119,348-353`) | Bank-wide, all periods | `backlogAge` → amber |
| Draft / Pending Approval | own (`createdBy === userId`) drafts/pending, only if `canRegister` (HO Controller also holds `findings.create`) (`HODashboard.tsx:121-134,354-357`) | Own registrations only | slate / amber |

Other widgets:
- **Pending Approval** queue (`HODashboard.tsx:288-291,360-378`) — findings at `HO_REVIEW`, plus `PENDING_BANK_APPROVAL` if this user's id is in `Settings.hoApproval.approverUserIds`. Not period-scoped.
- **Pending Close / Accept** queue (`HODashboard.tsx:295-299,380-397`) — findings where district-verified cases/amount exceed what's already `closedCases`/`closedAmount`, mirroring the close-route's own closable-amount math exactly. Not period-scoped.
- **Case-Based Performance, Top/Bottom Districts, District Ranking (RankedBarChart + DistrictRankingTable), Top/Bottom Branches, Branch Performance table, SourcePerformanceSummary, Findings by District (ColumnChart)** — see §2.6.
- **Source Comparison** (`HODashboard.tsx:552-620`) — IC vs IA (or whatever sources are active) per Document_3 §18: two `StackedBarChart`s (by case count, by amount) plus a table with Total/Eligible/Rectified/Outstanding Cases and Amount columns. "Eligible" = the active `ScoringRule`'s own category **and** source gate (`scoredCategoryIds`/`scoredSourceIds`, `HODashboard.tsx:197-230`), not category alone.
- **Category Totals table, FindingsByCategoryChart, MonthlyTrend, FindingStatusDistribution, RiskDistribution** — §2.6/§4.
- **Reporting Period Status** (`HODashboard.tsx:665-675`) — every `ReportingPeriod`, badge green if `OPEN`, gray otherwise.
- **Recent Activity** — bank-wide, top 8 `FindingTransition`s, unfiltered by the current FilterBar (`HODashboard.tsx:301`).

### 2.4 ExecutiveDashboard — `src/components/dashboard/ExecutiveDashboard.tsx`

Same bank-wide, unscoped findings base as HODashboard (`ExecutiveDashboard.tsx:56-59`), but no `user` prop is read for row-level ownership (no Draft/Pending-Approval cards — this role never registers findings) and no work-queue/close cards (view-only role).

| Stat Card | Computation | Scope | Tone |
|---|---|---|---|
| Bank-wide Performance | `computePerformance(db, {periodId})` (`ExecutiveDashboard.tsx:65-67,209-214`) | Bank-wide | gold |
| Total Findings / Total Cases | `findingCaseTotals`/`InPeriod` (`ExecutiveDashboard.tsx:74-75,215-221`) | Bank-wide | blue |
| Outstanding (in scope) | `allFindingsInRange` not in `RECTIFIED/CLOSED/REJECTED` — **not** gated by `hasPeriodScope` like every other card (always shows a live count) (`ExecutiveDashboard.tsx:111,222`) | Bank-wide, current filters | amber |
| High/Critical Exceptions | `outstanding` filtered to `isHoApproved` + top-2 risk tiers (`ExecutiveDashboard.tsx:113-123,223`) | Bank-wide | `criticalExceptions` → red |
| Rectified Findings / Cases, Outstanding Cases | closed-only definitions, same as HO (`ExecutiveDashboard.tsx:224-226`) | Bank-wide | emerald / amber |
| Transferred Findings / Cases | `transferTotals(bankTransfers)` (`ExecutiveDashboard.tsx:84-89,227-228`) | Bank-wide | blue |
| Total / Resolved / Outstanding Amount | same currency functions (`ExecutiveDashboard.tsx:95-109,229-231`) | Bank-wide | slate / emerald / red |
| Avg. Backlog Age | `averageCaseAgeDays(outstanding)` (`ExecutiveDashboard.tsx:111-112,232-237`) | Bank-wide, current filters | amber |

Other widgets: Case-Based Performance; Top/Bottom Districts and Branches (plain `<div>` rows, **not** links — read-only, no navigation into `/findings`, unlike every other dashboard's equivalent callouts); Source Comparison (case-count only, no amount breakdown, no Amount columns in its table — a smaller version of HO's); FindingsByCategoryChart; MonthlyTrend; FindingStatusDistribution; RiskDistribution; Reporting Period Status. No Work Queue, no Recent Activity, no per-branch/district edit links anywhere (comment `ExecutiveDashboard.tsx:20-27` explains this is intentional to match the view-only permission set).

### 2.5 AdminDashboard — `src/components/dashboard/AdminDashboard.tsx`

This dashboard shows **no `Finding` data** — it's a system/configuration summary.

| Stat Card | Computation | Tone |
|---|---|---|
| Active Users | `db.users.filter(status === ACTIVE).length`, hint = total user count (`AdminDashboard.tsx:35,59`) | `activeUsers` → slate |
| Districts | active district count / total (`AdminDashboard.tsx:36,60`) | `districts` → slate |
| Branches | active branch count / total (`AdminDashboard.tsx:37,61`) | `branches` → slate |
| Open Periods | count `status === OPEN`, hint = locked count (`AdminDashboard.tsx:38-39,62`) | `openPeriods` → slate |
| Active Scoring Rule | `vN` of the active `ScoringRule`, or "None" (`AdminDashboard.tsx:40,63-67`) | `activeScoringRule` → slate |

Other widgets:
- **Data-integrity warning banner** (`AdminDashboard.tsx:70-77`) — amber box, shown only if any active branch has no assigned Manager or no assigned Controller (`findBranchManager`/`findBranchController` from `src/lib/org.ts`).
- **Users by Role** (`AdminDashboard.tsx:80-93`) — every `Role`, count of users with that `role.code`, "(inactive)" suffix for disabled roles.
- **Quick Links** (`AdminDashboard.tsx:95-108`) — filtered to only the admin pages this user's permissions grant `.view` on (`hasPermission`).
- **Recent Activity** (`AdminDashboard.tsx:111-125`) — last 8 `AuditLog` entries (administrative/authentication events, not `FindingTransition`s).

### 2.6 Shared sub-widgets (used across multiple dashboards)

| Component | File | What it shows | Data source |
|---|---|---|---|
| `CaseBasedPerformance` | `src/components/dashboard/CaseBasedPerformance.tsx:53-98` | "Performance Section" (Document_3 §14) — three proportional bars: Total Eligible Cases, Rectified Cases, Outstanding, labeled with whatever category the active `ScoringRule` scores | `computeEligibleCaseCounts()` — identical call to the headline Performance % StatCard, so it can never disagree with it |
| `SourcePerformanceSummary` | `src/components/dashboard/SourcePerformanceSummary.tsx:29-114` | "IC + IA Performance" (Document_3 §9) — per-source card (Total/Rectified/Outstanding eligible cases) plus a "Combined" card with its own derived Performance % | `computeEligibleCaseCounts(db, {...scope, sourceId})` per source |
| `BranchPerformanceTable` | `src/components/dashboard/BranchPerformanceTable.tsx:76-221` | Document_3 §15's Branch Performance Dashboard: ranked table (Total Eligible/Solved/Unsolved/Performance, with click-to-expand math) plus 5 callouts — Top Performer, Lowest Performer, High-Risk Branch, Most Outstanding, Highest Improvement (vs the one adjacent prior period via `findPreviousPeriod()`) | `computeEligibleCaseCounts()` + `computePerformance()` per branch |
| `DistrictRankingTable` | `src/components/dashboard/DistrictRankingTable.tsx:42-118` | Document_3 §17's District Ranking: Rank/District/Branches(dynamic count)/Total Eligible/Solved/Unsolved/Performance | same, per district |
| `FindingsByCategoryChart` | `src/components/dashboard/FindingsByCategoryChart.tsx:14-39` | Volume bar chart, one bar per classified category, click-through to filtered `/findings` | plain `.filter(categoryId).length`, categorical palette |
| `MonthlyTrend` | `src/components/dashboard/MonthlyTrend.tsx:29-75` | Dual-axis trend: Total Cases/Rectified (left axis, from `findingCaseTotalsInPeriod` per period) plus Total/Rectified **Eligible** Cases and Performance % (right axis, dashed, fixed 0–100 scale) — lets a viewer tell "did performance move because volume changed, or because eligible-case rectification changed" from one chart | one point per `ReportingPeriod`, chronological |
| `FindingStatusDistribution` | `src/components/dashboard/FindingStatusDistribution.tsx:12-45` | Donut of **every** finding (no `isHoApproved` gate — deliberate exception) bucketed into 7 lifecycle stages: Draft/In Review, In Progress, Rectified (awaiting close), Transferred, Closed, Returned (needs correction), Rejected — RETURNED and REJECTED kept separate since one is resubmittable and the other is terminal | raw status bucketing |
| `RiskDistribution` | `src/components/dashboard/RiskDistribution.tsx:33-52` | Donut of **open, `isHoApproved`** findings by risk level, fixed severity palette (low=green, medium=amber, high=orange, critical=red), click-through to `/findings?risk=` | `Settings.riskLevels`, case-insensitive match |
| `CategoryDistribution` | `src/components/dashboard/CategoryDistribution.tsx:20-55` | Stacked bar + numeric %, open + `isHoApproved` findings by classified category | categorical palette |
| `BranchDashboard`'s "Other Case Summary" / HO's "Category Totals" | — | see §4 | — |

`EmptyWidget` (`src/components/dashboard/EmptyWidget.tsx:10-31`) is a placeholder component for a not-yet-implemented BRD widget — **it is currently unused** (no import anywhere in `src/`); it survives as dead code from an earlier project phase, not something a user will encounter today.

---

## 3. The StatTone / icon system

### 3.1 Tone definitions

`StatTone` (`src/components/ui/Card.tsx:14`) is a closed union: `"slate" | "blue" | "emerald" | "amber" | "red" | "gold"`. Each maps to a fixed Tailwind class pair in `TONE_CLASSES` (`src/components/ui/Card.tsx:16-23`):

| Tone | Classes | Business meaning |
|---|---|---|
| `slate` | `bg-slate-100 text-slate-500` | Neutral admin/reference count — not good or bad, just informational (e.g. Total Amount, active user counts) |
| `blue` | `bg-blue-50 text-blue-600` | A plain volume total or forward motion — "how many," not a judgment (Total Findings/Cases, Transferred) |
| `emerald` | `bg-emerald-50 text-emerald-600` | A good/completed outcome (Rectified, Resolved Amount, Approved) |
| `amber` | `bg-amber-50 text-amber-600` | Something pending or needing attention, not yet a crisis (Outstanding, Returned, Draft, Pending Approval/Rectification, Backlog Age) |
| `red` | `bg-red-50 text-red-600` | Something negative or at-risk (Rejected, High-Risk, Outstanding Amount, Critical Exceptions) |
| `gold` | `bg-brand-gold/15 text-brand-gold-dark` | Reserved for the **one** headline Performance % metric each dashboard has — same role brand-gold plays for `Button`'s `primary` variant | 

The doc comment at `src/components/ui/Card.tsx:4-13` explains why only these six exist: every one of the other five has a dark-mode remap in `globals.css`; `gold` is the sole exception because `--brand-gold`/`--brand-gold-dark` are already theme-invariant.

### 3.2 Icon-to-tone mapping (`src/lib/dashboardIcons.ts:54-80`)

One shared `{icon, tone}` object per *stat concept* (not per exact label — e.g. `rectified` covers both "Rectified Findings" and "Rectified Cases", since the underlying idea is identical and the label text already distinguishes the unit):

| Key | Icon | Tone | Used for |
|---|---|---|---|
| `totalFindings` | Files | blue | Total Findings |
| `totalCases` | Layers | blue | Total Cases |
| `requiringReview` | Eye | amber | District: Requiring Review |
| `approved` | CheckCircle2 | emerald | District: Approved |
| `outstanding` | Clock | amber | Outstanding (findings) |
| `outstandingCases` | Clock | amber | Outstanding Cases |
| `rejected` | XCircle | red | Rejected |
| `returned` | Undo2 | amber | Returned |
| `rectified` | FileCheck2 | emerald | Rectified Findings/Cases |
| `transferred` | ArrowRightLeft | blue | Transferred Findings/Cases |
| `performance` | Gauge | gold | Branch/District/Bank-wide Performance % (the one headline metric) |
| `totalAmount` | Wallet | slate | Total Amount |
| `resolvedAmount` | HandCoins | emerald | Resolved Amount |
| `outstandingAmount` | CircleDollarSign | red | Outstanding Amount |
| `pendingApproval` | Inbox | amber | Pending Approval |
| `pendingRectification` | Wrench | amber | Pending Rectification |
| `draft` | FilePenLine | slate | Draft |
| `highRisk` | AlertTriangle | red | High-Risk Findings |
| `criticalExceptions` | AlertOctagon | red | Executive: High/Critical Exceptions |
| `backlogAge` | Timer | amber | Avg. Backlog Age |
| `activeUsers` | Users | slate | Admin: Active Users |
| `activeScoringRule` | Calculator | slate | Admin: Active Scoring Rule |
| `branches` | Building2 | slate | Admin: Branches |
| `districts` | Map | slate | Admin: Districts |
| `openPeriods` | CalendarClock | slate | Admin: Open Periods |

`Districts`/`Branches`/`Scoring Rules`/`Reporting Periods` deliberately reuse the exact icons `src/lib/nav.ts` already uses for those concepts in the sidebar, for "same thing, same icon everywhere" consistency (comment `src/lib/dashboardIcons.ts:9-12`).

### 3.3 `StatCard` rendering (`src/components/ui/Card.tsx:57-95`)

`StatCard({label, value, hint, detail, icon})`: renders the tone-colored icon badge, label, big value, and an optional `hint` caption. If a `detail` node is supplied, `value` becomes the `<summary>` of a native `<details>` disclosure — click/tap to reveal the calculation breakdown inline, with **no client-side JS** (used for Performance % cards to show the `rectified ÷ total × 100` math or the active manual-override reason).

Note: `Badge` (`src/components/ui/Badge.tsx:1-22`) is a **separate, unrelated** tone system used for ranking callouts and status pills — its tone union is `"green" | "gray" | "amber" | "red" | "blue"` (not `StatTone`'s `emerald`/`slate`/`gold`). Do not conflate the two when reading dashboard JSX: `StatCard`'s `icon.tone` is a `StatTone`; `Badge`'s `tone` prop uses its own separate palette.

---

## 4. Category totals tables

Every operational dashboard (Branch, District, HO) has a "Category Totals" `<table>` with an identical 7-column shape (e.g. `BranchDashboard.tsx:443-475`, `DistrictDashboard.tsx:440-472`, `HODashboard.tsx:622-654`):

| Column | Source | Format |
|---|---|---|
| Category | `category.name` + a blue "Scored" `Badge` if `category.scored` | text |
| Total Cases | `findings.reduce((sum,f) => sum + f.caseCount, 0)` | `formatNumber()` (count) |
| Rectified Cases | `findings.reduce((sum,f) => sum + f.closedCases, 0)` — **closed-only**, never self-reported `rectifiedCases` | `formatNumber()` (count) |
| Outstanding Cases | `total - rectified` | `formatNumber()` (count) |
| Amount | `findings.reduce((sum,f) => sum + f.amount, 0)` | `formatCurrency()` (money, 2 decimals) |
| Rectified Amount | `findings.reduce((sum,f) => sum + f.closedAmount, 0)` | `formatCurrency()` (money, 2 decimals) |
| Outstanding Amount | `amount - rectifiedAmount` | `formatCurrency()` (money, 2 decimals) |

`formatNumber(n)` (`src/lib/format.ts:21-23`) calls `n.toLocaleString("en-US")` with no fraction-digit options — a count like `1,240` never grows a fake `.00`. `formatCurrency(n)` (`src/lib/format.ts:31-33`) always forces `minimumFractionDigits: 2, maximumFractionDigits: 2` — money always reads `70,000.00`, even for a whole number, matching conventional currency notation. That distinction *is* consistently applied to the three "Amount" columns: every one of them explicitly calls `formatCurrency(amount)` / `formatCurrency(rectifiedAmount)` / `formatCurrency(outstandingAmount)` (e.g. `BranchDashboard.tsx:467-469`, `DistrictDashboard.tsx:464-466`, `HODashboard.tsx:646-648`).

**However**, the three "Cases" columns (Total/Rectified/Outstanding Cases) do **not** call `formatNumber()` at all — each cell is a bare `{hasPeriodScope ? total : "--"}` JSX expression (e.g. `BranchDashboard.tsx:464-466`), i.e. React stringifies the raw `number` with no locale formatting at all (no thousands separator — a count of `12000` would render `12000`, not `12,000`). This is confirmed by grepping the whole `src/components/dashboard/` tree for `formatNumber`: it is only imported/called inside the chart primitives (`DonutChart.tsx:1,85,98,111` and `StackedBarChart.tsx:1,67,73`, for donut-legend and stacked-bar-total labels), never inside `BranchDashboard.tsx`/`DistrictDashboard.tsx`/`HODashboard.tsx`/`ExecutiveDashboard.tsx`, and never inside `StatCard` itself (`src/components/ui/Card.tsx` has no `formatNumber` import) — every plain count StatCard value (Total Findings, Total Cases, Rectified Findings, etc.) is likewise a raw unformatted number. So the money-vs-count split that *is* real and consistent is "money always goes through `formatCurrency()`, everywhere"; "counts go through `formatNumber()`" is **only true inside the donut/stacked-bar chart components**, not in the Category Totals tables or any StatCard — see §8 for this as a gotcha.

**Currency caveat**: all three "Amount" columns and every currency-grouped StatCard (Total/Resolved/Outstanding Amount) assume/display a **single locale-formatted number per currency present** — see `formatTotals()` in `src/lib/currency.ts:5-11`, which groups by `finding.currency` (ETB/USD/EUR/GBP — configurable in Settings) and joins multiple currencies with `·` (e.g. `"ETB 45,000.00 · USD 500.00"`). A raw cross-currency sum is never computed, since that would be meaningless (comment `src/lib/currency.ts:13-18`). The Category Totals table itself, however, sums `amount`/`closedAmount` directly across whatever findings are in that category **without** this currency grouping — it is a plain numeric sum formatted once via `formatCurrency()`, so if a single category legitimately contains findings in more than one currency, that column would silently mix currencies (this is a real, unaddressed edge case — see §8).

**Filters affecting this table**: rows are limited to `categoriesInScope` (narrowed by `filters.categoryId` if set — `BranchDashboard.tsx:183`, `DistrictDashboard.tsx:181-183`, `HODashboard.tsx:146-148`), and the underlying `findings` for each row are `approvedPeriodFindings` — i.e. affected by the FilterBar's District/Branch/Source/Risk/Status selections (wherever not already fixed by org scope), the `TimeRangeFilter` date range, and the selected Period/"All periods". Every cell reads `"--"` instead of a number when `!hasPeriodScope` (no period resolvable and "All periods" not chosen).

The bank-wide **Source Comparison** table on `HODashboard`/`ExecutiveDashboard` (§2.3/§2.4) follows the identical count-vs-currency convention, with an added "Eligible Cases" column gated by both the active `ScoringRule`'s category *and* source set.

---

## 5. Filters

### 5.1 `FilterBar` (`src/components/dashboard/FilterBar.tsx:55-247`, client component)

Fields, per master.txt §10: **Period, District, Branch, Source, Classified Case (category), Risk, Status.**

- **URL-driven, server round-trip**: every change calls `update()` (`FilterBar.tsx:82-95`), which builds a `URLSearchParams` from the current filter state, merges the patch, and calls `router.push(pathname?query)`. There is **no client-side re-render of dashboard data** — pushing a new URL causes Next.js to re-run the server component (`dashboard/page.tsx`) with new `searchParams`, which calls `parseDashboardFilters()` again and recomputes every stat from a **fresh `readDb()`** call (§6). The dashboard itself holds no client state for filters.
- **Period** (`FilterBar.tsx:112-128`): a `<Select>` with an explicit `"All periods"` option (`ALL_PERIODS_VALUE = "ALL"`, `src/lib/dashboardFilters.ts:20`), distinct from an unset value — an empty `periodId` means "no filter picked yet, default to whichever period is `OPEN`"; `"ALL"` means "aggregate across every period" (both are explained in `dashboardFilters.ts:13-19` and `FilterBar.tsx:113-119`).
- **District/Branch** (`FilterBar.tsx:130-168`): rendered as **fixed, read-only text** (not a `<Select>`) when the caller passes `fixedDistrict`/`fixedBranch` — this is how org-scope is enforced in the UI for Branch/District dashboards (a Branch user cannot even see a District/Branch selector). HO/Executive dashboards pass neither, so both remain live selects. Selecting a District on HO's `<Select>` also clears `branchId` (`FilterBar.tsx:140`) and narrows the Branch dropdown's own option list to that district (`FilterBar.tsx:102-104`).
- **Source, Classified Case, Risk** (`FilterBar.tsx:170-204`): plain selects over `db.sources`(active)/`db.categories`(active)/`Settings.riskLevels`, alphabetized except risk (kept in severity order).
- **Status** (`FilterBar.tsx:206-216`): options come from a caller-supplied `statusOptions` prop with **no default** on purpose — every dashboard here passes `HO_APPROVED_OR_LATER_STATUSES` (6 values: SENT_TO_BRANCH_MANAGER/PARTIALLY_RECTIFIED/RECTIFICATION_RETURNED/RECTIFIED/CLOSED/TRANSFERRED), since any other status would zero out nearly every "official" (`isHoApproved`-gated) widget on the page (doc comment `FilterBar.tsx:21-39`). Per-record list pages (`/findings`, `/reports`) pass a different, wider `FILTERABLE_FINDING_STATUSES` constant instead — picking the wrong one for the wrong page class is exactly the bug this prop's design prevents.
- **Reset filters** button (`FilterBar.tsx:218-242`) appears only when any field differs from its default, and resets every non-fixed field to its default (`defaultPeriodId` for Period, empty for the rest).

**Filter application** (`applyDashboardFilters()`, `src/lib/dashboardFilters.ts:68-78`): applies **every field except `periodId`** (district/branch/source/category/risk/status) as a plain `Array.filter` on a `Finding[]` — including fields the caller's org scope already fixes (a branch dashboard's own `branchId` filter is then a no-op there, but harmless). `periodId` is deliberately excluded from this generic function — each dashboard resolves its own "effective period" (`openPeriod`/`allPeriodsSelected`) separately, since which period counts as "current" changes what the whole page means, not just which rows show (comment `dashboardFilters.ts:58-67`).

Important scoping nuance: while `applyDashboardFilters`/date-range narrow **which findings are counted** in most stat cards, `computePerformance()`/`computeEligibleCaseCounts()` (Performance %, Branch/District/Bank-wide Performance, every ranking table) are **never** narrowed by Source/Category/Risk/Status — they always reflect the full BRD-defined eligible-case set for the given branch/district/period, so "80% performance" always means what the active `ScoringRule` says it means, independent of what a user happens to be looking at (explicitly called out in the `hint` prop passed to every `FilterBar` instance: *"Performance % always reflects the full scoring formula, not narrowed by source/category/risk/status."*, e.g. `BranchDashboard.tsx:308`). District/Branch selection **does** narrow which *rows* appear in ranking/comparison tables, though (a real narrowing of "what am I looking at," not a redefinition of the formula).

### 5.2 `TimeRangeFilter` (`src/components/reports/TimeRangeFilter.tsx:39-125`, client component)

A second, independent filter: Today / This Week (Monday-start) / This Month / Custom, writing `dateFrom`/`dateTo` onto the same URL query string (`pushRange()`, `TimeRangeFilter.tsx:50-58`) — same server-round-trip convention as `FilterBar`. Filters by each finding's own `findingDate` (`inDateRange()`, `src/lib/dateRange.ts:15-19`, plain string comparison since `findingDate` is `YYYY-MM-DD`), **distinct** from the reporting-*period* dropdown in `FilterBar` (comment `TimeRangeFilter.tsx:32-37`). Also client-only local state (`showCustom`, `customFrom/To`) purely for the custom-date-picker UI; the actual applied range always comes back from `searchParams`.

### 5.3 Summary: client vs. server

**All dashboard filtering is a server round-trip.** There is no client-side re-render, no `useEffect`-driven fetch, and no SWR/React Query layer anywhere in the dashboard code. `FilterBar` and `TimeRangeFilter` are `"use client"` only because they need `useRouter`/`useSearchParams`/local UI state (e.g. which preset button is highlighted, whether the custom date inputs are shown) — the moment a value actually changes, they `router.push()` a new URL, and the entire dashboard tree (a server component) re-renders from scratch.

---

## 6. Real-time vs. cached data

**Every dashboard load is a fresh, uncached read from PostgreSQL.** `readDb()` (`src/lib/db.ts:521-...`) runs ~26 `Promise.all`'d `prisma.*.findMany()` calls (roles, users, districts, branches, sources, departments, categories, scoring rules/adjustments, reporting periods, findings, transitions, rectifications, cases, transfers, closures, import batches, evidence, comments, notifications, audit logs, branch coverage notes, support threads/messages, settings) on **every single page render** — no `unstable_cache`, no `revalidate` export, no Redis involvement, confirmed by grepping `src/lib/db.ts` and `dashboard/page.tsx` for any caching primitive (none found). `dashboard/page.tsx` itself declares no `export const revalidate`/`dynamic`, so it uses Next's default dynamic server-rendering behavior for a page that reads `searchParams` and calls a database function — i.e. rendered fresh per request, not statically cached.

Redis (`src/lib/redisClient.ts:1-34`) exists in this codebase but is used **only** for login/password-change rate limiting (`src/lib/rateLimit.ts`) and the findings draft-autosave feature (`src/app/api/findings/draft-autosave/route.ts`) — it has no involvement in dashboard data at all.

**Implication**: a finding registered, approved, rectified, or transferred a moment ago is reflected on the next dashboard page load / filter change immediately — there is no staleness window, but also no memoization, so every dashboard load re-fetches and re-computes the entire database's worth of findings in memory (all the `computePerformance`/`computeEligibleCaseCounts`/`findingCaseTotalsInPeriod` calls documented above run fresh, per request, per dashboard widget that needs them — e.g. `MonthlyTrend` alone calls `computePerformance`/`computeEligibleCaseCounts` once per `ReportingPeriod`).

---

## 7. Permission gating

Two independent layers, both enforced server-side:

1. **Dashboard routing/permission** (`src/app/(app)/dashboard/page.tsx`, §1.1) — a user's `orgScope` decides *which* dashboard component *would* render for them; a separate `"<code>-dashboard.view"` permission decides whether they're actually allowed to see it. **A user cannot navigate to a different role's dashboard by URL** — there is only one route (`/dashboard`), and the component selection is entirely server-derived from the *session's own* `orgScope`/`role`, never from a query param or client input. A Branch Controller manually editing the URL has nothing to edit — `/dashboard` always resolves to their own `orgScope`'s dashboard (or a "no access" card if the specific dashboard permission was revoked). The registry's own standing rule (`src/lib/permissions/registry.ts:9-13`) states every dashboard/feature must be reachable only through this same permission-checked path — "nothing should be reachable by role [alone]."
2. **Data-scope enforcement** (`src/lib/findings-scope.ts:12-37`) — `isFindingInScope(session, finding)` is the BRD-mandated, centralized scope check: `BANK` → always true; `DISTRICT` → `finding.districtId === session.districtId`; `BRANCH` → `finding.branchId === session.branchId`; unrecognized scope → deny. The doc comment (`findings-scope.ts:4-11`) states this must be used by **every** findings API route and list view — "Filters must never bypass organizational scope; UI scope is not a security boundary; server/API must enforce access." **However**, the dashboard components themselves do **not** call `isFindingInScope`/`findingsInScope` directly — each dashboard hand-derives its own scoped subset inline (e.g. `db.findings.filter(f => f.branchId === branch.id)` in `BranchDashboard.tsx:96`, `f.districtId === district.id` in `DistrictDashboard.tsx:76`), which is equivalent in effect to `isFindingInScope` for these three org-scope types but is a parallel implementation rather than a shared call — worth flagging as a maintenance risk (a future 4th org scope type would need to be added to both places).

Net answer to "can a Branch Controller manually navigate to see HO's dashboard": **no** — there is no URL parameter or client control that selects a dashboard; the server derives it solely from the authenticated session's `orgScope`, and a Branch-scoped session can never produce anything but `BranchDashboard` (or a no-access card) from this route, regardless of what's typed in the address bar.

---

## 8. Edge cases & known gotchas

- **No open reporting period selected, and "All periods" not chosen**: `hasPeriodScope` is `false`, and essentially every StatCard on Branch/District/HO/Executive renders literally `"--"` instead of `0` — an explicit "not computable" rather than a misleading zero (pattern repeated dozens of times, e.g. `BranchDashboard.tsx:317-369`). Category Totals table cells do the same (`"--"` per cell, e.g. `BranchDashboard.tsx:464-469`).
- **No active `ScoringRule`**: `computeEligibleCaseCounts()`/`computePerformance()` return `null` (`src/lib/findings.ts:879-880,962-963`); every Performance % StatCard shows `"--"` with a hint of `"No active scoring rule"`; `CaseBasedPerformance` renders an entirely different "No active scoring rule configured yet" placeholder card instead of its bars (`CaseBasedPerformance.tsx:70-77`); `Other Case Summary` shows "Ask an administrator to configure one under Scoring Rules." (`BranchDashboard.tsx:437-439`).
- **Zero eligible cases even with an active rule**: `computeEligibleCaseCounts` also returns `null` if `totalCases === 0` after filtering (`src/lib/findings.ts:894,907`) — this is why every Performance % consumer treats `null` (not `0`) as "no data," and why `CaseBasedPerformance`'s percentage bars guard division explicitly: `rectifiedPct = totalEligible > 0 ? (rectified/totalEligible)*100 : 0` (`CaseBasedPerformance.tsx:85-86`) — a zero-division guard that resolves to `0%` width rather than `NaN`/`Infinity`.
- **Empty branch rankings / no peer branches**: `BranchDashboard`'s Branch Ranking table shows "No peer branches in this district yet." when `districtBranches` is empty (`BranchDashboard.tsx:391-397`); `BranchPerformanceTable`/`DistrictRankingTable` show "No branches/districts configured yet." (`BranchPerformanceTable.tsx:195-201`, `DistrictRankingTable.tsx:91-97`); Top/Bottom Performer lists show "No performance data yet." when nothing clears the threshold (`DistrictDashboard.tsx:339,359`, `HODashboard.tsx:412,432,488,508`) — these lists are **threshold-based** (`Settings.performanceThresholds.topPercent`/`bottomPercent`), not a fixed top-N cut, so they are legitimately empty when nobody clears the bar (comment `DistrictDashboard.tsx:199-202`).
- **No branch/district assigned to the user**: `BranchDashboard`/`DistrictDashboard` render an early-return red error card — "Your account isn't assigned to an active branch/district. Contact an administrator." — instead of attempting to render with an undefined scope (`BranchDashboard.tsx:78-86`, `DistrictDashboard.tsx:66-74`).
- **Ranking visibility toggles**: `Settings.rankingVisibility.branches`/`.districts` are admin-configurable kill-switches. When off, the corresponding ranking Card renders a plain "ranking visibility is disabled by your administrator" message in place of the real table on **every** dashboard that would otherwise show it (e.g. `BranchDashboard.tsx:414-419`, `DistrictDashboard.tsx:402-407,418-423`, `HODashboard.tsx:475-480`, `ExecutiveDashboard.tsx:281-286,322-327`) — the underlying computation still runs (it's just not rendered), so this is a display-only gate, not a perf optimization.
- **"Highest Improvement" with no prior period**: `BranchPerformanceTable`'s improvement callout shows "No prior period" instead of a branch name when `findPreviousPeriod()` returns nothing (`BranchPerformanceTable.tsx:96,177`) — improvement also doesn't apply at all in "All periods" mode (no single adjacent period to diff against).
- **Currency mixing risk in Category Totals**: as noted in §4, the Category Totals table's Amount columns sum `finding.amount`/`closedAmount` directly across a category **without** grouping by `finding.currency` the way every StatCard's Total/Resolved/Outstanding Amount does via `sumAmountByCurrency()`. If a category legitimately has findings in more than one currency (ETB/USD/EUR/GBP — all configurable in Settings), that column silently sums across currencies into one meaningless number. This is a genuine, uncorrected inconsistency between the StatCards (currency-safe) and the Category Totals / Source Comparison tables (not currency-safe) — no code comment flags it, and it was not part of the recent currency-formatting fix (which addressed `formatNumber` vs `formatCurrency` decimal formatting, not cross-currency summation).
- **`FindingStatusDistribution` is the deliberate exception to the `isHoApproved()` gate** — every other "official" widget hides in-flight findings; this one exists specifically to show the *whole* workflow including DRAFT/SUBMITTED/DISTRICT_REVIEW/etc., so a viewer comparing it against, say, Total Findings should expect a larger number here, by design (comment `FindingStatusDistribution.tsx:6-11`).
- **RETURNED vs REJECTED kept as separate donut segments**, not merged, specifically because RETURNED is resubmittable (same as RECTIFICATION_RETURNED further down the workflow) while REJECTED has no path back — merging them would hide a functionally important distinction (comment `FindingStatusDistribution.tsx:18-24`).
- **"Transferred Cases" historically mislabeled**: `HODashboard.tsx:274-277`'s comment notes a prior bug where a StatCard labeled "Transferred Cases" actually held a *distinct-finding* count, not a real case count; `transferTotals()` now correctly separates `transferredFindings` (record count) from `transferredCases` (real `casesTransferred` sum), and both are shown side by side rather than one replacing the other.
- **Executive Dashboard's "Outstanding (in scope)" card is the one StatCard on that page not gated by `hasPeriodScope`** — it always shows a live count regardless of period selection (`ExecutiveDashboard.tsx:111,222`), unlike every other card on the same page.
- **Case-count cells and StatCard values are not locale-formatted**: unlike the Amount columns (always `formatCurrency()`) and the chart legends (`formatNumber()` inside `DonutChart`/`StackedBarChart`), every plain case/finding count rendered directly in a `<StatCard value=.../>` or a Category/Source-Totals table's Cases column is an unformatted raw JS number in JSX (see §4) — for any count reaching four digits or more (e.g. a bank-wide "Total Cases" StatCard on `HODashboard`), the number renders with no thousands separator (`12000`, not `12,000`), inconsistent with how the same dashboards format every Amount figure.
- **`EmptyWidget` is dead code** — present in the codebase (`src/components/dashboard/EmptyWidget.tsx`) as a placeholder pattern from an earlier project phase (its own comment says it's for "a BRD-specified widget that needs Finding/Rectification data which doesn't exist in the app yet"), but grepping the entire `src/` tree shows zero imports of it — every dashboard widget documented above is fully implemented, not a placeholder.
