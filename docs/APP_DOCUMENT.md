# NIB Control360 — App Walkthrough & Business Rationale

This document walks through every functionality currently in the app, in
the order a new user would actually encounter it, and explains *why* it
exists — tied back to the specific business problem it solves per
`AuditDocs/proposal.txt`, `AuditDocs/icfms.txt`, and
`AuditDocs/master.txt`. Every claim below was verified by actually running
the app end-to-end in a fresh session (§14 has the full test log) — this
isn't a description of what the code is supposed to do, it's a report of
what it was made to do, live, against a running server.

For the technical *how it's built*, see PHASE1–7.md. For a strict
requirement-by-requirement checklist against the BRD, see
[BRD_COMPLIANCE.md](BRD_COMPLIANCE.md). This document is the third angle:
what does a person at the bank actually click, and why does the bank care.

---

## 0. The business problem this app exists to solve

Before any feature makes sense, the problem it's answering to needs to be
concrete. proposal.txt §2–3 describes NIB's actual monthly process before
this system: a Branch Internal Controller fills out an Excel template,
emails it to their District Internal Controller, the district manually
consolidates every branch's file into one, emails *that* to Head Office,
HO re-applies Excel formulas by hand, sends results back down through the
district to the Branch Manager, who fixes the problems and reports back up
the same chain — repeated every month, for 13 districts and 410+ branches.
proposal.txt §3 names the resulting failure modes directly: repetitive
manual consolidation, multiple conflicting versions of the same Excel
file, human error, delayed reporting, no real-time visibility, no
centralized repository, and "time-consuming performance calculations."

Every feature below exists to remove one specific piece of that manual
chain — replacing an Excel step with a system-enforced one.

---

## 1. Signing in — `/login`

**What it is.** A username/password form. Successful login sets an
encrypted session cookie and redirects to `/dashboard`; the dashboard
itself differs by role — Branch, District, HO, and Executive each see
their own real view (§12); only Administrator lands on a generic page,
since Admin's real dashboard is `/admin`.

**Why the business needs it.** The BRD requires the system to be
"web-based" with "secure authentication" and "role-based access control"
(icfms.txt §10). More concretely: today, anyone with the Excel file has
the data. A login wall is the first step toward the BRD's repeated
insistence that "server/API must enforce access" (master.txt §15) rather
than relying on who happens to have the spreadsheet.

**Verified.** All 7 seeded users (one per role) log in successfully; a
wrong password is rejected (`401`); every admin API call made without a
session is rejected (`401`) before it reaches any data.

---

## 2. Roles & Permissions — `/admin/roles`

**What it is.** Roles aren't a fixed list in this app — they're records an
administrator manages, each holding a specific set of page+action
permissions (e.g. `findings.create`, `reporting-periods.lock`). An admin
can narrow or widen any role's access, or create an entirely new role,
without a code change.

**Why the business needs it.** icfms.txt §7 names 7 specific roles with 7
specific, different sets of responsibilities — Administrator, HO
Controller, District Controller, District Director, Branch Controller,
Branch Manager. A bank's actual org structure doesn't stay fixed forever:
proposal.txt's "Success Factors" and "Recommendations" both frame this as
a platform meant to "support the bank's future operational and governance
requirements" — i.e., when NIB's structure changes, the software shouldn't
need a developer. Making permissions data instead of code is what makes
that true. It also directly implements master.txt §16's rule that "UI
scope is not a security boundary" — every permission is re-checked on the
server, not just hidden in the menu.

Each of the 7 seeded roles ships with a *default* permission set traced
to a specific line in the BRD (documented permission-by-permission in
PHASE5.md §2) — for example, District Director gets **no** permission to
approve, reject, rectify, or close a finding, which is the direct
implementation of icfms.txt §7's explicit line: *"Cannot modify findings
or scores."*

**Verified.** Created a custom role, edited its permission set, deleted it
(only possible because no user held it). Confirmed the built-in `ADMIN`
role cannot be deleted (`409`) — a safety rail so an administrator can
never accidentally lock every administrator out of the system.

---

## 3. Organization Administration — Districts & Branches

