# Security Findings Register

Extracted verbatim from the organization's shared security findings
spreadsheet (Internal Security Testing Team, with INSA verification on some
Nib Sacco items), as of the extraction date below. This is **not** an audit
of NIB Control360 / ICFMS (this repository) — every row in the source sheet
belongs to one of six *other* in-house systems (Memo Automation System, Nib
Sacco, Hospital Appointment System, Nib Learning, Micro Loan, NibTera
Askuala). It's kept here as a reference checklist of vulnerability classes
this organization has actually found and fixed elsewhere, so the same
classes get checked for — and not reintroduced — in this app.

- **Source:** internal Google Sheet ("Security Issues" register), tab
  `gid=28859979`
- **Extracted:** 2026-09-10
- **Rows extracted:** SEC-001 through SEC-091 (93 issues; rows below SEC-091
  were blank in the source)
- **Status at extraction time:** every issue below is marked `Applicable:
  Yes`, `Fixed: Yes`, `Status: Resolved` in the source sheet, for its
  respective system — none of this is a list of open/unfixed issues.

## Data quality note on SEC-001–050

In the source spreadsheet, the **Security Issue** description text for every
row from SEC-001 through SEC-050 (spanning both the *Memo Automation System*
and *Nib Sacco* sections) is identical — "Horizontal Privilege Escalation
via Insecure Direct Object Reference (IDOR) allowing unauthorized access to
memos by manipulating memo ID parameter" — regardless of that row's
`Category` (which correctly varies: Cryptography, Security Headers,
Authentication, Vulnerable Components, etc.) or its `Recommended Solution`
(which also correctly varies and clearly describes a different, unrelated
issue per row). This is almost certainly a copy/paste artifact in the source
sheet (the description column got stuck on the first row's text), not 50
genuinely identical findings. It is reproduced as-is below for fidelity to
the source; **treat the `Category` and `Recommended Solution` columns as the
reliable signal** for what each of those specific rows actually was, and
verify against the original tracker before citing SEC-001–050's "Security
Issue" text as authoritative. From SEC-051 onward, the description column is
correctly distinct per row.

## Relevance to this app (NIB Control360 / ICFMS)

None of these are findings *against* this app — but three recurring classes
above were checked against this codebase specifically. Two were real gaps
and have since been fixed here; the third turned out to already be covered.

- **Fixed — No HTTP security headers were configured.**
  [next.config.ts](../next.config.ts) had no `headers()` block at all — no
  CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`,
  `Referrer-Policy`, or `Permissions-Policy`. Matches the class in
  SEC-012/013/014/017/018/076/078/085. Now applies all of the above to every
  route via `headers()`. The CSP's `script-src`/`style-src` still allow
  `'unsafe-inline'` (documented in `next.config.ts`'s own comment) — this app
  has no per-request nonce plumbing yet, and Next's own hydration script plus
  this app's hand-written theme-init inline `<script>`
  ([layout.tsx](../src/app/layout.tsx)) both rely on it. Same tradeoff
  SEC-078 flagged elsewhere; moving to nonces is real follow-up work, not
  done here.
- **Fixed — No rate limiting or lockout on `/api/auth/login`.**
  Unlimited attempts were possible against any username. Matches SEC-045/091.
  [src/lib/rateLimit.ts](../src/lib/rateLimit.ts) adds an in-memory,
  per-process limiter (5 failed attempts / 15 min per IP+username, 30 / 15
  min per IP), wired into [the login route](../src/app/api/auth/login/route.ts).
  Only failed attempts count — a correct password on the first try never
  touches the counter. This is a single-process limiter (see that file's own
  doc comment); a real multi-instance deployment should move this to a
  shared store or an edge/WAF rate limiter (SEC-027's own recommendation),
  not rely on this in-memory version.
- **Already covered — seeded demo accounts use fixed, publicly-documented
  passwords.** ([prisma/seedData.ts](../prisma/seedData.ts), also listed in
  the main [README.md](../README.md) and on the login page itself) — the
  same class as SEC-009/036/048/090 if any of these accounts or passwords
  ever reached a real deployment unchanged. Checked: `User.mustChangePassword`
  *is* actually enforced — [src/proxy.ts](../src/proxy.ts) redirects any
  session with it set to `/profile` and blocks every other page until it's
  cleared, and every admin-created user gets it set to `true` automatically
  ([users/route.ts](../src/app/api/admin/users/route.ts)). The seeded demo
  accounts themselves don't have it set, since they're meant to be
  demoable out of the box — real accounts should still be created (or these
  reset) with a forced change before any non-demo use, as README.md already
  says.

---

## Cross-check: NibBot Chatbot VA Report

A second source, [ChatBot_VA_Report_Analysis.md](ChatBot_VA_Report_Analysis.md)
in this same folder, is a vulnerability assessment of a *different*
application (NibBot, a chatbot). Same rule as above: not an audit of this
app, but every finding in it was checked against this codebase specifically,
since a chatbot report from the same organization is at least as likely to
name a class this app shares. Extracted 2026-09-10.

| ID | Finding | Applies here? | Result |
|----|---------|----------------|--------|
| VA-001 | Vulnerable esbuild (0.17.0–0.28.0) | No | Only present as `tsx`'s dev dependency, already at 0.28.2 (above the vulnerable range) |
| VA-002 | SSRF via a proxy endpoint accepting arbitrary URLs | No | No `/api/proxy` or any server-side fetch of a user-supplied URL exists — [src/lib/api-client.ts](../src/lib/api-client.ts)'s `fetch()` calls are client-side, same-origin only |
| VA-003 | Vulnerable form-data (4.0.0–4.0.5) | No | Package not present in this app at all |
| VA-004 | Vulnerable hono (≤4.12.24) | No | Only present transitively via Prisma's own dev tooling (`@prisma/dev`, used by `prisma studio`/CLI), already at 4.13.7 (above the vulnerable range), and never in this app's own request path |
| VA-005 | Vulnerable ws (8.0.0–8.20.1) | No | Package not present — this app has no WebSocket usage |
| VA-006 | Weak password policy (no complexity requirement, no breach/common-password check) | **Yes** | **Fixed** — see below |
| VA-008 | Process-wide TLS verification disabled via `NODE_TLS_REJECT_UNAUTHORIZED` | No | No such code exists anywhere in this app |
| VA-009 | Vulnerable DOMPurify (<3.4.9) | No | Package not present |
| VA-010 | Vulnerable js-yaml (≤4.1.1) | No | Only present transitively via ESLint (dev-time linting only, never runs in the served app), already at 4.3.1 |
| VA-011 | Vulnerable protobufjs (≤7.6.2) | No | Package not present |
| VA-012 | `X-Powered-By` header discloses the framework | **Yes** | **Fixed** — see below |
| VA-013 | Insufficient file upload validation (client-side only, no magic-byte check) | No | Already covered — [src/lib/evidence.ts](../src/lib/evidence.ts) enforces a server-side MIME allowlist, a size cap, and a magic-byte signature check per type before anything is written to disk, and generates the stored filename itself (never the client's) |
| VA-014 | Sensitive/internal data stored in browser Local Storage | No | This app's only `localStorage` usage is the theme preference (light/dark/system) — no session, workflow, or internal data |

**VA-006 fix:** new [src/lib/passwordValidation.ts](../src/lib/passwordValidation.ts)
requires 8+ characters, upper + lower case, a digit, a special character, and
rejects an exact match against a local list of ~100 commonly-guessed
passwords (no network-dependent breach API - see that file's own doc comment
for why). Wired into all three endpoints that ever set a password:
[change-password](../src/app/api/auth/change-password/route.ts) (self-service),
[admin create user](../src/app/api/admin/users/route.ts), and
[admin reset/edit user](../src/app/api/admin/users/%5Bid%5D/route.ts). This
app's own seeded demo passwords (e.g. `Admin@123`) already satisfy the new
rule, so seeding is unaffected.

**VA-012 fix:** `poweredByHeader: false` added to [next.config.ts](../next.config.ts) —
verified live, the header is gone.

---

## Cross-check: NibBot additional findings (VA-013–VA-017)

A follow-up document, [additional chat bot.docx](additional%20chat%20bot.docx)
in this same folder, adds five more NibBot findings (two are the same
VA-013/VA-014 already covered above) plus that source's own later remediation
report. Same rule: not an audit of this app. Extracted 2026-09-10.

| ID | Finding | Applies here? | Result |
|----|---------|----------------|--------|
| VA-013 | Insufficient file upload validation | No | Same as above — already covered |
| VA-014 | Internal data in Local Storage | No | Same as above — no sensitive data stored there |
| VA-015 | Vulnerable Nodemailer (≤9.0.0) | No | Already at 9.1.0 (above the vulnerable range, and above the report's own recommended fix version) |
| VA-016 | Vulnerable undici (7.0.0–7.27.2) | No | Package not present anywhere in this app's dependency tree |
| VA-017 | Weak authentication rate limiting (no lockout, CAPTCHA, or progressive delay found during automated testing) | **Yes** | **Fixed** — see below |

**VA-017 fix:** the earlier single flat rate limit (5/15min per account,
30/15min per IP — see the first cross-check section above) has been replaced
with the four-layer scheme NibBot's own remediation report describes for the
same finding, all in [src/lib/rateLimit.ts](../src/lib/rateLimit.ts) and
wired into [the login route](../src/app/api/auth/login/route.ts):

| Layer | Key | Limit | Window / duration |
|-------|-----|-------|---------------------|
| Rate limit | per IP | 5 attempts | 15 min |
| Rate limit | per username+IP | 5 attempts | 15 min |
| Lockout | per username | 5 failures | 15 min hard lock |
| Lockout | per IP | 10 failures | 30 min hard lock |

Plus an exponential backoff delay on every failed attempt (`min(1000 *
2^(failures-1), 8000)` — 1s, 2s, 4s, 8s capped) before the response is sent,
and lockouts are checked *before* rate limits on every request, so an
already-locked-out caller gets an immediate 429 with `Retry-After` instead of
re-consuming rate-limit budget. `clientIp()` only trusts `x-forwarded-for`
when `TRUST_PROXY=true` (unset by default) — that header is entirely
client-controllable on a direct connection, and NibBot's own remediation for
this exact finding was "Added TRUST_PROXY configuration" for the same
reason. Verified live: backoff timing measured at ~1s/2s/4s/8s/8s across 5
failed attempts, the 6th returned 429 with `Retry-After: ~874` (≈15 min), the
correct password was still rejected while locked out, and a different
account from the same test source logged in normally once the per-IP rate
limit's own window was fresh.

---

## Horizontal and vertical privilege escalation review

Requested directly (not sourced from either document above): a systematic
check of every API route in this app for the two escalation classes several
of the findings above name (SEC-049/050, VA-... none directly, but it's the
same underlying concern as SEC-005/015/050/054/056/080/081).

**Method:** every one of the 55 files under `src/app/api/**/route.ts` was
checked for (a) a `requirePermission`/`requireUser`/`requireToggleOrEditPermission`
call before touching the database (vertical escalation — can a caller reach
an action their role doesn't grant), and (b) for any route keyed by a
specific record id, a corresponding ownership/org-scope check before
returning or mutating that record (horizontal escalation — can a caller
reach *someone else's* record by guessing/changing an id).

**Result — vertical:** all 55 route files call a guard before any database
access; none were found missing one. `auth/login`, `auth/logout`, and
`auth/me` are the only handlers with no guard call, which is correct for
all three (login/logout have no session yet to check, and `me` only ever
returns the caller's own already-authenticated session).

**Result — horizontal:** every single-finding route (`findings/[id]/...`)
calls `assertFindingInScope`; every list/bulk route (`findings`,
`findings/export`, `findings/similar`) filters through the bulk
`findingsInScope` equivalent — both trace back to
[src/lib/findings-scope.ts](../src/lib/findings-scope.ts)'s
`isFindingInScope`, which defaults to **deny** for any unrecognized
`orgScope` rather than allowing it. Notification routes filter strictly by
`recipientUserId`. The evidence-download route checks both the finding's
scope and that the requested evidence id actually belongs to that finding
before serving the file.

One real gap was found and fixed, plus two defense-in-depth hardenings for a
scenario that isn't exploitable today but could become one through this
app's own dynamic, admin-editable permission system:

- **Fixed — bulk import had no org-scope check.** `POST /api/findings`
  (single-record create) already forces a DISTRICT/BRANCH-scoped caller to
  their own org unit, rejecting anything else — but the bulk Excel import
  path (`findings.import`, seeded onto the BANK-scoped HO Controller role
  only) validated a row's District/Branch Code purely against reference
  data, with no check against who was importing it. If `findings.import`
  were ever granted to a DISTRICT- or BRANCH-scoped role, that role could
  have imported a finding into *any* district/branch just by putting a
  different code in the spreadsheet. `validateImportRow()` in
  [src/lib/import.ts](../src/lib/import.ts) now takes the importer's own
  `orgScope`/`districtId`/`branchId` and rejects any row outside it, mirroring
  the manual-create route's own rule exactly.
- **Hardened (defense in depth) — admin create/edit user had no org-scope
  check.** `users.create`/`users.edit`/`users.toggle-status` are seeded onto
  ADMIN only (BANK-scoped — icfms.txt reserves user/role management to the
  Administrator alone), so this was never reachable under this app's
  default configuration. But nothing in the route itself enforced that,
  either — if one of those permissions were ever granted to a DISTRICT- or
  BRANCH-scoped role, that role could have created or edited a user in *any*
  org unit, and assigned them *any* role, including a bank-wide one. Both
  [admin create-user](../src/app/api/admin/users/route.ts) and
  [admin edit-user](../src/app/api/admin/users/%5Bid%5D/route.ts) now check
  that a non-BANK-scoped caller stays within their own district/branch and
  can't assign a BANK-scoped role, matching the same rule applied to import
  above.

---

## Password and session hardening

Requested directly, based on a description of a comparable app's own
password/session design (bcrypt storage, a `validatePasswordFull` HIBP gate,
`sessionVersion`-based invalidation on password change, rate-limited
password-change endpoints, forced rotation for temporary credentials, and
email-required-before-completing-a-forced-change) — adopted here, plus
moving rate limiting/lockout off the in-memory store onto Redis so it
survives restarts and works correctly across more than one instance.

- **Redis-backed rate limiting/lockout**, replacing the in-memory `Map`
  from the earlier VA-017 fix. [src/lib/redisClient.ts](../src/lib/redisClient.ts)
  (new, `ioredis`, requires `REDIS_URL`) and a rewritten
  [src/lib/rateLimit.ts](../src/lib/rateLimit.ts) — same function names and
  call sites as before, now backed by real Redis keys with TTLs instead of
  per-process memory. Every call fails open (lets the request through) if
  Redis itself errors or times out, so a Redis outage degrades brute-force
  protection rather than taking login down entirely. **Verified live**:
  tripped a lockout, restarted the Node process, confirmed the lockout was
  still in effect afterward (proving it survived the restart) - the exact
  failure mode the in-memory version had.
- **HIBP breach check.** [src/lib/passwordValidation.ts](../src/lib/passwordValidation.ts)
  adds `validatePasswordFull()`: after the existing local checks pass, it
  queries Have I Been Pwned's k-anonymity range API (only the first 5 hex
  characters of the password's SHA-1 hash ever leave the server; the match
  against the full hash happens locally) and rejects a match. Fails open on
  any network error. Wired into all three password-setting endpoints
  (change-password, admin create-user, admin reset-user). **Verified
  live**: `Password1!` was rejected with a live call to the real HIBP API; a
  random strong password passed.
- **`sessionVersion`-based session invalidation.** New `User.sessionVersion`
  column, bumped on every password change (self-service or admin reset) and
  embedded in the session cookie at login. The check lives in one place -
  [src/lib/session.ts](../src/lib/session.ts)'s `getCurrentUser()` - and
  both `src/lib/guard.ts`'s `requireUser()` (every API route) and every
  Server Component page call it, so a stale session is rejected identically
  everywhere, not just on API routes. The same check also compares the
  user's live `status`, so a deactivated account's already-issued session
  stops working immediately too, not just at its next natural expiry.
  **Verified live**: logged the same account into two separate sessions,
  changed the password via session A, confirmed session A (rebuilt with the
  new version) kept working while session B was immediately rejected - both
  on a plain API call and on an actual page render.
  - Caught and fixed a real bug during that verification: Next.js only
    allows writing cookies from a Route Handler or Server Action, not a
    Server Component - `session.destroy()` was crashing every page render
    for a stale session with a 500 instead of redirecting to `/login`. Now
    wrapped in try/catch (clearing the cookie is a courtesy there; the
    security boundary is the version check itself, re-run on every call
    regardless of whether the cookie was physically cleared).
  - Also caught a second, adjacent bug the same fix exposed:
    [dashboard/page.tsx](../src/app/(app)/dashboard/page.tsx) used a
    non-null assertion on `getCurrentUser()` instead of checking and
    redirecting itself, relying on the parent layout's redirect - which
    doesn't reliably stop a sibling page from still rendering in the App
    Router. A stale session hitting `/dashboard` specifically threw a
    second, separate unhandled error server-side (still redirected
    correctly to the browser, but noisy). Fixed to check and redirect the
    same way every other page in this app already does.
- **Rate limit + lockout on change-password.** Wrong "current password"
  attempts now go through the same Redis-backed machinery as login (5
  failures / 15 min lockout, keyed by user id rather than IP+username since
  the caller is already authenticated). **Verified live**: 6th wrong
  attempt returned 429.
- **Forced rotation for temporary credentials.** New
  `User.passwordExpiresAt`, set 24h out whenever `mustChangePassword` is
  set (admin create-user, admin reset-user) and cleared when the user sets
  their own password. The login route rejects an expired temporary
  password outright ("Temporary password has expired. Contact an
  administrator to reset it.") rather than letting someone in in­definitely
  on a password an admin chose and may still know. **Verified live**: a
  freshly admin-created account's `passwordExpiresAt` was correctly set 24h
  out.
- **Email required before completing a forced password change.**
  [change-password](../src/app/api/auth/change-password/route.ts) now
  rejects the request if `mustChangePassword` is set and the account has no
  email on file yet, pointing the user at the Email card already on the
  same `/profile` page - no UI change needed, since that card is already
  rendered above the password form during a forced change. Ensures a
  password-recovery path exists before the account settles into permanent
  use. **Verified live**: rejected until an email was set, then succeeded.

---

## Deep-dive findings (self-assessment, not sourced from either document)

Requested directly: "what would a security engineer's deep dive find in
this app?" Answered by actually running `npm audit` and checking specific
code paths rather than speculating, then fixing what came back. All fixed
unless marked deferred below.

- **Fixed — Next.js 16.3.2 had a confirmed, unauthenticated RCE** (two
  CVEs: one on Windows-hosted servers, one in the Image Optimization API
  via AVIF files) - and this app actually uses `next/image` (login page,
  Sidebar), so the code path was live. Upgraded to `next@16.3.4`.
- **Fixed — `nodemailer@9.1.0`** was vulnerable to a `resolveContent()`
  bypass of `disableFileAccess`/`disableUrlAccess` (a different, newer
  advisory than VA-015's ≤9.0.0 range, which this app had already cleared).
  Patch-bumped to `9.1.1` rather than the available `10.x` major, since a
  patch release existed that already fixed it - no need for the larger
  version jump's behavior-change risk.
- **Fixed — `exceljs`'s bundled `uuid`** (a buffer-bounds-check
  vulnerability) sat directly on this app's untrusted-file-upload surface
  (the findings import feature parses attacker-supplied `.xlsx` files).
  `exceljs` itself hasn't released a fix (its latest, 4.4.0, still depends
  on the vulnerable `uuid@^8.3.0`), so `package.json` now `overrides` that
  nested resolution to the same `uuid@14.x` this app's own code already
  uses directly.
- **Fixed — unbounded request body size.** Evidence upload and import both
  had their own byte caps; every plain JSON POST/PATCH route had none. A
  single check in [src/proxy.ts](../src/proxy.ts) now rejects any `/api`
  state-changing request whose declared `Content-Length` exceeds 11 MB
  (just above both existing 10 MB caps) with a 413, before the body is ever
  read into memory. Known limitation: a request that lies about or omits
  `Content-Length` (chunked transfer) isn't caught by this - a
  standard, non-airtight first line of defense, same as most apps use.
  **Verified live** with a real 12 MB payload.
- **Fixed — no CSRF token.** `SameSite=Lax` on the session cookie already
  blocks a forged cross-site POST from carrying it in any modern browser;
  added a second, defense-in-depth layer in the same proxy check: a
  state-changing `/api` request whose `Origin` (or, failing that,
  `Referer`) doesn't match its own `Host` is rejected with 403. Requests
  with neither header (curl, non-browser tooling) are let through rather
  than blocked, since a real forged *browser* request always carries
  `Origin` and blocking headerless requests outright would only reject
  legitimate non-browser callers, not stop an actual attack. **Verified
  live**: matching origin passed, `http://evil.example.com` was rejected.
- **Fixed — username-enumeration timing side channel on login.**
  `!user || !verifyPassword(...)` short-circuited past the (comparatively
  slow) bcrypt compare whenever the username didn't exist, responding
  measurably faster than a real username with a wrong password.
  `src/lib/auth.ts` now exports `DUMMY_PASSWORD_HASH`, a fixed unrelated
  hash the login route compares against when there's no real user, so a
  bcrypt-equivalent delay always runs either way.
- **Fixed — raw SMTP error returned to the client.** `test-email` echoed
  the exception's own message back in the response; now logged server-side
  only, with a generic-but-actionable message to the client (admin-only
  endpoint, but a raw transport error can still carry internal
  hostnames/TLS details that shouldn't reach any client response).
- **Fixed — audit log had no tamper-evidence.** Rows were plain, mutable
  database records - editing or deleting one directly in Postgres, outside
  the app entirely, would have been invisible. `AuditLogEntry` now carries
  `sequence`/`previousHash`/`hash`: each entry's hash covers its own fields
  plus the previous entry's hash (using a canonical, key-sorted JSON
  serialization - plain `JSON.stringify` isn't safe here since `oldValue`/
  `newValue` round-trip through a Postgres `jsonb` column, which does not
  preserve object key order, so a naive hash computed at write time could
  mismatch its own recomputation at read time through no fault of tampering
  at all; this was caught and fixed during verification, not left as a
  latent bug). `GET /api/admin/audit-log` now runs
  `verifyAuditLogChain()` on every request and the Audit Log page shows a
  "Chain verified" / "Tampering detected at entry #N" badge. Existing
  history (593 pre-existing rows) was backfilled via
  `prisma/backfill-audit-hash-chain.ts`, ordering by `timestamp` since
  that's the only signal old rows have. **Verified live**: directly edited
  one row's `action` field via a raw Prisma call (bypassing the app
  entirely) and confirmed the API immediately reported
  `chainValid: false` at the exact tampered entry; reverted and confirmed
  it returned to `true`.
