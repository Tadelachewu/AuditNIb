# Login & Authentication Security Rules

This document is the single source of truth for how NIB Control360
authenticates users and hardens the login surface. Every rule is traced
to its implementing line so auditors, security reviewers, and future
maintainers can confirm "doc says X, code actually does X, here's the
line."

Sections:

1.  **Authentication surfaces** — routes, actors, credentials.
2.  **Passwords** — storage, strength, rotation, admin-set temp passwords.
3.  **Login hardening** — rate limits, lockouts, exponential backoff,
    username-enumeration blindness.
4.  **Sessions** — cookie, encryption, revocation on password change,
    account deactivation.
5.  **Forgot-password & reset-token hardening.**
6.  **Admin operational rules** — break-glass admin, sole-active-admin
    anti-pattern, email hygiene.
7.  **Failure modes / bypass matrix** — what we explicitly defend
    against, what we rely on the deployment (Nginx/TLS) to provide.

---

## 1. Authentication surfaces

Three flows write an authenticated session cookie. One (forgot-password)
**does not** write a session on success — it writes a reset token and
forces the user through an explicit password-set step first.

| Flow                                   | Route                                                                                            | Credentials                      | Returns a session? |
|----------------------------------------|--------------------------------------------------------------------------------------------------|----------------------------------|--------------------|
| Regular login                          | [login/route.ts](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/auth/login/route.ts) | `username + password`           | ✅ Yes             |
| Password change (self-service, logged in) | [change-password/route.ts](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/auth/change-password/route.ts) | old password + new password | ✅ Updates session (clears mustChangePassword flag) |
| Reset password (from emailed link)     | [reset-password/route.ts](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/auth/reset-password/route.ts) | `token + new password`           | ❌ No.  User must then visit `/login`. |
| Forgot password (request a link)       | [forgot-password/route.ts](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/auth/forgot-password/route.ts) | `identifier` (username OR email) | ❌ No.  Emails a token. |

**No other route may write, decrypt, or invalidate `nib_control360_session`** —
see `session.ts` §3 for the single-point-of-truth rule.

---

## 2. Passwords

### 2a. Storage

Algorithm: **bcrypt, 10 rounds**. No plaintext, no reversible ciphers, no
roll-your-own hashing. Single implementation, called by every
password-setting path:

- `hashPassword(plain): string` — hashes at rest.
- `verifyPassword(plain, hash): boolean` — constant-time comparison is
  provided by the bcrypt library itself.