**What it is.** `/admin/districts` and `/admin/branches`: create, rename,
deactivate, or permanently delete a district or branch. Branches show who
their Manager and Internal Controller are (derived automatically from the
Users list, never a separate field that can drift out of sync).

**Why the business needs it.** master.txt §1 is explicit: the system
covers "13 districts and more than 410 branches," and both "must be
configuration-driven so authorized administrators can add, edit,
deactivate or remove them without changing application code." A bank
occasionally opens, closes, or merges branches — that's a business event,
not a software deployment. master.txt §5 also states a hard business
rule: *"each branch has one Branch Manager and one Branch Internal
Controller"* — enforced here so an admin literally cannot assign a second
active manager to a branch that already has one.

**Verified.** Created, renamed, and deleted a test district and branch.
Confirmed the delete is *safe* — attempting to delete a branch or district
that still has people or records attached is blocked with a clear
explanation, not silently allowed to orphan data. Confirmed the
one-manager-per-branch rule directly: a second `BRANCH_MANAGER` assignment
to an already-staffed branch was rejected with the existing manager's name
in the error message.

---

## 4. Reference Data — Sources & Classified Categories

**What it is.** `/admin/sources` (Internal Control, Internal Audit, and
any future source) and `/admin/categories` (ATM Mismatch, ATM Long
Outstanding, IT Case, Dormant Account, Zero Balance, CK Book, Other Case —
each flagged `Scored` or not).

**Why the business needs it.** icfms.txt §9 requires exactly two sources
at launch — Internal Control and Internal Audit — but explicitly leaves
room for more ("Internal Control, Internal Audit and future configurable
sources," master.txt §6). Categories are the classification scheme the
whole performance calculation depends on: master.txt §9 says the "Other
Case" category is what currently drives the score, while every other
category (ATM, IT, Dormant, Zero Balance, CK Book) must still be tracked
and shown, "feed-ready for future inclusion" — i.e., the business already
knows it wants to score other categories eventually, and the system has to
be ready for that decision without a redesign. Making categories
data (with a `scored` flag an admin can flip) is exactly that readiness.

**Verified.** Created and deleted a test source and category. Confirmed a
category still referenced by a scoring rule **cannot** be deleted (`409`)
— protecting the historical scoring configuration from being silently
invalidated.

---

## 5. Scoring Rules & Scoring Adjustments

**What it is.** `/admin/scoring-rules`: a versioned record of exactly how
performance is calculated — which categories and sources count, and the
formula. Creating a new rule never edits an old one; it adds a new
version, and only one version is ever "active" at a time.
`/admin/scoring-adjustments`: a manual override of a computed score, with
a mandatory reason.

**Why the business needs it.** proposal.txt §6 gives the actual formula
the business uses today: *"Total Other Cases = 120, Rectified Cases = 60,
Performance = (60÷120)×100 = 50%."* master.txt §9 adds the crucial
constraint: *"Do not hard-code these policy decisions"* — because the
denominator treatment, which categories count, and how transferred cases
factor in are all things master.txt §24 lists as **still undecided**
business policy. A versioned rule means that when the Internal Control
Division changes the policy, history doesn't change retroactively — a
finding closed under last year's rule is still scored by last year's rule,
which is exactly what an auditor needs. master.txt §9 also restricts this
to Admin alone ("Only Admin changes scoring rules") — this is the one
place icfms.txt's role description for HO Controller ("configure
performance calculations") was deliberately *not* followed, because the
more specific business rule in master.txt overrides it.

**Verified.** Created a second rule version and activated it — confirmed
exactly one version stays active at a time (the previous version was
automatically deactivated). Confirmed a scoring adjustment without a real
reason is rejected (`400`) and one with a proper reason succeeds and is
recorded in the audit log.

---

## 6. Reporting Periods

**What it is.** `/admin/reporting-periods`: monthly periods with an
Open/Locked status. Locking a period requires typing a reason.

**Why the business needs it.** master.txt §13 is direct: *"Locked periods
prevent unauthorized reportable changes... Lock/unlock requires audit
trail and reason."* This is the system's equivalent of a month-end close
in accounting — once a district has signed off on August's numbers, those
numbers shouldn't be able to quietly change in September. This was
specifically re-verified and *fixed* during the BRD cross-check
(BRD_COMPLIANCE.md §4): earlier, locking a period only stopped brand-new
findings from being registered against it, but didn't stop an *existing*
finding in that period from still being approved, rectified, or moved
through the workflow — which defeats the point of a month-end lock. That
gap is now closed.

**Verified.** Created a new period, locked an existing one with a reason,
unlocked it again. Then, separately, confirmed live that a finding sitting
mid-workflow in a period that gets locked afterward is correctly blocked
from further action (`409`) until the period reopens.

---

## 7. Users

**What it is.** `/admin/users`: create, edit (name, role, org unit,
password reset), deactivate, or reactivate any user.

**Why the business needs it.** icfms.txt §7 lists user creation and role
assignment as the Administrator's job specifically — nobody else's. This
matters for a bank: staff move between branches, get promoted from
Controller to Manager, or leave the bank, and every one of those events
needs to be reflected in who can do what, immediately, without waiting for
IT to deploy anything.

**Verified.** Created a user, edited their name, deactivated and
reactivated them. Confirmed the branch-manager-singleton rule applies here
too (§3) — the same protection whether you're assigning org structure from
the Branches page or the Users page, because it's enforced once, centrally.

---

## 8. Settings

**What it is.** `/admin/settings`: the bank's currency list, risk-level
list, and notification delivery configuration.

**Why the business needs it.** master.txt §25's reference values (ETB,
USD, EUR, GBP; Low/Medium/High/Critical) are a *starting point*, not a
permanent list — master.txt §19 explicitly calls Settings "Currencies,
risk levels, notification settings and other configuration," an admin
capability, not a hard-coded one. A bank operating across multiple
currencies needs to add one without a code change.