- **Deferred — no MFA anywhere**, including ADMIN/HO_CONTROLLER. Not a
  quick fix - needs its own design decision (TOTP vs. email/SMS OTP,
  enrollment UX, recovery-code handling) rather than being bolted on
  during this pass. Worth its own follow-up.
- **Deferred — no antivirus/malware scanning on evidence uploads.**
  MIME allowlist + magic-byte verification are real and already in place
  (see the earlier VA-013 section), but content-safety scanning needs an
  external service (ClamAV, a cloud AV API) this environment doesn't have
  available to wire up and verify against.
- **Deferred — plaintext secrets in `.env`** (SMTP password, DB
  credentials, Redis auth if set). Standard for this app's current scale;
  a production deployment should move these to a real secrets manager
  rather than a code change addressing it here.
- **Accepted, not fixed — remaining `npm audit` findings** (js-yaml,
  valibot, mysql2, `@hono/node-server`, `@prisma/config`/`deepmerge-ts`)
  are all transitive dependencies of Prisma's own dev tooling (`@prisma/dev`,
  used by `prisma generate`/`prisma studio`), never part of this app's own
  served request path. `npm audit`'s own suggested fix for all of them is
  downgrading `prisma` to `6.19.3` - reverting this session's entire
  Postgres/Prisma-7 migration - which is a much larger regression than the
  actual risk (dev-CLI-only, not reachable from the running app) justifies.

