# How the System Works — Current State

A single top-level reference for how ICFMS (NIB Control360) actually
behaves today, verified against the running code (not a plan, not a
memory of an earlier phase). Where a topic already has a deep-dive
document, this page summarizes it and links out rather than duplicating
it — see §13.

**Why this document exists**: `FINDINGS_WORKFLOW.md` was written before
the Return-for-Correction / Resubmit feature landed and still shows only
13 states — it's missing `RECTIFICATION_RETURNED` entirely. This page is
the up-to-date picture; treat `FINDINGS_WORKFLOW.md` §1's state diagram as
superseded by §2 below.

---

## 0. Architecture, in one paragraph

Next.js App Router, Server Components reading a **JSON-file database**
(`src/lib/db.ts`, `data/db.json`) via `readDb()`/`writeDb()`/`updateDb()`
— there is no Prisma, no SQL, despite what generic Next.js boilerplate
might lead you to expect. `normalizeDb()` runs on every read and
back-fills any field a newer version of the schema added, so old
`data/db.json` snapshots keep working without a migration step. Access
control is **permission-driven**, not role-hardcoded: every route calls
`requirePermission("<resource>.<action>")`, and `hasPermission()` checks
the caller's *role's* permission set — a brand-new role picks up correct
behavior automatically, with no code changes, as long as its permissions
are set correctly at `/admin/roles`.

---

## 1. Roles & organization

| Role | Org scope | Singleton per branch? | Core ability |
|---|---|---|---|
| `ADMIN` | Bank-wide | — | Everything, including Roles & Permissions |
| `HO_CONTROLLER` | Bank-wide | — | HO review, Internal Audit entry, close, transfer-adjacent reporting |
| `DISTRICT_CONTROLLER` | District | — (multiple allowed per district) | District review, close, transfer, period lock for their district |
| `DISTRICT_DIRECTOR` | District | — | **View + comment only** — cannot modify findings or scores (proposal.txt §6) |
| `BRANCH_CONTROLLER` | Branch | ✅ one per branch | Register/submit findings, verify rectifications |
| `BRANCH_MANAGER` | Branch | ✅ one per branch | Record rectification / corrective action |
| `BRANCH_SUB_MANAGER` | Branch | ✅ one per branch | **Identical permission set to Branch Manager** — a deputy, not a lesser role. Not BRD-mandated (`isSystem: false`), so an admin can delete the role outright if unwanted, unlike the core seven. |
| `EXECUTIVE_READONLY` | Bank-wide | — | Read-only, every `.view` permission, nothing else |

All of this is admin-editable at `/admin/roles` — the table is the seeded
default, not a hard rule. `RoleDefinition.branchSingleton` +
`assertBranchRoleAvailable()` (`src/lib/org.ts`) enforces "one per branch"
for Controller/Manager/Sub-Manager at user create/edit time; District
Controller has no such constraint, so a district can have several.

Every permission check happens **server-side**, independent of what the
UI shows or hides — a hidden button is a convenience, never the actual
boundary. Every findings route also re-checks org scope
(`assertFindingInScope`): a district/branch-scoped user cannot act on, or
even see, a finding outside their own org unit, regardless of which
permissions their role otherwise holds.

---

## 2. The Finding lifecycle — 14 states

```
DRAFT ──submit──> SUBMITTED ──auto──> DISTRICT_REVIEW
                                            │
                        ┌───────────────────┼───────────────────┐
                     approve              reject               return
                        │                   │                    │
                        v                   v                    v
                 DISTRICT_APPROVED      REJECTED              RETURNED
                        │               (terminal)         (editable, resubmit
                     auto│                                  re-enters review)
                        v
                    HO_REVIEW
                        │
        ┌───────────────┼───────────────────┐
     approve           reject              return
        │                │                    │
        v                v                    v
   HO_APPROVED        REJECTED            RETURNED
        │auto        (terminal)
        v
SENT_TO_BRANCH_MANAGER
        │
        │  ┌─────────────────────────────────────────────┐
        │  │  while outstanding balance > 0, at any point: │
        │  │  TRANSFER ──> TRANSFERRED (periodId changes)  │
        │  │  loops back into rectification in new period  │
        │  └─────────────────────────────────────────────┘
        │
   rectify (partial or full)
        │
        ├──> PARTIALLY_RECTIFIED ──rectify (remaining)──> RECTIFIED
        │
        └──> RECTIFIED  (can happen on the very first call, if the
                          whole balance is recorded at once)

  From PARTIALLY_RECTIFIED, RECTIFIED, or TRANSFERRED, a District/HO
  Controller doing the close-verification can instead send it back:

        return-rectification (mandatory reason)
                        │
                        v
              RECTIFICATION_RETURNED
                        │
        ┌───────────────┴───────────────┐
   rectify again (adds numbers)   resubmit (no new numbers,
        │                          e.g. fixed evidence/note)
        └───────────────┬───────────────┘
                         v
        re-enters PARTIALLY_RECTIFIED / RECTIFIED
        (recomputed from the finding's unchanged totals)

RECTIFIED ──close (verify)──> CLOSED (terminal)
```

