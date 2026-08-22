# Phase 2 — Dynamic Roles & Page/Action Permissions

Phase 1 ([PHASE1.md](PHASE1.md)) shipped 7 roles as a hard-coded TypeScript
union (`Role = "ADMIN" | "HO_CONTROLLER" | ...`), and exactly one access
rule: "the Administrator role can use `/admin/*`; nobody else can." Phase 2
replaces both halves of that: roles are now data an admin manages at
`/admin/roles`, and access to each admin page is granted permission by
permission - view, create, edit, activate/deactivate, and a few page-
specific actions - rather than all-or-nothing by role.

This document explains the new system in the same depth as PHASE1.md, and
is explicit about what changed underneath so Phase 1's assumptions can be
updated.

---

## 1. The core idea: a catalog is code, a grant is data

Two things needed to become dynamic, and they're deliberately not the same
thing:

1. **Which roles exist** - now fully dynamic. An admin can create, rename,
   and permission any number of roles at runtime.
2. **Which pages/actions exist** - still defined in code, in
   [src/lib/permissions/registry.ts](src/lib/permissions/registry.ts). You
   can't grant a permission for a page that doesn't exist in the app, because
   "the Districts page" only means something because
   `src/app/(app)/admin/districts/page.tsx` and its API routes exist. Adding
   a *new* page/action still requires a code change.

What's dynamic is the **mapping** between the two: which permission keys a
given role holds. That mapping lives on `RoleDefinition.permissions: string[]`,
edited entirely through the `/admin/roles` UI - no code change needed to
grant, say, the District Director role read access to Reporting Periods.

This is the standard shape for this kind of system (a fixed permission
catalog, dynamic role→permission grants) and it's why "page then action"
works cleanly: the catalog is *organized* by page, then by the actions that
page supports.

---

## 2. The permission catalog — `src/lib/permissions/registry.ts`

```ts
interface PageDefinition {
  code: string;    // "users" - also the /admin/<code> URL segment, by convention
  label: string;   // "Users" - shown in the Roles & Permissions matrix
  actions: { action: PermissionAction; label: string }[];
}
```

Twelve pages are registered, each with the actions that page's UI/API
actually expose:

| Page code | Actions | Notes |
|---|---|---|
| `admin-dashboard` | view | The `/admin` index itself |
| `users` | view, create, edit, toggle-status | |
| `districts` | view, create, edit, toggle-status | |
| `branches` | view, create, edit, toggle-status | |
| `sources` | view, create, edit, toggle-status | |
| `categories` | view, create, edit, toggle-status | |
| `scoring-rules` | view, create, **activate** | "activate" also covers deactivate - see §6 |
| `scoring-adjustments` | view, create | create-only; adjustments are permanent records |
| `reporting-periods` | view, create, **lock** | "lock" covers both lock and unlock |
| `settings` | view, edit | singleton page, no create/toggle |
| `audit-log` | view | read-only |
| `roles` | view, **manage** | manage = create roles + edit any role's permissions |

