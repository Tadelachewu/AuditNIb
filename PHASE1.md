# Phase 1 — Foundation & Administration Console

This document explains what was actually built in Phase 1, how each piece
works internally, and how the pieces relate to each other. It's the deep
version of the summary table in [README.md](README.md).

Phase 1 corresponds to the plan's Phase 0/1/10 pulled forward: architecture,
auth, organization hierarchy, users/roles, navigation/route guards, and the
full Administration console — built early because every later phase
(findings, workflow, rectification, scoring) depends on users, roles,
districts, branches, sources, categories and reporting periods already
existing.

---

## 1. The four layers

Everything in the app sits in one of four layers, and each layer only talks
to the layer directly below it:

```
UI (pages, components)
   │  fetch() from client components, or direct calls from server components
API routes (src/app/api/**/route.ts)
   │  requireRole() then readDb()/updateDb()
Domain helpers (src/lib/org.ts, src/lib/audit.ts, src/lib/auth.ts, src/lib/sanitize.ts)
   │  pure functions operating on a Database object
Data layer (src/lib/db.ts)
   →  data/db.json on disk
```

The point of keeping this strict is Phase 2+: when the JSON file is
replaced with a real database, only `src/lib/db.ts` needs to change shape
(from sync `fs` calls to async SQL/Prisma calls). Nothing in the domain
helpers, API routes, or pages hard-codes "this is a JSON file" — they just
call `readDb()` / `updateDb()`.

---

## 2. Data layer — `src/lib/db.ts`

The whole app persists to a single file, `data/db.json`, shaped like the
`Database` type in [src/types/index.ts](src/types/index.ts):

```ts
interface Database {
  users: User[];
  districts: District[];
  branches: Branch[];
  sources: Source[];
  categories: ClassifiedCategory[];
  scoringRules: ScoringRule[];
  scoringAdjustments: ScoringAdjustment[];
  reportingPeriods: ReportingPeriod[];
  settings: Settings;      // singleton, not an array
  auditLogs: AuditLogEntry[];
}
```

Three functions are the entire public API of this file:

- **`readDb()`** — creates `data/` and a seeded `db.json` if they don't
  exist yet (`ensureDataFile()` → `buildSeedDatabase()`), then reads and
  parses the file. Called on every GET and at the start of every mutation.
- **`writeDb(db)`** — serializes the whole `Database` object back to disk.
- **`updateDb(mutator)`** — the read-modify-write helper every mutating API
  route actually uses: it reads the file, hands you the live object to
  mutate in place, writes it back, and returns whatever your mutator
  returned. This is why every POST/PATCH route body looks like:

  ```ts
  updateDb((current) => {
    current.users.push(newUser);
    appendAuditLog(current, { ... });
  });
  ```

There's no locking or transaction support — this is a single-process dev
store, not a concurrent database. That's an accepted trade-off of "local
storage for now."

### Seeding

`buildSeedDatabase()` is called exactly once, the first time `data/db.json`
doesn't exist. It creates:

- 3 districts, 3 branches (2 in one district, 1 in another)
- 2 sources (`Internal Control`, `Internal Audit`)
- 7 classified categories, matching the BRD's list — 6 informational
  (ATM Mismatch, ATM Long O/S, IT, Dormant, Zero Balance, CK Book) and 1
  scored (`Other Case`, `scored: true`)
- 1 scoring rule (v1, active, basis = the "Other Case" formula from the BRD)
- 1 reporting period for the current month, `OPEN`
- default settings (currencies `ETB`/`USD`, 4 risk levels, notifications
  disabled)
- **7 users, one per role** — see §5

Deleting `data/db.json` resets everything to this seed on the next request.

---

## 3. Domain model & relations

### Entity reference

