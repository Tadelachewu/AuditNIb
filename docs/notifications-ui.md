# On-screen Notifications (toasts)

The standard for success, error, warning, info and loading feedback in the UI. (Bell / email notifications are a different feature: see [notifications.md](notifications.md) and [email-events.md](email-events.md).)

## 1. Architecture

```
Component ──notify.*(catalog entry)──▶ src/lib/notify ──▶ Sonner (only here) ──▶ <AppToaster/> (root layout)
                     ▲
API error (code) ──presentError()── decides: field / auth / permission / not found / business / system
```

- **Library: Sonner** (already installed; accessible, small, supports loading → result in place). It is used **only** in `src/lib/notify` and `src/components/ui/AppToaster.tsx`. Importing `sonner` anywhere else is a lint error, so the library can be replaced in one place.
- The backend never knows about toasts. It returns error **codes**, and the frontend decides how to present them.
- Server Components never notify. Client Components call `notify` after an API result.

## 2. API (`src/lib/notify`)

```ts
import { notify, notifications } from "@/lib/notify";

notify.success(notifications.branch.deleted);                       // "Branch deleted successfully."
notify.fromError(err, notifications.branch.deleteFailed);           // mapped by error code (section 6)
setFormError(notify.formError(err, notifications.branch.createFailed)); // forms: same toast; returns field errors (only) for inline display
await notify.promise(saveFinding(), {                                 // ONE toast: loading → success / error
  loading: "Saving finding...",
  success: notifications.finding.updated,
  error: notifications.finding.saveFailed,
});
notify.warning(notifications.generic.fixFields);
notify.info(notifications.import.cancelled);
const id = notify.loading("Importing file...");  notify.dismiss(id);
```

Options are limited to `description` (a supporting line) and `id`. **Duration, position and style can't be set per call.**

## 3. Types, durations, position (`src/lib/notify/config.ts`)

| Type | Duration | Use |
|---|---|---|
| SUCCESS | 4 s | confirms what the user just did |
| INFO | 5 s | neutral information |
| WARNING | 8 s | needs attention (e.g. "Please correct the highlighted fields.") |
| ERROR | 10 s | a failed operation: what failed + what to do + reference |
| LOADING | until resolved | replaced in place by the result |

Hovering or focusing pauses the timer, and every toast has a close button. **Position: top-centre, 76 px from the top** (just below the top bar). It never covers the sidebar, the bell/profile menu, the sticky Save/Submit bars and page bars at the bottom, or the Add dialogs anchored top-right. At most 3 are visible; older ones stack.

## 4. Wording standard and catalog (`src/lib/notify/catalog.ts`)

- Success: **"[Object] [action] successfully."** e.g. *Finding submitted successfully.*, *User deactivated successfully.*
- Failure: **"Unable to [action] the [object]. Please try again."** e.g. *Unable to delete the branch. Please try again.*
- Business rule: the server's own rule text, e.g. *Awaiting district verification before this can be closed*.
- Never *Success!*, *Done!*, or technical text. Tests enforce this for every catalog entry.

Every entry has a stable code (`BRANCH_DELETED`, `FINDING_SUBMITTED`, `IMPORT_REVERSED`, ...). Catalog groups: `finding` (created, updated, draftSaved, submitted, approved, rejected, returned, rectified, verified, closed, transferred, deleted + failures), `user`, `district`, `branch`, `department`, `category`, `source`, `uncoveredReason`, `reportingPeriod`, `role`, `scoringRule` (created / updated / deleted / activated / deactivated + failures each), `import` (completed, cancelled, reversed, reimported, deleted + failures), `settings`, `auth` (loginSuccess, logoutSuccess, passwordChanged, sessionExpired), `generic` (fixFields, noPermission, notFound, network, unknown).

## 5. Loading → success / error

One operation = one toast. `notify.promise` shows the loading message, then **replaces it** with the success or the mapped error (same id). No *Request sent… / Processing… / Done!* chains.

