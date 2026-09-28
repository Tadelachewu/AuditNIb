# Admin & Settings — Deep Reference

This document is a code-grounded reference for the **Administration** area of NIB Control360 (ICFMS): every page under `src/app/(app)/admin/**`, every route under `src/app/api/admin/**`, the RBAC permission system that gates all of it, reporting-period lifecycle, reference-data (org unit) management, and the dev-reset tool. Every non-trivial claim below cites `file:line`.

---

## 1. Overview

### Who can reach `/admin`

There is **no role check anywhere in the admin area** — access is 100% permission-based, not role-based:

- `src/proxy.ts` maps every `/admin/<code>` URL to a page code and requires `<code>.view` on the caller's session permissions before letting the request through (`src/proxy.ts:17-30`, `src/proxy.ts:155-158`). It reads `session.permissions`, a snapshot taken at login time from the user's role (see §2.5), not the user's role string itself.
- The admin landing page (`/admin`) additionally does its own inline check: `hasPermission(user.permissions, permissionKey("admin-dashboard", "view"))`, redirecting to `/dashboard` otherwise (`src/app/(app)/admin/page.tsx:8-11`).
- The sidebar (`src/lib/nav.ts`) only *shows* an Administration link when the session holds the matching `<code>.view` permission (`src/lib/nav.ts:76-111`, `isNavItemVisible` at `src/lib/nav.ts:115-120`) — this is presentation only, not the security boundary (see §2.4).
- In the seed data, only the **Administrator (ADMIN)** role is granted every admin-dashboard/users/roles/settings/audit-log permission out of the box (`prisma/seedData.ts:274-373`), and only ADMIN gets `roles.manage` initially. But because permissions are just data on `RoleDefinition.permissions`, an admin can grant any subset of admin capabilities to any other role at `/admin/roles` (e.g. give HO Controller view access to Users). Nothing in the code hard-codes "only ADMIN can reach `/admin`."

### Admin sub-sections (from `src/app/(app)/admin/`)

| Path | Page code | Purpose |
|---|---|---|
| `/admin` | `admin-dashboard` | Landing dashboard: stat tiles (active users/districts/branches, open/locked periods, active scoring rule version), branches missing a Manager/Controller, quick links, recent audit log (`src/components/dashboard/AdminDashboard.tsx:34-77`). |
| `/admin/users` | `users` | User lifecycle: create/edit/deactivate (no hard delete except zero-activity accounts). |
| `/admin/districts` | `districts` | District reference data. |
| `/admin/branches` | `branches` | Branch reference data (belongs to a district). |
| `/admin/sources` | `sources` | Finding "source" reference list (e.g. Internal Control, Internal Audit). |
| `/admin/departments` | `departments` | Department reference list, itself org-scoped (BANK/DISTRICT/BRANCH). |
| `/admin/uncovered-reasons` | `uncovered-reasons` | Canned reason list for the Uncovered Branches report. |
| `/admin/categories` | `categories` | Classified (irregularity) categories, each with a `scored` flag. |
| `/admin/scoring-rules` | `scoring-rules` | Versioned performance-scoring formula config. |
| `/admin/scoring-adjustments` | `scoring-adjustments` | Manual overrides to computed performance scores. |
| `/admin/reporting-periods` | `reporting-periods` | Reporting period CRUD + OPEN/LOCKED lifecycle. |
| `/admin/roles` | `roles` | Role & permission management (the RBAC control panel). |
| `/admin/settings` | `settings` | Bank-wide operational settings (notification delivery, dropdown lists, HO approval, required fields, etc.). |
| `/admin/audit-log` | `audit-log` | Paginated, hash-chain-verified audit trail viewer. |
| `/admin/support` | `support` (`view`/`respond`) | Staff-side support inbox — every user's support threads, not just the admin's own. |

Additionally, `/dev-reset` exists **outside** `/admin/*` on purpose (see §6) and is not linked from the nav at all.

---

## 2. Roles & Permissions management

### 2.1 The permission model — how keys are structured

The entire catalog lives in `src/lib/permissions/registry.ts`. Every permission is a **page × action** pair:

```ts
export function permissionKey(pageCode: string, action: PermissionAction | string): string {
  return `${pageCode}.${action}`;
}
```
(`src/lib/permissions/registry.ts:217-219`)

