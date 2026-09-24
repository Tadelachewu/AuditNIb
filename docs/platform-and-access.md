# Platform Features: Auth, Notifications, Support, Evidence

This doc covers four supporting features of NIB Control360 (ICFMS) that don't have their own dedicated doc: **Authentication & Sessions**, **Notifications**, **Support / Help Desk**, and **Evidence & Attachments**. For the full permission registry see `docs/admin-settings.md`; for the finding status machine and which transitions exist, see `docs/workflow.md` (this doc cross-references it for which transitions fire notifications).

---

## 1. Authentication & Sessions

### Overview

Auth is username/password, backed by a stateless encrypted session cookie (`iron-session`) plus a database-verified "is this session still valid" check on every request. There is no server-side session store/table — a session is entirely the cookie's encrypted contents, re-validated against two live columns (`User.sessionVersion`, `User.status`) on each use.

### Password hashing

`src/lib/auth.ts:1-22` — passwords are hashed with `bcryptjs` at `SALT_ROUNDS = 10` (`src/lib/auth.ts:3,5-7`). `verifyPassword()` does a `bcrypt.compareSync` (`src/lib/auth.ts:9-11`).

A constant `DUMMY_PASSWORD_HASH` (`src/lib/auth.ts:22`) is compared against for unknown usernames so a nonexistent-username login takes the same CPU time as a wrong-password login, closing a username-enumeration timing side channel (`src/lib/auth.ts:13-21`, used at `src/app/api/auth/login/route.ts:85-92`).

### Login flow (`POST /api/auth/login`, `src/app/api/auth/login/route.ts`)

1. Body validated with zod (`username`, `password` both required) — `src/app/api/auth/login/route.ts:20-23,48-54`.
2. **Four independent abuse-protection layers**, all Redis-backed (`src/lib/rateLimit.ts`), keyed by IP and/or username (`src/app/api/auth/login/route.ts:25-46`):
   - Per-IP rate limit: 5 attempts / 15 min (`PER_IP_RATE_LIMIT`, line 43)
   - Per-account+IP rate limit: 5 attempts / 15 min (`PER_ACCOUNT_RATE_LIMIT`, line 44)
   - Per-username lockout: hard-locked 15 min after 5 failures (`ACCOUNT_LOCKOUT`, line 45)
   - Per-IP lockout: hard-locked 30 min after 10 failures (`IP_LOCKOUT`, line 46)
   Lockouts are checked *before* rate limits (`src/app/api/auth/login/route.ts:61-68`), so an already-locked-out caller gets an immediate `429` with a `Retry-After` header without consuming further rate-limit budget. A failed attempt also gets an exponential backoff sleep before the response returns — `1s, 2s, 4s, 8s` capped, driven by the account's own failure count (`computeBackoffMs`, `src/lib/rateLimit.ts:134-136`, invoked at `src/app/api/auth/login/route.ts:99`). Only *failed* attempts count against any counter; a correct password on the first try touches nothing.
   - `clientIp()` only trusts `X-Forwarded-For`/`X-Real-Ip` when `TRUST_PROXY=true`; otherwise every direct request collapses onto a shared `"direct"` bucket (`src/lib/rateLimit.ts:155-163`).
   - All Redis calls fail **open** (treat an outage as "not rate-limited") — `src/lib/rateLimit.ts:10-15,28-30,49-52` etc. — a rate-limiter outage must not itself take login down.
3. User lookup by case-insensitive username match against the JSON-backed `readDb()` store (`src/app/api/auth/login/route.ts:82-83`), then `verifyPassword()` against the real hash or `DUMMY_PASSWORD_HASH` (line 92).
4. On failure: records the attempt/failure against both rate-limit and lockout counters, sleeps the backoff, returns `401 "Invalid username or password"` (`src/app/api/auth/login/route.ts:93-101`) — deliberately identical error message whether the username didn't exist or the password was wrong.
5. On success: clears the account rate limit/lockout (`src/app/api/auth/login/route.ts:102`), then checks:
   - `user.status !== "ACTIVE"` → `403` "account has been deactivated" (line 103-105).
   - Temporary/admin-reset password expiry: if `user.mustChangePassword` and `passwordExpiresAt` is in the past, login is blocked outright with `403` (`src/app/api/auth/login/route.ts:107-117`) — a temporary password is only good for **24h** from when it was set (per the `User.passwordExpiresAt` schema comment, `prisma/schema.prisma:194-197`).
   - The user's role must exist and be `ACTIVE`, else `403` (`src/app/api/auth/login/route.ts:119-122`).