## Memo Automation System (SEC-001 – SEC-022)

#### SEC-001 — Access Control (Risk: High)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Implement strict, centralized server-side authorization checks for all memo retrieval operations. Validate that the requesting user is explicitly authorized (sender, recipient, CC, current holder, or authorized role) before returning memo data. Apply consistent access control across Inbox, Sent, and related endpoints. Avoid relying on client-side validation or obscurity of identifiers.
- **Status:** Resolved · Responsible: Alhamdu Y. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-002 — Cryptography (Risk: High)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Replace all non-cryptographic random number generation methods with cryptographically secure random number generators (e.g., `crypto.randomInt()` or equivalent secure entropy sources). Ensure all credentials, temporary passwords, reset tokens, and security-related values are generated using approved secure cryptographic APIs.
- **Status:** Resolved · Responsible: Alhamdu Y. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-003 — Security Headers / Configuration (Risk: Medium)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Add a strict `Permissions-Policy` HTTP response header to explicitly disable unused browser features. Only allow capabilities strictly required for business functionality. Ensure this header is applied application-wide and maintained in server configuration.
- **Status:** Resolved · Responsible: Alhamdu Y. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-004 — Authentication / Account Management (Risk: High)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Enforce email ownership verification before applying changes: send a confirmation link to the new email and notify the old email address. Optionally, use MFA/OTP for sensitive accounts. Reject email updates that are already associated with another account.
- **Status:** Resolved · Responsible: Alhamdu Y. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-005 — Access Control (Risk: Low)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Implement strict role-based access control (RBAC) checks before rendering administrative pages. Restrict unauthorized requests to administrative endpoints by returning HTTP 403 (Forbidden) or 404 (Not Found). Ensure UI components for admin functionality are not rendered for non-privileged users.
- **Status:** Resolved · Responsible: Alhamdu Y. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-006 — Vulnerable and Outdated Components (Risk: High)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Upgrade `fast-xml-parser` to version 5.3.4 or higher. Ensure all AWS SDK packages no longer rely on vulnerable versions. Use `npm audit fix` to update dependencies. Apply input validation and XML size limits to mitigate potential DoS attacks.
- **Status:** Resolved · Responsible: Alhamdu Y. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-007 — Vulnerable and Outdated Components (Risk: High)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Upgrade Next.js to version ^15.5.12 or later. Restrict `remotePatterns` in `next.config.ts` to specific domains only. Apply request size limits for server-side protection. Review and disable unused experimental features (e.g., PPR, React Server Components). Use `npm audit fix --force` to update dependencies and mitigate DoS risks.
- **Status:** Resolved · Responsible: Alhamdu Y. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-008 — Vulnerable and Outdated Components (Risk: High)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Upgrade `tar` to version 7.5.7 or later. Enforce strict file path validation when extracting archives. Avoid extracting archives from untrusted sources. Apply `npm audit fix` to update dependencies.
- **Status:** Resolved · Responsible: Alhamdu Y. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-009 — Authentication / Credential Management (Risk: High)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Remove hard-coded passwords from source code. Store admin credentials in environment variables or a secure secrets manager. Enforce password change on first login for all seeded administrative accounts.
- **Status:** Resolved · Responsible: Alhamdu Y. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-010 — Logging / Security Monitoring (Risk: Medium)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Implement a centralized security event logging mechanism capturing all security-relevant events (authentication/authorization failures, delegation changes, role modifications). Include contextual details: user ID, timestamp, IP, severity, and event description. Integrate alerting for high-severity events such as role deletions or critical security breaches.
- **Status:** Resolved · Responsible: Alhamdu Y. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-011 — Cryptography / Sensitive Data Exposure (Risk: High)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Remove all hashed passwords from API responses. Handle password verification solely on the server side. Ensure strong cryptographic hashing algorithms are used (e.g., bcrypt, Argon2). Review all API responses to prevent exposure of sensitive information.
- **Status:** Resolved · Responsible: Alhamdu Y. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-012 — Security Headers / Client-Side Security (Risk: Medium)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Configure a restrictive Content-Security-Policy header for all HTTP responses. Define trusted sources for scripts, styles, images, fonts, and frames. Avoid unsafe directives (`unsafe-inline`, `unsafe-eval`). Use nonces or hashes for inline scripts where required.
- **Status:** Resolved · Responsible: Alhamdu Y. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-013 — Security Headers / Transport Security (Risk: Medium)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Configure the application server or load balancer to include the `Strict-Transport-Security` header in all HTTPS responses. Example: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
- **Status:** Resolved · Responsible: Alhamdu Y. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-014 — Security Headers / Clickjacking Protection (Risk: Medium)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Add `X-Frame-Options: DENY` header or configure Content-Security-Policy with `frame-ancestors 'none'` to prevent the application from being embedded in malicious frames.
- **Status:** Resolved · Responsible: Alhamdu Y. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-015 — Access Control / Authorization (Risk: Low)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Implement strict role-based access control (RBAC) checks before rendering administrative pages. Return HTTP 403 (Forbidden) or 404 (Not Found) for unauthorized requests. Ensure admin UI components are not rendered for non-privileged users.
- **Status:** Resolved · Responsible: Alhamdu Y. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-016 — Session Management / Access Control (Risk: Critical)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Bind session tokens to authenticated user ID and contextual attributes. Enforce strict server-side validation on every request. Implement session token versioning, token rotation upon privilege change, session invalidation on logout/password change, and contextual binding (IP/device where appropriate). Ensure `__Secure-` cookies are properly scoped, `HttpOnly`, `Secure`, and `SameSite` protected.
- **Status:** Resolved · Responsible: Alhamdu Y. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-017 — Security Misconfiguration / Security Headers (Risk: Low)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Configure the web/application server to include `X-Frame-Options: DENY` or `X-Frame-Options: SAMEORIGIN` in all HTTP responses to prevent framing by malicious websites.
- **Status:** Resolved · Responsible: Alhamdu Y. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-018 — Security Hardening / Security Headers (Risk: Low)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Configure the application or web server to include `X-Content-Type-Options: nosniff` in all HTTP responses to prevent MIME-type sniffing and improper content interpretation by browsers.
- **Status:** Resolved · Responsible: Alhamdu Y. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-019 — Access Control / API Security (Risk: High)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Enforce authentication middleware on the upload API. Validate user session and permissions server-side before processing uploads. Associate uploaded files with authenticated user IDs. Implement strict RBAC checks and log upload activity for auditing.
- **Status:** Resolved · Responsible: Alhamdu Y. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-020 — Access Control / API Security (Risk: Critical)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Protect file download routes with strict authentication and authorization checks. Verify that the requesting user is authorized (e.g., memo sender, recipient, or CC). Avoid exposing direct file paths in API responses. Implement signed, time-limited URLs for secure file downloads. Log download access for auditing.
- **Status:** Resolved · Responsible: Alhamdu Y. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-021 — Input Validation / File Upload Security (Risk: High)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Implement a strict allowlist for permitted file types (e.g., specific image/document formats only). Validate file extensions, MIME types, and perform server-side content inspection. Reject executable, script, launcher, and other potentially dangerous file types. Log upload attempts for monitoring.
- **Status:** Resolved · Responsible: Alhamdu Y. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-022 — Authorization / Access Control (Risk: Medium)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Enforce validation to ensure delegation relationships are active and not expired at the time of JWT update. Verify delegator account status before applying delegation permissions. Invalidate or reissue JWTs when delegation relationships are modified or revoked. Reduce token lifetime or revalidate delegation per request.
- **Status:** Resolved · Responsible: Alhamdu Y. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

