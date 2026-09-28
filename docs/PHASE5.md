# Phase 5 — Every Feature Is a Permission, Every Role Starts Non-Empty

Two standing rules, both applied retroactively to Phase 4's Branch
dashboard and going forward to every dashboard/feature added after this:

1. **Every dashboard or feature gets a `PAGE_REGISTRY` entry.** Nothing in
   the app should be reachable by role alone - only by permission, checked
   at its actual enforcement point.
2. **Every seeded role ships with a non-empty, BRD-grounded default
   permission set**, so an administrator adjusts access from "what this
   role should plausibly have" rather than building it from zero. This
   reverses Phase 2's original choice (PHASE2.md §7) at explicit request.

## 1. The Branch dashboard is now a permission, not just an `orgScope` match

Phase 4 ([PHASE4.md](PHASE4.md)) routed `/dashboard` to `BranchDashboard`
purely on `session.orgScope === "BRANCH"`. That's necessary but not
sufficient: it means *which* dashboard a role's `orgScope` would imply, not
whether that role is actually allowed to see it. `branch-dashboard` is now
a `PAGE_REGISTRY` entry with a `view` action
([src/lib/permissions/registry.ts](src/lib/permissions/registry.ts)), and
`src/app/(app)/dashboard/page.tsx` checks both:

```ts
const canViewBranchDashboard = hasPermission(user.permissions, permissionKey("branch-dashboard", "view"));
if (user.orgScope === "BRANCH" && user.role !== "ADMIN") {
  if (canViewBranchDashboard) return <BranchDashboard user={user} db={db} />;
  return <Card>...ask an administrator to grant Branch Dashboard → View...</Card>;
}
```

This was verified end-to-end against a running server: `branch.manager`
saw the dashboard normally; an admin then `PATCH`ed the `BRANCH_MANAGER`
role's permissions to remove `branch-dashboard.view`; after `branch.manager`
logged in again (permission changes apply on next login - PHASE2.md §4),
the same request returned the "doesn't currently have dashboard access"
message instead of the dashboard. Re-granting it restores access the same
way. This is the concrete mechanism `/admin/roles` now controls for
dashboards, not just admin-console pages.

Non-admin pages like this one aren't gated by `src/proxy.ts`'s prefix
matching (that only covers `/admin/<page>`), so the check lives inline in
the page itself instead - noted directly in the registry's file comment as
the pattern to follow for District/HO/Executive next.

## 2. Default permissions per role, and why each one is what it is

Every default below is traceable to a specific line in `AuditDocs/`. The
governing constraint, from icfms.txt's Administrator section, is that
**org structure, users, and roles stay Administrator-only** by default -
"User creation, Role assignment, Branch configuration, District
configuration, Category maintenance, Workflow configuration, System
settings" is listed as the Administrator's job, nobody else's. So no
non-admin role gets `create`/`edit`/`delete`/`toggle-status` on
users/districts/branches/sources/categories/roles by default - only the
`view` (monitoring) access each role's own BRD description calls for.

| Role | Default permissions | Grounded in |
|---|---|---|
| `ADMIN` | `ALL_PERMISSION_KEYS` (unchanged) | icfms.txt Administrator section - everything listed there maps to full access |
| `HO_CONTROLLER` | `admin-dashboard.view`, `users.view`, `districts.view`, `branches.view`, `sources.view`, `categories.view`, `scoring-rules.view`, `scoring-adjustments.view`, `reporting-periods.view` **+ `.lock`**, `settings.view`, `audit-log.view` | "Monitor all districts... Monitor national performance" (icfms.txt) = broad view access; master.txt's *"District and Head Office Controllers can control periods within authorized scope"* is the one place HO gets a non-view permission |
| `DISTRICT_CONTROLLER` | `districts.view`, `branches.view`, `sources.view`, `categories.view`, `scoring-rules.view`, `scoring-adjustments.view`, `reporting-periods.view` **+ `.lock`** | "Monitor district performance, Generate district reports" (icfms.txt) + the same period-control sentence, which names District Controllers explicitly |
| `DISTRICT_DIRECTOR` | Same as District Controller **minus `reporting-periods.lock`** | icfms.txt is explicit: *"Cannot modify findings or scores"* - the BRD's one directly-stated restriction on a role, so the one default permission that's an action rather than a view is the one withheld |
| `BRANCH_CONTROLLER` | `branch-dashboard.view`, `sources.view`, `categories.view`, `reporting-periods.view` | Registers findings, so needs to see the Source/Classified-Case options and which period is open (icfms.txt: "Register findings... Submit findings") - no other admin-console visibility |
| `BRANCH_MANAGER` | `branch-dashboard.view`, `categories.view`, `reporting-periods.view` | Narrower still - records corrective actions against findings already raised by someone else, so doesn't need Source visibility the way the Controller filing the finding does |
| `EXECUTIVE_READONLY` | `ALL_VIEW_PERMISSION_KEYS` (unchanged from Phase 2) | "Read-only... KPIs, trends, rankings and exceptions" (master.txt) - broadest view-only default of any non-admin role, deliberately including `branch-dashboard.view` (auto-included, since it's computed from the full registry) so Executive oversight can drill into any dashboard once more exist |

`scoring-rules.create`/`.activate` and `roles.*` are withheld from every
non-admin role without exception - master.txt is explicit that *"Only
Admin changes scoring rules"* and role/permission administration is
inherently the most sensitive capability in the system.

Verified directly against a running server: after reseeding, `HO_CONTROLLER`
holds 12 permissions, `DISTRICT_CONTROLLER` 8, `DISTRICT_DIRECTOR` 7,
`BRANCH_CONTROLLER` 4, `BRANCH_MANAGER` 3, `EXECUTIVE_READONLY` 12 (up from
11, picking up `branch-dashboard.view` automatically) - none empty, all
matching the table above exactly.

## 3. What this changes about earlier phases

PHASE2.md §7 previously documented "six of seven roles start with zero
permissions" as the design. That section now points here instead of
describing stale behavior - the *mechanism* (permissions are editable data
on `RoleDefinition`, changed via `/admin/roles`, applied on next login) is
completely unchanged; only the seed's starting values are different. An
existing `data/db.json` from before this phase keeps its old (mostly
empty) permission grants - like every other seed change so far, picking up
the new defaults means deleting `data/db.json` and letting it reseed (see
README.md's "Data storage" section).

## 4. The standing rule, going forward

Documented directly in `src/lib/permissions/registry.ts`'s file comment so
it isn't only here: every dashboard or feature added to this app from now
on gets a `PAGE_REGISTRY` entry with at least a `view` action, enforced at
its real boundary (an API route via `requirePermission()`, an admin page
via `src/proxy.ts`, or an inline `hasPermission()` check like this
dashboard's). District, HO, and Executive dashboards (PHASE4.md's
remaining work) will each add their own `<role>-dashboard.view` entry the
same way `branch-dashboard` did here, and each seeded role gets that
specific dashboard added to its default permissions the same way
`BRANCH_CONTROLLER`/`BRANCH_MANAGER` picked up `branch-dashboard.view`
above.