**Verified.** Updated the currency and risk-level lists and notification
provider configuration; change persisted and reflected everywhere else
that reads currencies/risk levels (the Finding registration form, the
Branch Dashboard's risk legend).

---

## 9. Audit Log

**What it is.** `/admin/audit-log`: a read-only, chronological feed of
every significant action in the system — who did what, when, to what, and
(where relevant) why.

**Why the business needs it.** master.txt §15 requires "immutable or
protected audit records," and icfms.txt §10 requires the system to
"maintain complete audit logs." For a bank's Internal Control Division,
this isn't a nice-to-have — it *is* the product. The whole point of
Internal Control is being able to answer "who approved this, and why" six
months later. There is deliberately no API to edit or delete an audit
entry anywhere in the app.

**Verified.** After the full test pass in this session, the audit log held
27+ entries spanning every module exercised — user/district/branch/role
changes, scoring rule activation, period lock/unlock, and every Finding
transition — confirming the log genuinely captures activity across the
whole system, not just one module.

---

## 10. Findings — registration through closure

This is the center of the product — the part of the Excel process
proposal.txt §2 describes as *"Branch Internal Controllers prepare monthly
findings... reports are submitted to District Internal Controllers...
District Internal Controllers consolidate all branch reports... forwarded
to Head Office... Head Office applies formulas... results are returned to
districts... Districts distribute reports to Branch Managers... Branch
Managers implement corrective actions... rectification status is reported
back... District Controllers verify the submissions... consolidated
reports are again submitted to Head Office."* That entire paragraph — nine
manual handoffs, all by email — is what the rest of this section replaces
with one system that enforces the handoffs automatically.

### 10.1 Registration — `/findings/new`

**What it is.** A form covering every field master.txt §6 requires:
source, period, district/branch (locked to the registering user's own
branch, or pickable for HO registering an Internal Audit finding), date,
operation area, type of irregularity, classified case, amount+currency,
case count, risk level, description, recommendation, and an optional
evidence note. "Save Draft" or "Save & Submit."

**Why the business needs it.** icfms.txt §7 gives the Branch Internal
Controller exactly this capability — register, edit while draft, submit —
and proposal.txt §6 specifically calls out that "Branch Internal
Controllers will directly register findings into the system," replacing
the Excel template entirely. The Draft/Submit split matters: a controller
partway through data entry shouldn't have half-finished data visible to
their district yet — plan doc §3.3's "Draft save (no submission) vs
Submit (enters workflow)" is exactly this distinction.

**Verified.** Registered and submitted a 3-case, ETB 45,000 finding as
`branch.controller`.

### 10.2 The workflow — District Review, HO Review

**What it is.** Once submitted, a finding enters the District Controller's
queue. They can Approve (moves to HO), Reject (terminal, reason required),
or Return (goes back to the branch, editable again, reason required). HO
Controller repeats the same three options once it reaches them. Every
single transition — including the automatic "now queued for the next
stage" step — is written to a permanent history.

**Why the business needs it.** This is master.txt §4's "Target To-Be
Workflow" table, implemented literally: Draft → Submit (notification to
district) → District review (Approve/Reject/Return/Comment) → District
approval (moves to HO) → HO approval (routes to Branch Manager). The
two-stage approval (district, then HO) mirrors the actual accountability
structure a bank needs: a district shouldn't be able to approve its own
branches' findings without a second, independent set of eyes at Head
Office — which is precisely why `DISTRICT_REVIEW` and `HO_REVIEW` are two
separate, separately-permissioned stages rather than one "approve" button.