---

## Nib Sacco (SEC-023 – SEC-050)

#### SEC-023 — Authentication / API Security (Risk: High)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Remove password reset tokens and metadata from all API responses. Apply strict backend access control and response sanitization to prevent accidental disclosure.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: INSA · Verified: 10/9/2026

#### SEC-024 — Authentication / Access Control (Risk: High)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Enforce a strict allow-list of permitted callback URLs. Reject callback URLs containing nested parameters. Do not trust client-supplied URLs via POST body or cookies. Validate destinations server-side with secure state management.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: INSA · Verified: 10/9/2026

#### SEC-025 — Session Management / Authentication (Risk: High)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Implement strict session concurrency controls: limit active sessions per user, invalidate old sessions on new login, password change, or privilege update. Use short-lived access tokens with secure refresh token rotation and server-side session revocation.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: INSA · Verified: 10/9/2026

#### SEC-026 — Authentication / Authorization (Risk: High)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Enforce strict server-side authorization and workflow validation for all password change operations. Require a valid, unexpired, single-use reset token bound to the specific user and purpose. Validate user roles before rendering or processing requests and reject role mismatches.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: INSA · Verified: 10/9/2026

#### SEC-027 — Denial of Service / Server Hardening (Risk: High)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Deploy reverse proxies or WAFs to buffer and inspect traffic. Implement rate limiting to restrict connections per IP. Tune server configuration: set low connection timeouts and minimum transfer speeds to close suspiciously slow or incomplete connections.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: INSA · Verified: 10/9/2026

