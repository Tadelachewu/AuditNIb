# Phase 7 — Transfer Engine, Evidence, Comments, Notifications, Reports, and the Remaining Dashboards

Phase 6 shipped the full Findings workflow but deliberately deferred six
things, listed plainly in its own Context section and reflected honestly
in `APP_DOCUMENT.md` §13 and `BRD_COMPLIANCE.md` §5: the Transfer Engine,
real file evidence, threaded comments, notifications, reports/exports, and
the District/HO/Executive dashboards (Branch was the only one wired to
real data). This phase closes every one of them, grounded directly in
`AuditDocs/` rather than invented from scratch — each section below cites
the exact BRD/master-doc passage it implements.

Two infrastructure realities, stated up front rather than discovered
mid-build (both already flagged as open decisions in master.txt §24, not
oversights): there's no cloud object storage and no real SMTP/Outlook
credentials anywhere in this project. So Evidence became a **real** local-
disk file upload (not cloud, not a placeholder) and Notifications became a
**real in-app** notification center (not email) — both genuinely working,
just scoped to what infrastructure actually exists, the same "local now,
swap the implementation later" pattern the whole app already follows for
`db.json` itself.

---

## A. Transfer Engine (BRD §3.7, master.txt §8)

A transfer is a continuation, not a new finding: `transferFinding()`
(`src/lib/findings.ts`) records a `FindingTransfer` row (the outstanding
balance at the moment of transfer, permanently) and then simply moves
`finding.periodId` to the destination period, followed by a normal
`transitionFinding()` into a new `TRANSFERRED` status. "No double
counting" falls straight out of that: every performance/report query
filters by `Finding.periodId`, and a finding only ever has one live value
of it — the source period's queries stop seeing it and the destination
period's start seeing it, automatically, with no separate reconciliation
step.