| # | Status | Kind | Meaning |
|---|---|---|---|
| 1 | `DRAFT` | resting, editable | Registered, not yet submitted |
| 2 | `SUBMITTED` | momentary | Fired on Submit, immediately followed by auto-transition — its own transition-history row, not skipped |
| 3 | `DISTRICT_REVIEW` | resting | District Controller's queue |
| 4 | `DISTRICT_APPROVED` | momentary | Auto-followed by `HO_REVIEW` |
| 5 | `HO_REVIEW` | resting | HO Controller's queue |
| 6 | `HO_APPROVED` | momentary | Auto-followed by `SENT_TO_BRANCH_MANAGER` |
| 7 | `SENT_TO_BRANCH_MANAGER` | resting | Both approvals done, waiting on rectification |
| 8 | `PARTIALLY_RECTIFIED` | resting | Cases *or* amount still short of the total |
| 9 | `RECTIFICATION_RETURNED` | resting | Sent back to the branch because the *recorded rectification itself* had a problem (§3) |
| 10 | `RECTIFIED` | resting | Cases *and* amount both fully covered; awaiting independent verification |
| 11 | `TRANSFERRED` | resting | Outstanding balance carried into a later period; rectification continues there |
| 12 | `REJECTED` | **terminal** | Rejected at district or HO review. No path back. |
| 13 | `RETURNED` | resting, editable | Sent back *before rectification ever started* (district/HO review stage); resubmit re-enters `DISTRICT_REVIEW` |
| 14 | `CLOSED` | **terminal** | Verified and closed |

**`REJECTED` vs `RETURNED` vs `RECTIFICATION_RETURNED` — three different
"sent back" states, not one:**

| | Stage | Triggered by | Comes back how | Terminal? |
|---|---|---|---|---|
| `REJECTED` | District/HO review | District or HO Controller | Never — no further transitions exist | ✅ Yes |
| `RETURNED` | District/HO review | District or HO Controller | Editable again (`SUBMITTABLE_STATUSES` includes it); resubmit re-enters `DISTRICT_REVIEW` | No |
| `RECTIFICATION_RETURNED` | After rectification was recorded | District/HO Controller doing close-verification | Branch rectifies again, or explicitly resubmits; re-derives `PARTIALLY_RECTIFIED`/`RECTIFIED` | No |

This is exactly why `FindingStatusDistribution` (the dashboard donut, §10)
keeps `Rejected` and `Returned` as two separate slices rather than one —
merging them hides the difference between "permanently rejected" and
"still alive, needs a fix."

---

## 3. Return-for-Correction and Resubmit

`POST /api/findings/[id]/return-rectification`, `{ reason }` (min 5
chars) — gated by `findings.close` (the same authority as closing itself,
since this is "the other half of the same verify duty"). Accepted from
`PARTIALLY_RECTIFIED`, `RECTIFIED`, or `TRANSFERRED` — **not** limited to
partial rectifications. All three represent "a rectification was recorded
and something about it is wrong" (wrong amount, wrong case, insufficient
evidence), regardless of whether the recorded rectification happened to
be partial, full, or already carried into a new period by a transfer.

Effect: status → `RECTIFICATION_RETURNED`. Blocks close, partial-close,
and transfer until addressed. Notifies every `findings.rectify` holder at
that branch (Branch Manager and Branch Sub-Manager both, since they share
an identical permission set) with the Controller's name and reason.

**Two ways back out**, both landing on the same recomputed status:

- **Rectify again** (`POST .../rectify`) — `RECTIFICATION_RETURNED` is in
  `RECTIFIABLE_STATUSES`, so recording more `rectifiedCases`/
  `rectifiedAmount` moves it forward the normal way.
- **Resubmit** (`POST .../resubmit-rectification`, no body) — for when the
  correction didn't involve any new numbers (e.g. it was an evidence or
  note problem). Re-derives `RECTIFIED` vs `PARTIALLY_RECTIFIED` from the
  finding's *existing, unchanged* totals and notifies close-holders again.

