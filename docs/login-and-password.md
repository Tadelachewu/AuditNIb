# Login & Forgot/Reset Password — Technical Reference

This is the deep, standalone reference for the three self-service authentication flows: **Login**,
**Forgot Password**, and **Reset Password** — every rule, rate limit, token mechanic, and exact error
message, cited `file:line` against the running code. `docs/platform-and-access.md` §1 covers the same
ground at summary depth (plus Sessions, `requireUser()`/`requirePermission()`, Logout, `/api/auth/me`,
and self-service Change Password, which this document doesn't repeat); this document goes one level
deeper on the two flows the task specifically asked for. For what to do when self-service recovery is
**itself unusable** (a locked-out sole admin, a placeholder email on file), see
`docs/ACCOUNT_RECOVERY.md` — a DB/CLI escape-hatch playbook, deliberately out of scope here.

---

## 1. Login — `POST /api/auth/login`

### 1.1 Overview

Username/password auth backed by `bcryptjs` hashes and a stateless encrypted session cookie
(`iron-session`) — no server-side session table. The entry point is `src/app/login/page.tsx`, a plain
client form; the actual rules live entirely in `src/app/api/auth/login/route.ts`. There is no OAuth/SSO
path anywhere in the app — this is the only way in.

### 1.2 Request validation

`loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) })`
(`login/route.ts:20-23`) — both fields required and non-empty; anything else → `400 "Username and
password are required"`.

### 1.3 Rate limiting & lockout — four independent, stacked layers

All four are Redis-backed (`src/lib/rateLimit.ts`), all fail **open** (a Redis outage is treated as "not
limited" — an abuse-protection outage must degrade brute-force protection, not take login itself down,
`rateLimit.ts:10-15`):

| # | Layer | Key | Threshold | Effect |
|---|---|---|---|---|
| 1 | Per-IP rate limit | `login-ip:<ip>` | 5 attempts / 15 min | `429` once exceeded |
| 2 | Per-account+IP rate limit | `login-account:<ip>:<username>` | 5 attempts / 15 min | `429` once exceeded |
| 3 | Per-username lockout | `login-user:<username>` | 5 **failures** / 15 min window | hard-locked **15 min** |
| 4 | Per-IP lockout | `login-ip:<ip>` | 10 **failures** / 30 min window | hard-locked **30 min** |

(constants: `PER_IP_RATE_LIMIT`/`PER_ACCOUNT_RATE_LIMIT` = `{max:5, windowMs:15*60*1000}`;
`ACCOUNT_LOCKOUT` = `{maxFailures:5, windowMs:15*60*1000, lockoutMs:15*60*1000}`; `IP_LOCKOUT` =
`{maxFailures:10, windowMs:30*60*1000, lockoutMs:30*60*1000}` — `login/route.ts:43-46`).

**Evaluation order, every request** (`login/route.ts:61-80`):
1. Both lockouts (`checkLockout()`, read-only) are checked **first**, before either rate limit — an
   already-locked-out caller gets an immediate `429` with a `Retry-After: <seconds>` header
   (`{ error: "Too many failed attempts. This account/source is temporarily locked." }`) without
   consuming any rate-limit budget by re-triggering it.
2. Both rate limits are then checked (`isRateLimited()`, also read-only) — if either is exceeded,
   `429 { error: "Too many login attempts. Try again later." }`, again with `Retry-After`.
3. Only past this point does the route touch the database or compare a password at all.

**Only failed attempts count.** `recordAttempt()`/`recordFailureForLockout()` are called exclusively in
the failure branch (`login/route.ts:94-98`) — a correct password on the very first try never touches
any counter, and a successful login **clears** the account's rate limit and lockout state entirely
(`clearRateLimit()`/`clearLockout()`, `login/route.ts:102`).

**Exponential backoff on top of all four**: every failed attempt additionally sleeps before responding —
`computeBackoffMs(failures) = min(1000 * 2^(failures-1), 8000)` (`rateLimit.ts:134-136`), i.e. `1s, 2s,
4s, 8s`, capped, driven by the per-username lockout's own running failure count
(`sleep(computeBackoffMs(accountFailure.failures))`, `login/route.ts:99`). This throttles a scripted
loop in real time even before any hard limit is actually crossed.

**`clientIp()`** (`rateLimit.ts:155-163`) only trusts `X-Forwarded-For`/`X-Real-Ip` when the
`TRUST_PROXY` env var is exactly `"true"`; otherwise every direct request collapses onto one shared
`"direct"` bucket. Set `TRUST_PROXY=true` only when genuinely deployed behind a reverse proxy/tunnel
that itself sets (and cannot be tricked into forwarding an attacker-chosen) `X-Forwarded-For` — e.g. the
Cloudflare Tunnel setup in `docs/EXPOSE_TO_INTERNET.md`. Left unset, per-account/per-IP-pairing
protection still works correctly, it just can't distinguish two LAN clients from each other.

### 1.4 Credential check — enumeration-blind by construction

1. **Case-insensitive username lookup** (`u.username.toLowerCase() === username.toLowerCase()`,
   `login/route.ts:83`).
2. **`verifyPassword()` always runs**, even for a username that doesn't exist —
   `verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH)` (`login/route.ts:92`).
   `DUMMY_PASSWORD_HASH` is a fixed, unrelated bcrypt hash (`src/lib/auth.ts:22`), never a real
   account's — its only job is to make a nonexistent-username login and a real-username-wrong-password
   login cost the same bcrypt compare time, closing a response-time username-enumeration side channel
   (doc comment, `login/route.ts:85-91`).
3. On failure (`!user || !passwordOk`): records the attempt against both rate limits and both lockouts,
   sleeps the computed backoff, then returns **exactly** `401 { error: "Invalid username or password" }`
   (`login/route.ts:93-100`) — deliberately the same message whether the username didn't exist or the
   password was wrong. There is no separate "unknown user" error anywhere in this path.

### 1.5 Post-credential gates, in order

Only reached once the password check passes (`login/route.ts:102-122`):

1. `user.status !== "ACTIVE"` → `403 "This account has been deactivated"`.
2. **Temporary-password expiry**: if `user.mustChangePassword` is true **and** `user.passwordExpiresAt`
   is a past timestamp → `403 "Temporary password has expired. Contact an administrator to reset it."`
   A temporary/admin-reset password is only valid for **24 hours** from the moment it was set
   (`User.passwordExpiresAt`'s own schema doc comment, `prisma/schema.prisma:194-197`) — after that,
   login is blocked outright rather than letting the user in on a password an admin chose (and may
   still remember) indefinitely. This is the exact dead-end `docs/ACCOUNT_RECOVERY.md` exists to solve
   when the only admin is the one locked out.
3. The user's `role` record must exist **and** be `status === "ACTIVE"` → else `403 "Your role has been
   deactivated. Contact an administrator."` A user isn't blocked just by their own account being
   deactivated — their *role* being deactivated blocks every holder of it simultaneously.

### 1.6 On success

1. `User.lastLoginAt` is updated and a `LOGIN` `AuditLogEntry` appended, in one `updateDb()` call
   (`login/route.ts:124-135`).
2. A fresh `iron-session` is populated and saved — see `platform-and-access.md` §1 "Session payload" for
   the full `SessionData` field list. One detail worth restating here: `session.permissions` is resolved
   from the role's **current** `permissions` array **at this exact login moment**
   (`login/route.ts:152`, doc comment `:145-151`) — an admin narrowing or widening a role's permissions
   later has **no effect on an already-open session**; the affected users must log in again to pick it
   up. This includes `ADMIN` itself: a newly-added permission is not auto-granted to Administrator,
   contrary to what "Administrator = everything" might suggest — it only auto-holds `roles.manage`
   (guaranteed separately), so a new page/action still needs its checkbox ticked for Administrator like
   any other role.
3. Response returns the sanitized user object via `toSafeUser()` (`login/route.ts:159`) — never the
   password hash.

### 1.7 The login page itself (`src/app/login/page.tsx`)

A plain client component posting `{ username, password }` to `/api/auth/login`. It includes a
collapsible **"Demo accounts"** panel listing one seeded username/password per role
(`login/page.tsx:11-19,92-113`) — a development/demo convenience only, not a production auth path; the
seeded credentials themselves are listed in `README.md`'s "Default users & roles" table and are meant to
be changed or removed before any real deployment.

---

## 2. Forgot Password — `POST /api/auth/forgot-password`

### 2.1 Overview

Self-service token-based reset, reachable from `/forgot-password` (`src/app/forgot-password/page.tsx`),
linked from the login page. Matches by **username or email**, issues a single-use token by email, and is
carefully **user-enumeration-blind**: the HTTP response is identical (`200 {ok:true, message:...}`)
whether or not a match was found — extra machine-readable flags are only ever added for a genuine match,
so an admin reading the page can get actionable detail without the response itself confirming account
existence to an attacker.

### 2.2 Request validation & rate limiting

`schema = z.object({ identifier: z.string().min(1, "Enter your username or email address") })`
(`forgot-password/route.ts:11-13`).

Two independent Redis-backed limits, both checked before any DB read (`forgot-password/route.ts:69-90`):

| Layer | Key | Threshold |
|---|---|---|
| Per-IP | `forgot-password:ip:<ip>` | 5 requests / 15 min |
| Per-identifier | `forgot-password:id:<normalizedIdentifier>` | 3 requests / hour |

Both `429` responses carry a `Retry-After` header. The identifier is lowercased/trimmed before both the
rate-limit key and the DB lookup (`normalizedId`, `forgot-password/route.ts:79`).

### 2.3 Matching

`db.users.find(u => u.status === "ACTIVE" && (u.username.toLowerCase() === normalizedId ||
u.email.toLowerCase() === normalizedId))` (`forgot-password/route.ts:100-105`) — **inactive accounts
never match**, silently (no different response). The code comment notes that after the
`20260921110000_users_email_mandatory` migration, every `ACTIVE` user is guaranteed a non-empty `email`
column value, but a defensive `!== ""` check remains because older/backfilled deployments may carry a
deliberately non-deliverable placeholder (`username@legacy.nib-control360.local`) until an admin
corrects it.

### 2.4 The three "user-blind, but flagged" response shapes

All three return `200 { ok: true, message: "If an active account matches that username or email, a
password reset link has been sent." }` at the HTTP-status/message level — indistinguishable to a
network observer or an attacker probing for valid usernames. They differ only in extra fields, read by
the `/forgot-password` page's own UI (never exposed as a different status code or message):

1. **No match**: bare `{ ok:true, smtpConfigured, message }` — `smtpConfigured` reflects whether *any*
   provider is configured at all, revealing nothing about this specific identifier
   (`forgot-password/route.ts:114-120`).
2. **Match, but no deliverable email** (`noDeliverableEmail: true`, `forgot-password/route.ts:123-135`):
   the matched user's `email` is empty or fails a bare structural regex
   (`isValidEmailForSending()`, `^[^\s@]+@[^\s@]+\.[^\s@]+$`, `forgot-password/route.ts:51-56`). A
   warning is logged server-side naming the username (`console.warn`, not returned to the client) so an
   admin monitoring logs can act; the UI shown to the *requester* only says an administrator needs to
   fix the account's email in Admin → Users.
3. **Match, deliverable email** — proceeds to issue a real token (§2.5) regardless of whether SMTP is
   actually configured; `smtpConfigured`/`emailSent`/`smtpError`/`sentTo` are all populated honestly for
   this case only (`forgot-password/route.ts:255-263`).

### 2.5 Token issuance

Only reached for a real, deliverable-email match:

1. **Token**: `crypto.randomBytes(32).toString("base64url")` — 256 bits of entropy, stored **raw** (not
   hashed) in Postgres `PasswordResetToken.token` (`forgot-password/route.ts:148`; schema
   `prisma/schema.prisma:114-130`, whose own comment explains storing it raw is acceptable specifically
   *because* it's already single-use and this much entropy).
2. **TTL: exactly 30 minutes** (`TOKEN_TTL_MS = 30 * 60 * 1000`, `forgot-password/route.ts:17`).
3. **Any prior unused token for this user is invalidated first** — `updateMany({ where: { userId,
   usedAt: null }, data: { usedAt: new Date() } })` inside the same Postgres transaction that creates
   the new row (`forgot-password/route.ts:154-169`) — **only one live reset link per user at a time**;
   requesting a new one silently kills any earlier unused one.
4. **Reset URL origin**: `buildPublicOrigin()` (`forgot-password/route.ts:28-49`) trusts
   `X-Forwarded-Proto`/`X-Forwarded-Host` first (for a deployment behind a reverse proxy that terminates
   TLS), falling back to the raw `Host` header, then to `new URL(request.url).origin` if headers are
   unusable — specifically so the emailed link points at the domain the user actually typed into their
   browser, not an internal upstream address.
5. **`PASSWORD_RESET_REQUESTED`** audit-log entry is appended regardless of whether the email actually
   sends (`forgot-password/route.ts:175-184`) — the *request* is what's audited, delivery success is a
   separate concern.

### 2.6 Delivery

Via `getTransporter()` (`src/lib/mail.ts:12-36`) — a `nodemailer` SMTP transport built from
`Settings.notification` (host/port, admin-editable at Admin → Settings → Notification Delivery) plus
`SMTP_USER`/`SMTP_PASSWORD` env vars (secrets, never admin-editable in the UI). Returns `null` (no
throw) if the provider is `"NONE"`, the unimplemented `"GRAPH"` option, or missing required config — a
`null` transporter means the route still creates the token row but skips sending, logging a detailed
`console.warn` pointing an admin at `docs/EMAIL_SETUP.md` (`forgot-password/route.ts:138-146`). The
reset email itself (subject *"Reset your NIB Control360 password"*, both plain-text and HTML bodies,
`forgot-password/route.ts:194-229`) is composed and sent directly in this route — not through
`src/lib/mail.ts`'s separate in-app-notification-email helper. A `From` address falls back to
`no-reply@<host>` if `Settings.notification.fromAddress` isn't set (`forgot-password/route.ts:189-193`).
An actual SMTP send failure (caught, not thrown) still returns the same user-blind `200`, with
`smtpError` set to an admin-actionable message and the underlying error logged server-side only
(`forgot-password/route.ts:239-248`).

### 2.7 The forgot-password page (`src/app/forgot-password/page.tsx`)

A single-field form (username or email). After submit, it swaps to a result panel that always shows the
generic "if an account matches..." success message, then conditionally layers on:
- a green "Sent to `<email>`" line only when `emailSent === true` (never otherwise — never implies
  delivery when the route couldn't confirm it),
- an amber "no deliverable email on file" box when `noDeliverableEmail`,
- an amber "outbound email is not configured" box (with step-by-step admin instructions) when
  `!smtpConfigured`,
- a red "email delivery failed" box with the specific `smtpError` message when present.

None of these boxes ever appear for a genuine no-match request — the client only receives the extra
flags at all when the server found a real account, so a UI observer still can't distinguish "no match"
from "match, but nothing else went wrong."

---

## 3. Reset Password — `POST /api/auth/reset-password`

### 3.1 Overview

Reachable at `/reset-password?token=<token>` (`src/app/reset-password/page.tsx`, rendered by
`src/components/auth/ResetPasswordClient.tsx`) — the link emailed in §2.6. Consumes the token exactly
once and sets a new password; it does **not** log the user in.

### 3.2 Request validation & rate limiting

`schema = z.object({ token: z.string().min(1), newPassword: z.string().min(8) })`
(`reset-password/route.ts:10-13`) — the `min(8)` here is a cheap structural pre-filter only; the real
strength gate is `validatePasswordFull()` (§4), run separately.

**Rate limit: 10 attempts / 15 min, keyed by the first 8 characters of the token itself**
(`PER_TOKEN_RATE_LIMIT`, `token.slice(0,8)`, `reset-password/route.ts:15,27-35`) — since the token is
already single-use, high-entropy, and unguessable, this limit mainly guards against a client retrying
the same (possibly expired/already-used) link in a tight loop, not against brute-forcing the token value
itself.

### 3.3 Order of checks

1. Rate limit (above).
2. **Password strength**, via `validatePasswordFull()` — checked *before* the token is even looked up in
   Postgres (`reset-password/route.ts:37-40`), so an attacker can't use a weak-password probe to learn
   anything about token validity timing.
3. **Token lookup and validity**: `prisma.passwordResetToken.findUnique({ where: { token } })`
   (`reset-password/route.ts:43-45`); rejected with a single unified `400 "This password reset link is
   invalid or has expired. Request a new one."` if the row doesn't exist, `usedAt !== null` (already
   consumed), or `expiresAt` is in the past (`reset-password/route.ts:47-56`) — deliberately one message
   for all three cases, not distinguishing "never existed" from "expired" from "already used," so a
   probing request learns nothing extra either way.
4. **Account still valid**: the token's `userId` must resolve to a user with `status === "ACTIVE"`, else
   `400 "Account not found or deactivated"` (`reset-password/route.ts:59-65`) — covers the case where an
   admin deactivated the account *after* the reset email was sent but before the link was used.

### 3.4 On success

Two writes, not one transaction spanning both stores (Postgres for the token, the app's own `updateDb()`
for the user row):

1. `passwordResetToken.update({ usedAt: now })` — marks the token permanently consumed
   (`reset-password/route.ts:69-79`).
2. `u.passwordHash = hashPassword(newPassword)`; `u.mustChangePassword = false`; `u.passwordExpiresAt =
   null`; **`u.sessionVersion` incremented** (`reset-password/route.ts:81-95`) — this is what force-logs
   -out every *other* already-open session for that account, since `getCurrentUser()` compares the live
   `sessionVersion` against each cookie's snapshotted value on every request (see
   `platform-and-access.md` §1 "Session storage"). A `PASSWORD_RESET` audit-log entry is appended in the
   same call.

**This route never issues a session cookie for the caller.** `ResetPasswordClient.tsx` shows a plain
"sign in again" confirmation on success (`ResetPasswordClient.tsx:96-101`) — resetting a password never
auto-logs the user in; they must go through `/login` with the new password like any other sign-in.

### 3.5 The reset-password page

`ResetPasswordClient.tsx` reads `token` from the URL query string, runs `validatePasswordStrength()`
client-side (synchronous, no network — the same rules as §4.1, for instant hinting only) as the user
types, and only submits to the server once the client-side check passes. The server's
`validatePasswordFull()` (§4) remains the authoritative gate regardless of what the client already
checked.

---

## 4. Password strength policy (`src/lib/passwordValidation.ts`)

Centralized specifically so every password-setting endpoint in the app — self-service change, this
reset flow, admin create-user, admin reset-user-password — enforces identically, after an earlier drift
bug where they didn't (doc comment, `passwordValidation.ts:7-19`).

### 4.1 `validatePasswordStrength()` — synchronous, no network, usable client- or server-side

In order (the `PASSWORD_RULES` list in `passwordValidation.ts`), first failure wins:

| # | Rule | Error message |
|---|---|---|
| 1 | Length ≥ 8 (`PASSWORD_MIN_LENGTH`) | *"Password must be at least 8 characters"* |
| 2 | At least one lowercase (`[a-z]`) | *"Password must include a lowercase letter"* |
| 3 | At least one uppercase (`[A-Z]`) | *"Password must include an uppercase letter"* |
| 4 | At least one digit (`[0-9]`) | *"Password must include a number"* |
| 5 | At least one non-alphanumeric character | *"Password must include a special character"* |
| 6 | Not in the local ~90-entry common-password blocklist (case-insensitive exact match) | *"This password is too common - choose something less predictable"* |

The blocklist (`COMMON_PASSWORDS`, `passwordValidation.ts:20-37`) is a fixed in-code `Set` — generic
weak passwords (`"password123"`, `"qwerty123"`, `"letmein"`...) plus a handful tailored to this app's own
domain (`"banker123"`, `"controller1"`, `"auditor123"`, `"welcome123"`, `"changeme123"`, `"temppass1"`).
Rule 6 is checked only after rules 1-5 already pass, so a blocklisted word that's also too short or
missing a character class is rejected for that reason first. This same rule set is exactly satisfiable
by the app's own seeded demo passwords (e.g. `Admin@123`) — deliberately, so a fresh seed never fails
its own policy.

### 4.2 `validatePasswordFull()` — async, server-only, the real gate

Runs `validatePasswordStrength()` first (no point spending a network round trip on an already-rejected
password), then, only if that passes, checks the password against **Have I Been Pwned**'s breach
database using **k-anonymity** (`passwordValidation.ts:82-100`):

1. SHA-1 hash the password (Web Crypto `crypto.subtle.digest`, chosen specifically because it's
   available in both Node and the browser bundle without a `node:crypto` import that would break the
   client build — see the file's own top-of-file comment).
2. Send only the **first 5 hex characters** of the hash to `https://api.pwnedpasswords.com/range/<prefix>`
   (a 3-second timeout, `AbortSignal.timeout(3000)`) — HIBP returns every known suffix for that prefix
   (typically several hundred), and the real match against the full hash happens **locally**; neither
   the plaintext password nor its full hash ever leaves this server.
3. If the local suffix match hits → `{ valid: false, error: "This password has appeared in a known data
   breach - choose a different one" }`.
4. **Fails open**: any error or timeout calling HIBP is treated as "not breached"
   (`isPasswordBreached()`'s `catch { return false; }`, `passwordValidation.ts:97-99`) — an HIBP outage
   must never be the reason a legitimate password change or account creation is blocked. This mirrors
   the same fail-open philosophy as the Redis rate-limiter (§1.3).

`validatePasswordFull()` is what every server route actually calls (`reset-password/route.ts:37`,
`change-password/route.ts:77`, and the admin create/reset-user routes); `validatePasswordStrength()`
alone is reserved for contexts that can't await a network call — client-side hinting being the only one
in this codebase.

### 4.3 Where the rules are checked (kept in sync)

The rules live in **one place each** and both the server and every form use them, so a form never
accepts what the server will reject:

| Rule | Source | Server | Forms (live, before submit) |
|---|---|---|---|
| **Password policy** (§4.1) | `PASSWORD_RULES` in `src/lib/passwordValidation.ts` (`passwordRuleChecks()`, `validatePasswordStrength()`) | `validatePasswordFull()` in create user, admin reset (edit user), change password, reset password | A live checklist (`src/components/ui/PasswordRules.tsx`) under: **Add User** temporary password, **Edit User** reset password, **Profile → Change password**, **Reset password** page. The submit button stays disabled until every rule is met (and the confirmation matches). **Import CSV (users)** rejects a row whose password fails the policy before sending it. |
| **Username** | `src/lib/usernameValidation.ts`: 3–50 characters; letters, numbers, dots, dashes, underscores; no spaces | Create user (trimmed first); unique case-insensitively | **Add User**: the rule is shown under the field, the exact problem replaces it after leaving the field, and **Create User** stays disabled until it's valid. **Import CSV (users)** checks each row's username the same way. |

Only the breach check (§4.2) runs on the server alone; a password that passes the checklist can still
be rejected for that reason, with the server's message.

**Sign in** checks only that both fields are filled in (the button stays disabled until they are). It
deliberately does not apply the policy or the username format: older passwords and usernames may
predate the current rules. It trims the username, matching how usernames are stored (no spaces) and
looked up (case-insensitively).

---

## 5. Edge cases & known gotchas

- **The login error message never distinguishes "no such user" from "wrong password"** (§1.4) — by
  design, and this extends to backoff/lockout timing too: both paths run the same bcrypt compare and the
  same failure-recording logic, so there's no timing or counter-side-channel difference either.
- **Lockout is checked before rate limiting, every single request** — an attacker who's already
  triggered the harder lockout can't "reset" it by continuing to hammer the endpoint; every subsequent
  request short-circuits at the lockout check and never reaches (or consumes) the rate limiter.
- **A role being deactivated blocks login for every user holding it**, not just accounts individually
  deactivated (§1.5 rule 3) — an admin deactivating a role is effectively a mass-lockout for that role's
  users, immediately, even for already-issued sessions (the next `getCurrentUser()` re-check would also
  need the role active — see `platform-and-access.md` §1 for that server-side re-validation mechanism).
- **A permission change on a role takes effect only on next login** (§1.6) — this is easy to
  misdiagnose as "the permission edit didn't save" when it's actually working correctly; the fix is
  telling the affected user to log out and back in, not re-editing the role.
- **Forgot-password's three response variants are genuinely indistinguishable at the HTTP level** (same
  status, same top-level message) — only the JSON body's *extra* fields differ, and only ever for a real
  match. A network-level observer (not reading the parsed JSON) cannot tell a match from a non-match at
  all.
- **A reset token surviving past its account's later deactivation is still checked at redemption time**
  (§3.3 step 4) — issuing the email doesn't "lock in" the account's active status; an admin deactivating
  the account after the email goes out but before it's clicked correctly blocks the reset.
- **Resetting a password never logs the caller in** (§3.4) — a support agent walking a user through this
  flow should expect the user to land back at `/login`, not be automatically signed in; this is
  deliberate, not a missing feature.
- **HIBP and Redis both fail open, independently** — an HIBP outage weakens the breach check (falls back
  to the local blocklist only) and a Redis outage disables rate-limiting/lockout entirely, but neither
  outage can ever itself prevent a legitimate login, password change, or reset. This is a considered
  availability-over-strictness tradeoff, not an oversight — see each file's own doc comment for the
  reasoning.
- **The mandatory-email migration means a genuinely email-less account should no longer exist**, but the
  code still defensively handles one (§2.3) — a leftover placeholder address
  (`username@legacy.nib-control360.local`) from a pre-migration deployment is the realistic way this
  still shows up, and it surfaces to the *requester* as the generic success message plus the
  `noDeliverableEmail` admin-pointer box, never as an error that would confirm the account's existence.
- **`TRUST_PROXY` is a global, single on/off switch** — turning it on trusts `X-Forwarded-For` for every
  rate-limit/lockout key across the whole app, not just login; it should only ever be set when the
  actual deployment topology guarantees that header can't be attacker-forwarded (see `rateLimit.ts`'s
  own comment and `docs/EXPOSE_TO_INTERNET.md`).
- **If self-service recovery is itself the thing that's broken** — the sole-admin-locked-out scenario,
  or an account whose email column is wrong and nothing here can fix it — that's a different document
  entirely: `docs/ACCOUNT_RECOVERY.md`'s DB/CLI playbook, not a variation of the flows described here.