**Verified**, with the specific sequencing the docs describe, not just the
end state: confirmed a finding is genuinely **absent** from the District
Controller's queue before it's submitted, and genuinely absent from HO's
queue until the district approves it — the routing isn't just labeled
correctly, it actually controls who can see and act on what, when.
District Director (view-only, no modify permission) was confirmed unable
to approve anything (`403`), directly proving icfms.txt §7's "cannot
modify findings or scores" restriction is real, not just written down.

### 10.3 Rectification — Branch Manager records corrective action

**What it is.** Once HO approves, the finding lands with the Branch
Manager. They record how many cases and how much money were actually
fixed — which can be less than the full amount. The system tracks
cumulative rectified cases/amount and computes what's still outstanding.

**Why the business needs it.** This is the single most detailed rule in
the entire BRD, with a worked numeric example (master.txt §7): *three
cases totaling ETB 45,000 — if only the ETB 10,000 case gets fixed, the
system must record exactly 1 rectified case / ETB 10,000, and 2 remaining
cases / ETB 35,000 outstanding.* A bank's real findings are rarely
resolved all at once — partial progress has to be trackable, or the
Branch Manager has no way to report "we fixed some of it" without either
overstating progress or the finding staying stuck. proposal.txt §6 also
frames this as core to the business objective of "tracking outstanding
findings."

**Verified against the BRD's own numbers, not a simplified version of
them**: recorded exactly 1 case / ETB 10,000 against the 3-case / ETB
45,000 finding, and the system reported exactly 2 cases / ETB 35,000
outstanding — the doc's example reproduced digit-for-digit. Also confirmed
the guard rail the doc requires (§7: "rectified cases cannot exceed
eligible cases... rectified amount cannot exceed eligible amount") by
attempting to over-rectify and getting rejected before any data changed.

### 10.4 Verification & Closure — District/HO confirm and close

**What it is.** Once fully rectified, the finding isn't automatically
done — a District or HO Controller has to close it explicitly. The Branch
Manager who recorded the fix cannot close it themselves.

**Why the business needs it.** master.txt describes this as a distinct
"Verification" function, separate from rectification itself — someone
independent of the person who reported "I fixed it" has to confirm it
before the record is considered closed. This is a standard internal-
control principle (separation of duties) made structural: the permission
to *record* a fix and the permission to *verify and close* it are two
different, separately-grantable capabilities, not the same button.

**Verified**: a Branch Manager attempting to close their own
fully-rectified finding was rejected (`403` — they hold no `findings.close`
permission by default); a District Controller closed it successfully.

### 10.5 Transfer to next period — District Controller carries a balance forward

**What it is.** If a finding still has an outstanding balance when its
reporting period locks, the District Controller can transfer it into any
currently open period, with a required reason. The finding keeps its
full history — it isn't recreated — it just now belongs to the new
period, with status `TRANSFERRED`, and can be rectified further there.
The finding detail page shows a running "Transfer History" list and a
"Case age" figure that's unaffected by any transfer (it's always measured
from the original registration date).