Code: [auth.ts](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/auth.ts#L1-L11).

DB column: `users.password_hash` (mapped from Prisma field
`User.passwordHash`, see [schema.prisma#L159-L209](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/prisma/schema.prisma#L159-L209)).

**bcrypt-ignored characters beyond 72 bytes** is the known limitation of
bcrypt — passwords *can* be longer (the frontend allows any string ≥ 8
chars), but only the first 72 bytes participate in the hash. Policy and
blocklist below make 72-byte-repeating-collision-style attacks on the
userbase impractical; if this becomes a real concern in future, swap to
`hashSha256(plain) || bcrypt || salt`, but don't do it without a
migration path for existing hashes (keep an `algorithm` column, verify
with old algo on match, re-hash with new on success).

### 2b. Password-strength gate — applied on *every* password-set action

Two functions, one chain: local strength check first (fast), then
Have-I-Been-Pwned k-anonymity breach lookup (defense-in-depth, fails
open).

**Local strength gate** — [validatePasswordStrength()](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/passwordValidation.ts#L44-L69):

- ≥ 8 characters.
- ≥ 1 lowercase letter.
- ≥ 1 uppercase letter.
- ≥ 1 digit.
- ≥ 1 non-alphanumeric character (`[^A-Za-z0-9]`).
- NOT present in the local `COMMON_PASSWORDS` blocklist (84 entries,
  all the "admin123 / qwerty123 / p@ssw0rd" family plus a handful
  tailored to this app's own domain, e.g. "banker123", "controller1",
  "auditor123" — case-insensitive exact match).

**HIBP breach gate** — [validatePasswordFull()](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/passwordValidation.ts#L82-L116):

- Password is SHA-1 hashed locally.
- Only first **5 hex chars** of the hash leave this server (the k-anonymity
  prefix) — sent to `api.pwnedpasswords.com/range/<prefix>` with
  `Add-Padding: true` and a 3-second timeout.
- HIBP returns every known-suffix for that prefix (typically ~300-800
  lines); the real 40-hex suffix match is computed **locally**.
- Fails **open** — a HIBP network error / timeout is treated as "not
  breached."  A third-party outage must never block legitimate users.
- The plaintext password **never** leaves the server; the full SHA-1
  **never** leaves the server.

**Where the full gate is enforced** (3 paths):

1.  Self-service `/profile/change-password` —
    [change-password/route.ts](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/auth/change-password/route.ts).
2.  Admin → Users → Create user (the one-shot admin-supplied password)
    — [admin/users/route.ts](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/admin/users/route.ts).
3.  Admin → Users → Reset password (force reset of another user's password)
    — [admin/users/[id]/route.ts](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/admin/users/%5Bid%5D/route.ts#L161-L174).
4.  Self-service forgot-password flow → `/reset-password` token
    submission — [reset-password/route.ts](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/auth/reset-password/route.ts#L37-L40).

If a new password-setting code path is added (e.g., a SSO-migration
endpoint), it MUST call `validatePasswordFull()` and reject on
`valid === false`; otherwise the new path silently bypasses the
blocklist + HIBP check.

### 2c. Admin-set temporary passwords

The two admin paths (create user, reset user) intentionally set three
fields together (see [admin/users/[id]/route.ts#L161-L174](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/admin/users/%5Bid%5D/route.ts#L161-L174)):

| Field | Value | Semantics |
|-------|-------|-----------|
| `passwordHash` | fresh bcrypt(newPassword) | Admin chose the password. |
| `mustChangePassword` | TRUE | Login is allowed; but every guarded route plus the layout redirects to `/change-password` until the user picks their own. |
| `passwordExpiresAt` | `NOW + 24 hours` | A temp password the admin still (in theory) remembers must not work forever. After this time, the login route refuses it **even if the plaintext is correct**. |

Login check — [login/route.ts#L112-L117](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/auth/login/route.ts#L112-L117):

```ts
if (user.mustChangePassword && user.passwordExpiresAt && new Date(user.passwordExpiresAt).getTime() < Date.now()) {
  return NextResponse.json({ error: "Temporary password has expired. Contact an administrator to reset it." }, { status: 403 });
}
```

> ⚠ **This gate is exactly the "admin locks themselves out" trap from
> ACCOUNT_RECOVERY.md.** It is not a bug — it's a deliberate defense
> against a shared-secret that is still held by the admin who set it.
> The combination that is always dangerous (and should be prevented by
> policy / future hardening):
>
> *Sole active ADMIN → resets own password → 24h elapse before they
>  next log in → self-lockout; if email on file is also wrong, recovery
>  requires DB access.*
>
> Recovery runbook: **[ACCOUNT_RECOVERY.md](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/docs/ACCOUNT_RECOVERY.md)**.

After a successful self-service password change, these flags are cleared
and `sessionVersion` is bumped to revoke any other browsers' cookies.
See [change-password/route.ts](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/auth/change-password/route.ts).

---

## 3. Login hardening — rate limit, lockout, timing

Four independent layers, checked in this order on every login request.
Only **failed** attempts count — a correct password on the first try
never touches any counter or limit.

Source block comment with the whole table at
[login/route.ts#L25-L46](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/auth/login/route.ts#L25-L46).

| Layer | Keyed by | Budget | Window | Action |
|-------|----------|--------|--------|--------|
| L1. IP rate limit | client IP | 5 attempts | 15 min | 429 with `Retry-After` |
| L2. Account × IP rate limit | username + IP | 5 attempts | 15 min | 429 |
| L3. Account lockout | username | 5 failures | 15 min | Hard reject for **15 min** (after 5 failures) |
| L4. IP lockout | client IP | 10 failures | 30 min | Hard reject for **30 min** (after 10 failures) |

Lockouts are checked **before** rate limits on every request — an already
locked caller gets an immediate 429 without re-consuming rate budget.

### 3a. Exponential backoff before each failed-attempt response

Additionally, every failed attempt sleeps an exponentially growing
delay before returning the 401: `1000 * 2^(failures-1)`, **capped at
8000ms** — i.e. 1s, 2s, 4s, 8s, then flat at 8s for every further
failure, driven by the per-username lockout's own failure counter (no
separate jitter term). This is defense-in-depth for fast bot loops even
before any lockout threshold is hit. Implementation: `computeBackoffMs()`
(`src/lib/rateLimit.ts:134-136`: `Math.min(1000 * 2 ** Math.max(0,
failureCount - 1), 8000)`) + `sleep()`, invoked in the login handler.

### 3b. Username enumeration blindness

Two independent defenses.

**Error-message parity.** Regardless of *why* a login failed (no such
user; wrong password; account deactivated; temp password expired; IP
locked out), the **status code and error shape** are carefully kept
identical or indistinguishable where possible:

| Actual failure                               | Response status | Error text                                                                  |
|----------------------------------------------|-----------------|-----------------------------------------------------------------------------|
| Nonexistent username                         | 401             | `"Invalid username or password"`                                            |
| Wrong password                               | 401             | `"Invalid username or password"`                                            |
| Account status == INACTIVE                   | 403             | *"This account has been deactivated"* — distinguishable intentionally so HR offboarding is clear to the legitimate ex-user. |
| Temp password expired (`mustChangePassword && pastExpiry`) | 403 | *"Temporary password has expired. Contact an administrator to reset it."* — intentionally distinguishable. |

**Timing parity (the DUMMY_HASH trick).** If the username doesn't exist,
a naive implementation returns 401 *before* spending any CPU on bcrypt.
That creates a measurable timing side-channel — a nonexistent username
is ~80-120ms faster than a real one with a wrong password. Enumeration
defense against that runs a bcrypt compare against a **fixed, known
bogus** hash on the nonexistent-username path, so the two cases are
CPU-time indistinguishable. The dummy hash has never protected a real
account and is public (it's a constant in source).

Code: [auth.ts#DUMMY_PASSWORD_HASH](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/auth.ts#L13-L22) + the call site inside login/route.ts where it's used.

### 3c. Deactivated accounts (`status != ACTIVE`)

Checked **after** password verify (not before), so an attacker can't
time-probe for deactivated accounts either. Response: 403 *"This
account has been deactivated."* A legitimately offboarded employee
deserves a clear answer; enumeration risk here is accepted because
status changes are one-way, infrequent, and obvious to the affected
party anyway.

---

## 4. Sessions

Session system: [`iron-session`](https://github.com/vvo/iron-session)
(SeAL encryption). Stateless — the session content lives entirely in
the cookie; there is no server-side session table to purge.

Source: [session.ts](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/session.ts).

### 4a. Cookie properties

```ts
cookieName: "nib_control360_session"
cookieOptions: {
  secure:   SESSION_COOKIE_SECURE=true   (forced TRUE in production env
                                         per project_memory.md hard
                                         constraints)
  sameSite: lax
  httpOnly: true
}
```

Why:
- `httpOnly` — JS (and any XSS) cannot read the cookie.
- `sameSite=lax` — CSRF mitigation; cross-site navigations do not send
  it.  Additionally CSRF is checked at the Edge in `src/proxy.ts`.
- `secure=true` (production) — never sent over plain HTTP.

**Password (the session-encryption key):** `IRON_SESSION_PASSWORD`, min
32 chars, checked at boot. If absent or < 32, the session factory
throws and the app refuses to start.

### 4b. What travels in the encrypted cookie

`SessionData` at [session.ts#L6-L37](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/session.ts#L6-L37):

```ts
{ isLoggedIn, userId, username, name, role, roleName, orgScope,
  permissions[], districtId, branchId, mustChangePassword, sessionVersion }
```

Everything the Edge-side `src/proxy.ts` needs to authorize a request
**without** a round-trip to Postgres. The trade-off: role/permissions
changes take effect **at next login**, not mid-session. That's already
documented in PHASE1.md.

### 4c. Stateless-cookie revocation (the sessionVersion trick)

The biggest weakness of cookie-stored sessions is "how do I invalidate
a cookie I already issued, before it expires?"

**Answer: bump `users.session_version` (mapped from Prisma
`User.sessionVersion`) and compare on every single guarded request.**

`sessionVersion` is incremented on **every successful login** and on
**every password change** (self, admin reset, forgot-token consume).
Together these give us two revocation policies:

1. **Single-session-per-user** (via login bump): every time you sign in
   from a new browser / device, *every* previously-issued session cookie
   for that account becomes invalid on its next request. The brand-new
   cookie carries the new version and is the only one that survives.
   See [login/route.ts#L124-L178](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/auth/login/route.ts#L124-L178):
   `nextSessionVersion = (user.sessionVersion ?? 1) + 1` is computed
   before `updateDb`, written to `u.sessionVersion` in the same
   transaction as `lastLoginAt`, and then used as
   `session.sessionVersion` in the freshly-issued cookie.

2. **Global kill-on-password-change** (via password-change bumps): a
   password change on any channel (self-service change, admin reset,
   forgot-token consume) also `+= 1`s the counter, so no cookie issued
   against the old password can outlive the change itself. Admin reset
   is the narrowest case: the bump only runs inside the
   `if (input.password)` branch of
   [admin/users/[id]/route.ts#L161-L173](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/admin/users/%5Bid%5D/route.ts#L161-L173)
   so that an edit to *only* name/email/role does not knock the user
   offline.

- **Account status change (deactivate/reactivate) does NOT itself bump
  `sessionVersion`** — verified directly against
  [admin/users/[id]/route.ts#L155-L179](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/admin/users/%5Bid%5D/route.ts#L155-L179):
  setting `input.status` alone updates only `u.status`. Deactivation is
  still revoked immediately, but by a **separate** mechanism: every
  `getCurrentUser()` call independently re-checks `status === "ACTIVE"`
  from the DB on top of the `sessionVersion` comparison (§4c below), so
  a deactivated user's next request is rejected regardless of whether
  their `sessionVersion` ever changed. Don't rely on `sessionVersion`
  alone as evidence a deactivation took effect — the live `status` read
  is the actual enforcement point for that case.
- On **every guarded page render** (Server Components call
  `getCurrentUser()`, at [session.ts#L134-L190](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/session.ts#L134-L190)) and every API route
  that calls `requireUser()` ([guard.ts](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/guard.ts)):
  - Read `session.sessionVersion` from the decrypted cookie.
  - Read `current.sessionVersion` from the DB for that user (indexed,
    one column, cheap).
  - If they differ → treat the session as logged out; destroy the
    cookie where possible; return null / 401.

Cost: **one indexed PK lookup per guarded request** (~sub-ms on Postgres
with any reasonable pool). Benefit: instant, bulletproof revocation
without a server-side session store. The comparison also re-checks
`status === ACTIVE` in the same read, so a deactivation takes effect on
the user's next click, not at next cookie expiry.

### 4d. Idle / absolute expiry

Two independent time-based limits are enforced by
`getCurrentUser()` ([session.ts#L134-L190](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/session.ts#L134-L190))
**before** the DB-level `sessionVersion` / `status` check, so a timed-out
session never even makes it to Postgres.

Both are configurable via environment variables (see `.env.example`):

| Env var | Default | What it does |
|---|---|---|
| `SESSION_IDLE_TIMEOUT_MINUTES` | **30 minutes** | Sliding window. Any authenticated request (page render or API call) resets the clock; zero activity for this long signs the user out. |
| `SESSION_ABSOLUTE_TIMEOUT_HOURS` | **8 hours** | Hard cap from login (or from the last password change that re-issued the session). Even continuous activity cannot extend a session past this point — the user must log in again. |

Timestamps are carried inside the encrypted cookie itself:

- `session.sessionCreatedAt` — epoch ms at login / password-change (a
  password change fully re-issues the session, so this resets).
- `session.lastActivityAt` — epoch ms of the last guarded request;
  refreshed on every successful call to `getCurrentUser()`.

Three additional layers guarantee the limits even if the server-side
code path is somehow bypassed:

1. **Cookie `Max-Age`** is set to the absolute timeout in seconds, so the browser drops the cookie after 8 h even if no server call is ever made again.
2. **Backward-compat / migration:** an existing session cookie issued *before* these fields were added lacks both timestamps. `getCurrentUser()` treats this as the FIRST time it's seeing that session — if and only if it still passes the `sessionVersion` + `status === "ACTIVE"` checks, it populates `sessionCreatedAt = now` and `lastActivityAt = now` on the spot. Both timeout windows are then anchored to the migration visit rather than the original login — no forced relogin, no risk of a redirect loop. A genuinely-compromised old cookie still can't bypass anything because `sessionVersion` / `status` checks are applied first (before timestamps are backfilled).

Note on `lastActivityAt` refreshes from Server Components: Next.js forbids
writing `Set-Cookie` from a page render, so `.save()` throws in that
context. The refresh is best-effort: idle windows are always advanced by
API calls (every form submit, data fetch, mutation — those go through
`requireUser()` inside a Route Handler where `.save()` works) and page-only
activity will at worst cause a slightly conservative (earlier) idle
logout — which is itself backed by the absolute timeout + browser
`Max-Age`, so no session ever outlives the 8 h cap.

---

## 5. Forgot-password & reset-token hardening

### 5a. Identifiers, matching, enumeration

- User types either a username OR an email → the `identifier` field.
- Matching is case-insensitive, trimmed to `lower()`.
- Matches only `ACTIVE` users. Inactive users are treated as
  nonexistent.
- **Always** returns `{ ok: true, message: "If an active account matches…" }`
  with the same wording whether a match was found or not — enumeration
  blind. See [forgot-password/route.ts#L114-L120](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/auth/forgot-password/route.ts#L114-L120).

### 5b. Undeliverable-email guard (the silent success rule)

Before sending: `Boolean(email) && isValidEmailForSending(email)` (regex
shape check, at [forgot-password/route.ts#L51-L57](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/auth/forgot-password/route.ts#L51-L57)).

- ✅ Deliverable → send link via Nodemailer, write `PasswordResetToken`
  row, write audit log.
- ❌ Not deliverable → **still return the same 200 success**, but do
  NOT create a token, do NOT try to send. Write a console warning with
  the username + bad email; the recovery path for this case is **Admin
  → Users → fix email** (or, if the admin is the one locked out,
  ACCOUNT_RECOVERY.md).

Why this rule (§NetA in ACCOUNT_RECOVERY.md)? If we returned a different
response on an invalid email, an attacker could enumerate usernames by
typing deliberately-broken emails and watching for "failed to send"
errors. Silent success, same shape as the found-and-sent case, is the
enumeration-safe answer.

### 5c. Rate limits on the forgot endpoint

Two layers, separate from login counters (forgot-password requests
don't count as login attempts, and vice versa):

| Layer | Key | Budget | Window |
|-------|-----|--------|--------|
| IP | `forgot-password:ip:<ip>` | 5 requests | 15 min |
| Identifier (username or email, lowercased) | `forgot-password:id:<normalizedId>` | 3 requests | 60 min |

Code: [forgot-password/route.ts#L15-L16](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/auth/forgot-password/route.ts#L15-L16).

### 5d. Token properties

- 32-byte CSPRNG (`crypto.randomBytes(32)`), **base64url-encoded** (not
  hex) → `.toString("base64url")` yields ~43 characters
  (`src/app/api/auth/forgot-password/route.ts:148`). Still 256 bits of
  entropy either way; base64url just packs it into fewer characters
  than hex would. Not UUIDs — the UUID format has known-constant bits
  which reduce search space, though for a 30-min TTL this is academic.
- One `PasswordResetToken` row per request; each is **single-use**
  (row has `usedAt` consumed on success; reused on a second submit →
  invalid-token error, even if the user clicks the link twice).
- TTL: **30 minutes**. Both sides of the reset flow compare
  `createdAt + TTL_MS` against clock time, not DB expiry.
- DB row has a UNIQUE on `token`; FK on `userId`.

### 5e. Rate limit on token consumption

`reset-password` endpoint (submitting the new password) has its own
per-token 15-min limit: **10 attempts**. This blocks brute-forcing a
leaked token URL (though in practice the 64-hex space is already
infeasible to brute force in 30 min).

### 5f. Audit trail

Forgot-password link requests AND reset-password consumes both append
to the audit log via `appendAuditLog()`.  Consuming the token also
bumps `sessionVersion`, revoking any pre-reset session cookie (so a
stolen cookie taken before the password change can't still work after
the reset).

---

## 6. Admin / operational rules

These are enforced partly in code, partly by policy (where code-only
enforcement would itself cause the lockout it's trying to prevent).

### 6a. Break-glass admin (policy + code)

- Deployments MUST have at least **two** `role = ADMIN` rows.
- Exactly one of them MAY be kept `status = INACTIVE` 99% of the time —
  the emergency / break-glass account.
- To activate the break-glass account during a recovery: use the
  `prisma/emergency-admin.ts` Path-3 script in ACCOUNT_RECOVERY.md (it
  reactivates on upsert).  Do NOT edit it via SQL by hand — the script
  also bumps `sessionVersion` and writes a fresh password hash.

### 6b. Sole-active-ADMIN anti-pattern

These three operations on the **only** active `role=ADMIN` row are
policy-forbidden and should be code-forbidden in a future hardening
patch:

1.  Setting `mustChangePassword = true` on yourself.  (Direct path to
    the 24h-expiry self-lockout.)
2.  Changing your own email to an untested address.  Test-send via
    **Admin → Settings → Notifications → Test Email** first.
3.  Deactivating the last active ADMIN.  (App becomes un-admin-able;
    recovery is Path 3 only.)

### 6c. Email hygiene

- Every user MUST have a deliverable email (the DB column is `NOT NULL`
  with a UNIQUE constraint after the
  `20260921110000_users_email_mandatory` migration).  The backfill for
  legacy accounts writes `<username>@legacy.nib-control360.local` —
  deliberately non-deliverable so an admin has to fix it manually,
  instead of silently sending to a guessed address that never arrives.
- Before saving a user edit → send a Settings → Test Email to the new
  address.  Confirm delivery before saving.  The forgot-password flow
  **will not** tell a legitimate user "we couldn't reach this email"
  (see enumeration blindness above).  An admin who saves bad emails is
  creating their own future recovery problem.

### 6d. Production env hard constraints

These are non-negotiable (already in `project_memory.md`, repeated here
because an auth bypass is worse than any UI bug):

1.  `SESSION_COOKIE_SECURE=true` in `.env.local` for anything with a
    real hostname and TLS.  Without this, `sameSite=lax` won't save
    you — a cookie sent over HTTP can be captured passive.
2.  Nginx MUST pass `proxy_set_header Host $host;` and
    `X-Forwarded-Host $host;` plus `X-Forwarded-Proto=https`.
    Otherwise `src/proxy.ts`'s CSRF origin-vs-host comparison returns
    403 for every legitimate cross-form submit, AND the
    forgot-password `buildPublicOrigin()` builds `http://localhost:9005`
    reset links instead of the public HTTPS URL.
3.  `IRON_SESSION_PASSWORD` — ≥ 32 cryptographically-random chars,
    never committed, never shared outside the deployment host, rotated
    on suspicion of compromise (rotation invalidates every existing
    session cookie).

---

## 7. Failure modes / bypass matrix

| Attack / failure mode | Defense | Where implemented |
|-----------------------|---------|-------------------|
| Online brute force (password spray on one user) | 5-fail lockout 15 min (per-username) | login L3 |
| Distributed spray across 10 IPs, one user each | IP lockout 10-fail / 30 min | login L4 + exponential backoff |
| Enumerate valid usernames via different 401 text | Identical error wording + DUMMY bcrypt compare on no-match | login §3b |
| Timing side-channel (nonexistent username returns faster) | Same DUMMY bcrypt compare — same CPU budget | auth.ts DUMMY_HASH |
| Steal session cookie on one machine, victim changes password on another | sessionVersion bump on every reset → cookie rejected on next request | session.ts getCurrentUser, guard.ts requireUser |
| Stale cookie after account deactivated | Same `status !== ACTIVE` check in getCurrentUser | session.ts |
| CSRF (form POST from attacker site) | `sameSite=lax` cookie + `src/proxy.ts` Origin/Host comparison | sessionOptions + proxy.ts (trusts X-Forwarded-Host — see §6d) |
| XSS that steals cookies | `httpOnly: true` — cookie not readable from JS | sessionOptions |
| Forgot-password link guessed | 32-byte (256-bit) random token + 30 min TTL + single-use | forgot-password/route.ts crypto.randomBytes(32) |
| Admin reset password and never tells user, keeps logging in as them | 24h TTL on temp password + forced redirect to /change-password until user picks own | login gate + change-password clear-flags |
| Admin types wrong email for a user + user needs password reset later | Forgot returns silent success + admin-warning log → admin must fix in Users panel. Recovery: **ACCOUNT_RECOVERY.md** | forgot-password "can't deliver → still ok: true" |
| Password appears in HIBP breach | validatePasswordFull() k-anonymity check, fails closed | passwordValidation.ts |
| Password is "Admin@123" (blocklist) | COMMON_PASSWORDS local blocklist | validatePasswordStrength |

### What the codebase explicitly relies on the DEPLOYMENT to provide

These are outside the app's control and documented here because "we
trust TLS, we trust the reverse proxy, we trust the DB host's disk
encryption" are policy decisions, not code:

- **Transport confidentiality** (TLS 1.2+ between user and Nginx — app
  itself only speaks HTTP to a loopback upstream; no plaintext
  deployment over a real network).
- **Cookie integrity in transit** (again TLS; Nginx HSTS header).
- **PasswordHash confidentiality at rest** (the hashes are bcrypt'd, but
  they should still live on an encrypted volume and never be pasted
  into Slack / tickets / git).
- **DBA trust model.**  A DBA with a psql console can always update
  `users.password_hash` and log in as anyone. That's inherent to
  database-backed authentication.  Recovery plan §paths 1-2 explicitly
  require this level of access; if you want to *prevent* a DBA from
  logging in as any user, you need a hardware-backed credential store
  (HSM / Vault transit) — out of scope for this codebase.

---

## 8. Compliance / audit checklist

After any change to the login / session / password surfaces, confirm
*all* of these are still true before merging:

- [ ] `validatePasswordFull()` is called by every password-setting
      code path.  `grep -rn "passwordHash ="` and walk each call site.
- [ ] Nonexistent username login still takes a bcrypt-compare-sized
      amount of time (DUMMY_HASH block still runs after miss).
- [ ] `session_version += 1` still runs after every password change:
      self-service change, admin reset, forgot-token consume.  `grep -rn
      "sessionVersion"` — confirm every password mutation also
      increments it. (Deactivation deliberately does *not* bump
      `sessionVersion` — it's enforced instead by the independent
      `status === "ACTIVE"` check in `getCurrentUser()`; see §4c.)
- [ ] Login rate-limit layers (L1–L4) are all checked AND counters are
      only incremented on failed attempts.
- [ ] Forgot-password still returns the same 200 shape for match vs
      miss vs undeliverable email.
- [ ] In production `SESSION_COOKIE_SECURE=true` still ends up in the
      sessionOptions `secure` boolean.
- [ ] `IRON_SESSION_PASSWORD` minimum 32-char check still throws at
      boot if missing.