| Entity | Key fields | Points to |
|---|---|---|
| `User` | `role`, `districtId?`, `branchId?`, `status`, `passwordHash` | `District`, `Branch` (both optional, mutually exclusive by role — see §4) |
| `District` | `code`, `name`, `status` | — |
| `Branch` | `code`, `name`, `districtId`, `status` | `District` (required) |
| `Source` | `code`, `name`, `active` | — |
| `ClassifiedCategory` | `code`, `name`, `scored`, `active` | — |
| `ScoringRule` | `version`, `active`, `categories: string[]`, `sources: string[]`, `basis` | `ClassifiedCategory[]`, `Source[]` (many-to-many, stored as id arrays) |
| `ScoringAdjustment` | `targetType`, `targetId`, `periodId`, `value`, `reason` | `District` or `Branch` (polymorphic), `ReportingPeriod` |
| `ReportingPeriod` | `year`, `month`, `code`, `status`, `lockReason?` | — |
| `Settings` | `currencies`, `riskLevels`, `notification` | singleton, no relations |
| `AuditLogEntry` | `userId`, `entityType`, `entityId`, `oldValue?`, `newValue?`, `reason?` | `User` (actor) + any entity (polymorphic subject) |

### How a Branch's Manager/Controller actually works

This is the one relationship that's *not* a foreign key, on purpose. Early
in Phase 1 the `Branch` type had `managerUserId`/`controllerUserId` fields,
but that meant a branch manager's identity could be recorded in two places
(`User.branchId` + `User.role`, and `Branch.managerUserId`) that could drift
out of sync. So `Branch` carries no pointer to its manager/controller at
all — instead, [src/lib/org.ts](src/lib/org.ts) *derives* them on read:

```ts
findBranchManager(db, branchId)
  // = the ACTIVE user with role BRANCH_MANAGER and branchId === branchId

findBranchController(db, branchId)
  // = the ACTIVE user with role BRANCH_CONTROLLER and branchId === branchId
```

The BRD constraint "each branch has one Branch Manager and one Branch
Internal Controller" is enforced at write time by
`assertBranchRoleAvailable()`, called from `resolveOrgAssignment()` (§4)
every time a user is created or edited into one of those two roles. If the
slot is already taken by someone else active, the API rejects the write
with a 409 naming who's currently holding it. The Branches admin page
(`/admin/branches`) calls `findBranchManager`/`findBranchController` in its
GET route to display the derived names — it never stores them.

### Polymorphic references

Two entities deliberately don't use a single foreign key, because they need
to point at more than one kind of thing:

- **`ScoringAdjustment.targetType` + `targetId`** — `targetType` is either
  `"DISTRICT"` or `"BRANCH"`, and `targetId` is validated against the
  matching collection in the API route before the adjustment is saved.
- **`AuditLogEntry.entityType` + `entityId`** — every mutation across every
  module writes one of these (`entityType` is a plain string like `"User"`,
  `"Branch"`, `"ScoringRule"`, `"Settings"`), so the audit log is a single
  flat, chronological list covering all admin activity rather than one log
  per entity type.

---

## 4. Role → organization-unit scoping — `src/lib/org.ts`

The BRD defines 7 roles, each scoped to a different level of the
organization:

| Scope | Roles | Org unit stored on the user |
|---|---|---|
| Bank-wide | `ADMIN`, `HO_CONTROLLER`, `EXECUTIVE_READONLY` | none (`districtId: null, branchId: null`) |
| District | `DISTRICT_CONTROLLER`, `DISTRICT_DIRECTOR` | `districtId` only |
| Branch | `BRANCH_CONTROLLER`, `BRANCH_MANAGER` | `districtId` **and** `branchId` (district is derived from the branch, not chosen independently) |

`resolveOrgAssignment(db, { role, districtId, branchId }, excludeUserId?)`
is the single function that enforces this table. It's called from both
`POST /api/admin/users` (create) and `PATCH /api/admin/users/[id]` (edit),
so the rule can never be bypassed by editing around it:

1. If the role is branch-scoped: a `branchId` must be given, the branch
   must exist, and `assertBranchRoleAvailable` must confirm the manager/
   controller slot is free (or held by this same user, when editing). The
   returned `districtId` is read off the branch record — the caller can't
   assign a branch-scoped user to a mismatched district.
2. If the role is district-scoped: a `districtId` must be given and must
   exist. `branchId` is forced to `null`.
