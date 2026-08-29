# NIB Control360 — ICFMS

Internal Control Findings Management System. This repo implements the
foundation, the Administration console, and the full Findings module:
registration through district/HO review, rectification, cross-period
transfer, file evidence, threaded comments, in-app notifications, and
verified closure — plus reporting/CSV export and a real dashboard for
every role (Branch, District, HO, Executive).

For a deep dive into how every piece of this Phase 1 build works and relates
to the others — data model, auth flow, role/org-unit scoping, each admin
module — see [PHASE1.md](PHASE1.md). Phase 2 replaced the fixed 7-role
system with dynamic, admin-editable roles and a page/action permission
matrix — see [PHASE2.md](PHASE2.md). Phase 3 completed CRUD (in-place edit
everywhere, real delete where it's safe) and added confirmation dialogs to
every risky action — see [PHASE3.md](PHASE3.md). Phase 4 started the BRD's
role-specific dashboards, beginning with Branch — real data where it
exists, honest "no data yet" states for anything that needs Findings data —
see [PHASE4.md](PHASE4.md). Phase 5 made every dashboard/feature its own
permission and gave every seeded role a non-empty, BRD-grounded default
permission set — see [PHASE5.md](PHASE5.md). Phase 6 built the Findings
module itself: the `Finding` entity, the complete workflow state machine
(register → district review → HO review → rectify → verified close), and
wired the Branch dashboard's Phase 4 placeholders up to the real numbers —
see [PHASE6.md](PHASE6.md). Phase 7 closed the remaining BRD gaps: the
cross-period Transfer Engine, real local-disk evidence upload, threaded
comments, an in-app notification center, a Reports/CSV-export module, and
real District/HO/Executive dashboards (plus a real risk-distribution and
monthly-trend widget on all four dashboards, Branch included) — see
[PHASE7.md](PHASE7.md).

Several companion documents look at the finished app from different
angles: [BRD_COMPLIANCE.md](BRD_COMPLIANCE.md) is a strict
requirement-by-requirement cross-check against every document in
`AuditDocs/`; [APP_DOCUMENT.md](APP_DOCUMENT.md) is a business-facing,
screen-by-screen walkthrough of every feature and *why* the bank needs
it, verified end-to-end in a live test pass rather than described from
the code alone; [FINDINGS_WORKFLOW.md](FINDINGS_WORKFLOW.md) is the
complete state-machine reference for the Finding lifecycle - every
status, every action, who can trigger it, and every side-flow (evidence,
comments, notifications, transfer, period locking) attached to it;
[RECTIFICATION.md](RECTIFICATION.md) is a focused deep-dive on exactly
how `PARTIALLY_RECTIFIED` vs. `RECTIFIED` is decided and what each one
does and doesn't allow next; and [SCENARIOS.md](SCENARIOS.md) is a full
start-to-end test-case list covering the whole app.

## Getting started

```bash
cp .env.example .env.local   # then set IRON_SESSION_PASSWORD to a random 32+ char string
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll be redirected to `/login`.

To let someone outside this machine reach the running app (a demo, a
quick review), see [EXPOSE_TO_INTERNET.md](EXPOSE_TO_INTERNET.md) —
`npm run tunnel:cloudflare` is the one confirmed to work on NIB's
corporate network.

## Data storage

There is no database yet. All data lives in `data/db.json`, a single JSON
file managed by [src/lib/db.ts](src/lib/db.ts). The file is created and
seeded automatically the first time the app reads it, and is git-ignored, so
each environment gets its own fresh copy. Delete `data/db.json` (or the whole
`data/` folder) to reset to the seed data below.

Every read/write in the app goes through `readDb()` / `writeDb()` /
`updateDb()` in that one file — swapping in a real database later (Postgres
via Prisma, etc.) means reimplementing those functions only; nothing in the
API routes or pages needs to change.

## Authentication

Sessions are encrypted cookies managed by [iron-session](https://github.com/vvo/iron-session)
(see [src/lib/session.ts](src/lib/session.ts)). Passwords are hashed with
bcrypt. Roles are dynamic, admin-editable data (not a fixed list) and access
is granted per page, per action — see [PHASE2.md](PHASE2.md) for the full
design. [src/proxy.ts](src/proxy.ts) (Next's routing proxy, formerly called
"middleware") redirects unauthenticated requests to `/login` and redirects
away from any `/admin/<page>` the session's role doesn't hold `<page>.view`
for; every `/api/admin/*` route re-checks the specific permission itself via
[src/lib/guard.ts](src/lib/guard.ts), since the UI/proxy layer is a
convenience, not the real access-control boundary.

## Default users & roles

Seeded on first run, one user per role (see [src/lib/db.ts](src/lib/db.ts)):

| Role | Username | Password | Default permissions |
|---|---|---|---|
| Administrator | `admin` | `Admin@123` | Everything |
| HO Internal Controller | `ho.controller` | `Ho@12345` | View access bank-wide + reporting-period lock/unlock + register findings (Internal Audit) + HO review + close |
| District Internal Controller | `district.controller` | `District@123` | View access for their district + reporting-period lock/unlock + district review + close |
| District Director | `district.director` | `Director@123` | View access for their district only — BRD: "cannot modify findings or scores" |
| Branch Internal Controller | `branch.controller` | `Branch@123` | Branch Dashboard + register/edit/submit findings + record rectification |
| Branch Manager | `branch.manager` | `Manager@123` | Branch Dashboard + record rectification |
| Executive (Read-only) | `executive` | `Executive@123` | View-only, every page except Roles & Permissions |

Every seeded role starts with a non-empty, BRD-grounded default (see
[PHASE5.md](PHASE5.md) for the reasoning behind each one) rather than
zero access — an admin narrows or widens from there. These are also listed
on the login page under "Demo accounts". Change or remove them before any
real deployment. Roles themselves are editable data at `/admin/roles` —
create new roles, and grant/revoke page-by-page, action-by-action access to
any role (including these seven, and every dashboard — not just the admin
console) without a code change. A permission change only takes effect the
next time that role's users log in (see PHASE2.md §4).

## What's implemented

- Login / logout, session-based route guards, permission-aware navigation
- Dynamic roles with a page × action permission matrix, editable at
  `/admin/roles`; org-unit scoping (bank/district/branch) and the
  one-active-holder-per-branch rule are per-role data, not hard-coded (see
  PHASE2.md)
- Admin Dashboard: bank-wide KPIs, unassigned-branch warnings, recent activity
- Full CRUD on every admin entity — create, list, **edit in place**,
  deactivate/reactivate, and, where it's actually safe, **permanent delete**.
  Districts, Branches, Sources, Categories, and custom Roles support a real
  delete — each is blocked with a clear error if anything still references
  it (a branch in the district, a user on the branch, a scoring rule citing
  the source/category, a user holding the role), so nothing can be left
  with a dangling reference. Users, Scoring Rules, Scoring Adjustments,
  Reporting Periods, and the 7 built-in roles are deactivate-only, by
  design (see PHASE3.md) — never a hard delete, since they're either
  BRD-restricted to create/edit/deactivate (Users), append-only/versioned
  for reconciliation integrity (Scoring Rules, Reporting Periods), or
  themselves immutable audit-style records (Scoring Adjustments). Every
  delete is still recorded in the audit log with a full snapshot of what
  was removed. Destructive or high-blast-radius actions (deactivating
  anything, deleting anything, locking/unlocking a period, activating/
  deactivating a scoring rule) require an explicit confirmation dialog
  before they run; period lock/unlock collects its mandatory reason in that
  same dialog
- Users: create/edit (name, role, org-unit, password reset)/deactivate/
  reactivate, enforces the per-role branch-singleton constraint (e.g. one
  active Branch Manager and one active Branch Internal Controller per
  branch, by default)
- Districts, Branches (linked to district, editable), Sources, Classified
  Categories — each with inline rename
- Scoring Rules: versioned, one active version at a time (creating and
  activating are separate confirmed actions — see PHASE2.md §5 for why a
  rule is versioned rather than edited in place)
- Scoring Adjustments: mandatory reason, audit-logged
- Reporting Periods: open/lock/unlock with mandatory reason
- Settings: currencies, risk levels, notification provider config
- Audit Log viewer
- **Findings**: full registration form (every BRD §3.3 field) and the
  complete workflow state machine — Draft → Submit → District Review →
  HO Review → Send to Branch Manager → Rectify (full or partial, validated
  independently against outstanding cases/amount) → District/HO-verified
  Close. Every action is permission-gated *and* org-scope-enforced
  server-side (a district/branch user genuinely cannot see or act on
  another district/branch's findings — not just hidden in the UI); every
  transition is recorded with who/when/from/to/reason. See
  [PHASE6.md](PHASE6.md) for the full design and a live, scripted
  verification of the BRD's own acceptance example. Phase 7 added a
  Transfer-to-next-period action, real evidence file upload/download,
  threaded comments, and an in-app notification bell — see
  [PHASE7.md](PHASE7.md).
- Dashboards: Branch, District, HO, and Executive all backed by real
  Finding data (KPIs, category totals, risk distribution, monthly trend,
  work queue, recent activity), each its own permission-gated page.
- Reports: `/reports` with a filterable Findings Report, Branch/District
  Performance rankings, Category/Risk breakdowns, a Transfers list, a real
  CSV export, and a Print/Save-as-PDF button.

## What's not implemented yet

The Excel Migration Toolkit (master.txt §22), an in-app Knowledge Base
(icfms.txt §8), configurable per-source workflow routing, scoring-
adjustment integration into the computed performance figure, and email/
Outlook delivery for notifications (the in-app notification center exists;
there's no mail server or Graph API credential to send through) — see
`AuditDocs/master.txt` §21 for the original phased roadmap and PHASE7.md
for exactly what's deferred and why. [BRD_COMPLIANCE.md](BRD_COMPLIANCE.md)
is a full requirement-by-requirement cross-check of the app against every
document in `AuditDocs/`.