`POST /api/findings/[id]/transfer` (`findings.transfer`, default-granted
to `DISTRICT_CONTROLLER` per icfms.txt's "Transfer outstanding cases")
requires a destination period that's `OPEN` and different from the
current one, and is only allowed while there's an outstanding balance
(`SENT_TO_BRANCH_MANAGER`, `PARTIALLY_RECTIFIED`, or already
`TRANSFERRED`, for a chain of transfers). It deliberately **does not**
call `assertPeriodWritable()` on the *source* period — transfer is the
intended escape hatch once a period locks with the finding still
outstanding, which is exactly why `rectify`'s `RECTIFIABLE_STATUSES` gained
`TRANSFERRED`: work continues in the new period without any extra step.
`finding.createdAt` is never touched by a transfer, so `caseAgeDays()`
(shown on the finding detail page) always reflects the true age since
original registration, not since the last transfer.

## B. Real evidence file upload (BRD §3.3/§3.5, master.txt §12/§15/§16)

Files land on local disk under `data/uploads/<uuid>.<ext>` — already
covered by the existing `/data/` `.gitignore` rule, same as `db.json`.
`POST /api/findings/[id]/evidence` uses Next.js's native
`request.formData()` (no new multipart-parsing dependency), enforces an
allow-list of extensions/MIME types (PDF, PNG, JPG, XLSX, DOCX, CSV), a
10 MB cap, and always writes a **server-generated** filename — never the
user-supplied one — to rule out path traversal (master.txt §16's "secure
attachment validation and access controls"). `GET .../evidence/[evidenceId]`
streams the file back after the same `requirePermission` +
`assertFindingInScope` check every other route uses. Listing evidence
only requires `findings.view` (so a reviewer without upload rights can
still see what's attached); uploading requires `findings.evidence`,
granted to `BRANCH_CONTROLLER`/`BRANCH_MANAGER` per icfms.txt's explicit
"upload optional evidence" line.

## C. Threaded comments (BRD §3.11, proposal.txt §6)

One level of replies — top-level comments plus replies-to-a-comment —
enough for real reviewer discussion without recursive-thread UI
complexity the docs never ask for; the API rejects a reply whose parent is
itself a reply (`400`, verified live). `findings.comment` is granted to
`BRANCH_CONTROLLER`, `BRANCH_MANAGER`, `DISTRICT_CONTROLLER`,
`DISTRICT_DIRECTOR`, and `HO_CONTROLLER` — **not** `EXECUTIVE_READONLY`
(verified: an executive's comment attempt returns `403`). Granting it to
`DISTRICT_DIRECTOR` specifically closes the exact gap `BRD_COMPLIANCE.md`
had flagged: proposal.txt §6 says *"District Directors shall have view and
comment access"* — comment is the one mutating capability that role gets,
deliberately, on top of the review permissions they still lack.

## D. In-app notifications (BRD §9, master.txt §12)

`src/lib/notifications.ts` exports `notifyUsers()` and
`usersWithFindingsPermission(db, action, { districtId?, branchId? })` —
every ACTIVE user whose role holds `findings.<action>`, narrowed to a
district/branch for DISTRICT/BRANCH-scoped roles but **never** narrowed
for BANK-scoped roles (so a bank-wide HO reviewer is notified regardless
of which district a finding is in). This is reused at every trigger point
master.txt §12 names — *"submit, approve, reject, return, assignment,
rectification, transfer and period events"*:

| Event | Recipients |
|---|---|
| Submit | District reviewers of that district |
| District approve | HO reviewers (bank-wide) |
| District/HO reject or return | The finding's creator |
| HO approve | Branch's rectifiers |
| Finding fully rectified | District/HO closers for that district |
| Transfer | Creator + district's transfer-holders |
| Close | Creator |
| New comment / reply | The comment's parent author + the finding's creator |
| Reporting period lock/unlock | District + HO controllers, bank-wide |

`GET /api/notifications` (mine only, scoped directly to
`recipientUserId` — no page-permission gate, since every logged-in user
has notifications regardless of role), `POST .../[id]/read`, and
`POST .../read-all`. The UI is a bell icon in `Topbar.tsx`
(`NotificationBell.tsx`) with an unread-count badge, a dropdown polled
every 30s (no websocket infrastructure exists elsewhere in the app),
mark-as-read, and click-to-navigate to the underlying finding.

## E. Reports & exports (master.txt §18)

`/reports` (`reports.view`, default-granted to `DISTRICT_CONTROLLER`,
`DISTRICT_DIRECTOR`, `HO_CONTROLLER`, `EXECUTIVE_READONLY` per icfms.txt's
"generate district/executive reports") covers master.txt §18's 14 named
reports as a small number of real, data-backed views rather than 14
separate pages: a **Findings Report** (same scoped+filtered query as the
Findings list) with a real `GET /api/findings/export` CSV download and a
**Print / Save as PDF** button (`window.print()` + a page-scoped
`@media print` stylesheet that hides the sidebar/topbar — a genuine
working PDF export via the browser's own dialog, not a new PDF-rendering
dependency); **Branch/District Performance** (ranked, via the existing
`computePerformance()`); **Category and Risk breakdowns**; and a
**Transfers** list (only meaningful once §A exists). Reporting-period
status and the audit trail are already real, existing admin pages —
linked from `/reports` rather than duplicated.

## F. District, HO, and Executive dashboards (master.txt §10)

Same widget pattern `BranchDashboard.tsx` established in Phase 4/6 — KPI
cards, category totals, work queue, recent activity, all computed from
real `Finding` data with the same `computePerformance()` and
`queueStatusesForSession()` helpers — extended to `DistrictDashboard.tsx`
(district aggregate + branch ranking), `HODashboard.tsx` (bank + district
aggregates, district ranking, IC-vs-IA source comparison, reporting-period
status), and `ExecutiveDashboard.tsx` (concise bank-wide KPIs, top-district/
branch rankings, a high/critical-risk outstanding-findings exceptions
count — matching `EXECUTIVE_READONLY`'s view-only permission set rather
than the full operational widget set the other three carry). Two new
shared components, `RiskDistribution.tsx` and `MonthlyTrend.tsx`, replace
the `EmptyWidget` placeholders on **all four** dashboards including
Branch — a real per-`riskLevel` breakdown and a lightweight CSS-bar
monthly performance trend, both placeholders specifically because Finding/
period-history data didn't exist before Phase 6.

`src/app/(app)/dashboard/page.tsx`'s dispatch now checks
`EXECUTIVE_READONLY` first (it's `BANK`-scoped like `HO_CONTROLLER` but
gets its own concise view), then `orgScope` (`BRANCH`/`DISTRICT`/`BANK`)
for everyone else, each gated by its own `<x>-dashboard.view` permission
with the same "ask an administrator" fallback Branch already established
— so an admin can revoke a role's dashboard access without touching its
org scope, same as every other page in the app (PHASE5.md's standing
rule).

---

## Verified end-to-end (live, not just reviewed)

Ran against a running server with the seeded accounts, no shortcuts:

1. **`branch.controller`** registers and submits a 3-case / ETB 45,000
   "Other Case" finding in `2026-08`. District-approve → HO-approve →
   status `SENT_TO_BRANCH_MANAGER`.
2. Admin **locks** `2026-08` mid-workflow. `branch.manager`'s rectify
   attempt correctly returns `409` (period locked) — confirming the
   Transfer Engine is genuinely necessary here, not decorative.
3. **`district.controller`** transfers the finding into the new open
   period `2026-09` with a reason. Verified via `GET /api/findings?periodId=`:
   the finding is now **absent** from `2026-08`'s results and **present**
   in `2026-09`'s — no double-count, no manual bookkeeping.
4. **`branch.manager`** fully rectifies (3 cases / ETB 45,000) in the new
   period → `RECTIFIED`; the district controller receives a `RECTIFIED`
   notification. **`district.controller`** closes → `CLOSED`; the
   original creator (`branch.controller`) receives a `CLOSED` notification.
5. Confirmed all nine notification triggers fired correctly across the
   run: `SUBMITTED`, `DISTRICT_APPROVED`, `HO_APPROVED`, `PERIOD_LOCKED`,
   `TRANSFERRED`, `RECTIFIED`, `CLOSED`, plus `COMMENT` (below) —
   each landing on the right recipient, each mark-as-read/read-all round
   trip verified.
6. **Evidence**: uploaded a `.csv` (accepted), a `.txt` (rejected — 400,
   unsupported type), a file just over 10 MB (rejected — 400, exceeds
   limit; the runtime's own body parser turned out to reject a well-formed
   upload just past 10 MB before this route's own size check could even
   run, so the catch path was corrected to report "exceeds the 10 MB
   limit" instead of a misleading "no file provided"). Downloaded the
   accepted file back — byte-for-byte identical (`diff` clean) — and
   confirmed `HO_CONTROLLER` (no upload permission) can still list it via
   `findings.view` alone.
7. **Comments**: `district.controller` posts a top-level comment;
   `district.director` (comment-only role) replies successfully; a
   reply-to-that-reply is rejected (`400`, one level only); `executive`'s
   comment attempt is rejected (`403`) while their `GET` still succeeds
   (`200`) — view-only, as designed.
8. **CSV export**: `GET /api/findings/export` returns a header row plus
   exactly the filtered rows also shown on `/reports`, matching the
   Findings Report table field-for-field.
9. **Playwright screenshot pass** across `branch`, `district`, `ho`, and
   `executive` dashboards, `/reports`, the Findings list, and the finding
   detail page (with its new Transfer/Evidence/Comments cards, Transfer
   History, and updated Rectification/Transition ledgers all rendering
   correctly) — **zero browser console errors** on every screen.

`npm run lint` and `npm run build` both clean throughout.

---

## What's still deferred

Everything in `BRD_COMPLIANCE.md` §5 as of this phase: the Excel
Migration Toolkit (master.txt §22), the Knowledge Base module (icfms.txt
§8), configurable per-source workflow routing (master.txt §2),
scoring-adjustment integration into the computed performance figure
(master.txt §9), and Outlook/SMTP email delivery for notifications (the
in-app center now exists; email transport still has no credentials to
send through). None of these were in this phase's scope — see
`BRD_COMPLIANCE.md` for the full requirement-by-requirement picture, and
`APP_DOCUMENT.md` for the business-facing walkthrough of everything this
phase added.
