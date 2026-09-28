# NIB Control360 — Security Audit Findings (Round 1)

Audit date: 2026-09-07. Read-only, code-level audit (no packages installed, no files modified, no secret values printed). Covers architecture, authentication, session security, authorization/RBAC/IDOR, input validation, business-logic/workflow abuse, XSS/uploads/SSRF/redirects, and error handling/CORS/CSRF/headers/logging.

Status: **Not yet remediated.** This file exists to track what still needs to be fixed. Update each finding's status inline as it's addressed.

---

## Executive Summary

| Severity | Count |
|---|---|
| CRITICAL | 1 |
| HIGH | 6 |
| MEDIUM | 7 |
| LOW | 7 |
| INFO | 4 |

**Overall risk: CRITICAL.** Core Finding-lifecycle IDOR/BOLA is correctly enforced everywhere, there's no SQL injection surface, no XSS sinks, mass assignment is blocked, path traversal is not exploitable, and password hashes never leak. But several severe gaps make the app unsafe to deploy as-is (see Critical/High below).

## Security Score: 21 / 100

Formula: `100 − Σ(severity deduction, capped per category)` — Critical −15 each (cap 3), High −6 each (cap 6), Medium −3 each (cap 8), Low −1 each (cap 10), Info 0.
Applied: 1 Critical (−15) + 6 High (−36) + 7 Medium (−21) + 7 Low (−7) = −79 → **100 − 79 = 21**.

---

## CRITICAL

### C-1: Hardcoded default credentials seeded in source and displayed unconditionally on the public login page
- **Status:** Open
- **File:** `src/app/login/page.tsx:10-18` (display), `src/lib/db.ts:498-597` (seed)
- **Problem:** `DEMO_USERS` array with plaintext username/password pairs for all 7 roles is rendered in an expandable "Demo accounts" panel on `/login`, no auth required, no environment gate. Same passwords hash-seed the real `data/db.json`.
- **Attack scenario:** Anyone opens `/login`, expands the panel, logs in as `admin`/`Admin@123` — instant full Administrator access.
- **Fix:** Remove/gate the demo panel behind a non-production flag; rotate seeded passwords to be randomly generated per install; force `mustChangePassword` before any real deployment.

---

## HIGH

### H-1: No rate limiting, lockout, or failed-login logging on `POST /api/auth/login`
- **Status:** Open
- **File:** `src/app/api/auth/login/route.ts`
- **Problem:** Zero attempt-throttling anywhere in the codebase; failed logins are never audit-logged (only successes are).
- **Fix:** Add per-IP/per-username rate limiting with lockout/backoff; log `LOGIN_FAILED` via `appendAuditLog`.

### H-2: Report Templates module bypasses organizational scope — cross-district data disclosure
- **Status:** Open
- **File:** `src/app/api/report-templates/[slug]/export/route.ts`, `src/lib/reportTemplates.ts` (all 10 report functions), role seed `src/lib/db.ts:302-329`
- **Problem:** None of the report functions filter by session org-scope; only a bare permission check gates them. `districtControllerPermissions`/`districtDirectorPermissions` (orgScope DISTRICT) hold the full `reportTemplatePermissions` set by default, so a District Controller gets bank-wide, all-district data via both the UI pages and the CSV export — unlike every other surface in the app (findings list/detail/export), which correctly scopes via `findingsInScope`/`assertFindingInScope`.
- **Fix:** Thread `session.orgScope`/`districtId`/`branchId` into every `reportTemplates.ts` function (and the export route), narrowing the same way `findingsInScope()` already does.

### H-3: `close` and `verify-rectification` routes never check the reporting-period lock
- **Status:** Open
- **File:** `src/app/api/findings/[id]/close/route.ts`, `src/app/api/findings/[id]/verify-rectification/route.ts`
- **Problem:** Every other mutating findings route calls `assertPeriodWritable()`; these two don't, with no comment explaining the omission (unlike `transfer`, whose skip is deliberate and documented). `src/lib/findings.ts:343-346`'s own doc comment lists "rectify, close" as routes this should gate.
- **Fix:** Add `assertPeriodWritable(db, existing.periodId)` to both routes, matching `rectify/route.ts:78`.