- `PAGE_REGISTRY: PageDefinition[]` (`registry.ts:75-215`) is the static catalog of every page in the app (admin pages **and** every role's dashboard/workflow page) plus the list of actions each one supports. This list is static — "you can't grant a permission for a page that doesn't exist" (`registry.ts:1-14`) — but **which roles hold which keys is fully dynamic**, stored on `RoleDefinition.permissions: string[]` and edited at `/admin/roles`.
- `ALL_PERMISSION_KEYS` (`registry.ts:229-231`) flattens the whole registry into every valid `"page.action"` string — this is exactly what the ADMIN role's `permissions` array is seeded with (`prisma/seedData.ts:373`).
- `ALL_VIEW_PERMISSION_KEYS` (`registry.ts:234-236`) is every `.view` key except `roles.view` — the seeded default for the read-only Executive role.
- `isValidPermissionKey(key)` (`registry.ts:249-253`) validates a `"page.action"` string against the registry — both role-create and role-edit API routes reject any key that fails this check (`src/app/api/admin/roles/route.ts:49-52`, `src/app/api/admin/roles/[id]/route.ts:35-40`).

### 2.2 Full resource/action matrix (from `PAGE_REGISTRY`)

| Page code | Label | Actions |
|---|---|---|
| `admin-dashboard` | Admin Dashboard | view |
| `branch-dashboard` | Branch Dashboard | view |
| `findings` | Findings | view, create, edit, delete, submit, district-review, ho-review, bank-approval, rectify, verify-rectification, return-rectification *(legacy)*, district-return-rectification, ho-return-rectification, close, transfer, evidence, comment, import |
| `reports` | Reports | view (labeled "View Standard Reports") |
| `report-templates` | Report Templates | view, uncovered-branches, category-detail-by-district, monthly-summary, monthly-district-history, monthly-district-detail, district-ranking-other-cases, weekly-executive-summary, district-ranking-all-cases, category-performance-summary, mid-month-district-snapshot, transferred-findings |
| `district-dashboard` | District Dashboard | view |
| `ho-dashboard` | HO Dashboard | view |
| `executive-dashboard` | Executive Dashboard | view |
| `users` | Users | view, create, edit, toggle-status, delete *(delete only ever succeeds for a zero-activity account)* |
| `districts` | Districts | view, create, edit, toggle-status, delete |
| `branches` | Branches | view, create, edit, toggle-status, delete |
| `sources` | Sources | view, create, edit, toggle-status, delete |
| `departments` | Departments | view, create, edit, toggle-status, delete |
| `uncovered-reasons` | Uncovered Branch Reasons | view, create, edit, toggle-status, delete |
| `categories` | Classified Categories | view, create, edit, toggle-status, delete |
| `scoring-rules` | Scoring Rules | view, create, edit, delete, activate *(edit/delete only on a version that never went live)* |
| `scoring-adjustments` | Scoring Adjustments | view, create, toggle-status *(never edit or delete — permanent record)* |
| `reporting-periods` | Reporting Periods | view, create, lock (labeled "Lock / Unlock"), delete |
| `settings` | Settings | view, edit |
| `audit-log` | Audit Log | view |
| `roles` | Roles & Permissions | view, manage |
| `support` | Support | view, create, respond |

Source: `src/lib/permissions/registry.ts:75-215`.

Notable design points documented inline in the registry:
- **`findings.bank-approval`** is a *distinct* permission from `findings.ho-review`, layered on top of `Settings.hoApproval.approverUserIds` — a role needs the permission *and* the specific user must be hand-picked into the approver list (`registry.ts:93-105`, enforced in `bank-approval/route.ts`).
- **`findings.verify-rectification`** (District's approval of a recorded rectification) is split from **`findings.close`** (final closure) and from **`district-return-rectification`**/**`ho-return-rectification`** (bounce-back at each stage), so a role can hold any subset independently (`registry.ts:106-121`).
- **`support`** has 3 independent actions: `create` = requester-side (send/continue your own thread), `view`/`respond` = staff-side inbox (every user's threads) — a `respond`-only role still needs `view` OR `respond` to reach the inbox at all, since `respond` alone gives no way to find a thread (`registry.ts:200-214`).
- Reference-data pages (Districts/Branches/Sources/Categories/Departments/Uncovered-Reasons/Roles) get a real `delete` action because they're pure config data — by contrast **Users never gets `delete`** in the BRD sense (create/edit/deactivate/reactivate only) for audit-integrity reasons, though a narrow zero-activity delete route exists anyway (`registry.ts:69-74`, `159-165`).

### 2.3 Creating / editing a role

`GET /api/admin/roles` returns both the role list and the full `PAGE_REGISTRY` in one response so the UI can render the whole matrix without a second round trip (`src/app/api/admin/roles/route.ts:9-23`).

**Create** (`POST /api/admin/roles`, requires `roles.manage`):
- `code` must be `UPPER_SNAKE_CASE` starting with a letter, `orgScope` ∈ `BANK|DISTRICT|BRANCH`, `branchSingleton` only meaningful when `orgScope === BRANCH` (`src/app/api/admin/roles/route.ts:25-35, 65-66`).
- Every permission key in the request is validated against `isValidPermissionKey` (`route.ts:49-52`).
- New roles are always `isSystem: false` — only the 7 seeded system roles are `isSystem: true` (`route.ts:37-38, 67`).

**Edit** (`PATCH /api/admin/roles/[id]`, requires `roles.manage`):
- `code` and `orgScope` are **never editable** — existing users reference `role` by code, and org-scoping logic assumes `orgScope` is stable once users exist against it. Only `name`/`description`/`permissions`/`branchSingleton`/`status` can change (`src/app/api/admin/roles/[id]/route.ts:18-23`).
- **The one line ADMIN can't cross**: the Administrator role's permissions can be freely narrowed (deliberately, e.g. to require a second admin's sign-off on Roles access), *except* it must always retain `roles.manage` — removing it would permanently lock every admin out of the Roles screen with no way back in. Attempting to strip it or to deactivate ADMIN returns `409` (`roles/[id]/route.ts:46-64`). This is also enforced client-side by disabling that one checkbox in the UI (`src/app/(app)/admin/roles/page.tsx:309-317`), but the **real** boundary is the API check.

**Delete** (`DELETE /api/admin/roles/[id]`, requires `roles.manage`):
- System roles (`isSystem: true`) can never be deleted, only deactivated — returns `409` (`roles/[id]/route.ts:123-125`).
- Any role — system or custom — with ≥1 user still holding it (`User.role === code`) is blocked from deletion with a `409` naming the count (`roles/[id]/route.ts:127-133`).

**Deactivate** a role: sets `status: "INACTIVE"`. Existing sessions for users on that role are unaffected until they next log in (permissions are a login-time snapshot — see §2.5); the role becomes unassignable to new/edited users via `resolveOrgAssignment`'s active-role check (`src/lib/org.ts:120-122`). The Roles UI states this explicitly in its confirm dialog (`src/app/(app)/admin/roles/page.tsx:124-129`).

### 2.4 "UI scope is not a security boundary" — proof of server-side re-checks

The registry's own header comment states the standing rule: *"Nothing should be reachable by role alone once it has a registry entry — only by permission"* (`registry.ts:9-14`). This is enforced at three independent layers, and the middle one is explicitly called out as convenience-only:

1. **Middleware (`src/proxy.ts`)** — redirects at the edge for `/admin/*` and `/findings/*` page loads. Its own comment: *"This is a UX convenience only — the actual authorization boundary is enforced again, action by action, in every API route via `requirePermission()`... since middleware/UI checks can never be trusted alone"* (`proxy.ts:8-16`).
2. **Nav visibility (`src/lib/nav.ts`)** — hides sidebar links for permissions not held; purely cosmetic.
3. **API-route guard (`src/lib/guard.ts`)** — the actual boundary. Its doc comment: *"The UI hides links and routes for permissions a user doesn't hold, and `src/proxy.ts` redirects at the edge, but those are convenience only — every mutating or data-returning API route must call this... itself, since the client can never be trusted to enforce access control"* (`guard.ts:15-21`).

Concrete proof every admin route re-checks server-side (not an exhaustive list, but representative — every `route.ts` under `src/app/api/admin/**` follows this pattern):
- `requirePermission("roles.view")` — `src/app/api/admin/roles/route.ts:10`
- `requirePermission("roles.manage")` — `roles/route.ts:40`, `roles/[id]/route.ts:25`, `115`
- `requirePermission("users.view")` — `src/app/api/admin/users/route.ts:23`
- `requirePermission("users.create")` — `users/route.ts:66`
- `requireToggleOrEditPermission("users", input)` — `users/[id]/route.ts:51` (splits `users.toggle-status` vs `users.edit` based on which fields are in the PATCH body — see `guard.ts:58-66`)
- `requirePermission("users.delete")` — `users/[id]/route.ts:223`
- `requirePermission("reporting-periods.view"/"create"/"lock"/"delete")` — `reporting-periods/route.ts:10,56`, `reporting-periods/[id]/route.ts:70,237`
- `requirePermission("settings.view"/"edit")` — `settings/route.ts:8,105`
- `requirePermission("audit-log.view")` — `audit-log/route.ts:23`
- `requirePermission("support.view", "support.respond")` (any-of) — `support/route.ts:10`

`requirePermission()` itself (`guard.ts:42-49`) calls `requireUser()` first (401 if no session), then `hasAnyPermission(session.permissions, keys)` (403 otherwise) — so an unauthenticated *or* under-permissioned request is rejected before any database read happens, regardless of what the UI would have shown.

Additionally, several admin routes layer **org-scope defense-in-depth** on top of the permission check — e.g. `POST /api/admin/users` explicitly re-derives that even if a non-BANK-scoped role were ever granted `users.create` (not the case today — it's seeded ADMIN-only), it could still only create users inside its own district/branch and never assign a bank-wide role (`users/route.ts:98-116`). The code comments are explicit that this is "defense in depth, not a live restriction today," since permissions are dynamic data an admin could reassign later.

### 2.5 Permissions are a login-time snapshot (gotcha)

`session.permissions` is set once, at login, from the user's role (`src/app/api/auth/login/route.ts:152` sets `session.permissions = role.permissions`) and carried in the encrypted iron-session cookie. `getCurrentUser()` (`src/lib/session.ts:87-95`) only re-validates `sessionVersion` and account `status` on each request (a cheap indexed lookup) — it does **not** re-read the role's current permission set. This means: **editing a role's permissions at `/admin/roles` does not take effect for already-logged-in holders of that role until they log out/in again** (or their session is otherwise invalidated by a password reset, which bumps `sessionVersion` — `users/[id]/route.ts:172-173`). There is no explicit re-issue-all-sessions step wired to a role-permission edit.

### 2.6 Default seeded roles

`prisma/seedData.ts:364-469` seeds **8 roles total**, of which **7 are `isSystem: true`** (protected from deletion) and 1 (`BRANCH_SUB_MANAGER`) is seeded but `isSystem: false`:

| Code | Name | orgScope | branchSingleton | isSystem | Default permission highlights |
|---|---|---|---|---|---|
| `ADMIN` | Administrator | BANK | false | **true** | `ALL_PERMISSION_KEYS` — literally every permission in the registry (`seedData.ts:373`). |
| `HO_CONTROLLER` | Head Office Internal Controller | BANK | false | **true** | Full reference-data `view`, `reporting-periods.lock`, `settings.view`, `audit-log.view`, findings create/edit/delete/submit/**ho-review**/**bank-approval**/close/ho-return-rectification/comment/import, all report-templates, `ho-dashboard.view` (`seedData.ts:274-302`). |
| `DISTRICT_CONTROLLER` | District Internal Controller | DISTRICT | false | **true** | Reference-data view, `reporting-periods.lock`, findings **district-review**/**verify-rectification**/**district-return-rectification**/close/transfer/comment, reports + templates, `district-dashboard.view` (`seedData.ts:303-323`). |
| `DISTRICT_DIRECTOR` | District Director | DISTRICT | false | **true** | Read/oversight only — reference-data view, findings view+comment (no review/rectify/close), reports + templates, `district-dashboard.view` — explicitly "cannot modify findings or scores" (`seedData.ts:324-338, 408`). |
| `BRANCH_CONTROLLER` | Branch Internal Controller | BRANCH | **true** | **true** | `branch-dashboard.view`, findings create/edit/delete/submit/**rectify**/evidence/comment (`seedData.ts:339-353`). |
| `BRANCH_MANAGER` | Branch Manager | BRANCH | **true** | **true** | `branch-dashboard.view`, findings view/**rectify**/evidence/comment (no create/submit) (`seedData.ts:354-362`). |
| `BRANCH_SUB_MANAGER` | Branch Sub-Manager | BRANCH | **true** | **false** | Identical permission set to Branch Manager — "Deputy for the Branch Manager" (`seedData.ts:443-455`). Since it's not `isSystem`, it *can* be deleted via `/admin/roles` once no user holds it. |
| `EXECUTIVE_READONLY` | Executive (Read-only) | BANK | false | **true** | `ALL_VIEW_PERMISSION_KEYS` (every `.view` except `roles.view`) + all report-templates — read-only oversight bank-wide (`seedData.ts:456-468`). |

Each `BRANCH`-scoped role above has `branchSingleton: true`, meaning at most one active user per branch may hold that role at a time (enforced by `assertBranchRoleAvailable` — `src/lib/org.ts:41-61`).

Seeded demo users (one per role) exist at `prisma/seedData.ts:471-577` (e.g. `admin` / `Admin@123`).

---

## 3. User management

### 3.1 Creating a user

`POST /api/admin/users`, requires `users.create` (`src/app/api/admin/users/route.ts:65-67`):
- `name` required; `username` ≥3 chars, `[a-zA-Z0-9._-]` only (`route.ts:43-46`); `email` required + RFC email format (`route.ts:47`); `phone` **optional**, loosely validated `[+0-9()\-.\s]{6,20}` — "international formats vary too much for a strict pattern" (`route.ts:52-57`); `password` ≥8 chars at the schema level, then re-validated by `validatePasswordFull` (§3.2); `role` required; `districtId`/`branchId` optional (resolved from role's `orgScope`).
- Username and email uniqueness enforced case-insensitively (`route.ts:82-87`).
- Org unit assignment goes through `resolveOrgAssignment()` (`src/lib/org.ts:113-130`), which derives district/branch from the role's `orgScope` and enforces `branchSingleton`.
- Department, if given, must be `active` and must satisfy `isDepartmentExactScopeForUser` — a branch-scoped user needs a branch-scoped department at *that exact branch*, a district-scoped user a district-scoped department at *that exact district*, a bank-scoped user only a bank-wide department (`route.ts:118-127`, `org.ts:157-165`).
- The account is created with `mustChangePassword: true` and `passwordExpiresAt` set to **24 hours** from creation (`route.ts:145-151`) — the admin-chosen password is a one-time credential; `src/proxy.ts:151-153` force-redirects the user to `/profile` on every page until they set their own password, and the login route separately rejects an expired temporary password.

### 3.2 Password rules (`src/lib/passwordValidation.ts`)

`validatePasswordStrength()` (`passwordValidation.ts:49-69`) — synchronous, local-only checks used everywhere a password is set:
- Minimum **8 characters**
- At least one **lowercase** letter
- At least one **uppercase** letter
- At least one **digit**
- At least one **special character** (`[^A-Za-z0-9]`)
- Not present in a local blocklist of ~75 common/guessed passwords (`passwordValidation.ts:20-37`)

`validatePasswordFull()` (`passwordValidation.ts:109-117`) additionally checks the password against the **Have I Been Pwned** breach database via its k-anonymity range API — only the first 5 hex chars of the SHA-1 hash are ever sent; the full hash/plaintext never leaves the server (`passwordValidation.ts:71-100`). It **fails open**: a network error/timeout is treated as "not breached" so an HIBP outage never blocks a legitimate password change (`passwordValidation.ts:77-81`). This full check is used on every password-setting path: self-service change, admin-create-user (`users/route.ts:76-79`), and admin-reset-user-password (`users/[id]/route.ts:83-88`).

The doc comment ties this directly to a named security finding: *"security/ChatBot_VA_Report_Analysis.md's VA-006 ('Weak Password Policy Enforcement')"* — previously every password endpoint only checked `min(8)` (`passwordValidation.ts:7-12`).

### 3.3 Editing / deactivating / deleting a user

`PATCH /api/admin/users/[id]`:
- Gated by `requireToggleOrEditPermission("users", input)` — a pure `{status}` body needs only `users.toggle-status`; anything touching name/email/phone/role/org/password needs `users.edit` (`users/[id]/route.ts:51`, `guard.ts:58-66`).
- Resetting a password (`input.password` present) forces `mustChangePassword: true` again, resets the 24h expiry, **and bumps `sessionVersion`**, which immediately invalidates every session the user currently has open elsewhere — "an admin resetting a password is very often a 'this account may be compromised' action" (`users/[id]/route.ts:161-174`).
- Email uniqueness is re-checked (case-insensitive) excluding the user's own row (`users/[id]/route.ts:90-92`).

`DELETE /api/admin/users/[id]` (requires `users.delete`): only succeeds for a user with **zero** recorded activity across 12 different reference checks (findings created, transitions, rectifications, itemized cases, transfers, closures, import batches, evidence, comments, coverage notes, scoring rules, scoring adjustments) and who is not a designated HO-approval approver — otherwise `409` naming the blocking count (`users/[id]/route.ts:206-254`). In practice this only ever fires for an account created by mistake minutes ago; every real account must be deactivated (`status: INACTIVE`), never deleted.

### 3.4 Phone field

Added in migration `prisma/migrations/20260923130000_user_phone/migration.sql`:
```sql
ALTER TABLE "users" ADD COLUMN "phone" TEXT;
```
`User.phone` is `String?` at the schema level (`prisma/schema.prisma:176`), optional and nullable (unlike `email`). It is validated the same loose way on both create (`users/route.ts:52-57`) and edit (`users/[id]/route.ts:26-28`), and is **admin-set/changed only** — same access rule as email (schema comment at `schema.prisma:173-176`). It displays read-only on `/profile` (`src/app/(app)/profile/page.tsx:60-63`).

### 3.5 Why email is not self-editable by the user

`/profile` (`src/app/(app)/profile/page.tsx`) renders the user's account fields (name, username, role, org unit, department, **email**, phone, last login) inside a card explicitly labeled *"Set by an administrator — contact one to change any of this"* (`profile/page.tsx:34`) — the page is entirely read-only for these fields; the only interactive element is `<ProfileClient forced={...}/>`, which is the self-service **password change** form only (`profile/page.tsx:71`). There is no client-side or API path for a logged-in user to edit their own email.

Git history confirms this was a deliberate fix: commit `1ca22dd` ("...email not edited by user...") **deleted** a pre-existing self-service endpoint `src/app/api/auth/email/route.ts` (57 lines removed) while also touching `profile/page.tsx` and `admin/users/page.tsx` (`git show --stat 1ca22dd`). Today, email is **admin-editable only**, through `PATCH /api/admin/users/[id]` (`users/[id]/route.ts:19-22`, `158`) — mandatory, unique, and re-validated on every edit, since (per its own schema comment) it's load-bearing for the Forgot Password flow, every workflow notification, and the username-or-email login lookup (`schema.prisma:163-171`).

### 3.6 Role and org-scope assignment

A user's org placement is fully derived from their **role's** `orgScope`, via `resolveOrgAssignment()` (`src/lib/org.ts:113-130`):
- `BANK`-scoped role → no district/branch.
- `DISTRICT`-scoped role → district required, no branch.
- `BRANCH`-scoped role → branch required (district auto-derived from the branch); if `RoleDefinition.branchSingleton` is true, at most one active user may hold that exact role at that exact branch (`org.ts:41-61`) — e.g. only one active `BRANCH_MANAGER` per branch.

The Users admin page and both create/edit API routes drive district/branch/department pickers off this same resolver, so an inconsistent assignment (e.g. a district user with a branchId, or two active Branch Managers on one branch) is rejected server-side regardless of what the form sent.

---

## 4. Reporting periods

### 4.1 Creation

`POST /api/admin/reporting-periods` (requires `reporting-periods.create`): takes `startsAt`/`endsAt` (the reporting window) plus an independent `submissionStartsAt`/`submissionEndsAt` window (may run earlier/later than the period itself — e.g. a grace window) — `year`/`month`/`code` (`YYYY-MM`) are derived from `startsAt`, not entered separately, so there's one source of truth (`reporting-periods/route.ts:32-54`). Duplicate `code` is rejected with `409` (`route.ts:73-75`).

**A period is created `LOCKED` by default**, not `OPEN` — it must be deliberately opened by an admin before the full submit/review/rectify workflow is available, though `draftsAllowedWhileLocked` defaults to `true` so registration work isn't blocked in the meantime (`route.ts:78-98`).

### 4.2 The OPEN ↔ LOCKED lifecycle

`PATCH /api/admin/reporting-periods/[id]` (requires `reporting-periods.lock`) drives every status change. A `reason` of ≥5 characters is required on every call (`reporting-periods/[id]/route.ts:15`), and it's recorded on the period (`lockReason`) and in the audit log (`route.ts:145-170`). The route also supports:
- **Flag-only touch-ups** on an already-LOCKED period (toggling `draftsAllowedWhileLocked` without a full unlock/relock cycle) (`route.ts:9-20`).
- **Editing the submission window** independently of lock status.
- **Editing the period's own `startsAt`/`endsAt`** — only permitted while the period has **zero** findings referencing it, since reference-number sequences, dedupe keys, and every period-scoped stat are already keyed off the current dates (`route.ts:94-117`).
- **Optional automatic transfer**: on a genuine `OPEN → LOCKED` transition, if the locking admin explicitly opts in (`transferOverdueCases: true`, only offered when `Settings.autoTransferOnLock` is enabled), `autoTransferOnLock()` sweeps that period's still-outstanding findings forward into the next `OPEN` period (`route.ts:172-194`, `src/lib/findings.ts:116`).
- Both `LOCK` and `UNLOCK` transitions notify every user holding `findings.district-review` or `findings.rectify` (`route.ts:196-213`).

**Locking is fully reversible** — `PATCH` with `status: "OPEN"` on a `LOCKED` period unlocks it, subject to the same `reason` requirement (`route.ts:14, 126-131`).

### 4.3 What exactly does LOCKED prevent? (every guard checked)

The central gate is `assertPeriodWritable(db, periodId, editingFindingStatus?)` (`src/lib/findings.ts:463-471`):
```ts
export function assertPeriodWritable(db: Database, periodId: string, editingFindingStatus?: FindingStatus): string | null {
  const period = db.reportingPeriods.find((p) => p.id === periodId);
  if (!period) return "Reporting period not found";
  if (period.status === "LOCKED") {
    if (editingFindingStatus === "DRAFT" && period.draftsAllowedWhileLocked) return null;
    return `${period.code} is locked and cannot accept changes`;
  }
  return null;
}
```
Rule: a `LOCKED` period is a **hard stop for every write** — edit, delete, submit, district review, HO review, bank-approval, rectify, close — *except* saving/editing a finding that is still `DRAFT`, and only when the period's own `draftsAllowedWhileLocked` flag is set. Submitting (moving a finding past `DRAFT`) never passes `editingFindingStatus`, so it is **never** exempted — a draft can be worked on in a locked-but-draftable period, but cannot progress until the period is genuinely `OPEN` (`findings.ts:446-461`).

Confirmed call sites (every mutating findings-workflow route re-checks the *current* period status, not a value cached earlier):
- `src/app/api/findings/[id]/route.ts:109,140,261` — edit/delete of an existing finding, and moving a finding to a different (target) period.
- `src/app/api/findings/[id]/submit/route.ts:32` — submitting past DRAFT (plus `assertPeriodOpenForSubmission` — see below).
- `src/app/api/findings/[id]/district-review/route.ts:60` — district approve/reject/return.
- `src/app/api/findings/[id]/ho-review/route.ts:57` — HO approve/reject/return.
- `src/app/api/findings/[id]/bank-approval/route.ts:75` — bank-wide approval stage.
- `src/app/api/findings/[id]/rectify/route.ts:78` — recording a rectification.
- `src/app/api/findings/[id]/return-rectification/route.ts:139` — bouncing a rectification back.
- `src/app/api/findings/[id]/resubmit-rectification/route.ts:40` — resubmitting after a return.
- **New finding creation** (`src/app/api/findings/route.ts:152-160`) has its own inline check rather than calling `assertPeriodWritable` (there's no existing finding row to read a `periodId` off yet): a `LOCKED` period without `draftsAllowedWhileLocked` rejects creation outright (`409`); even a drafts-allowed `LOCKED` period rejects `submit: true` in the same call (create-and-submit-in-one-request is blocked exactly like a two-step submit would be).
- **Deliberately exempt**: `src/app/api/findings/[id]/transfer/route.ts:23` explicitly skips `assertPeriodWritable()` — transferring a finding *out of* its current (often just-locked) period into a new one is the intended escape valve, not a write that should be blocked by the very lock that motivated it.

A second, narrower gate, `assertPeriodOpenForSubmission()` (`findings.ts:493-502`), tightens the `OPEN` case further: even an `OPEN` period stops accepting new *submissions* (not draft saves) once today's date falls outside its `submissionStartsAt`/`submissionEndsAt` window — independent of whether anyone has flipped its status to `LOCKED` yet.

### 4.4 Deletion

`DELETE /api/admin/reporting-periods/[id]` (requires `reporting-periods.delete`) only succeeds if the period is referenced by **zero** findings, scoring adjustments, rectifications, closures, or transfers (checked individually, each with its own `409` message) — stricter than the edit-date-range gate, since some of those relations (`RectificationEntry.periodId`, `FindingClosure.periodId`, `FindingTransfer.fromPeriodId/toPeriodId`) are plain unconstrained string columns at the DB level, not real foreign keys, so deleting a referenced period would otherwise silently orphan historical records (`reporting-periods/[id]/route.ts:221-291`).

---

## 5. Reference data management

All six reference-data types (Districts, Branches, Sources, Departments, Uncovered-Branch Reasons, Classified Categories) follow the same two-tier pattern: a **soft toggle** (`status`/`active` ACTIVE↔INACTIVE) for routine use, and a **real hard delete** guarded by reference-count checks, since — per the registry's own note — these are "pure reference/config data" so genuine cleanup is legitimate, unlike Users (`registry.ts:69-74`).

| Entity | Toggle field | Hard-delete blocked by | Hierarchy |
|---|---|---|---|
| District | `status` | Any branch (`branches.filter(districtId)`) or user (`users.filter(districtId)`) still pointing at it (`districts/[id]/route.ts:62-72`) | Top-level; owns Branches. |
| Branch | `status` | Any user still assigned (`branchId`) to it (`branches/[id]/route.ts:66-72`) | Belongs to exactly one District (`Branch.districtId`, FK `onDelete: Restrict` — `schema.prisma:231-232`); create requires an existing `districtId` (`branches/route.ts:53-55`). |
| Source | `active` | Any scoring rule version referencing it (`sources/[id]/route.ts:61-67`) — **note:** findings referencing a source are *not* checked at the application level, but `Finding.sourceId` is a real DB foreign key with `onDelete: Restrict` (`schema.prisma:395-396`), so the Postgres layer itself blocks the delete if a finding uses it. |
| Department | `active` | Any finding referencing it (`departments/[id]/route.ts:81-87`); also FK-`Restrict`ed for `User.departmentId`/`Finding.departmentId` at the DB level (`schema.prisma:189, 398`). Own `orgScope` (BANK/DISTRICT/BRANCH) resolved via `resolveOrgScope()` (`org.ts:78-98`). | Optionally scoped to a District or Branch. |
| Uncovered Reason | `active` | Any `BranchCoverageNote` referencing it (`uncovered-reasons/[id]/route.ts:60-66`) | Flat list. |
| Classified Category | `active` | Any scoring rule version referencing it (`categories/[id]/route.ts:62-68`) — **note:** `Finding.categoryId` is *deliberately not a real foreign key at all* (`schema.prisma:408-420` — "a real FK constraint would reject exactly the values this column exists to hold," since free-typed "Other" values are allowed on this field), and the DELETE route does not check `db.findings` either. **This is a genuine gap**: deleting a category that active findings reference will succeed, leaving those findings' `categoryId` pointing at a row that no longer exists (see §8). | Flat list; each has a `scored: boolean` flag consumed by the scoring engine. |

All six list endpoints are gated by `<page>.view`; create by `<page>.create`; the shared `PATCH` handler infers `<page>.toggle-status` vs `<page>.edit` from which fields are present in the body via `requireToggleOrEditPermission()` (`guard.ts:58-66`) — e.g. a `{active: true}`-only PATCH needs only the toggle permission, a `{name: "..."}` PATCH needs the edit permission.

Scoring Rules and Scoring Adjustments (also under `/admin`, though not named in this task's org-unit list) have their own stricter immutability rules worth noting: a scoring rule version that has ever gone live (`everActivated: true`) can never again be edited or deleted, only superseded by a new version (`scoring-rules/[id]/route.ts:11-17, 79-84, 113-128`); scoring adjustments can never be deleted at all, only deactivated, to preserve the permanent record (`registry.ts:183-188`).

---

## 6. Dev-reset (`/dev-reset` + `POST/GET /api/admin/dev-reset`)

### 6.1 What it wipes

`resetRegisteredData()` (`src/lib/devResetRegisteredData.ts:72-141`) mutates the in-memory `Database` object inside `updateDb()`, precisely:

- **Cleared entirely**: `findings`, `findingTransitions`, `rectifications`, `findingTransfers`, `findingClosures`, `findingCases`, `importBatches`, `scoringAdjustments`, `branchCoverageNotes`, `evidence` (and the physical evidence files on disk, via `fs.unlinkSync` — `devResetRegisteredData.ts:90-99`), `comments`.
- **Filtered, not cleared**: `notifications` and `auditLogs` keep every entry that is **not** `entityType === "Finding"` — a role/settings/user change stays in the audit trail; only Finding-scoped entries are dropped (`devResetRegisteredData.ts:113-119`).
- **Reset, not cleared**: any `LOCKED` reporting period is flipped back to `OPEN` with its lock fields cleared (its lock almost always existed *because of* the now-deleted findings) — the period record itself (id/year/month/code/date range) is preserved (`devResetRegisteredData.ts:121-132`).
- **Never touched**: `users`, `roles`, `districts`, `branches`, `sources`, `departments`, `categories`, `uncoveredReasons`, `scoringRules`, `permissionRegistrySyncedKeys`, `settings` — every piece of admin configuration survives (`devResetRegisteredData.ts:68-70`).

### 6.2 Safety gating — thorough, layered, and I found no gap

This is one of the most heavily-gated features in the codebase, not an under-protected one:

1. **Environment gate**, checked independently in *two* places:
   - `isDevResetEnabled()` returns `process.env.NODE_ENV !== "production"` (`devResetRegisteredData.ts:38-40`).
   - The API route calls it first, before even checking auth, and returns a bare `404 Not Found` (not a 403, so as not to reveal the route exists) when disabled (`src/app/api/admin/dev-reset/route.ts:15-24`).
2. **Role gate**: requires the caller to be authenticated *and* to literally hold `role === "ADMIN"` — not merely a permission a custom role happens to hold — "since this is far more destructive than anything else the permission system gates" (`dev-reset/route.ts:12-14, 21-23`).
3. **Explicit confirmation phrase**: `POST` requires the request body's `confirm` field to exactly equal the literal string `"DELETE ALL FINDINGS"`, checked server-side (`dev-reset/route.ts:51, 58-60`) — the UI additionally disables its own submit button until the typed text matches (`src/app/(app)/dev-reset/page.tsx:172`), but the server-side string comparison is the real gate.
4. **`GET` pre-flight**: returns live row counts per collection so the confirmation screen can show "this will delete 42 findings..." before the admin commits (`dev-reset/route.ts:27-49`).
5. **Not reachable via the UI at all in production** and **not linked from anywhere in the app**: the page lives at the top-level `/dev-reset` (not `/admin/dev-reset`) specifically *because* `src/proxy.ts`'s blanket `/admin/<code>.view` rule has no registry entry for a `dev-reset` page code and would otherwise silently redirect *everyone, including Admin*, away before the page or even the API route ever ran (`devResetRegisteredData.ts:19-24`, `dev-reset/page.tsx:11-23`). It is deliberately excluded from `src/lib/nav.ts`. Both the module and the route comment that this is by design, not an oversight — the page component itself "has no security logic of its own to begin with" (`dev-reset/page.tsx:20-22`), because the two checks inside the API route are what actually matter.
6. **Audit trail**: the reset itself leaves one `DEV_RESET_REGISTERED_DATA` audit-log entry (entityType `"Settings"`) recording who ran it and the full summary — deliberately exempt from the Finding-audit-log purge the reset itself just performed, since it's a system-administration event, not a Finding event (`dev-reset/route.ts:66-74`).
7. **Removal instructions are included in the code**: the module's header comment lists the exact 3 files to delete to remove the feature entirely before a production release (`devResetRegisteredData.ts:29-35`), reinforcing that `NODE_ENV=production` alone is considered sufficient without deleting the files, but deletion is offered as belt-and-suspenders.

**Conclusion: this feature is safely gated.** No path was found where a production deployment (`NODE_ENV=production`) or a non-ADMIN session could reach either the page's data or the destructive endpoint. The only theoretical residual risk is operational: if a deployment fails to set `NODE_ENV=production`, the tool becomes reachable to any ADMIN-role account — this is a deployment-configuration risk, not a code defect, and the code's own comments flag exactly this as the reason `NODE_ENV` is checked independently in two files rather than once.

---

## 7. Notifications settings & Support admin view

### 7.1 Notification / operational settings (`/admin/settings`, `settings.view`/`settings.edit`)

`GET/PATCH /api/admin/settings` (`src/app/api/admin/settings/route.ts`) manage one `Settings` object covering (schema at `settings/route.ts:14-102`):
- **Dropdown lists**: `currencies`, `riskLevels`, `operationAreas`, `priorityLevels`, `irregularityTypes` (each must stay non-empty).
- **Notification delivery**: `notification.provider` ∈ `NONE | SMTP | GRAPH`, plus `fromAddress`/`smtpHost`/`smtpPort`. A companion endpoint, `POST /api/admin/settings/test-email` (requires `settings.edit`), sends a real test email to the calling admin's own address via `getTransporter()` — it fails with a clear 400 if the caller has no email or if no transporter is configured, and logs raw SMTP errors server-side only (never echoing internals like hostnames/auth failures to the client) (`settings/test-email/route.ts:12-52`).
- **`autoTransferOnLock`**: whether the period-lock dialog offers the "transfer outstanding findings forward" option (§4.2).
- **`rankingVisibility`**: whether branch/district rankings are shown.
- **`rectificationReminders`**: enabled + threshold-days.
- **`performanceThresholds`**: top/bottom percentile cutoffs.
- **`hoApproval`**: `required` (bank-wide approval stage on/off) + `approverUserIds` — every id is validated to be an **active, bank-wide-scoped** user before saving (`settings/route.ts:116-130`), since this stage bypasses the normal district/HO review chain.
- **`similarFindingFields`** / **`requiredFindingFields`** / **`allowOtherValueFields`**: configure duplicate-detection, which fields are mandatory on the finding form, and which fields accept a free-typed "Other" value.
- **`typography`**: app-wide font family, text size and text contrast, applied to every signed-in page. Optional on PATCH (omitted keeps the stored value). Also holds the header & sidebar color (`typography.chrome`). Full reference: [typography-settings.md](typography-settings.md).

There is no separate "Notifications" admin sub-page distinct from Settings — delivery configuration lives entirely inside `/admin/settings`.

### 7.2 Support — staff/admin side

Support has a requester side (`/support`, `support.create`) and a staff side:
- `GET /api/admin/support` (requires `support.view` OR `support.respond`) returns **every** user's threads (not just the caller's own), enriched with the author's name/role (`src/app/api/admin/support/route.ts:9-29`).
- The admin page `src/app/(app)/admin/support/page.tsx` does its own inline `hasAnyPermission(["support.view", "support.respond"])` check and redirects to `/admin` otherwise (`admin/support/page.tsx:11-14`) — this mirrors, and is required by, `proxy.ts`'s explicit carve-out: `pageCodeFor()` returns `null` for `/admin/support*` specifically so the blanket `<page>.view`-only rule doesn't wrongly exclude a `respond`-only role (`proxy.ts:19-25`).
- Only `support.respond` additionally allows posting a reply into someone else's thread from the inbox — the one place `view` and `respond` actually diverge in capability (`registry.ts:210-213`).
- `canRespond` is passed down to `<AdminSupportClient>` to conditionally show reply controls (`admin/support/page.tsx:16-24`).

---

## 8. Edge cases & known gotchas

1. **Permission edits don't apply until next login.** `session.permissions` is a snapshot taken at login (`login/route.ts:152`); `getCurrentUser()` only re-validates `sessionVersion`/`status`, not the role's live permission set (`session.ts:87-95`). Narrowing or widening a role at `/admin/roles` has no effect on an already-open session until it re-authenticates.
2. **Category deletion is not reference-checked against findings.** Unlike every other reference-data DELETE route, `DELETE /api/admin/categories/[id]` only checks Scoring Rules (`categories/[id]/route.ts:62-68`) — it never checks `db.findings`. This is consistent with `Finding.categoryId` being deliberately *not* a real foreign key at the database level either (`schema.prisma:408-420`, to allow free-typed "Other" category values), so nothing — application code or the database — stops an admin from deleting a category that active findings still reference, silently orphaning the reference. Sources and Departments don't have this gap: their DELETE routes plus real DB-level `onDelete: Restrict` foreign keys on `Finding.sourceId`/`Finding.departmentId` provide two independent layers of protection.
3. **Reporting-period date-range editing is a one-way door once used.** `startsAt`/`endsAt` can be changed freely on a period with zero findings, but becomes permanently locked the moment even one finding is created against it (`reporting-periods/[id]/route.ts:94-117`) — there is no override.
4. **A period's own workflow-lock (`OPEN`/`LOCKED`) and its submission window are two independent gates.** An `OPEN` period can still reject new submissions if today falls outside `submissionStartsAt`/`submissionEndsAt` (`assertPeriodOpenForSubmission`, `findings.ts:493-502`) — a period being green-lit for the workflow overall doesn't guarantee the submission window is currently open.
5. **Legacy permission key kept for compatibility.** `findings.return-rectification` is explicitly labeled "Legacy — kept for backward compatibility; use the District/HO-specific ones below for new roles" (`registry.ts:116-119`) — new custom roles should be granted `district-return-rectification`/`ho-return-rectification` instead.
6. **The Administrator role is not special-cased anywhere except the one `roles.manage` floor.** Every other permission ADMIN holds can be stripped through `/admin/roles`, including, in principle, `users.create`/`settings.edit`/etc. — the seed data grants everything by default, but nothing in the code re-grants it automatically if narrowed. Losing `roles.manage`, specifically, is the only self-lockout the API refuses to allow.
7. **Dev-reset's only residual risk is a misconfigured `NODE_ENV`**, not a code gap — see §6.2.
8. **`BRANCH_SUB_MANAGER` is seeded but not a protected "system" role**, unlike its 7 siblings — an admin could delete it (once unassigned) or otherwise alter it in ways not possible for the other seeded roles, even though functionally it grants the same permission set as `BRANCH_MANAGER` today.