3. Otherwise (bank-wide role): both are forced to `null`, even if the
   caller passed values — so switching a user's role to `ADMIN` always
   clears their old org assignment.

`excludeUserId` is what lets a `PATCH` "keep" the branch role it already
holds without tripping its own uniqueness check.

---

## 5. Authentication & session — `src/lib/session.ts`, `src/lib/auth.ts`, `src/proxy.ts`

### Passwords

`src/lib/auth.ts` wraps `bcryptjs`: `hashPassword()` (used at seed time and
on every user create/password-reset) and `verifyPassword()` (used at
login). Nothing in the app ever stores or compares a plain-text password.

### Default users (seeded)

| Role | Username | Password | Org unit |
|---|---|---|---|
| Administrator | `admin` | `Admin@123` | Bank-wide |
| HO Internal Controller | `ho.controller` | `Ho@12345` | Bank-wide |
| District Internal Controller | `district.controller` | `District@123` | Addis Ababa District |
| District Director | `district.director` | `Director@123` | Addis Ababa District |
| Branch Internal Controller | `branch.controller` | `Branch@123` | Bole Branch |
| Branch Manager | `branch.manager` | `Manager@123` | Bole Branch |
| Executive (Read-only) | `executive` | `Executive@123` | Bank-wide |

These exist so every role can be logged into and exercised immediately;
they're also listed on the login page itself.

### Session cookie

`src/lib/session.ts` defines `SessionData` — the shape actually stored,
*encrypted*, in the cookie:

```ts
{ isLoggedIn, userId, username, name, role, districtId, branchId }
```

`iron-session` (not a database session table) does the encryption, keyed by
`IRON_SESSION_PASSWORD` (a ≥32-char secret from `.env.local`). That means
the session is entirely self-contained in the cookie — there's no server-
side session store to keep in sync with `data/db.json`. The trade-off:
deactivating a user doesn't invalidate their existing session cookie until
it's re-checked (every admin API call does re-check via `requireRole`,
which reads the *fresh* role from the cookie — but not the fresh `status`
from the DB; a truly revoked session would need a session-store lookup,
which is future work).

- **`getSession()`** — for Server Components / Route Handlers, via
  `next/headers` `cookies()`.
- **`getCurrentUser()`** — returns the session data, or `null` if not
  logged in. Used by every server component that needs to know who's
  looking (root page redirect, the `(app)` layout, `/dashboard`).

### Login/logout/me — `src/app/api/auth/*/route.ts`

- **`POST /api/auth/login`** — validates the body with `zod`, looks up the
  user by username (case-insensitive), calls `verifyPassword`, checks
  `status === "ACTIVE"`, then in one `updateDb()` call both stamps
  `lastLoginAt` **and** appends a `LOGIN` audit log entry — so login
  activity shows up in `/admin/audit-log` and on the Admin Dashboard's
  "Recent Activity" feed. Only after that does it populate and save the
  `iron-session` cookie.
- **`POST /api/auth/logout`** — appends a `LOGOUT` audit entry (if there
  was a session), then `session.destroy()`.
- **`GET /api/auth/me`** — returns the current session, `401` if none.
  Not currently called from the UI (server components use
  `getCurrentUser()` directly) but is there for any future client-only
  entry point.

### Route guarding — two layers, on purpose

1. **`src/proxy.ts`** (Next's routing layer, formerly called
   "middleware" — renamed in Next 16) runs on every request at the edge.
   It unseals the same `iron-session` cookie (iron-session works on the
   Edge runtime, unlike raw `fs`) and:
   - redirects unauthenticated requests to `/login` (preserving `?from=`)
   - redirects an already-logged-in user away from `/login`
   - redirects any non-`ADMIN` session away from `/admin/*` to `/dashboard`

   This is a **UX convenience** — it means a non-admin never even sees the
   admin shell flash before being bounced.

2. **`src/lib/guard.ts`** (`requireUser()` / `requireRole(...roles)`) runs
   inside every single API route handler under `/api/admin/*`. This is the
   **real** authorization boundary — the comment in the file says it
   explicitly: *"the client can never be trusted to enforce access
   control."* Even if the proxy layer were misconfigured or bypassed,
   every admin API route independently re-checks the role from the
   session before touching `data/db.json`. This mirrors the BRD's explicit
   requirement: *"UI scope is not a security boundary; server/API must
   enforce access."*

