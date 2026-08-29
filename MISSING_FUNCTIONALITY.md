# Missing Functionality — Cross-Check vs. Document 3

`AuditDocs/Document_3_—_Business_Process_&_Workflow_Specification.pdf`
("Business Process & Workflow Specification," v1.0) read in full and
checked section-by-section against the running code — not against memory
of what was intended. Every item below was verified directly (grep/read
the actual file cited), not inferred from the doc alone. Where the gap is
also tracked in `BRD_COMPLIANCE.md` (the existing master.txt/Master IT
Doc/proposal.txt cross-check), that's noted rather than re-explained.

**Two items `BRD_COMPLIANCE.md` still lists as missing are no longer
true** — they were built earlier in this project's work, after that
document's last update: the **Excel Migration Toolkit** (§22 there) now
exists in full (`src/lib/import.ts`, `/findings/import`), and **in-app
notifications** were extended (every rectification — not just full — now
notifies the other branch-level `findings.rectify` holder, with an
optional acknowledgment comment). Neither is listed again below.

**Update — five of the original nine gaps are now closed** (§4, §5, §6,
§7, §9 below), plus meaningful new ground covered on §8. Each is marked
✅ with what actually shipped, left in place rather than deleted so this
stays a record of what changed, not just a current snapshot. Several
unrelated features requested since the original pass — **Configurable
Automatic Transfer** (fires when a period locks, Admin-toggleable, tags
transfers Manual/Automatic, and each `FindingTransfer` row now also
snapshots the finding's original case count/amount and case age at that
hop, per Document_3 §15), **HO/District return-of-rectification-for-
correction** (a mandatory-reason return step between rectification and
close/transfer, with resubmission), **Performance Ranking Visibility**
(Admin can hide branch/district ranking widgets independently), an
optional **Root Cause** field on finding registration, a **Branch
Sub-Manager** role (identical permissions to Branch Manager), reporting
periods now capturing a full **start/end date-time range** rather than
just year/month, and a **Today/This Week/This Month/Custom date filter**
on the Reports page — aren't in Document_3 at all, so they're not listed
as "fixed" items here, but several materially affect §1 (period
lifecycle) and §8 (authorization-like checkpoint) below and are called
out where relevant.

**Status key**: ❌ Not implemented · ⚠️ Partially implemented · ✅ Fixed since the original pass

---

## 1. ❌ Reporting Period is a 2-stage lifecycle, not the spec's 4-stage one

**Doc**: §28 "Reporting Period Workflow" — `OPEN → REPORTING → REVIEW →
LOCKED`.

**Code**: `PeriodStatus` (`src/types/index.ts:147`) is
`"OPEN" | "LOCKED"` only. There is no `REPORTING` (data-entry cutoff,
consolidation begins) or `REVIEW` (pre-lock review window) intermediate
state anywhere — `FilterBar.tsx:89` and every period-lock check in the
app only ever branches on `"LOCKED"` vs. everything else.

**Effect**: a period is either fully open for writes or fully frozen —
there's no distinct "district is consolidating, branches can't add more"
or "under final review before lock" stage the doc calls for.

---

## 2. ❌ No free-text search across findings

**Doc**: §23 "Dashboard Filters" — Reporting Month, District, Branch,
Finding Source, Category, Risk Level, Status, **Search**.

**Code**: `FilterBar.tsx` (lines 80–186) renders exactly the seven
dropdown filters and nothing else — no `<input type="text">`, and the
`DashboardFilters` interface (lines 7–15) has no `search`/`query`/
`keyword` field. There is no way to find a finding by reference number,
title, or description text; only structured dropdown narrowing exists.

---

## 3. ⚠️ HO "Return" bypasses the District Controller

**Doc**: §9 / BR-WF-008 — *"Head Office return sends the finding through
District back to Branch Controller for correction."* The state diagram
(§9) shows `HEAD OFFICE → DISTRICT → BRANCH CONTROLLER`.