---

## 4. Rectification & Closure — the arithmetic

Full deep-dive, worked examples, and the itemized-case variant live in
[RECTIFICATION.md](RECTIFICATION.md). The short version:

- `finding.rectifiedCases`/`rectifiedAmount` are running totals, updated
  by every accepted `POST .../rectify` call, each of which also appends a
  permanent `RectificationEntry` ledger row.
- Status becomes `RECTIFIED` only when **both** dimensions (cases *and*
  amount) meet or exceed the total — falling short on either keeps it
  `PARTIALLY_RECTIFIED`.
- A District/HO Controller (never the Branch Manager who did the fixing —
  `findings.close` isn't in their permission set) can close whatever's
  currently rectified-but-unclosed at any time, via a **second, parallel
  counter pair** (`closedCases`/`closedAmount`) — the still-unrectified
  remainder stays open and untouched. Status only reaches `CLOSED` once
  `closedCases`/`closedAmount` themselves reach the finding's full total.

---

## 5. Case-level itemization (`FindingCase`) — optional

A finding can, at registration, list per-case amounts instead of just one
total (`caseAmounts: [15000, 10000, 20000]`, must sum to `amount` and have
exactly `caseCount` entries) — this creates one `FindingCase` row per
case, each independently `OUTSTANDING`/`RECTIFIED`.

**When it exists**, `POST .../rectify` requires picking specific
still-`OUTSTANDING` case IDs (`caseIds: [...]`) instead of typing a
count/amount — "rectify only Case 2" becomes a stored, traceable fact
(which case, by whom, when) rather than a free-text note that merely
happens to add up. `rectifiedCases`/`rectifiedAmount` are then derived
from the selected cases' own amounts, not entered separately.

**When it doesn't exist** (the default — `caseAmounts` was never
supplied), rectification is the original plain-number flow, completely
unchanged. Itemization is opt-in per finding, not a schema requirement.

---

## 6. Transfer Engine — manual and automatic

`POST /api/findings/[id]/transfer`, `{ toPeriodId, reason }` (District
Controller) — from `SENT_TO_BRANCH_MANAGER`, `PARTIALLY_RECTIFIED`, or
`TRANSFERRED` (chainable). **Not blocked** by the source period being
locked — that's the intended escape hatch once a period locks with a
finding still outstanding.

What happens (`transferFinding()`): a permanent `FindingTransfer` row is
written (outstanding cases/amount at that moment, snapshotted `originalCaseCount`/
`originalAmount`/`caseAgeAtTransferDays`, `method: "MANUAL"`), then
`finding.periodId` is reassigned and status → `TRANSFERRED`.
`finding.createdAt` is never touched — case age is always measured from
original registration. No new `Finding` row is ever created — this is a
continuation, never a duplicate.