#### SEC-028 — Authorization / Transaction Controls (Risk: High)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Enforce a clear transaction approval model: single-role approval (only one defined role may authorize transactions), or dual authorization / maker–checker (two distinct users perform approval actions, with immutable transaction states). Server-side validation must ensure initiator and approver are distinct.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: INSA · Verified: 10/9/2026

#### SEC-029 — Authentication / API Security (Risk: High)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Sanitize API responses by explicitly excluding password and temporary credential fields. Deliver temporary credentials via secure out-of-band mechanisms only.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: INSA · Verified: 10/9/2026

#### SEC-030 — Authentication / API Security (Risk: Medium)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Remove password hashes from all API responses. Enforce strict server-side field filtering and data-minimization controls across all endpoints. Conduct regression testing to ensure no sensitive authentication artifacts are exposed.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: INSA · Verified: 10/9/2026

#### SEC-031 — Authentication / Password Policy (Risk: Medium)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Enforce password complexity: require a combination of upper- and lower-case letters, numbers, and special characters, or adopt passphrase-based policies.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: INSA · Verified: 10/9/2026

#### SEC-032 — Authentication / CSRF Protection (Risk: Medium)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Enforce strict server-side CSRF token validation for all state-changing operations. Use unique, session-bound CSRF tokens with expiration policies.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: INSA · Verified: 10/9/2026

#### SEC-033 — Authentication / Credential Management (Risk: Medium)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Enforce strict expiration on all temporary or first-use credentials. Ensure credentials are time-bound and single-use, bound to the specific user and role. Implement server-side validation to reject expired or reused credentials.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: INSA · Verified: 10/9/2026

#### SEC-034 — Authentication / Session Security (Risk: Medium)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Set the `Secure` attribute on all authentication and session cookies to enforce transmission over HTTPS only. Ensure sensitive cookies also have `HttpOnly` and `SameSite` attributes properly configured; consider `SameSite=Strict` for maximum protection.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: INSA · Verified: 10/9/2026

#### SEC-035 — Information Disclosure / Security Hardening (Risk: Low)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Remove or obfuscate the `Server` header from all HTTP responses, including error pages. Configure the web server or reverse proxy to return a generic or empty server value.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: INSA · Verified: 10/9/2026