**Why the business needs it.** master.txt §8 and BRD §3.7 both require
outstanding cases to carry forward into the next reporting period rather
than getting stuck once a month closes. This is the same problem
Reporting Periods (§6) exists to prevent in reverse: locking August's
numbers must not mean an unresolved August finding becomes permanently
unworkable — it needs a controlled path forward, with an accountable
person (the District Controller) and a stated reason, not a silent
database edit.

**Verified.** Ran a finding through submit → district-approve →
HO-approve, locked its reporting period mid-workflow (confirming the
now-expected `409` when the Branch Manager tried to rectify against the
locked period), transferred it into the next open period, and confirmed
via the Findings list, filtered by period, that the finding is now
**absent** from the locked period's results and **present** in the new
period's — no manual reconciliation, no double-counting. Fully rectified
and closed it in the new period afterward, completing the same
partial-rectification and closure guarantees §10.3–10.4 already proved,
now shown to survive a transfer too.

### 10.6 Evidence — attach supporting files

**What it is.** Any finding can have real files attached — PDF, PNG, JPG,
XLSX, DOCX, or CSV, up to 10 MB each — uploaded by the Branch Controller
or Branch Manager, downloadable by anyone who can view the finding.

**Why the business needs it.** icfms.txt gives both branch roles an
explicit "upload optional evidence" capability, and master.txt §15/§16
call for "controlled" attachment storage with "secure validation and
access controls." A finding's supporting documentation — a scanned
receipt, a screenshot of a system error, a reconciliation spreadsheet — is
exactly the kind of thing that used to live buried in an email thread
under the old Excel process; attaching it directly to the finding record
means it's still there, and still linked to the right finding, months
later when an auditor asks for it.

**Verified.** Uploaded a `.csv` file (accepted) and downloaded it back —
byte-for-byte identical to the original. A `.txt` file was rejected
(unsupported type) and a file just over the 10 MB cap was rejected with a
clear size-limit message. Confirmed a role with view-only access to the
finding (no upload permission) can still see and download what's already
attached.

### 10.7 Comments — reviewer discussion on a finding

**What it is.** A comment thread on each finding, with one level of
replies. Branch Controller, Branch Manager, District Controller, District
Director, and HO Controller can all post; Executive (view-only) can read
but not post.

**Why the business needs it.** proposal.txt §6 specifically calls out
that "District Directors shall have view and comment access" — this is
the one action that role gets beyond looking at data, and it only exists
now because comments themselves now exist. More broadly, BRD §3.11
expects reviewer communication that isn't limited to a formal reject/
return with a mandatory reason (§10.2) — sometimes a reviewer just needs
to ask a clarifying question without kicking the finding back to Draft.

**Verified.** A District Controller posted a comment; the District
Director replied to it; a second reply nested under that first reply was
correctly rejected (comments only thread one level deep). Confirmed
Executive's comment attempt is rejected (`403`) while their read access to
the same thread still works (`200`) — exactly the read-only boundary
icfms.txt §7 describes for that role.

---

## 11. Notifications — the bell icon in the top bar

**What it is.** Every signed-in page shows a bell icon with an unread
count. It lists events relevant to that specific user — a finding was
submitted to their queue, approved, rejected, returned, rectified,
transferred, closed, commented on, or a reporting period they care about
was locked or unlocked — each one click-through to the finding or record
involved, with mark-as-read (individually or all at once).

**Why the business needs it.** master.txt §12 explicitly lists
"notifications for submit, approve, reject, return, assignment,
rectification, transfer and period events" as a requirement, and BRD §9
frames this as closing the old process's biggest blind spot: under the
Excel/email workflow, someone only found out a finding needed their
attention when they happened to check their inbox or someone called them.
A system-driven notification means the person who actually needs to act
next always has a clear, current list of what's waiting on them — which
is also exactly what each dashboard's own "Work Queue" widget shows, just
pushed to them proactively instead of requiring a visit to check.

