# Phase 3 — Complete CRUD & Confirmed Risky Actions

Phase 1 ([PHASE1.md](PHASE1.md)) shipped Create/Read and a status toggle for
every admin entity, but no in-place Edit UI and no real Delete anywhere.
Phase 2 ([PHASE2.md](PHASE2.md)) made roles and their permissions dynamic.
Phase 3 closes the CRUD gap deliberately rather than uniformly: every entity
gets a real Edit, but only entities where a permanent delete is actually
*safe* get one, and every action with real blast radius - deactivate,
delete, activate a scoring rule, lock/unlock a period - now requires an
explicit confirmation before it runs.

## 1. The delete policy, and why it isn't "delete everywhere"

The obvious version of "full CRUD" adds a Delete button to every table. That
would be wrong here: several entities in this app are deliberately
*append-only* or *reference-integrity-bearing*, and a hard delete on them
would either violate the BRD directly or quietly corrupt data that other
records depend on. Phase 3 draws the line entity by entity:

| Entity | Delete? | Why |
|---|---|---|
| Districts, Branches, Sources, Classified Categories | **Yes** | Pure reference/config data. A mistakenly-created branch or duplicate source code is legitimate cleanup, not history worth preserving. |
| Custom (non-system) Roles | **Yes** | Same reasoning - an admin-created role that turned out to be unnecessary should be fully removable. |
| Users | **No** | The BRD (section 3.1) explicitly scopes User Management to "create/edit/deactivate/reactivate" - never delete. A user is also the audit trail's "who" for every past action; keeping the record (even deactivated) keeps that trail meaningful. |
| The 7 built-in (`isSystem`) Roles | **No** | Load-bearing: `ADMIN` is the lockout guard's foundation (PHASE2.md §6), and `BRANCH_MANAGER`/`BRANCH_CONTROLLER`'s codes are referenced by name in `src/lib/org.ts`. They can be deactivated, never deleted. |
| Scoring Rules | **No** | Versioned and append-only by design (PHASE1.md/PHASE2.md §5) - a past reporting period must keep reconciling against whichever version was live when it ran. Deleting a version would break that. |
| Scoring Adjustments | **No** | Themselves a permanent, audit-style record of a manual override (PHASE1.md §7) - deleting one would defeat the reason it exists. |
| Reporting Periods | **No** | Core to reconciliation; governed by lock/unlock instead of removal. |
| Settings, Audit Log | **N/A** | Settings is a singleton (nothing to delete). The audit log is explicitly immutable (BRD section 13) - not even the app's own admin can delete an entry. |

This mirrors a normal relational-database instinct - some tables are
lookup/reference tables (safe to `DELETE`), others are transactional/
historical records (`ON DELETE RESTRICT` at best, or no delete path
at all) - just enforced in application code instead of foreign keys, since
the data layer is still the JSON file from PHASE1.md §2.

## 2. Referential-integrity checks replace foreign-key constraints

Since `data/db.json` has no real foreign keys, every `DELETE` route
(`src/app/api/admin/{districts,branches,sources,categories,roles}/[id]/route.ts`)
does the check a database would otherwise do for free, and rejects with
`409` and a specific count if anything still points at the record:

- **District** → blocked if any `Branch.districtId` or `User.districtId`
  still references it.
- **Branch** → blocked if any `User.branchId` still references it (this is
  also why a Branch Manager/Controller assignment can never be silently
  orphaned - see PHASE1.md §3 on how those are derived, not stored).
- **Source** / **Category** → blocked if any `ScoringRule.sources` /
  `.categories` array (any version, active or not) still contains its id.
- **Role** → blocked if `isSystem` is true (hard `409`, not even checked
  against usage), or if any `User.role` still equals its `code`.

Every one of these checks looks at *all* records regardless of status -
an inactive branch still counts as "still referencing" its district, since
the goal is preventing a dangling id, not just preventing surprises for
active data.