**Configurable Automatic Transfer** (`Settings.autoTransferOnLock`): the
bank-wide "is this allowed at all" switch — when enabled, the Lock dialog
on Reporting Periods shows the locking user a preview (outstanding case
count + destination period code, from `outstandingTransferPreview()`) and
asks them to opt in for that specific lock, via a checkbox. It is never
silent: locking never transfers anything unless the locking user checks
that box, which sends `transferOverdueCases: true` on
`PATCH /api/admin/reporting-periods/[id]`. Only then does it sweep every
still-outstanding finding in the period (`SENT_TO_BRANCH_MANAGER`,
`PARTIALLY_RECTIFIED`, `TRANSFERRED`) into the next `OPEN` period, tagged
`method: "AUTOMATIC"` — same underlying `transferFinding()` mechanism as
a manual click, just bulk-triggered by the confirmed lock action. A
finding already manually transferred earlier that period is naturally
skipped (it's no longer in that period by the time the sweep runs).

**Period-scoped performance after a transfer** doesn't rely on
`finding.periodId` alone — see `findingCasesEligibleInPeriod()` and
[RECTIFICATION.md §9](RECTIFICATION.md#9-period-performance-after-a-transfer)
for the segment-based walk that credits each period only the cases/
rectification that actually happened while the finding belonged to it.

---

## 7. Reporting Periods

Created at `/admin/reporting-periods` with a full **date-time range**
(`startsAt`/`endsAt`, to the minute) rather than just a year/month picker
— `year`/`month`/`code` are derived from `startsAt`, one source of truth
instead of three fields that could disagree.

**Locking** (`PATCH .../reporting-periods/[id]`, requires a reason,
audit-logged) blocks every mutating action against an existing finding in
that period — edit, delete, submit, district review, HO review, rectify —
with `409`. Two deliberate exceptions: **Transfer** (§6, the designed way
forward) and **Close** (verifying/closing doesn't change any reportable
total, so it isn't what locking protects against). Locking/unlocking
notifies every district-review and rectify holder bank-wide, and — if the
locking user opted in via the Lock dialog's transfer prompt (§6) — runs
the automatic sweep in the same transaction, audit-logged as its own
`AUTO_TRANSFER` entry.

---

## 8. Performance Scoring

`computePerformance(db, scope)` (`src/lib/findings.ts`):

```
Performance % = Rectified Eligible Cases ÷ Total Eligible Cases × 100
```

"Eligible" is never hardcoded — it's whatever the **active** `ScoringRule`
currently defines: `rule.categories` (which classified-case categories
count) and `rule.sources` (which sources count), both admin-editable at
`/admin/scoring-rules`, versioned (each activation creates a new
version, the prior one deactivated, never edited in place). `REJECTED`
findings are always excluded from the candidate pool regardless of the
rule. Without a `periodId` in scope, it's a lifetime figure (straight off
`caseCount`/`rectifiedCases`); with one, it uses the transfer-aware
per-period eligible-cases walk (§6). Returns `null` (rendered as `--`) when
there's no active rule or no eligible cases at all — never a fabricated
`0%`.

---

## 9. Evidence & Comments

**Evidence** (`POST/GET /api/findings/[id]/evidence`): real files on
local disk (`data/uploads/`), allow-listed by MIME to
PDF/PNG/JPG/XLSX/DOCX/CSV, 10 MB cap, server-generated filenames (never
the client's own — rules out path traversal). The declared `Content-Type`
is **not trusted on its own** — `evidenceContentMatchesType()` checks the
actual file bytes (magic numbers) match the claimed type before it's ever
written to disk, closing a MIME-spoofing gap (upload a `.exe` renamed
`.pdf` with a forged Content-Type header). Uploading needs
`findings.evidence`; **viewing/downloading only needs `findings.view`** —
a reviewer without upload rights can still see attachments.

**Comments carry their own optional attachment** via the same evidence
endpoint (an added `commentId` field) — gated by `findings.comment`
instead of `findings.evidence`, since attaching to your own comment is
part of the comment action itself (this is why District Director/District
Controller can attach a file to a comment despite holding no
`findings.evidence` permission at all).

---

## 10. Notifications — every trigger

| Event | Recipients |
|---|---|
| Submit | District-review holders in that district |
| District approve | HO-review holders, bank-wide |
| District/HO reject or return | The finding's creator |
| HO approve | Rectify-holders at that branch |
| Rectify (partial or full) | The *other* rectify-holder(s) at that branch (excludes whoever just recorded it) |
| Fully rectified | Close-holders in that district |
| **Return-for-Correction** | Rectify-holders at that branch, with the Controller's name + mandatory reason |
| **Resubmit-rectification** | Close-holders in that district |
| Transfer | Creator + district's transfer-holders |
| Close | Creator |
| New comment / reply | Parent comment's author + creator (excludes whoever just posted) |
| Reporting period locked/unlocked | District- and HO-review holders, bank-wide |
| **Rectification reminder** (time-based) | Rectify-holders at that branch, once a still-open finding has sat unchanged past `Settings.rectificationReminders.thresholdDays` |

The reminder row is the one **time-based** trigger in the system — there's
no cron/scheduler infrastructure, so `checkRectificationReminders()` is
checked lazily off the existing 30-second notification-bell poll,
throttled to at most one real scan per hour
(`REMINDER_SCAN_COOLDOWN_MS`) via `Settings.rectificationReminders.lastCheckedAt`,
and per-finding via `Finding.lastReminderAt` so the same finding isn't
re-reminded inside the same threshold window. Everything is in-app only
(bell icon) — no email/Outlook delivery exists.

---

## 11. Dashboards

Four org-scoped dashboards (`BranchDashboard`, `DistrictDashboard`,
`HODashboard`, `ExecutiveDashboard`), each reading `db` server-side and
gated by the session's org scope. All four now report **two units side by
side wherever it matters** — a "finding" (the record) and its underlying
"cases" (`Finding.caseCount`/`rectifiedCases`) diverge exactly when a
finding bundles more than one incident, so both are shown rather than
picking one:

| KPI pair | What it counts |
|---|---|
| Total Findings / Total Cases | Finding records vs. sum of `caseCount` |
| Rectified Findings / Rectified Cases | Records at `RECTIFIED`/`CLOSED` vs. sum of `rectifiedCases` |
| Transferred Findings / Transferred Cases | Distinct findings with a transfer out of period vs. sum of `FindingTransfer.casesTransferred` |

(The old HO Dashboard "Transferred Cases" label was actually counting
distinct findings, not cases — fixed alongside adding the real per-case
figure.)

**Chart tier structure** (KPIs → trend+composition → ranking → detailed
analysis), all hand-rolled SVG (no charting library was pre-existing, and
none was added — see `src/components/dashboard/charts/`):

- `TrendChart` — Monthly Performance Trend, a real line chart (trend over
  time), shared by all four dashboards.
- `FindingStatusDistribution` (`DonutChart`) — part-to-whole lifecycle-stage
  composition across every finding in scope (Draft/Review, In Progress,
  Rectified-awaiting-close, Transferred, Closed, Returned, Rejected — kept
  separate per §2's table, not merged).
- `RiskDistribution` (`StackedBarChart`) — open findings by risk tier.
- `RankedBarChart` — Branch/District performance ranking, present on all
  three of Branch, District, and HO Dashboards (see below), gated by
  `Settings.rankingVisibility`.
- `StackedBarChart` (Source Comparison) — Internal Control vs. Internal
  Audit, by case count and by amount (HO Dashboard).

### Performance Ranking Visibility — two independent layers

`Settings.rankingVisibility.branches`/`.districts` (`/admin/settings`)
controls whether a ranking/comparison table is shown at all — but *which*
org units ever appear together in one is a separate, structural boundary
that the toggle can't cross:

| | Org-scope boundary (always on, not configurable) | `rankingVisibility` toggle (admin-configurable) |
|---|---|---|
| What it does | Bounds *which* units can ever appear in the same ranking table | Decides whether that table is shown at all, or hidden down to just your own number |
| Can it be changed? | No — a Branch Dashboard's queries never read another district's branches, full stop | Yes, per-branches / per-districts, at `/admin/settings` |
| Effect when off | N/A | Each dashboard falls back to showing only its own unit's performance number |

Concretely, **when `rankingVisibility.branches` is enabled**:
- **Branch Dashboard** shows *Branch Ranking* — every branch **in the
  viewer's own district**, so a Branch Manager/Controller/Sub-Manager can
  see how they compare to their peer branches, for competitive visibility.
- **District Dashboard** shows the same *Branch Ranking* (branches in that
  Controller's own district).
- **HO Dashboard** shows *Branch Comparison*/*Top-/Bottom-Performing
  Branches*, bank-wide (every branch, every district).

**When `rankingVisibility.districts` is enabled**:
- **District Dashboard** shows *District Ranking* — every district
  bank-wide, so a District Controller/Director can see how their district
  compares to every other district.
- **HO Dashboard** shows the same *District Ranking*, bank-wide.

In no configuration does a Branch Dashboard ever show another district's
branches — the peer group for branch-level competitive visibility is
always "my own district," matching what the District Controller already
sees for the same district. District-level competitive visibility, by
contrast, is deliberately bank-wide (every district), since districts sit
one level below the bank-wide HO view that already aggregates all of
them.

---

## 12. Reports

`/reports` — filters compose (all server-side, no client-side
re-filtering): reporting period, district, branch, source, category,
risk, status, **and a time-range filter** (Today / This Week / This Month
/ Custom `dateFrom`–`dateTo`) applied against each finding's own
`findingDate` — distinct from the period dropdown, which buckets by the
monthly reporting period rather than a free date range. Exports to CSV
(`/api/findings/export`, same filter querystring) and print-to-PDF
(browser print, a `no-print` CSS rule hides chrome).

---

## 13. Where to go deeper

| Topic | Document |
|---|---|
| Full permission table, registration fields, worked end-to-end trace, BR-WF-001–020 cross-check | [FINDINGS_WORKFLOW.md](FINDINGS_WORKFLOW.md) *(state diagram there is stale — this page's §2 is current)* |
| Rectification/Closure arithmetic, ledger vs. running total, itemized-case worked example | [RECTIFICATION.md](RECTIFICATION.md) |
| BRD clause-by-clause compliance | [BRD_COMPLIANCE.md](BRD_COMPLIANCE.md) |
| Test scenarios | [SCENARIOS.md](SCENARIOS.md) |
| Gaps found against Document_3 and their fix status | [MISSING_FUNCTIONALITY.md](MISSING_FUNCTIONALITY.md) |
