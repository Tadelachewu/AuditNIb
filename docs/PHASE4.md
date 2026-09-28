# Phase 4 — Role-Specific Dashboards (Branch, first)

The BRD (`AuditDocs/`) specifies four role-specific dashboards - Branch,
District, HO, Executive - each built from Finding/Rectification data
(master.txt §10). None of that data exists in the app yet: there is no
`Finding` entity, no workflow, no rectification records. Building "real"
dashboards would mean building the entire Findings module first - several
phases of the original roadmap (`AuditDocs/NIB_Control360_Development_Plan.md`
§5: "Findings core," "District workflow," "HO workflow," "Rectification").

Phase 4 takes the other documented path instead - the original plan's own
Phase 2, "Dashboards skeleton... with mock/aggregated data" - built here
with a stricter rule: **no fabricated numbers**. Every widget either shows
real data that already exists (org units, periods, the active scoring
rule's formula, risk levels) or an honest "no data yet" state naming
exactly what will populate it once Findings registration ships. This
document covers the first dashboard, Branch - District/HO/Executive follow
in later phases, one at a time, reusing the same building blocks.

## 1. What the BRD actually specifies

From master.txt §10 (the dashboard requirements table) and §241 (shared
filters), verified directly against the docs before writing any code:

- **Branch Controller / Manager**: Selected month; category totals;
  total/rectified/outstanding; Other Case summary; performance; monthly
  trend; risk distribution; recent activity; relevant work queues.
- **Common filters** (all roles): Reporting Period, District, Branch,
  Finding Source, Classified Case, Risk, Operation Area, Status - and,
  critically: *"Filters must never bypass organizational scope."*
- **Widget list**: Monthly Performance Trend, Risk Distribution, Finding
  by Category, Branch Performance by Month, District Performance, Top
  Performers, Recent Activity, KPI cards and exception/work-queue
  indicators.

## 2. Routing: orgScope decides the dashboard, not the role code

Phase 2 ([PHASE2.md](PHASE2.md)) made roles dynamic - there's no longer a
fixed `Role` union to switch on. So which dashboard a user sees is decided
from their role's `orgScope` (`BANK`/`DISTRICT`/`BRANCH`), carried in the
session since login (a new `session.orgScope`, resolved the same way
`roleName`/`permissions` already are - see `src/app/api/auth/login/route.ts`).
That means a *custom* branch-scoped role an admin creates later
automatically gets the Branch dashboard too, with zero code changes.

`src/app/(app)/dashboard/page.tsx` is the single entry point every
non-admin role already lands on. It now branches:

```ts
if (user.orgScope === "BRANCH" && user.role !== "ADMIN") {
  return <BranchDashboard user={user} db={db} />;
}
// ...generic landing page for everyone else, until District/HO/Executive land
```

The `user.role !== "ADMIN"` guard exists because `ADMIN` could theoretically
be reassigned a non-`BANK` `orgScope` by a future edit (nothing currently
prevents that structurally) - Administrators should always land on the
generic page with the `/admin` link, never get redirected into a
Findings-role dashboard.

## 3. Shared building blocks — `src/components/dashboard/`

Two components exist specifically so District/HO/Executive don't rebuild
the same pieces:

### `FilterBar.tsx`

Implements the BRD's exact filter list. Two decisions worth calling out:

- **Org-scope locking**: `fixedDistrict`/`fixedBranch` props render the
  District/Branch fields as plain, non-editable text instead of a
  `<select>` when the caller's role is scoped to that unit - literally
  enforcing *"filters must never bypass organizational scope"* in the UI
  itself, not just trusting a future API to reject it. The Branch
  dashboard passes both fixed; District/HO/Executive (later phases) will
  pass fewer, since their scope is wider.
- **Local state, no live query**: filter changes update local component
  state only (an `onChange` callback exists as an extension point but
  nothing consumes it yet). Wiring this to `useSearchParams`/URL state was
  considered and deliberately deferred - there's no Finding query for the
  filters to drive yet, so persisting them to the URL would be complexity
  with nothing behind it. A caption under the bar says so explicitly,
  rather than leaving the filters looking broken. The `status` field's
  options are already the BRD's full workflow-state list (master.txt §11)
  even though `Finding.status` doesn't exist yet, so the control is correct
  and ready the moment it does.

### `EmptyWidget.tsx`

The "no fabricated numbers" rule made this necessary: every BRD widget that
needs Finding data (Monthly Performance Trend, Risk Distribution, Recent
Activity, Work Queue) renders as a bordered card stating plainly what will
appear there and why it's empty now - not a chart library rendering a flat
line at zero, which would misrepresent "no findings tracked yet" as
"genuinely zero findings." Where a widget has *some* real, non-Finding data
worth showing even while empty (e.g. the configured risk levels as a
legend on Risk Distribution), it's passed as `children`.

## 4. `BranchDashboard.tsx`

Maps directly onto the BRD's Branch row, in order:

1. **Header** - branch name/code, district, and its Manager/Controller
   (via the derived `findBranchManager`/`findBranchController` from
   PHASE1.md §3 - real data, since org assignment already exists).
2. **Filter bar** - District and Branch both fixed to the user's own
   branch (a Branch user's org scope is exactly one branch).
3. **KPI row** - Total Findings / Rectified / Outstanding / Performance,
   each `"--"` with a caption explaining why, using the existing
   `StatCard` component rather than a new one.
4. **Other Case Summary** - the BRD calls this out as its own widget,
   separate from the general category table. It shows the **real** active
   scoring rule's formula (`ScoringRule.basis`) even though the computed
   number is still `"--"` - genuinely useful context that doesn't require
   Finding data to exist.
5. **Category Totals table** - every active `ClassifiedCategory`, real
   names and the `Scored` badge (reused from the admin Categories page)
   pulled straight from `db.categories`, with `"--"` in the numeric
   columns.
6. **Monthly Performance Trend / Risk Distribution** - `EmptyWidget`s;
   Risk Distribution's legend uses the real `Settings.riskLevels`.
7. **Work Queue / Recent Activity** - `EmptyWidget`s. Recent Activity is
   deliberately *not* backed by the existing admin audit log
   (`AuditLogEntry`) - that log records administrative changes (users,
   districts, scoring rules), not findings-workflow events
   (submit/approve/return/rectify), and a Branch Manager typically doesn't
   even hold `audit-log.view`. Reusing it here would both show the wrong
   kind of activity and leak data the role isn't permissioned to see.

## 5. Verified

Logged in as both seeded branch-scoped users (`branch.manager`,
`branch.controller`) - both correctly land on the Branch dashboard for
Bole Branch, with the District/Branch filter fields rendered as fixed text
(no `<select>` present, confirmed via the DOM) rather than editable
dropdowns. Zero browser console errors. Screenshot reviewed directly:
header, filter bar, KPI row, Other Case Summary (showing the real v1
formula), the full 7-row category table, and all four empty-state widgets
render as designed.