---

## 6. Audit trail — `src/lib/audit.ts`

One function, `appendAuditLog(db, entry)`, called from inside essentially
every mutating API route, always inside the same `updateDb()` transaction
as the actual data change (never as a separate write — so a change and its
audit record can't get out of sync). It `unshift`s onto `db.auditLogs`, so
the array is already newest-first; the audit-log API route and the Admin
Dashboard's "Recent Activity" widget just `slice()` off the front.

Every entry captures: who (`userId` + denormalized `userName`, so the log
reads correctly even if the user is later renamed or deactivated), what
(`action`, `entityType`, `entityId`), and — where relevant —
`oldValue`/`newValue` (a before/after snapshot of the changed fields) and
`reason` (mandatory for scoring adjustments and period lock/unlock,
matching the BRD's "old value / new value / actor / timestamp / reason"
requirement).

---

## 7. The admin modules, and how they lean on each other

Each module is a pair: an API route under `src/app/api/admin/<module>/`
and a page under `src/app/(app)/admin/<module>/page.tsx`. All pages except
the Admin Dashboard itself are client components that call the API via
`src/lib/api-client.ts` (`apiGet`/`apiSend`, which normalize errors into a
typed `ApiError`).

- **Users** (`/admin/users`) — the most cross-cutting module. Its create
  form's District/Branch fields only appear when the selected role needs
  them (mirroring §4's scoping table exactly), and its branch dropdown is
  filtered to the selected district. Every write goes through
  `resolveOrgAssignment`, so this page is where the branch-manager/
  -controller uniqueness rule actually surfaces to an admin (as a 409
  error naming the conflicting user).
- **Districts** (`/admin/districts`) — plain CRUD (create, rename,
  activate/deactivate). Every `Branch` depends on a District existing.
- **Branches** (`/admin/branches`) — CRUD plus a district picker; its GET
  route joins in the *derived* manager/controller names via
  `findBranchManager`/`findBranchController` (§3) rather than storing them.
  Reassigning a branch's manager/controller happens on the Users page, not
  here.
- **Sources** (`/admin/sources`) and **Classified Categories**
  (`/admin/categories`) — reference data consumed later by Scoring Rules
  (below) and, in future phases, by the Finding form itself. Categories
  carry a `scored` boolean toggled right in the table — only categories
  marked `scored` are eligible to be included in a scoring rule.
- **Scoring Rules** (`/admin/scoring-rules`) — the only module that's
  append-only by design: `POST` always creates a **new version**
  (`version` auto-increments), it never edits an existing one. `PATCH`
  exists only to flip `active`, and activating one rule deactivates every
  other rule in the same `updateDb()` call — enforcing "exactly one active
  rule at a time" at the data layer, not just in the UI. This matters
  because a past reporting period needs to keep reconciling against
  whichever rule *version* was actually active when it ran, not today's
  rule. The create form's category/source pickers read live data from the
  Sources and Categories modules above.
- **Scoring Adjustments** (`/admin/scoring-adjustments`) — create-only (no
  edit/delete — like the audit log, an adjustment is itself a permanent
  record). Its form's target picker switches between the Districts and
  Branches lists depending on `targetType`, and its period picker reads
  from Reporting Periods. `reason` is enforced server-side as a required
  field (min 5 characters), and every adjustment is also written to the
  audit log with that reason attached.
- **Reporting Periods** (`/admin/reporting-periods`) — create (year+month
  → `OPEN`) and lock/unlock. Locking/unlocking always prompts for a reason
  (`window.prompt`, kept deliberately lightweight rather than a modal
  component) and is rejected server-side if you try to set a period to the
  status it's already in. `lockedBy`/`lockedAt`/`lockReason` are stamped
  on the period itself in addition to the audit log entry.
- **Settings** (`/admin/settings`) — the one singleton module (`GET`/
  `PATCH`, no list, no id). Currencies and risk levels are edited as
  comma-separated text and split/trimmed into arrays; the notification
  section conditionally reveals SMTP host/port fields only when `SMTP` is
  the selected provider.
- **Audit Log** (`/admin/audit-log`) — read-only viewer over
  `db.auditLogs`, capped to the most recent 300 entries by the API route.

### Admin Dashboard (`/admin`) — the one server-rendered exception

Unlike every other admin page, `/admin/page.tsx` is a **Server Component**
that calls `readDb()` directly instead of fetching from an API route —
there's no `/api/admin/stats` endpoint. It computes everything from the
same data every other module reads/writes:

- active/total counts for users, districts, branches
- open vs. locked reporting-period counts
- the currently active scoring rule's version (via `.active`)
- a warning banner when any active branch has no derived manager or
  controller (§3) — a live cross-check across Branches and Users
- a per-role breakdown of the `users` array against `ROLE_LABELS`
- the 8 most recent `auditLogs` entries, so admin changes and login/logout
  events are visible without leaving the dashboard

---

## 8. UI shell & shared primitives

- **`src/lib/nav.ts`** — a single declarative list (`NAV_SECTIONS`) of
  every nav link and which roles can see it (`"all"` or a specific `Role[]`).
  Adding a future non-admin dashboard link means adding one entry here;
  `isNavItemVisible()` is what both the sidebar and (indirectly, via the
  proxy's own `/admin` prefix check) the route guard agree on.
- **`src/components/layout/`** — `Sidebar` (client, highlights the active
  route, filters `NAV_SECTIONS` by the session's role), `Topbar` (shows
  name/role, hosts `LogoutButton`), `LogoutButton` (client, calls
  `POST /api/auth/logout` then routes to `/login`).
- **`src/components/ui/`** — `Button` (variant-based), `Field`
  (`Input`/`Select`/`Label`), `Badge`/`StatusBadge`, `Card`/`CardHeader`/
  `StatCard`. These exist purely because the same table/form/status-pill
  shapes repeat across all 9 admin modules — kept intentionally small
  (no theming system, no variant explosion) rather than a full component
  library.
- **`src/app/(app)/layout.tsx`** — the route-group layout that actually
  requires a session (`redirect("/login")` if `getCurrentUser()` is
  `null`) and renders `Sidebar` + `Topbar` around every authenticated
  page. This is the second, page-level line of defense behind the proxy.
- **`src/app/(app)/dashboard/page.tsx`** — the landing page for every
  *non-admin* role today (role-specific findings dashboards are future
  work per the BRD's phase plan); it shows the signed-in user's org
  context and the currently open reporting period, and links into
  `/admin` only if the session's role is `ADMIN`.

---

## 9. End-to-end example: creating a Branch Manager

To make the relations above concrete, here's exactly what happens when an
admin uses `/admin/users` to assign someone as Branch Manager of "Piassa
Branch":

1. **UI**: selecting role `BRANCH_MANAGER` in the form reveals District and
   Branch selects (via the `BRANCH_SCOPED` check in the page component,
   mirroring §4). The branch dropdown is filtered to the chosen district.
2. **Client → API**: `apiSend("/api/admin/users", "POST", {...})`.
3. **Guard**: `requireRole("ADMIN")` confirms the caller's session role.
4. **Validation**: `zod` checks the shape; then
   `resolveOrgAssignment(db, { role: "BRANCH_MANAGER", branchId })` looks
   up the branch, calls `assertBranchRoleAvailable(db, branchId,
   "BRANCH_MANAGER")`, which calls `findBranchManager(db, branchId)` — if
   Piassa Branch already has an active manager, the whole request is
   rejected with a 409 and that manager's name, before anything is written.
5. **Write**: `updateDb()` pushes the new `User` (with `districtId` derived
   from the branch, not from the form) and, in the same transaction,
   `appendAuditLog()` records a `CREATE` / `User` entry.
6. **Read-back**: the Users page reloads its list; the Branches page's GET
   route now derives this user as Piassa Branch's manager via
   `findBranchManager` the next time it's opened — no field on `Branch`
   itself ever changed.
