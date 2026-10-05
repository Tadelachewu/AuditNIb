# Authentication & Authorization — Security Review

A review of how NIB Control360 signs users in (**authentication**) and decides what they may do (**authorization**): what is designed well, and the drawbacks worth fixing, ranked by risk. Reviewed against the code as of 2026-10-05; nothing was changed.

**Verdict:** the design is sound and follows good practice in most places: server-side checks on every API, organisational scope enforced centrally, strong password rules, layered brute-force protection, single-session sign-in, audit logging. The main weakness is that **a signed-in user's permissions and scope are frozen in their cookie** until they sign in again. A few deployment settings also need attention before production.

> **Status (2026-10-05): fixes applied** for H1, H2, H3, M1, M2, M4, L1 and L2 — see §5. M3 (two-factor sign-in) is still open.

---

## 1. How it works (short)

| Layer | Where | What it does |
|---|---|---|
| Sign-in | `POST /api/auth/login` | Checks the username + password (bcrypt), the account and role are active, the temporary password hasn't expired; issues an encrypted session cookie holding the user's id, role, **permissions**, org scope, branch/district, `sessionVersion` and timestamps |
| Session cookie | `src/lib/session.ts` (iron-session) | Encrypted + signed, `HttpOnly`, `SameSite=Lax`, `Secure` in production, max age = absolute timeout |
| Every page | `src/proxy.ts` | Idle / absolute timeout, sign-in redirect, forced password change, page-level `<page>.view` permission |
| Every API | `requireUser()` / `requirePermission()` (`src/lib/guard.ts`) | Re-validates the session (timeouts, user still ACTIVE, `sessionVersion` unchanged) and checks the permission key |
| Org scope | `src/lib/findings-scope.ts` | One central rule: BANK sees all, DISTRICT its district, BRANCH its branch. Every findings route and list uses it |
| Workflow rules | `src/lib/findings.ts` and each route | Status-based conditions and separation of duties (e.g. a verifier can't also return the same rectification) |
| Permission catalogue | `src/lib/permissions/registry.ts` | Page × action keys (`findings.close`, `users.toggle-status`, …); unknown keys are rejected when saving a role |

---

## 2. What is done well

**Authentication**
- **Passwords:** bcrypt hashes; at least 8 characters with lower, upper, number and symbol; common passwords refused; checked against the Have I Been Pwned breach list (k-anonymity: only a hash prefix leaves the server).
- **Brute force:** four stacked layers: rate limits per IP and per IP+account; lockouts per account (5 failures / 15 min) and per IP (10 / 30 min); and a growing delay after each failure.
- **No user enumeration:** an unknown username still runs a bcrypt compare against a dummy hash (same timing), and returns the same "Invalid username or password". Forgot Password always gives the same answer.
- **Single session per user:** a new sign-in invalidates older sessions via `sessionVersion`.
- **Session revocation:** changing or resetting a password, deactivating a user and deactivating a role all sign the user out immediately.
- **Timeouts:** idle (sliding) and absolute, enforced in the proxy and again on every API call. Background polling doesn't count as activity, so an open tab can't stay signed in forever.
- **Temporary passwords:** admin-set passwords expire after 24 h and force a change at first sign-in.
- **Reset links:** random 32-byte token, 30-minute life, single use, only the newest one valid, rate limited.
- **Cookie:** encrypted and signed, `HttpOnly` (no JavaScript access), `SameSite=Lax`, `Secure` in production.
- **Cross-site request forgery:** state-changing API calls from another origin are rejected (Origin / Referer check), on top of `SameSite=Lax`.
- **Security headers:** CSP, `X-Frame-Options: DENY`, HSTS (in `next.config.ts`).
- **Audit:** sign-ins, password resets and every permission-relevant action are written to the tamper-evident audit log.

**Authorization**
- **Server-side, not UI-side:** the UI hides what you can't do, but every API route checks again; the client is never trusted.
- **Fine-grained, data-driven roles:** permissions are page × action keys stored on roles, editable by admins; *View*, *Edit*, *Activate/Deactivate* and *Delete* are separate.
- **Central org-scope rule:** one function decides which findings a user may touch; it denies when the scope is unknown.
- **Lockout protection:** a change that would leave nobody able to manage users or roles is refused, and the Administrator role always keeps *Roles & Permissions › Manage*.
- **Self-protection:** you can't deactivate or delete your own account.
- **Separation of duties** in the rectification workflow.

---

## 3. Drawbacks and risks

Ranked: **High** = fix before production; **Medium** = fix soon; **Low** = hardening.

### H1. Permissions, role and scope are frozen in the cookie until the next sign-in — **High**
The cookie carries the user's permissions, role, org scope and branch/district, copied at sign-in. Afterwards:

| Admin action | Takes effect for a signed-in user |
|---|---|
| Removes a permission from a role | **Not until they sign in again** (up to the absolute timeout, 8 h) |
| Changes a user's role | **Not until they sign in again**: they keep the old role's permissions |
| Moves a user to another branch / district | **Not until they sign in again**: they keep seeing and acting on the old branch's findings |
| Deactivates the user / the role, resets the password | Immediately (these bump `sessionVersion`) ✅ |

Revoking access is exactly when "immediately" matters (e.g. a controller moved off a branch under investigation).
**Fix:** bump the user's `sessionVersion` whenever their role, branch or district changes, and for every holder of a role whose permissions change (the same mechanism role deactivation already uses). Or look permissions up from the database on each request instead of trusting the cookie copy.

### H2. One shared "IP" for everyone unless `TRUST_PROXY` is set — **High (deployment)**
Without `TRUST_PROXY=true`, every request counts as coming from the same IP ("direct"). The per-IP lockout (10 failures in 30 min) then applies to **all users together**: one person (or attacker) mistyping 10 times locks **everyone** out of sign-in for 30 minutes. `TRUST_PROXY` isn't set in `.env`.
**Fix:** behind Nginx / a load balancer, set `TRUST_PROXY=true` and make the proxy overwrite `X-Forwarded-For`.
**Related (Medium):** with `TRUST_PROXY=true` the code takes the **left-most** `X-Forwarded-For` entry, which the client controls, so an attacker can send a different fake IP each time and dodge the per-IP limits. It should take the address added by your own proxy (the right-most trusted hop).

### H3. Default demo accounts and passwords — **High (deployment)**
The seed data creates one user per role with known passwords (`admin` / `Admin@123`, …), and they're printed in the docs. On any shared or internet-facing server they must be removed or have their passwords changed before go-live.

### M1. Rate limits and lockouts switch off when Redis is down — **Medium**
Every rate-limit and lockout call "fails open": if Redis is unreachable, sign-in has **no brute-force protection at all**. (The breach-list check fails open too, which is reasonable.) A deliberate choice for availability, but there's no alert.
**Fix:** fail closed for login (or fall back to an in-memory limiter), and alert when Redis is down.

### M2. Reset tokens are stored in plain text — **Medium**
Password-reset tokens are saved as-is in `PasswordResetToken.token`. Anyone who can read that table (a database backup, a support query) can reset any user whose link is still live (30 min).
**Fix:** store only a SHA-256 hash of the token and compare hashes.

### M3. No second factor (MFA) — **Medium**
Sign-in is password only. For HO, Administrator and other bank-wide roles, a second factor (authenticator app / email code) is common practice for a banking control system.

### M4. Import files and history aren't scoped — **Medium/Low**
Any holder of *Bulk Import* can download **any** import's stored Excel file and see the whole Import History, whoever imported it and whatever branches it covers. Today imports are a bank-level task (HO), so the impact is small; if the permission is ever given to district roles, they'd see other districts' data.
**Fix:** limit the download and the list to imports whose findings are within the user's scope.

### L1. bcrypt cost 10, run synchronously — **Low**
Cost 10 is the minimum still considered acceptable (12 is the usual recommendation), and `hashSync` / `compareSync` block the server while they run; many simultaneous sign-ins slow every other request.
**Fix:** cost 12 with the async `hash` / `compare`.

### L2. Some smaller points — **Low**
- A new password may be the **same as the old one** (reset and change).
- A request with **neither Origin nor Referer** passes the cross-origin check; `SameSite=Lax` still blocks the classic cross-site form post, so the risk is small.
- Sign-in reveals "This account has been deactivated" / "Your role has been deactivated" — but only **after** the correct password, so it doesn't help guessing.
- Development `.env` has a 2-minute idle timeout and `NODE_ENV=development` (cookie not `Secure`). Make sure production uses its own values; set `SESSION_COOKIE_SECURE=true` explicitly when serving over HTTPS.
- Permissions are "any of" lists per route; there's no automated test that every API route calls `requirePermission` and the scope check. A small test that scans the routes would stop a future route from forgetting it.

---

## 4. Recommended order

| # | Item | Effort |
|---|---|---|
| 1 | H1: revoke sessions on role / permission / branch change | Small (reuse `sessionVersion`) |
| 2 | H2: set `TRUST_PROXY` correctly and use the trusted hop of `X-Forwarded-For` | Config + small change |
| 3 | H3: remove or change the seeded demo accounts | Ops |
| 4 | M2: hash reset tokens | Small |
| 5 | M1: fail closed / alert when Redis is down for login | Small |
| 6 | M4: scope import files and history | Small |
| 7 | L1, L2 hardening | Small each |
| 8 | M3: MFA for bank-wide roles | Larger |

See also: [login-and-password.md](login-and-password.md), [forgot-password.md](forgot-password.md), [LOGIN_SECURITY_RULES.md](LOGIN_SECURITY_RULES.md), [permissions-clarified.md](permissions-clarified.md).

---

## 5. Fixes applied (2026-10-05)

| Item | What changed | Where |
|---|---|---|
| **H1** permissions frozen in the cookie | Every request now reads the user's **current** role, its permissions, org scope and branch / district from the database and refreshes the cookie. A role, permission or branch change applies on the user's **next click**; nobody is signed out for it. A user whose role was deactivated is signed out | `getCurrentUser()` in `src/lib/session.ts` |
| **H2** shared IP / spoofable IP | Without `TRUST_PROXY`, per-IP limits and lockouts are **skipped** (per-account ones still apply), so one person can't lock everyone out. With `TRUST_PROXY=true`, the client IP is the **right-most** `X-Forwarded-For` entry (the one your proxy added), configurable with `TRUST_PROXY_HOPS`; a faked left-most entry is ignored | `clientIp()` / `ipIsKnown()` in `src/lib/rateLimit.ts`; login and forgot-password routes; `.env.example` |
| **H3** demo passwords | The seeded demo passwords can never be chosen as a new password, and **in production** a sign-in that uses one is forced to change it before doing anything else. (Removing the demo users from a live database is still an ops task) | `DEMO_PASSWORDS` in `src/lib/passwordValidation.ts`; login route |
| **M1** limits off when Redis is down | Rate limits and lockouts fall back to an **in-memory** store instead of switching off | `src/lib/rateLimit.ts` |
| **M2** plain reset tokens | Only a **SHA-256 hash** of each reset token is stored; the emailed link still carries the raw token. Links issued before this change no longer work (they expired within 30 min anyway) | `src/lib/resetToken.ts`; forgot / reset routes |
| **M4** import files not scoped | Import History and the stored-file download only show imports whose findings are all within the user's scope (bank-wide users see all); anything else reads as "not found" | `isImportBatchInScope()` in `src/lib/findings-scope.ts`; import routes |
| **L1** bcrypt | Cost **12**, run **asynchronously** (no blocking). Existing cost-10 hashes still work and are upgraded at the user's next sign-in. The dummy hash for unknown usernames is a real cost-12 hash, so timing stays equal | `src/lib/auth.ts`; login route |
| **L2** same password | Reset and change-password refuse a new password equal to the current one | reset-password, change-password routes |
| **L2** no Origin / Referer | A state-changing API call with **neither** header is now refused (browsers always send Origin; scripts must too) | `isCrossOriginApiRequest()` in `src/proxy.ts` |
| **L2** routes without a check | A test fails if any API route other than the public sign-in ones lacks a sign-in / permission check | `tests/authHardening.test.ts` |
| Bug found while fixing | `change-password` would have accepted a **wrong current password** once checks became async (`!promise` is never true); it now awaits the check | `src/app/api/auth/change-password/route.ts` |

**Still to do:** M3 (two-factor sign-in for bank-wide roles), and on the live server: remove / re-password the demo accounts, set `TRUST_PROXY` and `SESSION_COOKIE_SECURE=true`, and use production session timeouts.

Tests: `tests/authHardening.test.ts`, `tests/sessionTimeout.test.ts` (TC15–17).
