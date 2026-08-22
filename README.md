# NIB Control360 — ICFMS

Internal Control Findings Management System. This repo currently implements
the foundation and Administration console: authentication, organization/user
management, and system configuration. The findings/workflow/rectification
modules described in `AuditDocs/` ship in later phases.

For a deep dive into how every piece of this Phase 1 build works and relates
to the others — data model, auth flow, role/org-unit scoping, each admin
module — see [PHASE1.md](PHASE1.md). Phase 2 replaced the fixed 7-role
system with dynamic, admin-editable roles and a page/action permission
matrix — see [PHASE2.md](PHASE2.md).

## Getting started

```bash
cp .env.example .env.local   # then set IRON_SESSION_PASSWORD to a random 32+ char string
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll be redirected to `/login`.

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

| Role | Username | Password | Default admin-console access |
|---|---|---|---|
| Administrator | `admin` | `Admin@123` | Everything |
| HO Internal Controller | `ho.controller` | `Ho@12345` | None — grant via `/admin/roles` |
| District Internal Controller | `district.controller` | `District@123` | None — grant via `/admin/roles` |
| District Director | `district.director` | `Director@123` | None — grant via `/admin/roles` |
| Branch Internal Controller | `branch.controller` | `Branch@123` | None — grant via `/admin/roles` |
| Branch Manager | `branch.manager` | `Manager@123` | None — grant via `/admin/roles` |
| Executive (Read-only) | `executive` | `Executive@123` | View-only, every page except Roles & Permissions |

These are also listed on the login page under "Demo accounts". Change or
remove them before any real deployment. Roles themselves are editable data
at `/admin/roles` — create new roles, and grant/revoke page-by-page,
action-by-action access to any role (including these seven) without a code
change. A permission change only takes effect the next time that role's
users log in (see PHASE2.md §4).

## What's implemented

- Login / logout, session-based route guards, permission-aware navigation
- Dynamic roles with a page × action permission matrix, editable at
  `/admin/roles`; org-unit scoping (bank/district/branch) and the
  one-active-holder-per-branch rule are per-role data, not hard-coded (see
  PHASE2.md)
- Admin Dashboard: bank-wide KPIs, unassigned-branch warnings, recent activity
- Full CRUD on every admin entity — create, list, **edit in place**, and
  deactivate/reactivate (there is no hard delete anywhere in the app: every
  entity is soft-deleted via `status`, so audit history and foreign-key
  references — e.g. a district a branch still points to — never dangle).
  Destructive or high-blast-radius actions (deactivating anything, locking/
  unlocking a period, activating/deactivating a scoring rule) require an
  explicit confirmation dialog before they run; period lock/unlock collects
  its mandatory reason in that same dialog
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

## What's not implemented yet

Findings registration/workflow, rectification, transfers, scoring
calculation, role-specific dashboards (branch/district/HO/executive),
reports/exports, and comments/notifications — see
`AuditDocs/NIB_Control360_Development_Plan.md` for the phased roadmap.