## 6. Error → presentation mapping (`presentError`)

| Error | Presentation |
|---|---|
| `VALIDATION_ERROR` with field details | **inline next to each field**; one warning toast *Please correct the highlighted fields.* |
| `AUTHENTICATION_FAILED`, `SESSION_EXPIRED` | info *Your session has expired…*, then back to sign-in |
| `AUTHORIZATION_DENIED` | *You don't have permission to do that.* (pages themselves are protected by the proxy) |
| `RESOURCE_NOT_FOUND` | warning *This item no longer exists…* (unknown URLs → `not-found.tsx`) |
| other 4xx (business rules, conflicts, rate limits) | error toast with the server's safe message |
| 5xx, network, unknown | the **action's own failure text** (e.g. *Unable to delete the user. Please try again.*) + *Reference: abcd1234* |
| page render failure | `error.tsx` (not a toast) |
| root layout failure | `global-error.tsx` |

Raw exception text is never shown: non-API errors and all 5xx messages are replaced.

**Where a toast is not used:** field validation (inline), decisions the user must make (e.g. import duplicates, which show the review card), destructive confirmations (confirmation dialog **before** the action; the toast only reports the outcome), and page-level failures (error boundaries).

## 7. Duplicate prevention

Each notification's id is its catalog code, and a `notify.promise` operation uses one id. The same notification raised again (double click, retries, two failing paths) **updates the toast already on screen** instead of stacking copies.

## 8. Accessibility

Toasts are announced by a polite `aria-live` region, and each type has its own icon as well as colour (never colour alone). The close button is labelled *Dismiss notification*, and errors stay 10 s (paused while hovered or focused). **Alt+T** moves focus to the notifications, and animations are off under *reduce motion*.

## 9. Where it's used today

Every user action follows the standard: **success → catalog success toast; failure → `notify.fromError` (one-click actions) or `notify.formError` (forms)**. Raw error text is never shown, and `errorMessage()` is not used in components (a test fails if it comes back).

| Area | Success | Failure |
|---|---|---|
| **Finding page**: submit, approve / return / reject, record rectification, verify, close, return / resubmit rectification, transfer, reverse, delete, evidence upload / remove, comments | catalog toast | toast (`reviewFailed`, `rectifyFailed`, `verifyFailed`, `closeFailed`, `transferFailed`, ...). The **Record Rectification** form's own checks (amount vs cases) show **inside the form** with the "correct the highlighted fields" warning |
| **Register / edit finding** | created / draft saved / submitted / updated | `formError`: toast; field errors inline in the sticky bar |
| **Admin lists** (Users, Districts, Branches, Departments, Categories, Sources, Uncovered Reasons, Reporting Periods, Roles, Scoring Rules): add / edit / delete / activate / lock | catalog toast | add / edit forms: `formError`; row actions: `fromError` |
| **CSV import (Add many)** | "Rows imported successfully." + count | "Unable to import some rows…" + counts; per-row results table stays |
| **Findings list bulk actions** | "Bulk action completed successfully." + counts | "Unable to apply the action to some findings…" + counts; summary line stays |
| **Settings** | "Settings saved successfully." | `formError`. *Send test email* shows its result in the test panel |
| **Import** (upload, re-import, reverse, delete) | completed / reimported / reversed / deleted | toast; duplicates and file errors use their review cards |
| **Profile** (change password), **Forgot / Reset password** | password changed / reset | `formError` |
| **Uncovered branches** (reason, bulk reason) | saved / applied | `formError` |
| **Support** (new message, reply, rating) | message sent / rating saved | `formError`; a conversation that fails to load shows the standard text in place |
| **Notification bell** (reply to a comment) | comment posted | `formError` |
| **Dev reset** | "Registered data reset successfully." | `formError` |

Silent by design (no toast): draft autosave, marking notifications read, and optional look-ups a role may not have permission for.