### H-4: No security headers configured anywhere
- **Status:** Open
- **File:** `next.config.ts` (no `headers()`), `src/proxy.ts` (sets no response headers)
- **Problem:** No CSP, HSTS, X-Frame-Options/frame-ancestors, X-Content-Type-Options, Referrer-Policy, or Permissions-Policy. Clickjacking exposure on an admin UI with one-click Approve/Reject/Close buttons; zero XSS defense-in-depth.
- **Fix:** Add a `headers()` function in `next.config.ts` setting at minimum `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, HSTS once served over HTTPS, and an appropriate CSP.

### H-5: No session invalidation on deactivation, role change, or password reset
- **Status:** Open
- **File:** `src/lib/guard.ts:15-21`, `src/lib/session.ts:16-29`
- **Problem:** `iron-session` cookie carries a 14-day default TTL with `permissions`/`role`/`status` snapshotted at login only; `requireUser()` never re-checks the DB per request. A deactivated/reset/role-changed user's existing session keeps working for up to 14 days.
- **Fix:** Re-validate user status (and ideally permissions) against the DB on each `requireUser()` call, or add a session-epoch counter bumped on deactivation/role change/password reset.

### H-6: Self-approval is possible at every review stage
- **Status:** Open (may be intentional — confirm with business owner)
- **File:** `src/app/api/findings/[id]/district-review/route.ts:53-58`, `.../ho-review/route.ts:50-55`, `.../bank-approval/route.ts:62-67`
- **Problem:** Only self-RETURN is blocked at each review stage; self-APPROVE is explicitly allowed per code comments. A user holding both `findings.create` and the review permission (e.g. default HO Controller) can register and single-handedly approve their own finding through every gate.
- **Fix:** Decide as a business rule — either block self-APPROVE the same way self-RETURN is blocked, or explicitly accept with compensating controls (e.g. mandatory dual sign-off reporting).

---

## MEDIUM

### M-1: CSRF protection has no defense-in-depth
- **Status:** Open
- **File:** `src/lib/session.ts:39-47` (`sameSite: "lax"` only, no Origin/Referer check, no CSRF token anywhere)
- **Fix:** Add explicit Origin/Referer validation on state-changing routes.

### M-2: Systemic unbounded input — no `.max()` on ~127 string fields, no upper bound on `amount`/`caseCount`
- **Status:** Open
- **File:** `src/app/api/findings/route.ts:44-62`, `src/app/api/findings/[id]/route.ts:42-62`, ~50 other route files, `src/lib/import.ts:304,308`
- **Fix:** Add `.max()` bounds to free-text fields and sane upper bounds to `amount`/`caseCount` (the codebase already does this correctly for `caseAmounts` and admin settings thresholds).

### M-3: No rate limiting on export/report endpoints + synchronous full-file DB reads
- **Status:** Open
- **File:** `src/lib/db.ts:899-922` (synchronous `fs.readFileSync`/`writeFileSync`, no caching), `src/app/api/report-templates/[slug]/export/route.ts`
- **Fix:** Rate-limit export endpoints; consider caching read-heavy aggregations.

### M-4: Bulk import never checks the importing user's own org scope against each row
- **Status:** Open (latent — not exploitable under default seed roles)
- **File:** `src/lib/import.ts:241-370` vs. the correct check in `src/app/api/findings/route.ts:93-113`
- **Fix:** Add the same org-scope validation used in the single-create path to the import row validator.

### M-5: No file locking on the JSON database
- **Status:** Open (latent — safe only under current single-process assumption)
- **File:** `src/lib/db.ts:899-922`
- **Fix:** Document as single-instance-only, or add real file locking / migrate to a proper datastore before horizontal scaling.

### M-6: `report/` directory with real-looking dated `.xlsx` exports is committed to git
- **Status:** Open — content NOT VERIFIED
- **File:** `report/14. July 2026 Consolidated as at August 17 2026.xlsx`, `report/Summarized unrectified Irreg report-August 24,2026.xlsx`, plus a `.backup/` copy
- **Fix:** Confirm whether these contain real bank data; if so, purge from git history and gitignore `report/`.

### M-7: Weak password policy
- **Status:** Open
- **File:** `src/app/api/auth/change-password/route.ts:11`, `src/app/api/admin/users/route.ts:47`, `src/app/api/admin/users/[id]/route.ts:18`
- **Fix:** Add complexity rules (mixed case, digit, symbol); consider a breach-database check.

---

## LOW

- **L-1:** `X-Powered-By` header not disabled (`poweredByHeader` unset in `next.config.ts`). Fix: set `poweredByHeader: false`.
- **L-2:** `audit-log.view` has no code-level org-scope filter (`src/app/api/admin/audit-log/route.ts:11-18`) — latent risk if ever assigned to a district/branch-scoped role.
- **L-3:** Admin-only `test-email` route leaks raw SMTP error text (`src/app/api/admin/settings/test-email/route.ts:30-41`). Fix: generic message, log detail server-side only.
- **L-4:** No root-level `error.tsx`/`global-error.tsx` — only `src/app/(app)/error.tsx` exists.
- **L-5:** `findingDate` lacks format/range validation on the interactive create/edit path (import path validates it, `src/lib/import.ts:299-301`).
- **L-6:** Minor login enumeration timing signal — unknown-username path skips the bcrypt compare; deactivated-account messages differ from invalid-credentials.
- **L-7:** `exceljs@4.4.0` not verified against current CVE database (NOT VERIFIED — `npm audit` not run).

---

## INFORMATIONAL

- No MFA anywhere — worth a roadmap item.
- No "remember me" feature — confirmed absent, not a gap.
- `roles.manage` is a self-service master permission — standard for a self-service RBAC console, but should be the most tightly-held permission in the system.
- Findings API returns the full, unfiltered `Finding` object — no field-level ACL model exists in the data model; by design, not a bug.

---

## Verified Secure (no action needed)

- Core Finding lifecycle authorization (view/edit/delete/submit/district-review/ho-review/bank-approval/rectify/verify-rectification/return-rectification/resubmit-rectification/transfer/close/comments/evidence) — correct `requirePermission` + `assertFindingInScope` + ownership checks everywhere, no IDOR found.
- `findings-scope.ts`'s `isFindingInScope()` — deny-by-default, correct BANK/DISTRICT/BRANCH logic.
- `guard.ts`'s `requireUser`/`requirePermission` — fails closed, applied consistently.
- Mass assignment blocked by strict Zod whitelisting + explicit server-side reconstruction.
- No XSS sinks anywhere; no SQL injection surface; no path traversal; no SSRF via request-controlled URLs; no open redirects.
- Password hashes never leak (`toSafeUser()` strips them everywhere, including audit logs).
- Logout genuinely destroys the session server-side.
- No public self-registration.
- Self-service routes (`/api/auth/email`, `/api/auth/change-password`) scoped strictly to the caller's own `userId`.
- Rectify/close numeric bounds checking is sound.
- Secrets hygiene: env-only, fail-closed, never hardcoded, never persisted to the JSON DB; `.env*` and `data/` correctly gitignored.
- No `NEXT_PUBLIC_*` variables exist.

---

## Not Verified

- Exact CVE status of `exceljs@4.4.0` and other dependencies (no `npm audit` run).
- Content of the committed `report/` `.xlsx` files.
- Exact permission required to edit `Settings.notification.smtpHost`.
- Whether every `page.tsx`/`layout.tsx` correctly triggers dynamic rendering for per-user data (spot-checked only).
- Actual production deployment target/infrastructure (no Dockerfile/CI/CD in-repo; only documented path is the dev server via `EXPOSE_TO_INTERNET.md`).
- Whether Node is ever run multi-process/clustered (relevant to M-5).

---

## Top 10 Fix Priority Order

1. C-1 — Remove/gate hardcoded demo credentials on login page.
2. H-1 — Add login rate limiting/lockout/failed-attempt logging.
3. H-2 — Scope Report Templates to org/district/branch.
4. H-3 — Add `assertPeriodWritable` to close/verify-rectification.
5. H-4 — Add security headers via `next.config.ts`.
6. H-5 — Re-validate session/user status per request or add a session-epoch mechanism.
7. H-6 — Decide and enforce self-approval policy.
8. M-1 — Add CSRF Origin/Referer validation.
9. M-2/M-3 — Add input bounds; rate-limit exports.
10. M-6/L-7 — Verify/purge committed report files; run `npm audit`.

## Production Readiness: WITH CONDITIONS

Not safe to deploy as-is. Fix C-1 and all six High findings first, re-verify with a focused follow-up review, then move to a hardened deployment (`next build && next start` behind TLS) rather than the documented dev-server-plus-tunnel path.