6. `User.lastLoginAt` is updated and a `LOGIN` audit-log entry appended (`src/app/api/auth/login/route.ts:124-135`).
7. The session cookie is populated and saved (`src/app/api/auth/login/route.ts:137-157`) — see "Session payload" below.
8. Response returns the sanitized user object via `toSafeUser()` (`src/app/api/auth/login/route.ts:159`).

The login page itself (`src/app/login/page.tsx`) is a plain client form posting to `/api/auth/login`, with a collapsible "Demo accounts" panel listing one seeded username/password per role (`src/app/login/page.tsx:11-19,92-113`) — a development/demo convenience, not a production auth path.

### Session storage

`src/lib/session.ts` — sessions use `iron-session`, an encrypted-cookie library (no server-side session table).

- Cookie name: `"nib_control360_session"` (`src/lib/session.ts:52`).
- Encryption key: `IRON_SESSION_PASSWORD` env var, required to be ≥32 chars or the app throws at boot (`src/lib/session.ts:39-44`).
- Cookie flags: `httpOnly: true`, `sameSite: "lax"`, `secure` computed from `SESSION_COOKIE_SECURE` env override or defaults to `NODE_ENV === "production"` (`src/lib/session.ts:46-57`).
- **No explicit `maxAge`/expiry is set on the cookie** — `iron-session`'s default is a session cookie (dies when the browser session ends) since `cookieOptions` here only sets `secure`/`sameSite`/`httpOnly` (`src/lib/session.ts:53-57`). There is no fixed idle-timeout or absolute-expiry field in `SessionData` either.
- Effective expiry is instead **enforced server-side per request** by `getCurrentUser()`, not by the cookie's own TTL: every call re-reads `User.sessionVersion` and `User.status` from Postgres and destroys the session immediately on any mismatch or deactivation (`src/lib/session.ts:87-113`). This is what actually revokes a still-valid cookie the moment a password changes or an account is deactivated, since a stateless encrypted cookie can't otherwise be invalidated server-side.

### Session payload (`SessionData`, `src/lib/session.ts:6-37`)

| Field | Purpose |
|---|---|
| `isLoggedIn` | boolean flag |
| `userId`, `username`, `name` | identity |
| `role`, `roleName` | role code + display name |
| `orgScope` | `"BANK" \| "DISTRICT" \| "BRANCH"` (`src/types/index.ts:13`) — decides which dashboard renders and how notification/scope filtering behaves |
| `permissions` | `string[]` resolved from the user's `RoleDefinition.permissions` **at login time** (`src/app/api/auth/login/route.ts:144-152`) — a role's permissions changing takes effect only on the user's *next* login, not live |
| `districtId`, `branchId` | org scope narrowing |
| `mustChangePassword` | mirrors `User.mustChangePassword`; updated in place by `POST /api/auth/change-password` without a re-login |
| `sessionVersion` | snapshot of `User.sessionVersion` at login; compared against the live DB value on every `getCurrentUser()` call — a mismatch force-logs-out the session |

This payload travels in the encrypted cookie itself so `src/proxy.ts` (the edge middleware) can authorize page-level routing without a database/filesystem read.

### `requireUser()` / `requirePermission()` (`src/lib/guard.ts`)