A permission **key** is `"<pageCode>.<action>"`, e.g. `"users.create"`,
`"reporting-periods.lock"`. `permissionKey()`, `hasPermission()`,
`hasAnyPermission()`, and `isValidPermissionKey()` are the small helpers
everything else in the app is built on. `ALL_PERMISSION_KEYS` (every key -
what the Administrator role holds) and `ALL_VIEW_PERMISSION_KEYS` (every
`.view` key except `roles.view` - the Executive role's default) are
precomputed from the same table, so the catalog is the only place that
needs editing when a page/action is added.

Notice `/dashboard` (the generic post-login landing page every role sees)
is **not** in this catalog at all. It isn't part of the Administration
console the permission system governs - it stays accessible to anyone
logged in, same as Phase 1.

---

## 3. Roles are data — `RoleDefinition`

```ts
interface RoleDefinition {
  id: string;
  code: string;          // stable key - what User.role actually stores
  name: string;
  description?: string;
  orgScope: "BANK" | "DISTRICT" | "BRANCH";
  branchSingleton: boolean;  // only meaningful when orgScope === "BRANCH"
  isSystem: boolean;      // true for the 7 seeded roles
  permissions: string[];  // "<pageCode>.<action>" keys
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
  updatedAt: string;
}
```

`User.role` changed from the literal union `Role` to a plain `string` - it's
a foreign key into `db.roles` now (matched on `code`, not `id`, since `code`
is the stable, human-assigned identifier and is what's embedded in the
session cookie and audit log). This is the one type-level thing every
Phase 1 file that touched `Role` had to unlearn: there is no longer a
closed, compile-time-checkable set of role values. Whether a given `role`
string is valid is now a runtime lookup against `db.roles`, not a type
error.

### `orgScope` replaces the old hard-coded scoping arrays

Phase 1's `src/lib/org.ts` had two literal arrays,
`DISTRICT_SCOPED_ROLES` and `BRANCH_SCOPED_ROLES`, and everything derived
from checking role-string membership in them. Since roles aren't a fixed
set anymore, that scoping decision moved onto the role itself:
`RoleDefinition.orgScope`. `resolveOrgAssignment()` (§5) now looks the
role up by code and switches on `.orgScope` instead of on hard-coded
arrays - so a *new* custom role an admin creates is automatically subject
to the right district/branch requirement just by picking a scope in the
create-role form, no code change required.

### `branchSingleton` generalizes the Branch Manager/Controller rule

Phase 1's BRD constraint - "one active Branch Manager + one active Branch
Internal Controller per branch" - was two hard-coded role-name checks in
`assertBranchRoleAvailable()`. That function is now generic: it checks
`RoleDefinition.branchSingleton` for *whatever* branch-scoped role is being
assigned, and rejects the write if another active user already holds that
same role on that branch. `BRANCH_MANAGER` and `BRANCH_CONTROLLER` are
seeded with `branchSingleton: true` (preserving the exact Phase 1 rule) but
any admin-created branch-scoped role can opt into the same "one active
holder per branch" behavior via a checkbox in the Roles UI - see §8's
`REGIONAL_AUDITOR` example.

`src/lib/org.ts` still exports `findBranchManager()` /
`findBranchController()` as thin wrappers around the new generic
`findBranchRoleHolder(db, branchId, roleCode)`, purely because the Branches
admin page always wants to show those two specific BRD roles as named
columns regardless of what other branch-scoped roles exist.

---

## 4. Where permissions actually live at request time — the session cookie

Resolving "what can this user do" by reading `RoleDefinition` from
`data/db.json` on every request would work, but `src/proxy.ts` runs at the
edge and Phase 1 already established that the JSON-file store is Node-only
(`fs`). So permissions are resolved **once, at login**, and carried in the
same encrypted `iron-session` cookie as the rest of the session:

```ts
// src/lib/session.ts
interface SessionData {
  ...
  role?: string;          // the RoleDefinition.code
  roleName?: string;      // denormalized display label
  permissions?: string[]; // the full list of permission keys granted at login
}
```

`POST /api/auth/login` ([src/app/api/auth/login/route.ts](src/app/api/auth/login/route.ts))
looks up the user's `RoleDefinition` by code, **rejects the login outright
if that role has been deactivated** (`role.status !== "ACTIVE"`, a new
check that didn't exist in Phase 1), and otherwise copies
`role.permissions` straight into the session.

**The trade-off this creates, explicitly:** if an admin changes a role's
permissions while someone with that role is already logged in, the change
does not take effect until that user's *next* login - their current session
cookie still carries the old permission list. This was verified directly:
granting `BRANCH_MANAGER` a new permission had no effect on an
already-open `branch.manager` session until it logged in again. This is
the same category of trade-off Phase 1 already accepted for `User.status`
(deactivating a user doesn't invalidate their live cookie either) - see
PHASE1.md §5. A future phase could close this gap with a server-side
session/token-revocation store; for now it's a documented, deliberate
limitation of a cookie-only session design.

---

## 5. Enforcement: page-level, then action-level

The two-layer defense model from Phase 1 (proxy = convenience,
API route = the real boundary) is unchanged in shape, but each layer is now
finer-grained:

### Page level — `src/proxy.ts`

```ts
function adminPageCodeFor(pathname) {
  if (pathname === "/admin") return "admin-dashboard";
  const match = pathname.match(/^\/admin\/([^/]+)/);
  return match ? match[1] : null;
}
```

Because every page's `code` in the registry was deliberately chosen to
match its URL segment (`/admin/districts` → `"districts"`), the proxy needs
no lookup table - it derives the page code straight from the path, then
checks `hasPermission(session.permissions, "<pageCode>.view")`. No `.view`
permission → redirect to `/dashboard`, exactly like Phase 1's "non-admin
hitting `/admin/*`" redirect, just decided per-page instead of by role.

### Action level — `src/lib/guard.ts`

`requireRole("ADMIN")` is gone. Two replacements:

- **`requirePermission(...keys)`** - the direct replacement for the common
  case: "this endpoint needs one of these permissions." Used for GET (needs
  `.view`) and most POST handlers (needs `.create`).
- **`requireToggleOrEditPermission(pageCode, body, toggleField = "status")`**
  - several PATCH endpoints (Districts, Branches, Sources, Categories,
    Users) double as both "toggle active/inactive" and "general edit"
    through one handler. This helper inspects which fields are actually in
    the request body: if the *only* field present is the toggle field
    (`status`, or `active` for Sources/Categories), it requires
    `"<page>.toggle-status"`; otherwise it requires `"<page>.edit"`. That's
    real action-level granularity even though it's one route - a role can
    be given permission to deactivate users without being able to change
    their role or reset their password, for instance.

A few endpoints needed bespoke logic beyond either helper:

- **`POST /api/admin/scoring-rules`** always needs `scoring-rules.create`,
  and *additionally* needs `scoring-rules.activate` only if the request
  asks to activate the new version immediately (`activateNow: true`). A
  role with create-only can still author new rule versions; it just can't
  make one live in the same step.
- **`PATCH /api/admin/scoring-rules/[id]`** (activate/deactivate an
  existing version) is gated by `scoring-rules.activate` alone.
- **`PATCH /api/admin/reporting-periods/[id]`** (lock/unlock) is gated by
  `reporting-periods.lock` alone.
- **`/api/admin/roles`** (both create-role and edit-permissions) is gated
  by `roles.manage`; listing roles is gated by `roles.view` - the split
  matters because a role can be allowed to *see* what roles/permissions
  exist without being able to change them.

---

## 6. The Administrator lockout guard

Because permissions are now editable data, it became possible to
accidentally (or maliciously) edit the Administrator role's own access away
- including locking every admin out of the console with no path back in.
`PATCH /api/admin/roles/[id]` special-cases `code === "ADMIN"`:

- Its `permissions` can never be set to anything other than the full
  `ALL_PERMISSION_KEYS` list (any attempt to shrink it is rejected `409`).
- Its `status` can never become `"INACTIVE"` (rejected `409`).

This was verified directly against the running API: both a
permission-stripping `PATCH` and a deactivation `PATCH` against the seeded
Administrator role were rejected. Every other role, including the other
six seeded ones, has no such protection - an admin can freely narrow or
deactivate `HO_CONTROLLER`, `BRANCH_MANAGER`, etc. The guarantee is only
"there is always at least one fully-privileged way back in," not "seeded
roles can't be changed."

---

## 7. What the seeded roles actually grant now

Phase 1's seed implicitly gave six of the seven roles *zero* admin-console
access (only `ADMIN` could reach `/admin/*` at all). Phase 2's seed makes
that explicit and preserves it as the literal starting state - migrating
to Phase 2 does not silently grant anyone new access:

| Role | Seeded permissions |
|---|---|
| `ADMIN` | `ALL_PERMISSION_KEYS` - every page, every action |
| `HO_CONTROLLER`, `DISTRICT_CONTROLLER`, `DISTRICT_DIRECTOR`, `BRANCH_CONTROLLER`, `BRANCH_MANAGER` | `[]` - none; an admin must deliberately grant access via `/admin/roles` |
| `EXECUTIVE_READONLY` | `ALL_VIEW_PERMISSION_KEYS` - every `.view` key **except** `roles.view` |

Executive is the one exception, given a non-empty default because it
matches the BRD's own description of the role ("read-only management
dashboards and reports") closely enough that shipping it non-functional by
default would be a worse demonstration of the feature than a sensible
read-only default is a security risk. `roles.view` is excluded even from
Executive by default - visibility into the role/permission structure itself
stays admin-opt-in.

---

## 8. End-to-end example: a role Phase 1 couldn't express

`BRANCH_MANAGER` and `BRANCH_CONTROLLER` are the only two branch-scoped
roles Phase 1 could ever have (they were hard-coded). Phase 2 was verified
against a role that didn't exist in Phase 1 at all:

1. **Create the role** - `POST /api/admin/roles` with
   `{ code: "REGIONAL_AUDITOR", name: "Regional Auditor", orgScope: "BRANCH",
   branchSingleton: true, permissions: ["audit-log.view"] }`. No code
   change; `resolveOrgAssignment()` picks up its `BRANCH` scope purely from
   the stored `RoleDefinition`.
2. **Assign a user** - `POST /api/admin/users` with
   `role: "REGIONAL_AUDITOR", branchId: "branch-2"` succeeds and derives
   `districtId` from the branch, exactly like a Branch Manager would.
3. **The singleton rule applies automatically** - a second
   `REGIONAL_AUDITOR` user submitted for the same branch is rejected `409`
   with *"This branch already has an active Regional Auditor (...). 
   Deactivate or reassign them first"* - the same code path Branch
   Manager/Controller use, driven by `branchSingleton: true` on the new
   role rather than a hard-coded role-name check.
4. **The permission takes effect immediately for new logins** - a user
   with this role can hit `GET /api/admin/audit-log` (granted) but gets
   `403` from every other admin endpoint (not granted), and the `/admin/*`
   pages that don't match a granted `.view` permission never render for
   them (`src/proxy.ts` redirects to `/dashboard` before the page loads).

None of this required touching `src/lib/org.ts`, `src/proxy.ts`, or any
API route - the entire behavior fell out of the data-driven design in §3-§5.

---

## 9. What's still fixed, on purpose

- **The permission catalog itself** (§2) is code, not data. This is
  intentional, not a gap: a permission only means something if a page/API
  route exists to back it.
- **`/dashboard`** stays outside the permission system entirely - every
  logged-in user sees it regardless of role or permissions.
- **Session staleness** (§4) - permission and role-deactivation changes
  apply on next login, not instantly, given the cookie-only session design.
- **No hard delete for roles** - matching every other module in this app,
  a role is deactivated (`status: "INACTIVE"`), never removed. Its `code`
  and `orgScope` are also immutable after creation (§3), since existing
  users reference the code directly and `org.ts` assumes a role's scope is
  stable once users are assigned against it.