A successful delete still writes a normal audit-log entry
(`action: "DELETE"`), with the entire deleted record captured in
`oldValue`. That's what makes hard-deleting these entities safe from an
audit standpoint even though the row itself is gone: `AuditLogEntry`
already denormalizes the actor's name (PHASE1.md §6), and now the deleted
record's full contents live in the log too, so "what was this, and who
deleted it" stays answerable after the row no longer exists.

## 3. Confirmations for every risky action — `useConfirm()`

[src/components/ui/ConfirmDialog.tsx](src/components/ui/ConfirmDialog.tsx)
is a small promise-based hook:

```ts
const { confirm, dialog } = useConfirm();
const result = await confirm({ title, message, tone: "danger" });
if (result === false) return; // cancelled
```

`{dialog}` is rendered once per page; `confirm()` can be awaited from
anywhere in that page's event handlers, and resolves to `false` on cancel.
Passing `needsReason: true` turns it into the same dialog used for
Reporting Periods' lock/unlock: it collects a short text reason and
resolves with that string instead of `""`, replacing what used to be a
bare `window.prompt()` call.

Every action wired to a confirmation states, in the message itself, what
concretely happens if the user proceeds — not a generic "are you sure?":

- **Deactivate** (Users, Districts, Branches, Sources, Categories, Roles) -
  states what becomes unavailable and confirms it's reversible.
- **Delete** (Districts, Branches, Sources, Categories, Roles) - states
  that it's *not* reversible and names the referential condition that has
  to be true for it to succeed.
- **Category "scored" toggle** - states that this can change live
  performance figures if the category is part of the active scoring rule.
- **Scoring rule activate/deactivate**, including create-and-activate-
  immediately - names the specific version being replaced.
- **Reporting period lock/unlock** - states the bank-wide effect and
  collects the mandatory reason in the same step.

## 4. A permission-catalog change exposed a real staleness bug — and the fix

Adding "delete" as a new `PermissionAction` in
[src/lib/permissions/registry.ts](src/lib/permissions/registry.ts) surfaced
exactly the drift risk PHASE2.md §9 flagged as a known limitation: the
seed's `ADMIN` role has `permissions: ALL_PERMISSION_KEYS`, computed and
*stored* once at seed time. Adding a new action to the catalog doesn't
retroactively touch that stored array - so, verified directly against a
running dev server, an already-seeded `ADMIN` role's session resolved to
34 permissions (the old total) even after the code added 4 new
`.delete` keys (38 total).

The fix generalizes the lockout guarantee from PHASE2.md §6 ("ADMIN can
never lose access") to cover catalog growth, not just accidental edits:
`ADMIN`'s effective permissions are now computed **live** as
`ALL_PERMISSION_KEYS` at two points, rather than trusted from storage:

- `POST /api/auth/login` - `session.permissions = role.code === "ADMIN" ? ALL_PERMISSION_KEYS : role.permissions`.
- `GET /api/admin/roles` - the returned `ADMIN` row has its `permissions`
  field replaced with `ALL_PERMISSION_KEYS` before being sent to the UI, so
  the Roles & Permissions page never displays a stale count for it either.

Every other role still resolves strictly from its stored `permissions`
array, so this doesn't change PHASE2.md §4's staleness trade-off for
custom or the other six built-in roles - only `ADMIN` is special-cased,
consistent with it being the one role the whole permission model treats as
"always everything, always a way back in."

## 5. Verified end-to-end

Directly against a running server: `ADMIN`'s session permission count rose
from 34 to 38 immediately after the registry change, with no data
migration. Deleting `district-1` (which has branches and users) returned
`409` naming exact counts; deleting `district-3` (empty) succeeded and the
district disappeared from subsequent list calls. Deleting `branch-1`
(assigned users) was blocked the same way; deleting `branch-3` (unassigned)
succeeded. Deleting the built-in `BRANCH_MANAGER` role was rejected before
even checking usage. Both successful deletes produced `DELETE` entries in
the audit log. In the browser, deleting the `CK_BOOK` category succeeded
(no scoring rule referenced it) while attempting to delete `OTHER_CASE`
correctly failed and left it in place (the seeded scoring rule references
it) - confirming the referential-integrity check works through the actual
UI flow, not just the API directly.