**Code**: `src/app/api/findings/[id]/ho-review/route.ts:59-61` — on
`decision === "RETURN"` it transitions straight to `RETURNED` (the same
terminal-ish status District's own return uses), and the notification at
lines 66-72 goes only to `f.createdBy` (the original branch submitter).
The District Controller is never notified and the finding never passes
back through `DISTRICT_REVIEW` as its own step — it's a single hop from
HO straight to whoever created it.

**Why partial, not full**: once the branch controller corrects and
resubmits, `submitFinding()` does route it through `DISTRICT_REVIEW`
again before HO sees it — so the *review chain* is eventually honored.
What's missing is the District Controller being kept in the loop *at the
moment of the return itself*, which the doc's diagram depicts as an
explicit hop.

---

## 4. ✅ Fixed — Automated "Rectification Reminder" (lazy, no scheduler infrastructure)

**Doc**: §30 "Notification Workflow" lists, alongside the event-driven
notifications: *"Rectification Reminder — System → Branch Manager"* —
implying a time-based nudge for findings sitting too long awaiting
rectification, not just a reaction to someone else's action.

**What shipped**: this app still has no cron/scheduler infrastructure, so
rather than adding one, `checkRectificationReminders()`
(`src/lib/notifications.ts`) is checked lazily off the existing
30-second `NotificationBell` poll (`GET /api/notifications`). An
Admin-configurable toggle and threshold (`Settings.rectificationReminders`,
editable at `/admin/settings`) control whether it's on and how many days
without progress trigger a reminder. A global cooldown
(`REMINDER_SCAN_COOLDOWN_MS`, one hour) keeps the scan itself cheap
regardless of how many users are polling, and each finding's own
`lastReminderAt` stops it being re-flagged inside the same threshold
window. Off by default for existing installs - an Admin opts in
explicitly.

---

## 5. ✅ Fixed — Branch Dashboard KPI cards, category amounts, and category distribution chart

**Doc**: §24 "Branch Dashboard" — KPI cards: Total Findings, Outstanding,
Rectified, **Transferred**, **High Risk**, Performance. Category Summary:
per-category total/rectified/outstanding **cases and amounts**. Analytics:
monthly trend, risk distribution, **category distribution**, recent
activity, recent findings, notifications.

**What shipped**: `BranchDashboard.tsx` now has all six KPI cards,
including **Transferred** (same convention as District/HO's own transfer
count — distinct findings transferred out of the current period) and
**High Risk** (open findings in the top two configured risk tiers). The
"Category Totals" table gained Amount/Rectified Amount/Outstanding Amount
columns alongside the existing case counts. A new `CategoryDistribution`
component (`src/components/dashboard/CategoryDistribution.tsx`) renders
the per-category breakdown as a real stacked-bar chart plus a
count/percentage grid, using the same fixed categorical palette convention
as the rest of the dashboard charts.

---

## 6. ✅ Fixed — "Bottom Performers" on District and HO dashboards

**Doc**: §25 "District Dashboard" — Top performers **and** Bottom
performers, as separate callouts.

**What shipped**: both `DistrictDashboard.tsx` and `HODashboard.tsx` now
render a "Bottom Performers"/"Bottom-Performing Branches" card alongside
the existing top-performers one — the same ranked list, reversed and
capped at 5, with a red "Rank #N" badge (vs. the top list's green/gray
rank badges) so the two read as distinct at a glance. Both respect the
existing Performance Ranking Visibility toggle: when branch ranking is
hidden for an org level, its bottom-performers card is hidden along with
everything else in that comparison group, rather than leaking a
comparison the Admin explicitly turned off.

---

## 7. ✅ Fixed — IC vs. IA comparison now includes amount columns and eligible-cases

**Doc**: §18 "IC vs IA Dashboard" — a table comparing Internal Control vs.
Internal Audit across: Total Cases, **Other Cases**, Rectified,
Outstanding, **Amount**, **Rectified Amount**.

**What shipped**: `HODashboard.tsx`'s "Source Comparison" table now has
Total Cases, **Eligible Cases** (whatever categories the *active scoring
rule* currently scores — generalized rather than hard-coding "Other
Case," the same principle `computePerformance()` already follows),
Rectified Cases, Outstanding Cases, Amount, Rectified Amount, and
Outstanding Amount, per source. Two stacked-bar charts sit above the
table — one by case count, one by amount — so the comparison is both
graphical and numeric.

---

## 8. ⚠️ Authorization is folded into Close, but there is now a real "send it back" checkpoint

**Doc**: §13 "Authorization" describes a step *after* rectification,
before closure, with its own status (`AUTHORIZED` or `RETURNED`) and a
dedicated view of original/rectified/outstanding/evidence/history — doc
itself flags this as unresolved: *"The exact authorization authority
should be finalized with the business owner and IT during detailed
requirements validation."*

**What's changed since the original pass**: there is still no distinct
`AUTHORIZED` status, and closing is still one action rather than a
separate authorization step. But a new `RECTIFICATION_RETURNED` status
and two routes — `return-rectification` and `resubmit-rectification` —
now give the District/HO Controller exactly the "or RETURNED" half of
§13's proposed outcome: reviewing a rectification, they can send it back
to the Branch Manager with a mandatory reason instead of closing/
partially closing/transferring it, which stays blocked until the Branch
Manager addresses it and resubmits. That's a real, working equivalent of
the doc's `AUTHORIZED`/`RETURNED` fork — just not under that literal
status name, and without the dedicated single-screen authorization view
(the same information is already spread across the existing finding
detail page's sections).

**Still open**: no distinct `AUTHORIZED` terminal-before-close status: a
"send it back" path exists, but there's no equivalent explicit "I
authorize this" action separate from `close` itself — closing still
plays that role implicitly. Given the source document itself says the
authorization authority needs business-owner sign-off either way, this
remaining piece is closer to "an open design question" than "a
clearly-specified feature that was skipped."

---

## 9. ✅ Fixed — `FindingCase` entity for optional case-level itemization

**Doc**: §12 (Partial Rectification Rule) and §34 (Recommended
Development Principle) are explicit: *"A finding containing three cases
should not be permanently treated as one indivisible record. The
production database should be capable of tracking the individual cases or
case-level rectification events while still presenting the aggregated
finding totals to users."* `FindingCase` is named directly in the doc's
list of recommended entities.

**What shipped**: a new `FindingCase` entity (`id`, `findingId`, `seq`,
`amount`, `status: "OUTSTANDING" | "RECTIFIED"`, plus who/when it was
rectified). At registration, a finding with more than one case can
optionally be itemized — one amount per case, validated to sum to the
finding's total — via a checkbox on `NewFindingForm.tsx`. Once itemized,
rectifying that finding switches from typing a count/amount to picking
specific still-outstanding cases from a checklist
(`FindingDetailClient.tsx`), and `RectificationEntry` now records exactly
which `caseIds` were addressed. A finding's detail page shows a "Cases"
panel with each case's status. Non-itemized findings (the overwhelming
majority, including every finding that predates this feature) are
completely unaffected — itemization is opt-in, not a migration.

---

## Also still open (tracked in `BRD_COMPLIANCE.md`, unaffected by this pass)

Not re-verified here since `BRD_COMPLIANCE.md` §5 already covers them in
detail and nothing this session touched them:

- Configurable per-source workflow routing (master.txt §2) — every
  source follows one identical pipeline.
- Knowledge Base module (icfms.txt §8) — not started.
- `ScoringAdjustment` records exist and are audit-logged, but
  `computePerformance()` doesn't fold a manual adjustment into the
  displayed percentage.
- Outlook/SMTP email delivery — in-app notifications only, no send
  channel configured.
- Production-scale database — the entire app is one JSON file
  (`src/lib/db.ts`), by original design ("local storage now, convert
  later"), not sized for "410+ branches, years of monthly data."

---

## Bottom line

The core lifecycle Document 3 describes — registration through
district/HO review, full and partial rectification, cross-period
transfer, closure, dashboards per role, comments, audit trail — is built
and matches the doc closely, and five of the original nine gaps (§4, §5,
§6, §7, §9) are now closed, with real progress on a sixth (§8). What's
left is narrower: a period lifecycle with two fewer stages than proposed
(though it now at least captures a real start/end date-time range, just
not the doc's REPORTING/REVIEW intermediate statuses), no free-text
search, and one workflow return path (the *initial-submission* return,
not the newer rectification-return) that skips a notification hop to the
District Controller.