#### SEC-036 — Hard-Coded Credentials / Insecure Password Initialization (Risk: High)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Remove hard-coded password from source code. Generate unique, strong random temporary passwords per user. Enforce mandatory password change at first login. Use secure environment variables or a secrets manager. Audit and reset accounts created with the default password.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-037 — Input Validation / Data Sanitization (Risk: Medium)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Strengthen validation rules with strict length limits, domain constraints, and phone number normalization. Sanitize all inputs before database insertion. Use schema validation libraries such as Joi or Zod for robust server-side validation. Reject invalid inputs explicitly at the API layer.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-038 — Insecure Randomness / Predictable Identifiers (Risk: Medium)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Replace `Date.now()` and `Math.random()` with a cryptographically secure random generator (e.g., `crypto.randomBytes`). Ensure sufficient entropy to prevent collisions. Implement server-side uniqueness checks and avoid account number formats that leak timestamp information.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-039 — Insecure Communication / Transport Security (Risk: Medium)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Enforce `secure: true` in Nodemailer configuration to require TLS. Deploy APIs strictly over HTTPS. Use app-specific credentials or OAuth2 authentication. Protect environment variables using secure storage mechanisms.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-040 — Insecure Communication / Transport Security (Risk: Medium)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Configure Nodemailer with `secure: true` to enforce TLS. Ensure APIs are served strictly over HTTPS. Use app-specific credentials or OAuth2 for Gmail authentication. Avoid logging sensitive reset URLs in production environments.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-041 — Session Management / Insecure Session Handling (Risk: Medium)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Implement inactivity-based session expiration (e.g., 15–30 minutes). Enforce absolute session lifetime limits (e.g., 8 hours). Use secure `HttpOnly`/`Secure` cookies or properly configured JWTs with expiration claims. Invalidate sessions on logout and consider MFA revalidation for sensitive operations.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-042 — Security Misconfiguration / Content Security Policy (Risk: Low)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Review and correct the Content-Security-Policy header. Remove invalid directives such as `/auth` and replace them with valid hostnames or URL patterns. Ensure CSP is properly configured and consistently applied across all pages and subpages.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-043 — Information Disclosure / Security Misconfiguration (Risk: Low)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Remove `X-Powered-By` headers at the web server or load balancer layer. Minimize or obfuscate the `Server` header. Keep platform components patched. Use generic error pages without stack traces or version disclosure. Re-run automated scans to verify header removal.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-044 — Authentication / Information Disclosure (Risk: Medium)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Replace detailed authentication errors with generic responses (e.g., "Phone number not found or invalid password"). Implement account lockout or throttling after multiple failed attempts. Apply rate limiting and CAPTCHA to mitigate automated attacks.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-045 — Authentication / Brute-force Protection (Risk: High)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Implement rate limiting for login attempts (e.g., maximum retries per time window). Introduce account lockout or temporary suspension after repeated failures. Consider CAPTCHA or MFA. Monitor and alert on suspicious login activity.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-046 — Vulnerable / Outdated Dependency (Risk: Critical)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Upgrade Axios to version 1.12.0 or later. Retest application post-upgrade. Implement input validation and request size limits as additional mitigations.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-047 — Authentication / Token Management (Risk: High)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Do not store authentication tokens in `localStorage`. Instead, store them in `HttpOnly`, `Secure`, `SameSite` cookies. Implement short token lifetimes with automatic rotation to enhance security and prevent token theft or reuse.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-048 — Authentication / Password Management (Risk: Medium)
- **Issue:** see [data quality note](#data-quality-note-on-sec-001–050) above.
- **Recommended solution:** Generate a unique, random initial password for each user, enforce a mandatory password change on first login, and track accounts that have not updated their default credentials to ensure security compliance.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-049 — Access Control / Insecure Direct Object Reference (IDOR) (Risk: High)
- **Issue:** Authenticated users can access other users' accounts by modifying user ID values in the URL, indicating missing server-side authorization.
- **Recommended solution:** Ensure all server-side endpoints verify that users can only access their own records, avoiding reliance on user-supplied IDs in URLs. Implement session-based validation or ownership checks and enforce the principle of least privilege on all data access requests to prevent horizontal privilege escalation.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-050 — Access Control / Vertical Privilege Escalation (Risk: High)
- **Issue:** Regular users can access the admin dashboard by directly entering the URL, bypassing frontend-only restrictions. Server-side role verification is missing.
- **Recommended solution:** Implement server-side role checks for all Admin pages and APIs by verifying that the user's session or token contains the 'admin' role before rendering content. Return "Access Denied" or redirect unauthorized users, audit all URLs and endpoints to ensure proper protection, and do not rely solely on frontend controls for security.
- **Status:** Resolved · Responsible: Hawi T. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

---

## Hospital Appointment System (SEC-051 – SEC-063)

#### SEC-051 — Information Disclosure / Server Configuration (Risk: Medium)
- **Issue:** Application discloses detailed server version information in HTTP response headers (e.g., `Microsoft-IIS/10.0`, `ASP.NET 4.0.30319`), allowing attackers to identify backend technology and versions.
- **Recommended solution:** Remove or suppress server version headers at the server or application level. Expose only essential headers such as `Content-Type` and `Cache-Control`.
- **Status:** Resolved · Responsible: Hawi T. & Nuhamin M. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-052 — Security Configuration / Content Security Policy (Risk: Medium)
- **Issue:** Application implements a Content Security Policy (CSP) with overly permissive directives, such as `img-src` allowing `data:` and all HTTPS sources, and `connect-src` allowing all HTTPS destinations.
- **Recommended solution:** Restrict CSP directives to only the specific domains required by the application. Avoid using wildcard sources (`https:` or `data:`) where possible. Regularly review CSP rules to enforce least privilege.
- **Status:** Resolved · Responsible: Hawi T. & Nuhamin M. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-053 — Cryptography / TLS Configuration (Risk: High)
- **Issue:** Server supports weak and deprecated TLS 1.2 cipher suites, including AES-CBC, CAMELLIA-CBC, SEED-CBC, and static RSA key-exchange ciphers. These configurations expose the TLS channel to cryptographic weaknesses and downgrade attacks.
- **Recommended solution:** Harden TLS configuration: (1) disable all TLS 1.2 CBC-mode cipher suites (AES-CBC, CAMELLIA-CBC, SEED-CBC), (2) disable all static RSA key-exchange ciphers (`TLS_RSA_*`), (3) restrict TLS 1.2 to Forward Secrecy AEAD ciphers only, (4) prioritize TLS 1.3. Recommended TLS 1.2 ciphers: `TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256`, `TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384`, `TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256`.
- **Status:** Resolved · Responsible: Hawi T. & Nuhamin M. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-054 — Access Control / IDOR (Risk: High)
- **Issue:** Hospital context switching is possible via ID manipulation. Authenticated hospital administrators can modify request parameters (hospital ID) to access or manage data belonging to other hospitals, violating tenant isolation.
- **Recommended solution:** Enforce hospital ownership validation: derive the hospital ID from the authenticated session or token, not the request parameters, and ensure backend operations match the admin's assigned hospital. Implement server-side authorization checks for every hospital-scoped request (authentication, role authorization, and hospital ID verification).
- **Status:** Resolved · Responsible: Hawi T. & Nuhamin M. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-055 — Information Disclosure / Security Misconfiguration (Risk: Low)
- **Issue:** Public endpoint exposes the default Microsoft IIS welcome page, revealing underlying server and platform details (Windows Server and IIS). This information can be used for technology fingerprinting and targeted attacks.
- **Recommended solution:** Remove or disable the default IIS welcome page. Configure the server to return only intended application content. Apply web server hardening best practices (disable unused IIS modules, implement custom error pages, enforce HTTPS). Perform a configuration review to ensure no default/sample resources are accessible.
- **Status:** Resolved · Responsible: Hawi T. & Nuhamin M. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-056 — Access Control / IDOR (Risk: High)
- **Issue:** Appointment status endpoint (`/api/appointments/status`) exposes sensitive patient appointment data without authentication. The endpoint relies solely on a user-supplied `transactionId` and does not validate the requester's identity.
- **Recommended solution:** Enforce authentication using `auth()` or `getServerSession()`. Ensure only the appointment owner or authorized admins can access appointment data. Implement authorization checks to verify the authenticated user is associated with the requested appointment.
- **Status:** Resolved · Responsible: Hawi T. & Nuhamin M. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-057 — Security Logging / Monitoring (Risk: Medium)
- **Issue:** Application lacks centralized and consistent audit logging for critical administrative actions. Partial logging exists for hospital creation and deletion, but sensitive operations like updating hospital images, modifying schedules, and editing user roles are not logged.
- **Recommended solution:** Implement centralized audit logging for all administrative and sensitive actions. Ensure logs capture actor, action, target, and timestamp. Protect logs to be immutable and auditable. Align logging with industry security standards (OWASP, NIST, ISO 27001).
- **Status:** Resolved · Responsible: Hawi T. & Nuhamin M. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-058 — Authentication / Token Management (Risk: Low)
- **Issue:** Account activation tokens remain valid for an extended period (24 hours), increasing the window of opportunity for unauthorized activation if the token is intercepted or compromised.
- **Recommended solution:** Reduce activation token validity to 1–2 hours. Ensure tokens are single-use and invalidated immediately after activation. Implement monitoring and alerts for abnormal activation attempts.
- **Status:** Resolved · Responsible: Hawi T. & Nuhamin M. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-059 — Authorization / Access Control (UI-Level) (Risk: Low)
- **Issue:** Improper role-based UI exposure: all roles (Maker–Checker, Maker, Checker) see the same interface and controls regardless of permissions, potentially causing confusion and misinterpretation of access privileges.
- **Recommended solution:** Implement role-based UI rendering so pages, buttons, and actions are displayed only for users with the appropriate permissions. Condition UI elements on the authenticated user's role (e.g., hospital creation, modification, approval).
- **Status:** Resolved · Responsible: Hawi T. & Nuhamin M. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-060 — Authentication / Access Control (Risk: High)
- **Issue:** Inadequate role-based restrictions: all Super Admin roles (Maker–Checker, Maker, Checker) can change passwords of other Super Admin accounts without role-based limits, approval, or additional verification.
- **Recommended solution:** Restrict Super Admin password reset functionality to the highest-privileged administrative role. Implement MFA for admin password changes, approval workflows for sensitive modifications, and comprehensive audit logging with real-time alerts.
- **Status:** Resolved · Responsible: Hawi T. & Nuhamin M. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-061 — Authentication / Credential Management (Risk: Medium)
- **Issue:** Missing forced password change on first login: newly created Super Admin accounts can log in using assigned credentials without being required to change the password.
- **Recommended solution:** Enforce mandatory password change for all newly created Super Admin accounts upon first login. Treat initial passwords as temporary and invalidate after first use. Apply strong password policies and MFA for administrative accounts.
- **Status:** Resolved · Responsible: Hawi T. & Nuhamin M. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-062 — Vulnerable / Outdated Components (Risk: High)
- **Issue:** The application runs a vulnerable Next.js version (10.0.0 – 15.6.0-canary.60) affected by multiple Denial of Service (DoS) vulnerabilities, including Image Optimizer `remotePatterns` abuse, PPR resume endpoint memory exhaustion, and HTTP request deserialization in React Server Components.
- **Recommended solution:** Upgrade Next.js to a patched, stable version. Restrict Image Optimizer `remotePatterns` to trusted domains. Disable or limit experimental features such as PPR. Apply rate limiting and monitoring to detect abnormal request patterns.
- **Status:** Resolved · Responsible: Hawi T. & Nuhamin M. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-063 — Access Control / CSRF Protection (Risk: Medium)
- **Issue:** CSRF protection is not consistently enforced on state-changing API routes. Some endpoints (file upload, appointment updates, payment callbacks) verify authentication but do not validate CSRF tokens or request origin.
- **Recommended solution:** Enforce CSRF validation on all state-changing API routes (POST, PUT, PATCH, DELETE). Apply `verifyCsrfToken` consistently. Validate `Origin` and `Referer` headers where tokens are not feasible. Ensure cookies have appropriate `SameSite` attributes.
- **Status:** Resolved · Responsible: Hawi T. & Nuhamin M. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

---

## Nib Learning (SEC-064 – SEC-081)

#### SEC-064 — Functional / Business Logic (Risk: Low)
- **Issue:** Inconsistent user registration and authentication requirements: users can be created without a phone number, but phone number is mandatory for login, preventing such users from authenticating.
- **Recommended solution:** Align registration and login logic by making phone number mandatory during user creation or allowing authentication using an alternative identifier.
- **Status:** Resolved · Responsible: Blen K. & Haymanot D. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-065 — Authentication Weakness (Risk: High)
- **Issue:** Weak password policy allows short and low-complexity passwords without enforcing uppercase, lowercase, numeric, special character, or common-password restrictions.
- **Recommended solution:** Enforce strong password policy including minimum length and complexity requirements. Block commonly used passwords. Ensure passwords are securely hashed using modern algorithms such as bcrypt, Argon2, or scrypt.
- **Status:** Resolved · Responsible: Blen K. & Haymanot D. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-066 — Session Management (Risk: Medium)
- **Issue:** Excessive session timeout: user sessions remain active for prolonged periods without expiring after inactivity, exceeding recommended security best practices.
- **Recommended solution:** Reduce session timeout duration and enforce automatic session invalidation after inactivity. Require re-authentication for sensitive or high-risk actions to minimize session hijacking impact.
- **Status:** Resolved · Responsible: Blen K. & Haymanot D. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-067 — Authentication & Session Management (Risk: Critical)
- **Issue:** Session token reuse / token binding failure: refresh tokens are not bound to a specific user, session, or client context, allowing reuse across different accounts and enabling privilege escalation.
- **Recommended solution:** Bind refresh tokens to a specific user session and client context. Validate token ownership on every refresh request. Implement refresh token rotation, invalidate old tokens after use, revoke tokens on logout or privilege change, securely store tokens, and reduce token lifetime.
- **Status:** Resolved · Responsible: Blen K. & Haymanot D. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-068 — Authentication & Session Management (Risk: High)
- **Issue:** Missing idle timeout and absolute session expiration controls. Sessions remain valid indefinitely as long as refresh tokens rotate successfully, with no server-side inactivity tracking or maximum lifetime enforcement.
- **Recommended solution:** Enforce server-side idle timeouts and absolute session lifetime limits. Track last activity timestamps, invalidate refresh tokens when limits are exceeded, and align session policies with regulatory and banking security standards.
- **Status:** Resolved · Responsible: Blen K. & Haymanot D. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-069 — Authentication & Session Management (Risk: Critical)
- **Issue:** Session invalidation failure: refresh tokens remain valid after logout, allowing stale tokens to restore sessions. Token revocation is not properly implemented or enforced.
- **Recommended solution:** Implement server-side refresh token revocation on logout. Use database-backed revocation or token versioning. Ensure logout and password changes invalidate all active sessions and refresh tokens.
- **Status:** Resolved · Responsible: Blen K. & Haymanot D. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-070 — Authentication & Session Management (Risk: Critical)
- **Issue:** Authentication token impersonation allows privilege escalation: auth tokens (`accessToken`/`auth_token`) are not bound to a session, device, or server-side state, allowing one user to assume another user's identity.
- **Recommended solution:** Bind authentication tokens to server-side session state. Enforce token revocation on logout, password or role changes. Do not trust client-provided role claims without server validation. Implement session invalidation, replay protection, and reduce token lifetime with strict refresh token controls.
- **Status:** Resolved · Responsible: Blen K. & Haymanot D. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-071 — Authentication & Session Management (Risk: High)
- **Issue:** Token tampering does not invalidate active sessions: JWT (`auth_token`) payloads can be modified without triggering session termination or token invalidation.
- **Recommended solution:** Enforce strict token validation failure handling with immediate logout. Invalidate both access and refresh tokens on detection of tampering. Ensure authentication middleware rejects and clears tampered tokens.
- **Status:** Resolved · Responsible: Blen K. & Haymanot D. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-072 — Authorization / Access Control (Risk: High)
- **Issue:** Missing authorization checks in Super Admin server actions: all server actions in `super-admin-actions.ts` lack explicit role verification, allowing any authenticated user to perform Super Admin operations.
- **Recommended solution:** Enforce strict Super Admin role verification on all server actions. Centralize role-based authorization logic, deny access by default, explicitly allow only authorized roles, and implement automated authorization tests.
- **Status:** Resolved · Responsible: Blen K. & Haymanot D. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-073 — Security Misconfiguration / Cookie Management (Risk: Medium)
- **Issue:** Access token cookie uses a less restrictive `SameSite` policy (`Lax`), while the refresh token uses `Strict`. Partial CSRF protection is provided, but the access token may be sent in certain cross-site requests.
- **Recommended solution:** Align cookie policies by setting `SameSite=Strict` for both access and refresh tokens where feasible. Ensure all state-changing requests enforce CSRF protections. Review endpoints relying on cookies for authentication.
- **Status:** Resolved · Responsible: Blen K. & Haymanot D. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-074 — Security Misconfiguration / Information Disclosure (Risk: High)
- **Issue:** Verbose error messages expose internal system details: API endpoints return raw exception messages and diagnostic information to clients, revealing internal logic, database errors, and integration details.
- **Recommended solution:** Replace verbose error messages with generic user-safe responses in production. Log detailed errors server-side only. Implement centralized error handling and differentiate verbosity between development and production environments. Review all API endpoints for potential information disclosure.
- **Status:** Resolved · Responsible: Blen K. & Haymanot D. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-075 — Security Logging and Monitoring (Risk: Medium)
- **Issue:** Sensitive data exposure through application logging: payment, PII, and authentication-related information are logged without sanitization, risking unauthorized disclosure.
- **Recommended solution:** Avoid logging sensitive data such as credentials, tokens, payment details, or PII. Implement log sanitization/redaction. Restrict access to production logs, review retention policies, and ensure compliance with GDPR, PCI DSS, and other regulations.
- **Status:** Resolved · Responsible: Blen K. & Haymanot D. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-076 — Security Misconfiguration / HTTP Security Headers (Risk: Medium)
- **Issue:** Missing or incomplete HTTP security headers: critical headers like `X-Frame-Options`, `X-Content-Type-Options`, HSTS, CSP, `Referrer-Policy`, and `Permissions-Policy` are not configured, weakening client-side protections.
- **Recommended solution:** Define and enforce a comprehensive set of HTTP security headers globally. Apply secure defaults, explicitly disable unnecessary browser features, and ensure consistent header enforcement across all routes and environments.
- **Status:** Resolved · Responsible: Blen K. & Haymanot D. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-077 — Security Misconfiguration / Information Disclosure (Risk: Low)
- **Issue:** Server version disclosure via HTTP headers (`Server: Microsoft-HTTPAPI/2.0`) exposes backend platform details to unauthenticated users.
- **Recommended solution:** Suppress or replace the `Server` header with a generic value at the server, gateway, or reverse proxy level. Ensure Windows components are fully patched and hardened.
- **Status:** Resolved · Responsible: Blen K. & Haymanot D. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-078 — Security Misconfiguration / Content Security Policy (Risk: Medium)
- **Issue:** CSP includes `unsafe-inline` in `style-src`, allowing execution of inline CSS styles and exposing potential CSS injection risks. `img-src` allows external domains, expanding attack surface.
- **Recommended solution:** Remove `unsafe-inline` from `style-src` if possible. If inline styles are required, use nonce-based or hash-based inline styles or move CSS to external files to maintain a strict CSP without breaking the UI.
- **Status:** Resolved · Responsible: Blen K. & Haymanot D. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-079 — Vulnerable / Outdated Component (Risk: Critical)
- **Issue:** Application uses a vulnerable version of the jsPDF library (`<=3.0.4`) via `jspdf-autotable`, exposing a Local File Inclusion / Path Traversal vulnerability (GHSA-f8cm-6447-x5h2).
- **Recommended solution:** Upgrade jsPDF to `>=4.0.0` and update dependent packages (e.g., `jspdf-autotable`) to compatible versions. Test in a controlled environment due to potential breaking changes. Remove unused dependencies and monitor third-party libraries for advisories.
- **Status:** Resolved · Responsible: Blen K. & Haymanot D. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-080 — Broken Access Control / Privilege Escalation (Risk: High)
- **Issue:** Insecure role-based access control (RBAC) could allow lower-privileged users (Staff or Admin) to access dashboards or perform actions beyond their assigned permissions, risking privilege escalation.
- **Recommended solution:** Implement strict server-side RBAC. Validate roles on all API endpoints and sensitive actions. Log and audit all Admin/Super Admin activities. Test regularly for privilege escalation (URL tampering, parameter manipulation, API bypass). Apply MFA for Super Admin accounts.
- **Status:** Resolved · Responsible: Blen K. & Haymanot D. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-081 — Access Control / Authorization (Risk: High)
- **Issue:** Users with read-only permissions are able to perform privileged actions (add, modify, delete), indicating insufficient backend authorization enforcement and potential privilege escalation.
- **Recommended solution:** Enforce authorization checks on all backend state-changing endpoints. Implement strict RBAC with clearly defined permissions per role. Block unauthorized API actions regardless of UI. Log and alert all unauthorized attempts.
- **Status:** Resolved · Responsible: Blen K. & Haymanot D. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

---

## Micro Loan (SEC-082 – SEC-089)

#### SEC-082 — Authentication / Session Management (Risk: High)
- **Issue:** Sensitive tokens (`accessToken`, `refreshToken`, session identifiers) are stored in browser-accessible cookies without the `HttpOnly` flag, making them vulnerable to theft via XSS or malicious scripts.
- **Recommended solution:** Mark all sensitive cookies as `HttpOnly`, `Secure`, and `SameSite=Strict`. Avoid storing sensitive tokens in cookies if not required. Implement short token lifetimes with rotation.
- **Status:** Resolved · Responsible: Tony S. & Aliy U. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-083 — Privacy / Information Leakage (Risk: Low)
- **Issue:** Persistent identifiers (e.g., `_device_id`, `MSFPC`) stored in cookies can be used for device/session tracking and user activity correlation.
- **Recommended solution:** Minimize storage of persistent identifiers. Hash or tokenize identifiers before storage. Provide transparency in privacy documentation.
- **Status:** Resolved · Responsible: Tony S. & Aliy U. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-084 — Misconfiguration / Cross-Origin Resource Sharing (CORS) (Risk: High)
- **Issue:** Production environment allows CORS wildcard (`Access-Control-Allow-Origin: *`), enabling any external domain to send requests to the backend and potentially exploit authenticated sessions.
- **Recommended solution:** Restrict allowed origins to trusted production domains. Store multiple frontend clients in environment variables. Use dynamic validation logic if the list is large or needs runtime evaluation.
- **Status:** Resolved · Responsible: Tony S. & Aliy U. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-085 — HTTP Security Hardening (Risk: Low)
- **Issue:** Missing critical browser security headers (`X-Permitted-Cross-Domain-Policies`, COEP, COOP, CORP, HSTS), weakening browser isolation and increasing risk from cross-origin attacks.
- **Recommended solution:** Configure: `X-Permitted-Cross-Domain-Policies: none`; `Cross-Origin-Embedder-Policy: require-corp`; `Cross-Origin-Opener-Policy: same-origin`; `Cross-Origin-Resource-Policy: same-origin`; `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
- **Status:** Resolved · Responsible: Tony S. & Aliy U. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-086 — Information Disclosure / HTTP Headers (Risk: Medium)
- **Issue:** The application exposes framework and version information via headers such as `X-AspNet-Version` and `X-AspNetMvc-Version`, allowing attackers to target version-specific vulnerabilities.
- **Recommended solution:** Remove or suppress `X-AspNet-Version` and `X-AspNetMvc-Version` headers at the server or application level. Expose only essential headers like `Content-Type` and `Cache-Control`.
- **Status:** Resolved · Responsible: Tony S. & Aliy U. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-087 — Information Disclosure / HTTP Headers (Risk: Low)
- **Issue:** The server exposes implementation details via the `X-Powered-By` HTTP header, revealing the backend framework or technology stack to attackers.
- **Recommended solution:** Disable or suppress the `X-Powered-By` header at the web/application server and intermediary levels (load balancers, reverse proxies). Use generic headers and enforce strict caching policies.
- **Status:** Resolved · Responsible: Tony S. & Aliy U. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-088 — Cryptographic Weakness (Risk: Medium)
- **Issue:** The server supports weak TLS 1.2 cipher suites using AES-CBC mode, which are vulnerable to padding-oracle attacks and other cryptographic weaknesses.
- **Recommended solution:** Disable all AES-CBC cipher suites in TLS 1.2. Allow only secure GCM and ChaCha20-based ciphers. Recommended set: `TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256`, `TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384`, and all TLS 1.3 default ciphers.
- **Status:** Resolved · Responsible: Tony S. & Aliy U. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-089 — Cryptography / Randomness (Risk: Medium)
- **Issue:** The application generates `connectionId` values using `Math.random()`, a non-cryptographically-secure pseudorandom generator. This makes connection IDs predictable, enabling session hijacking or enumeration attacks.
- **Recommended solution:** Replace `Math.random()` with a cryptographically secure random generator, such as `crypto.randomUUID()` or `crypto.getRandomValues()`. Ensure IDs are sufficiently long, unpredictable, and not exposed in logs or URLs.
- **Status:** Resolved · Responsible: Tony S. & Aliy U. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

---

## NibTera Askuala (SEC-090 – SEC-091)

#### SEC-090 — Sensitive Data Exposure / Cryptographic Secret Management (Risk: Critical)
- **Issue:** The JWT signing secret (`JwtSettings.Secret`) is hard-coded in the source code. If exposed, attackers can forge valid JWT tokens and impersonate any user, including administrative accounts.
- **Recommended solution:** Replace the hard-coded JWT secret with a strong, randomly generated key. Store it securely in environment variables or a secrets management system (e.g., HashiCorp Vault, AWS Secrets Manager).
- **Status:** Resolved · Responsible: Robel A. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026

#### SEC-091 — Authentication / Brute-Force Protection (Risk: High)
- **Issue:** Login and authentication endpoints do not enforce rate limiting or throttling, allowing unlimited login attempts. This exposes the system to brute-force and credential-stuffing attacks.
- **Recommended solution:** Implement rate limiting and throttling on all authentication endpoints. Consider additional protections such as account lockout after multiple failed attempts.
- **Status:** Resolved · Responsible: Robel A. · Target fix: 10/9/2026 · Verified by: Internal Security Testing Team · Verified: 10/9/2026
