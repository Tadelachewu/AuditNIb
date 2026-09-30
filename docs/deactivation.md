# Deactivation: What It Does for Each Record

**Deactivate** means "stop using this from now on, but keep its history". It is always reversible (**Activate** again). **Delete** is permanent and only allowed when nothing refers to the record; that's why most lists offer both.

The rule everywhere: **a deactivated record can't be picked for anything new, and everything already recorded against it stays exactly as it is.**

---

## Users

| | Effect |
|---|---|
| **Login** | Refused: *"This account has been deactivated"*. Password reset links and Forgot Password also stop working for the account. |
| **Already signed in** | Signed out on their **next click**. Every request re-checks the account's status in the database. |
| **Notifications** | None: no bell entries and no emails. This includes notifications that name them directly (as a finding's registrant, a comment author, a support thread owner, or a Bank-Wide Approval approver). |
| **Queues, assignments** | They stop appearing among the people notified or picked for review. Their past actions (findings registered, approvals, rectifications, comments, audit log entries) keep their name. |
| **Branch roles held by one person** (e.g. Branch Manager) | A deactivated user **still holds the slot**. Change their role or move them to free it for someone else. |

**Safety limits:**
- You **can't deactivate or delete your own account**.
- **Permission-based lock-out protection.** Two permissions are needed to undo a deactivation: **Users › Activate / Deactivate** (re-enable a user) and **Roles & Permissions › Manage** (re-enable a role or restore permissions). A change is refused if it would leave **no active user** holding either one. This applies to deactivating or deleting a user, changing a user's role, and deactivating a role or removing those permissions from it. It follows the permissions, whatever the role is called. Today only the Administrator holds them; give them to a second trusted role or user if you want a backup.

**Bank-Wide Approval:** a deactivated approver is no longer notified. Make sure at least one *active* approver is picked in Settings.

---

## Roles

| | Effect |
|---|---|
| **Users holding the role** | **Signed out immediately**, and can't sign in again while the role is inactive (*"Your role has been deactivated"*). |
| **Assigning it** | Can't be given to a user while inactive. |
| **Administrator role** | Can never be deactivated, and always keeps Roles & Permissions › Manage. |
| **Any role** | Can't be deactivated, or lose those two permissions, if that would leave nobody active holding them (see *Users* above). |

A permission change to an *active* role applies to each user at their **next sign-in**; to apply it at once, ask them to sign out and back in.

---

## Districts and branches

| | Effect |
|---|---|
| **New findings** | Can't be registered for a deactivated district or branch, from the form or from Excel import. Staff of a deactivated branch can't register new findings. |
| **Existing findings** | Unchanged. They can still be reviewed, rectified, closed, transferred and edited. A finding can't be *moved into* a deactivated district or branch. |
| **Users** | Can't be newly assigned or moved into it. Users already there keep working and can still sign in. Deactivate them separately if they should stop. |
| **Dropdowns** | Hidden from the Register Finding form, user forms and filters. |
| **Report templates** | Leave the official templates (which list active branches and districts). |
| **Dashboards** | Rankings still show its existing findings' performance. District rankings count only active branches in "Branches". |

---

## Departments, Classified Categories, Sources

| | Effect |
|---|---|
| **New findings** | Can't be picked on the form or in an import, and the server refuses them (*"Selected source is not active"*, etc.). |
| **Existing findings** | Keep the value and can still be edited without changing it. Only a *newly picked* value must be active. |
| **Users (departments)** | A deactivated department can't be assigned to a user. |
| **Scoring** | Performance % follows the **Scoring Rule's** categories and sources, whether active or not. |
| **Report templates** | Category columns in the official templates show **active** categories only. |

## Uncovered Branch Reasons

A deactivated reason disappears from the reason picker and can't be newly chosen (single or bulk). A branch note that already uses it keeps it and can still be saved.

## Reporting Periods

Periods are **locked / unlocked**, not deactivated. See the period's own lock rules.

---

## For developers

| Where | What |
|---|---|
| `src/lib/session.ts` (`getCurrentUser`) | Signs out a non-ACTIVE user, or a stale `sessionVersion`, on every request |
| `src/app/api/auth/login/route.ts` | Refuses an inactive user or role |
| `src/lib/permissions/lockout.ts` | `KEEPER_PERMISSIONS` and `lockoutError()`: the permission-based lock-out check |
| `src/app/api/admin/users/[id]/route.ts` | Own-account guard; lock-out check on deactivate / delete / role change; no moves into an inactive district/branch |
| `src/app/api/admin/roles/[id]/route.ts` | Deactivating a role bumps its users' `sessionVersion` (immediate sign-out) |
| `src/lib/notifications.ts` (`notifyUsers`) | Skips inactive recipients |
| `src/lib/org.ts` (`inactiveOrgUnitError`) | Shared "district/branch is deactivated" check used by findings and users routes |
| `src/lib/import.ts` | Rejects inactive district, branch, source, department, category codes |
