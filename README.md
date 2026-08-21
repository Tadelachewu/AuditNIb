# NIB Control360 — ICFMS

Internal Control Findings Management System. This repo currently implements
the foundation and Administration console: authentication, organization/user
management, and system configuration. The findings/workflow/rectification
modules described in `AuditDocs/` ship in later phases.

For a deep dive into how every piece of this Phase 1 build works and relates
to the others — data model, auth flow, role/org-unit scoping, each admin
module — see [PHASE1.md](PHASE1.md).

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
bcrypt. [src/proxy.ts](src/proxy.ts) (Next's routing proxy, formerly called
"middleware") redirects unauthenticated requests to `/login` and keeps
`/admin/*` restricted to the Administrator role at the edge; every
`/api/admin/*` route re-checks the role itself via
[src/lib/guard.ts](src/lib/guard.ts), since the UI/proxy layer is a
convenience, not the real access-control boundary.

## Default users

Seeded on first run, one per role (see [src/lib/db.ts](src/lib/db.ts)):

| Role | Username | Password |
|---|---|---|
| Administrator | `admin` | `Admin@123` |
| HO Internal Controller | `ho.controller` | `Ho@12345` |
| District Internal Controller | `district.controller` | `District@123` |
| District Director | `district.director` | `Director@123` |
| Branch Internal Controller | `branch.controller` | `Branch@123` |
| Branch Manager | `branch.manager` | `Manager@123` |
| Executive (Read-only) | `executive` | `Executive@123` |

These are also listed on the login page under "Demo accounts". Change or
remove them before any real deployment.

## What's implemented

- Login / logout, session-based route guards, role-aware navigation
- Admin Dashboard: bank-wide KPIs, unassigned-branch warnings, recent activity
- Users: create/deactivate/reactivate, role + org-unit assignment, enforces
  one active Branch Manager and one active Branch Internal Controller per
  branch
- Districts, Branches (linked to district), Sources, Classified Categories
- Scoring Rules: versioned, admin-only, one active version at a time
- Scoring Adjustments: mandatory reason, audit-logged
- Reporting Periods: open/lock/unlock with mandatory reason
- Settings: currencies, risk levels, notification provider config
- Audit Log viewer

## What's not implemented yet

Findings registration/workflow, rectification, transfers, scoring
calculation, role-specific dashboards (branch/district/HO/executive),
reports/exports, and comments/notifications — see
`AuditDocs/NIB_Control360_Development_Plan.md` for the phased roadmap.