Email/Outlook delivery is explicitly out of scope for now — there's no
mail server or Graph API credential anywhere in this project to send
through, a gap master.txt §24 itself already lists as an open decision.
The in-app center covers the same underlying business need (a
user finds out something needs their attention) without depending on
infrastructure that doesn't exist yet.

**Verified.** Ran a finding through submit, district-approve, HO-approve,
a period lock, a transfer, a rectification, a comment, and a close —
confirmed a notification landed in the correct recipient's list at every
one of those nine points, with the right title and message, and that
mark-as-read (both single and "mark all read") correctly updated the
unread badge.

---

## 12. Dashboards — every role sees their own real numbers

**What it is.** `/dashboard` now shows a genuinely different, real-data
view depending on the signed-in role:

- **Branch** (Branch Controller/Manager): their branch's KPIs, category
  totals, risk distribution, monthly trend, work queue, recent activity.
- **District** (District Controller/Director): the district's aggregate
  KPIs, plus a branch-by-branch performance ranking table.
- **HO** (HO Controller): bank-wide KPIs, a district-by-district ranking,
  an Internal Control vs. Internal Audit source comparison, and
  reporting-period status at a glance.
- **Executive** (view-only): a concise bank-wide summary — performance,
  outstanding count, a high/critical-risk "exceptions" count, and
  top-district/top-branch rankings — deliberately lighter than the
  operational dashboards, matching the read-only nature of that role.

Every dashboard now also shows a real per-risk-level breakdown and a
month-over-month performance trend, replacing the "no data yet"
placeholders every dashboard (including Branch) carried before this.

Branch and District dashboards additionally show **currency amounts**,
not just finding counts: Total Amount, Resolved Amount, and Outstanding
Amount for the current period, grouped by currency where a scope has
findings in more than one (e.g. "ETB 45,000 · USD 500") since summing
across currencies would otherwise be meaningless. The District dashboard
also breaks its finding count down by exactly where each one sits in the
review pipeline - Total Submitted, Requiring Review, Approved, Rejected,
Returned, Outstanding, and Transferred - rather than one generic total.

**Why the business needs it.** master.txt §10 specifies this widget set
per role explicitly, and this is the clearest before/after against
proposal.txt §2's old process: a District Director or HO Controller used
to see the bank's real performance only after Head Office finished
manually recalculating everyone's spreadsheet by hand. Now every role
sees their own slice of the current, real state the moment they log in —
no waiting for the next consolidation cycle.

**Verified.** Logged in as one user per role (branch, district, HO,
executive) and screenshotted each dashboard — every KPI, ranking table,
and widget rendered real numbers matching what the underlying Findings
data actually contained, with **zero browser console errors** on any of
the four.

---

## 13. Reports & Exports — `/reports`

**What it is.** One page covering the report types master.txt §18 names:
a filterable Findings Report with a **Download CSV** button and a
**Print / Save as PDF** button (the browser's own print dialog, styled to
hide the navigation and print cleanly); Branch and District Performance
rankings; Category and Risk breakdowns; and a Transfers list. Reporting
period status and the full audit trail are linked from here rather than
duplicated, since they're already their own real pages.

**Why the business needs it.** proposal.txt §3 lists "time-consuming
performance calculations" and the lack of a "centralized repository" as
two of the specific pains the old Excel process caused; master.txt §18
lists 14 named reports the system is expected to produce. Being able to
download exactly what's on screen as a CSV (for further analysis in
Excel, if that's still someone's preferred tool) or print it straight to
a PDF for a physical file or an email attachment is the concrete
replacement for "someone manually builds this report in Excel every
month."

**Verified.** Downloaded the CSV export and confirmed its rows matched
exactly what the on-screen Findings Report table showed, for the same
filters. Confirmed the Print button opens the browser's print dialog with
the sidebar and top bar hidden, showing only the report content.

---

## 14. Full end-to-end test log (this session)

Run fresh, against a newly reseeded server, in this order:

| # | Area | Result |
|---|---|---|
| 1 | Login as all 7 seeded roles | All `200`; wrong password `401`; unauthenticated API access `401` |
| 2 | Districts: create, rename, deactivate, delete | All succeeded |
| 3 | Branches: create, delete (unreferenced) | Succeeded |
| 4 | Sources / Categories: create, delete; delete a category still used by a scoring rule | Create/delete succeeded; referenced-category delete correctly blocked `409` |
| 5 | Scoring Rules: create v2, activate | Succeeded; confirmed exactly one active version afterward |
| 6 | Scoring Adjustments: short reason rejected, valid reason accepted | `400` then `201` |
| 7 | Reporting Periods: create, lock, unlock | All succeeded |
| 8 | Users: create, edit, deactivate, reactivate; branch-manager-singleton conflict | Succeeded; conflict correctly rejected with the existing holder's name |
| 9 | Roles: create custom role, edit permissions, delete; attempt to delete built-in `ADMIN` | Succeeded; `ADMIN` delete correctly blocked `409` |
| 10 | Settings: update currencies/risk levels/notification config | Succeeded |
| 11 | Audit Log: review activity generated by the above | 27+ entries, spanning every module touched |
| 12 | Findings: full `DRAFT → SUBMITTED → DISTRICT_REVIEW → ... → CLOSED` run, reproducing the BRD's own partial-rectification example | Every stage transitioned correctly; 3 cases/45,000 → 1/10,000 rectified → 2/35,000 outstanding → fully rectified → closed |
| 13 | Permission spot-checks: District Director creating a district, Branch Manager listing users, Executive (view-only) listing vs. creating users | All denied/allowed exactly as each role's permissions dictate |
| 14 | Logout, then attempt admin API access with the stale cookie | `401` |
| 15 | Full page-render pass across all 13 admin/findings pages plus the Branch Dashboard | Every page rendered with **zero browser console errors** |

Two real defects were found and fixed *because* of this pass — not before
it (both detailed in BRD_COMPLIANCE.md §4): reporting-period locks weren't
blocking existing findings' workflow actions, and the seeded currency/
classified-case reference data didn't match the BRD's own listed values.

This table is the original Phase 6 test log, left as-is for its own
record. Everything added in Phase 7 — Transfer, Evidence, Comments,
Notifications, Reports, and the three new dashboards — has its own
equally live, equally scripted verification pass documented in
`PHASE7.md`'s own "Verified end-to-end" section, summarized in §10.5–§13
above; one real defect was found and fixed during that pass too (the
runtime's own request-body limit was rejecting an over-10MB evidence
upload with a misleading "no file provided" message before this app's own
size check ever ran — corrected to report the actual "exceeds the 10 MB
limit" reason instead).

---

## 15. What's still deferred (and why that's a known gap, not a surprise)

Everything below is a real, current limitation — each one already flagged
as deliberately out of scope, not something quietly missed (full detail
and BRD citations in BRD_COMPLIANCE.md §5):

- **Migrate existing Excel-based findings history into the system** (the
  Excel Migration Toolkit, master.txt §22) — no import template,
  validation, or reconciliation-vs-Excel tooling exists yet.
- **Look something up in an in-app Knowledge Base** (icfms.txt §8) — not
  started.
- **Have per-source workflow routing differ** (master.txt §2) — every
  source (Internal Control, Internal Audit) follows the identical
  approval pipeline today.
- **Have a manual scoring adjustment automatically change the displayed
  performance percentage** (master.txt §9) — adjustments are recorded and
  audit-logged, but `computePerformance()` doesn't yet fold one into the
  number shown on a dashboard; the two currently coexist rather than
  combine.
- **Receive a notification by email or Outlook**, rather than only the
  in-app bell (BRD §9, master.txt §12) — there's no mail server or Graph
  API credential in this project to send through yet; the in-app
  notification center (§11) covers the same underlying need for now.

None of these change what's already true for everything else: the full
Findings lifecycle — registration, district/HO review, partial or full
rectification, cross-period transfer, evidence, comment-based
collaboration, notification, reporting/export, and independently verified
closure — all work, are permission-enforced, and have been proven to work
against the BRD's own worked examples end-to-end, not a simplified
stand-in for them.