Every API route calls `requireUser()` (401 if not logged in) or `requirePermission(...keys)` (403 if the session doesn't hold at least one of the given permission keys) — `src/lib/guard.ts:28-49`. This is the server-side enforcement point; the UI hiding links and `src/proxy.ts`'s edge redirects are convenience only, per the file's own doc comment (`src/lib/guard.ts:15-20`).

### Logout (`POST /api/auth/logout`, `src/app/api/auth/logout/route.ts`)

Appends a `LOGOUT` audit-log entry if a session existed (`src/app/api/auth/logout/route.ts:9-23`), then unconditionally calls `session.destroy()` (line 25). No token blacklist is needed since destroying the cookie is the whole mechanism (no server-side session record exists to revoke).

### `GET /api/auth/me` (`src/app/api/auth/me/route.ts`)

Returns the current `SessionData` (or `401 {user: null}`) — used by client code to read "who am I" without a full page load (`src/app/api/auth/me/route.ts:4-10`).

### Change password (`POST /api/auth/change-password`, `src/app/api/auth/change-password/route.ts`)

Self-service, requires no permission — proof of the *current* password is the only gate (`src/app/api/auth/change-password/route.ts:24-28`). Same rate-limit/lockout shape as login but keyed by `userId` alone (5 attempts / 15 min for both, `src/app/api/auth/change-password/route.ts:16-22`). If `mustChangePassword` is set and the account has no email on file, the change is blocked until an email is added (`src/app/api/auth/change-password/route.ts:70-75`) — this is what guarantees every account that completes a forced password change has a recovery email. On success: `sessionVersion` is bumped (`src/app/api/auth/change-password/route.ts:82,88`), which invalidates every *other* logged-in session for that account (their next request fails the `getCurrentUser()` version check) — the current request's cookie is destroyed and fully rebuilt with the new version (`src/app/api/auth/change-password/route.ts:100-124`).

### Forgot password (`POST /api/auth/forgot-password`, `src/app/api/auth/forgot-password/route.ts`)

- Rate-limited per IP (5/15min) and per identifier (3/hour) — `src/app/api/auth/forgot-password/route.ts:15-16,69-90`.
- Matches by username **or** email, active users only (`src/app/api/auth/forgot-password/route.ts:100-105`).
- **User-enumeration-blind**: always returns the same `200 {ok:true, message: "If an active account matches..."}` body whether or not a match was found (`src/app/api/auth/forgot-password/route.ts:110-136`) — extra machine-readable flags (`smtpConfigured`, `noDeliverableEmail`, `emailSent`, `smtpError`) are tacked on only for a real match, so the UI can surface admin-actionable detail without confirming account existence to an attacker.
- Reset token: `crypto.randomBytes(32).toString("base64url")`, stored raw (not hashed) in Postgres `PasswordResetToken` (`src/app/api/auth/forgot-password/route.ts:148,158-169`; schema at `prisma/schema.prisma:114-130`, which explains storing it raw as acceptable since it's already single-use and 32 bytes of entropy).
- **Token TTL: 30 minutes** (`TOKEN_TTL_MS = 30 * 60 * 1000`, `src/app/api/auth/forgot-password/route.ts:17`).
- Any prior unused token for that user is invalidated (`usedAt` set) before issuing a new one (`src/app/api/auth/forgot-password/route.ts:154-158`) — only one live reset link per user at a time.
- The reset link's origin is built from `X-Forwarded-Proto`/`X-Forwarded-Host` headers first (trusting a reverse proxy), falling back to the raw request `Host` (`buildPublicOrigin()`, `src/app/api/auth/forgot-password/route.ts:28-49`).
- Delivery: via `getTransporter()` from `src/lib/mail.ts:12-36`, an `nodemailer` SMTP transport built from `Settings.notification` (host/port, admin-editable) plus `SMTP_USER`/`SMTP_PASSWORD` env vars (secrets). Returns `null` (no throw) if the provider is `"NONE"`, unimplemented (`"GRAPH"`), or missing config — every caller treats a `null` transporter as "skip silently." The reset email itself is sent directly in the route (`src/app/api/auth/forgot-password/route.ts:194-229`), not via `src/lib/mail.ts`'s notification-email helper.
- A `PASSWORD_RESET_REQUESTED` audit-log entry is appended regardless of whether the email actually sent (`src/app/api/auth/forgot-password/route.ts:175-184`).

### Reset password (`POST /api/auth/reset-password`, `src/app/api/auth/reset-password/route.ts`)

- Rate-limited per (truncated) token: 10 attempts / 15 min (`PER_TOKEN_RATE_LIMIT`, `src/app/api/auth/reset-password/route.ts:15,27-35`).
- Token must exist, be unused (`usedAt === null`), and not be past `expiresAt`, else `400` "invalid or has expired" (`src/app/api/auth/reset-password/route.ts:47-56`).
- New password is validated through `validatePasswordFull()` (see below) before the token is consumed (`src/app/api/auth/reset-password/route.ts:37-40`).
- Token is marked used in the same Postgres transaction (`src/app/api/auth/reset-password/route.ts:69-79`); `passwordHash` is updated, `mustChangePassword`/`passwordExpiresAt` cleared, and `sessionVersion` bumped — which force-logs-out every other existing session for that account, same mechanism as change-password (`src/app/api/auth/reset-password/route.ts:81-95`). Note this route does **not** re-issue a new session cookie for the caller — the reset-password page only shows a "sign in again" confirmation (`src/components/auth/ResetPasswordClient.tsx:96-101`), it never logs the user in automatically.

### Password strength policy (`src/lib/passwordValidation.ts`)

Two layers, both invoked from every password-setting endpoint (self-service change, admin create user, admin reset — the file's own doc comment names this centralization as the fix for a prior drift bug, `src/lib/passwordValidation.ts:7-19`):

- **`validatePasswordStrength()`** (synchronous, works client- and server-side): ≥8 characters, at least one lowercase, one uppercase, one digit, one special character, and not in a local ~90-entry common-password blocklist (`src/lib/passwordValidation.ts:20-37,49-69`).
- **`validatePasswordFull()`** (server-only, async): runs the above, then checks the password against the Have I Been Pwned breach-password API using k-anonymity — only the first 5 hex chars of the SHA-1 hash are sent, the real match happens locally against HIBP's returned suffix list (`src/lib/passwordValidation.ts:82-100,109-117`). This check **fails open**: an HIBP timeout or error is treated as "not breached" (`src/lib/passwordValidation.ts:76-81,97-99`) so an HIBP outage can never block a legitimate password change.
- The client-side reset-password form uses `validatePasswordStrength()` only, for instant hinting (`src/components/auth/ResetPasswordClient.tsx:10,21-26`); the server routes call `validatePasswordFull()` (e.g. `src/app/api/auth/reset-password/route.ts:37`, `src/app/api/auth/change-password/route.ts:77`).

---

## 2. Notifications

### Model

`Notification` (`src/types/index.ts:792-802`): `id`, `recipientUserId`, `type` (free-form string tag), `title`, `message`, `entityType`, `entityId`, `readAt` (nullable), `createdAt`. There is no separate notification-preferences table — every notification is generated server-side as a direct consequence of some workflow action.

### Delivery model: polling, not push

There is no WebSocket or Server-Sent-Events infrastructure anywhere in the app. `NotificationBell` (`src/components/layout/NotificationBell.tsx`) polls `GET /api/notifications` every **30 seconds** via `setInterval` (`src/components/layout/NotificationBell.tsx:36-40`), per the component's own doc comment: "polled rather than pushed (no websocket infrastructure exists elsewhere in the app)" (`src/components/layout/NotificationBell.tsx:9-12`). The Support inbox (`SupportClient.tsx`) polls on the same 30s cadence for thread/message updates (`src/components/support/SupportClient.tsx:64-75`).

### `GET /api/notifications` (`src/app/api/notifications/route.ts`)

Returns the caller's own notifications only (`recipientUserId === session.userId`), most recent first, **capped to 100** (`src/app/api/notifications/route.ts:37-40`) — same unbounded-history-needs-a-server-side-cap pattern as the audit log. No page-level permission gate; every logged-in user has notifications regardless of role (comment at `src/app/api/notifications/route.ts:6-8`).

This endpoint is also the **lazy trigger point for the time-based Rectification Reminder** — since there is no cron/scheduler infrastructure in the app at all, the reminder scan piggybacks on the notification poll every logged-in user already makes every 30s (`src/app/api/notifications/route.ts:9-15`, `src/lib/notifications.ts:107-122`). See "Rectification Reminder" below.

### Mark-as-read endpoints

- `POST /api/notifications/[id]/read` — marks one notification read if it belongs to the caller; `404` otherwise (`src/app/api/notifications/[id]/read/route.ts:5-18`).
- `POST /api/notifications/read-all` — marks every unread notification belonging to the caller as read (`src/app/api/notifications/read-all/route.ts:5-18`).

`NotificationBell` also offers a "reply inline" UX: clicking a `Finding`-type notification marks it read and opens an optional comment box right there, posting to `/api/findings/[id]/comments` before navigating to the finding (`src/components/layout/NotificationBell.tsx:65-103`).

### Recipient resolution (`src/lib/notifications.ts`)

Two resolution strategies:

1. **Permission + org-scope driven** (`usersWithFindingsPermission()`, `src/lib/notifications.ts:50-73`): every `ACTIVE` user whose role holds the given `findings.<action>` permission key, narrowed by district/branch **only** for `DISTRICT`/`BRANCH`-scoped roles — `BANK`-scoped roles (e.g. HO Controller) are never narrowed, since a bank-wide reviewer should hear about every finding regardless of district (`src/lib/notifications.ts:42-49,66-71`). Accepts either one action or an array of actions (e.g. `["verify-rectification", "return-rectification"]`) and de-duplicates recipients so a role holding more than one doesn't get double-notified (`src/lib/notifications.ts:55-59`).
2. **Direct recipient list** (`notifyUsers()`, `src/lib/notifications.ts:23-40`) — used when the recipient is a specific known user (e.g. the finding's `createdBy`) rather than "whoever holds a permission."

`usersWithSupportRespondPermission()` (`src/lib/notifications.ts:86-90`) is the Support-specific equivalent: every `ACTIVE` user whose role holds `support.respond`, **not** org-scoped (Support isn't tied to a district/branch).

### Full trigger list

Every call site that generates a notification, gathered from `src/lib/notifications.ts` and the finding/support API routes:

| Trigger (route) | `type` | Recipients | Notes |
|---|---|---|---|
| Submit — bank-registered, HO approval required (`submit/route.ts:44-51`) | `SUBMITTED` | `Settings.hoApproval.approverUserIds` (explicit list) | |
| Submit — bank-registered, no approval required (`submit/route.ts:53-59`) | `SUBMITTED` | `findings.rectify` holders at the branch | |
| Submit — district-registered (`submit/route.ts:62-68`) | `SUBMITTED` | `findings.district-review` holders in the district | |
| District review — approve (`district-review/route.ts:67-73`) | `DISTRICT_APPROVED` | `findings.ho-review` holders (bank-wide) | |
| District review — reject/return (`district-review/route.ts:82-88`) | `REJECTED`/`RETURNED` | the finding's creator | |
| HO review — approve (`ho-review/route.ts:64-70`) | `HO_APPROVED` | `findings.rectify` holders at the branch | |
| HO review — reject/return (`ho-review/route.ts:92-99`) | `REJECTED`/`RETURNED` | creator + `findings.district-review` holders in the district | Keeps the District Controller "in the loop" even on a Reject, not just a Return (comment at lines 79-91) |
| Bank approval — approve (`bank-approval/route.ts:87-93`) | `BANK_APPROVED` | `findings.rectify` holders at the branch | |
| Bank approval — reject (`bank-approval/route.ts:113-119`) | `REJECTED` | creator only | |
| Bank approval — return (`bank-approval/route.ts:102-119`) | `RETURNED` | creator + `findings.district-review` holders in the district | |
| Rectify — each entry (partial or full) (`rectify/route.ts:233-246`) | `RECTIFIED` | other `findings.rectify` holders at the branch (excludes the actor) | |
| Rectify — same event, District side (`rectify/route.ts:253-261`) | `RECTIFIED` | `findings.verify-rectification` + `findings.return-rectification` holders in the district | Fires even on a partial rectification, not only once fully rectified |
| Verify rectification (`verify-rectification/route.ts:56-62`) | `RECTIFICATION_VERIFIED` | `findings.close` holders in the district | |
| Return rectification — Branch-level or legacy (`return-rectification/route.ts:155-162`) | `RECTIFICATION_RETURNED` | `findings.rectify` holders at the branch | |
| Return rectification — HO-level (overriding District's verify) (`return-rectification/route.ts:172-183`) | `RECTIFICATION_RETURNED` | `findings.verify-rectification` holders in the district | Only fires when HO is the one returning it (`hasHoOnly`) |
| Resubmit rectification (`resubmit-rectification/route.ts:60-66`) | `RECTIFICATION_RESUBMITTED` | `findings.verify-rectification` + `findings.return-rectification` holders in the district | |
| Close — full or partial (`close/route.ts:102-112`) | `CLOSED` | the finding's creator (if not the actor) | |
| Transfer to next period (`transfer/route.ts:67-77`) | `TRANSFERRED` | creator + `findings.transfer` holders in the district | |
| New comment (`comments/route.ts:73-84`) | `COMMENT` | the parent comment's author (if replying) + the finding's creator (excluding the commenter) | |
| Rectification Reminder (time-based, see below) | `RECTIFICATION_REMINDER` | `findings.rectify` holders at the branch | Not tied to a user action |
| New support message (from requester) (`support/route.ts:61-70`, `support/[id]/messages/route.ts:58-68`) | `SUPPORT_MESSAGE` | every `support.respond` holder | |
| Support reply (from staff) (`support/[id]/messages/route.ts:69-77`) | `SUPPORT_REPLY` | the thread's own owner | |

For which finding statuses each of these transitions requires/produces, see `docs/workflow.md`.

### Rectification Reminder (time-based, not action-triggered)

`checkRectificationReminders()` (`src/lib/notifications.ts:123-155`) is the one notification not fired by a user action. Per its doc comment (`src/lib/notifications.ts:107-121`): the app has no cron/scheduler, so this is checked lazily from `GET /api/notifications` itself.

- Gated by `Settings.rectificationReminders.enabled` (`src/lib/notifications.ts:125`).
- Scan cooldown: **1 hour** regardless of configured threshold, so it doesn't rescan every finding on every 30s poll from every user — `REMINDER_SCAN_COOLDOWN_MS = 60 * 60 * 1000` (`src/lib/notifications.ts:105`), throttled via `Settings.rectificationReminders.lastCheckedAt` (`src/lib/notifications.ts:127-131`).
- Applies to findings in one of: `SENT_TO_BRANCH_MANAGER`, `PARTIALLY_RECTIFIED`, `TRANSFERRED`, `RECTIFICATION_RETURNED` (`REMINDABLE_STATUSES`, `src/lib/notifications.ts:97`).
- A finding is reminded once it's been sitting past `Settings.rectificationReminders.thresholdDays` since its last update, and not reminded again inside that same window (`f.lastReminderAt` tracked per finding, `src/lib/notifications.ts:133-152`).
- Recipients: `findings.rectify` holders at the finding's branch (`src/lib/notifications.ts:141`).

### Email notifications

Every in-app notification is also mirrored as an email, **fire-and-forget** (never awaited — `sendNotificationEmail()` is called synchronously inside `notifyUsers()`, which itself runs inside `updateDb()` mutators; a slow/down mail server must never delay or break the workflow action that triggered it — `src/lib/notifications.ts:14-21,38`, `src/lib/mail.ts:56-73`).

- Implemented in `src/lib/mail.ts:74-99` (`sendNotificationEmail`). Uses the notification's own `title`/`message` verbatim as the email subject/body — no separate template system.
- No-ops silently (no throw) if the recipient has no email on file, or if `getTransporter()` returns `null` (SMTP not configured) — `src/lib/mail.ts:76-80`.
- Includes a deep link back into the app, built from `notificationPath()` (`src/lib/mail.ts:44-54`) which maps `entityType`/`type` to a real route: `Finding` → `/findings/[id]`; `SupportThread` with type `SUPPORT_MESSAGE` → `/admin/support` (staff inbox) vs. any other `SupportThread` type → `/support` (requester's own page); `ReportingPeriod` → `/admin/reporting-periods`; anything else falls back to `/dashboard`. The link's base URL comes from the `APP_BASE_URL` env var and is omitted entirely if that's unset (`src/lib/mail.ts:82-83`).
- SMTP transport (`getTransporter()`, `src/lib/mail.ts:12-36`) is shared with the forgot-password flow: driven by `Settings.notification.provider` (`"NONE" | "SMTP" | "GRAPH"`), `smtpHost`/`smtpPort` (admin-editable), plus `SMTP_USER`/`SMTP_PASSWORD` env secrets. `"GRAPH"` is not implemented (logs a warning, returns `null`).

---

## 3. Support / Help Desk

### Purpose

An in-app help-desk / messaging channel between any user and whoever handles Support — not tied to a specific finding, district, or branch. Any logged-in user can open a thread to ask a question or report an issue; there is no separate ticket "category" or "priority" field — a thread is just a subject (auto-derived) plus a message stream.

### Who can open a ticket

Gated by the `support.create` permission (`src/app/api/support/route.ts:11,27`) — the "requester" side. Per the page's own doc comment, "Any logged-in user can send a support message (no permission needed)" (`src/types/index.ts:900`) — in practice `support.create` is granted broadly across roles (see `docs/admin-settings.md` for the registry).

### Who handles tickets

There is no per-agent assignment — Support is handled by a **fixed permission-holder pool**, not routed to a specific staff member. Anyone whose role holds `support.respond` sees the whole inbox (all threads from all users) at `/admin/support` and can reply (`src/app/(app)/admin/support/page.tsx:6-16`, `AdminSupportClient`). A separate `support.view` permission exists for read-only access to the inbox without reply rights — the admin Support page is reachable with *either* `support.view` or `support.respond` (`src/app/(app)/admin/support/page.tsx:14,16`); a `support.respond`-only role must still reach the inbox to find threads to act on (comment at `src/app/(app)/admin/support/page.tsx:6-10`).

### Ticket ("thread") model

`SupportThread` (`src/types/index.ts:907-915`): `id`, `userId` (the requester/owner), `subject` (auto-derived from the first message body, truncated to 80 chars — `src/app/api/support/route.ts:35`), `status` (`"OPEN" | "RESOLVED"`), `rating` (nullable 1-5), `createdAt`, `updatedAt`.

`SupportMessage` (`src/types/index.ts:917-925`): `id`, `threadId`, `senderId`, `senderName`, `senderIsSupport` (boolean — distinguishes the requester's own messages from a staff reply), `body`, `createdAt`.

### Lifecycle

1. **Create** (`POST /api/support`, `src/app/api/support/route.ts:26-76`): requires `support.create`; creates the thread as `"OPEN"` plus its first message, and notifies every `support.respond` holder (`SUPPORT_MESSAGE`).
2. **List own threads** (`GET /api/support`): returns only the caller's own threads, newest-updated first (`src/app/api/support/route.ts:10-20`).
3. **View one thread + its messages** (`GET /api/support/[id]`, `src/app/api/support/[id]/route.ts:10-32`): the thread's owner needs `support.create`; anyone else needs `support.view` **or** `support.respond` (either is enough — opening a thread the inbox lists must not additionally require reply rights).
4. **Reply** (`POST /api/support/[id]/messages`, `src/app/api/support/[id]/messages/route.ts:13-83`): the owner needs `support.create`; a non-owner needs `support.respond`. **Only works while the thread is `"OPEN"`** — replying to a `"RESOLVED"` thread returns `409` "Send a new message to start a new thread" (`src/app/api/support/[id]/messages/route.ts:35-37`). A reply from the owner clears any existing `rating` (reopening the satisfaction loop) and re-notifies every `support.respond` holder; a reply from staff notifies the owner (`SUPPORT_REPLY`) instead (`src/app/api/support/[id]/messages/route.ts:52-77`).
5. **Rate** (`POST /api/support/[id]/rate`, `src/app/api/support/[id]/rate/route.ts`): only the thread's own owner, via `support.create` (`src/app/api/support/[id]/rate/route.ts:15-30`). Rating is a required 1-5 integer. **A 5-star rating closes the thread** (`status → "RESOLVED"`); any lower rating leaves it `"OPEN"` so the owner can send another message to reopen the response cycle (`src/app/api/support/[id]/rate/route.ts:33-38`). The client UI only offers the rating prompt when the thread is still open and the most recent message came from staff (`canRate` in `src/components/support/SupportClient.tsx:132`).

There is no separate "close without rating"/admin-close action — the only way a thread reaches `"RESOLVED"` is the requester giving it 5 stars.

### UI

- Requester side: `SupportClient` (`src/components/support/SupportClient.tsx`) — a two-pane "my conversations" list + active thread view, with a star-rating widget once staff has replied. Polls both the thread list and the open thread every 30 seconds (`src/components/support/SupportClient.tsx:64-75`), same polling model as notifications (no push infrastructure).
- Staff side: `AdminSupportClient`, rendered at `/admin/support` (`src/app/(app)/admin/support/page.tsx`), gated by `support.view`/`support.respond` with a `canRespond` flag passed down to control whether the reply box renders (`src/app/(app)/admin/support/page.tsx:16,24`).

---

## 4. Evidence & Attachments

### What it is

`Evidence` (`src/types/index.ts:766-777`): a file attached either to a whole `Finding` (`commentId` unset) or to one specific `Comment` on it (`commentId` set — shown inline under that comment). Fields: `id`, `findingId`, `commentId?`, `fileName` (original, user-supplied), `mimeType`, `size`, `storagePath` (server-generated), `uploadedBy`/`uploadedByName`, `createdAt`.

### Accepted file types and size limit

Defined in `src/lib/evidence.ts:9-18`:

| MIME type | Extension |
|---|---|
| `application/pdf` | `.pdf` |
| `image/png` | `.png` |
| `image/jpeg` | `.jpg` |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `.xlsx` |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `.docx` |
| `text/csv` | `.csv` |

**Max size: 10 MB** (`MAX_EVIDENCE_BYTES = 10 * 1024 * 1024`, `src/lib/evidence.ts:9`). The Next.js request-body parser itself rejects a `formData()` body over ~10MB before the route ever runs, so an over-size upload is caught as a parse failure and reported as "File exceeds the 10 MB limit" rather than a more literal "no file provided" (`src/app/api/findings/[id]/evidence/route.ts:27-42`).

### Content-type verification (anti-spoofing)

The client-supplied `file.type` (just a `Content-Type` header the browser/client chose) is never trusted alone — `evidenceContentMatchesType()` checks the file's actual leading bytes against what the claimed type should look like before it's written to disk (`src/lib/evidence.ts:44-68`, invoked at `src/app/api/findings/[id]/evidence/route.ts:83-89`):

- PDF: must start with `%PDF-`
- PNG: must match the PNG magic-byte signature
- JPEG: must start with `FF D8 FF`
- XLSX/DOCX: must be a valid ZIP container (`PK\x03\x04` or `PK\x05\x06`) containing an `xl/` or `word/` path respectively
- CSV: coarse "looks like text" check — no NUL/control bytes outside tab/LF/CR in the first 4KB (`src/lib/evidence.ts:31-42`)

A mismatch is rejected with `400` "File content doesn't match its declared type" (`src/app/api/findings/[id]/evidence/route.ts:84-89`) — this closes the specific hole of uploading, say, an HTML file mislabeled as a PDF to get it stored (and later re-served) under an allow-listed extension.

### Storage

**Local filesystem only** — no S3/blob-storage client exists anywhere in the codebase. Files are written under `data/uploads/` relative to the process working directory (`UPLOADS_DIR = path.join(process.cwd(), "data", "uploads")`, `src/lib/evidence.ts:7`), the same "local now, swappable later" convention as the JSON-backed `data/db.json` store (comment at `src/lib/evidence.ts:4-6`). The directory is git-ignored under the existing `/data/` rule. Stored filenames are always server-generated (`${uuid()}.${extension}`, `src/app/api/findings/[id]/evidence/route.ts:92`) — never the user-supplied original name — specifically to rule out path traversal (`evidenceStoragePath()`'s own doc comment, `src/lib/evidence.ts:70-73`).

### Upload — which workflow stages allow it

Evidence upload (`POST /api/findings/[id]/evidence`, `src/app/api/findings/[id]/evidence/route.ts:24-114`) is gated purely by the `findings.evidence` permission (or `findings.comment` when a `commentId` is included — see below) **plus** the finding being in the caller's org scope. It is **not restricted to any particular finding status** — `canUploadEvidence: has("evidence")` in `src/app/(app)/findings/[id]/page.tsx:249` has no status condition, unlike almost every other action on that page (compare `canRectify`, `canClose`, etc., which all check `finding.status`, e.g. lines 200-227). In other words, evidence can be attached at registration time via `NewFindingForm.tsx` and also later, at any point in the finding's lifecycle (rectification, review, after closure, etc.), as long as the uploader holds the permission.

- **Finding-level attachment**: requires `findings.evidence` (`permissionKey("findings", "evidence")`, `src/app/api/findings/[id]/evidence/route.ts:46-49`).
- **Comment attachment** (a `commentId` is included in the form data): requires `findings.comment` instead — per the route's own comment, "the actual action being authorized" is commenting, so a District Controller/Director who can comment but doesn't hold `findings.evidence` can still attach a file to their own comment (`src/app/api/findings/[id]/evidence/route.ts:16-23,44-49`). The referenced `commentId` must belong to the same finding (`src/app/api/findings/[id]/evidence/route.ts:59-61`).

The registration form (`NewFindingForm.tsx`) itself has no file-upload UI for evidence — it only has a free-text `evidenceNote` field ("e.g. filed in branch cabinet, ref #4 - no file upload yet", `src/components/findings/NewFindingForm.tsx:842-849`). Actual file upload only happens after the finding exists, from the finding detail page's Evidence card (`FindingDetailClient.tsx:1011-1025`) and from comment attachments.

### Listing / viewing / downloading

- `GET /api/findings/[id]/evidence` (`src/app/api/findings/[id]/evidence/route.ts:119-132`): gated by `findings.view` only — any user who can see the finding can see its evidence list, independent of upload rights (comment at lines 116-118).
- `GET /api/findings/[id]/evidence/[evidenceId]` (`src/app/api/findings/[id]/evidence/[evidenceId]/route.ts`): also gated by `findings.view` + org scope; streams the file back from disk with `Content-Disposition: attachment` (forces download) using the record's stored `mimeType` and original `fileName` (`src/app/api/findings/[id]/evidence/[evidenceId]/route.ts:26-38`). Returns `404` if the DB record's `storagePath` is missing from disk (line 27-29).
- The finding detail UI (`FindingDetailClient.tsx`) shows finding-level evidence in an "Evidence" card (`src/components/findings/FindingDetailClient.tsx:1011-1047`, listing type/size and linking to the download route) and comment-level evidence inline under each top-level comment and reply (`src/components/findings/FindingDetailClient.tsx:1059-1106`).

### Deletion

**No deletion endpoint exists.** `src/app/api/findings/[id]/evidence/[evidenceId]/route.ts` exports only `GET`; there is no `DELETE` handler for evidence anywhere in `src/app/api/findings/[id]/evidence/**`, and no delete affordance in the Evidence card UI. Once uploaded, an evidence record (and its underlying file) is permanent for the life of the finding — the only way it would disappear is a finding being deleted outright (`DELETE /api/findings/[id]`, gated by `findings.delete`), which is a separate, unrelated code path from evidence-specific deletion.
