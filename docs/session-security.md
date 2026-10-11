# Session Security

How the sign-in session works, what happens if someone copies a session cookie, and the protections around it.

---

## 1. How the session works

There is no session table: the whole session lives in **one encrypted, signed cookie** (`nib_control360_session`, iron-session, keyed by `IRON_SESSION_PASSWORD`). The server decrypts it on every request and checks it against the database.

| Cookie property | Value |
|---|---|
| Encrypted and signed | The browser can't read or change it |
| `HttpOnly` | Page scripts can't read it |
| `Secure` | HTTPS only (`SESSION_COOKIE_SECURE=true` in production) |
| `SameSite=Lax` | Other sites can't make the browser send it on a forged change |
| Lifetime | The absolute timeout (8 hours by default) |

**Every request**

1. The proxy (`src/proxy.ts`) redirects to sign-in when there is no valid cookie or it has timed out, and checks the page permission.
2. `getCurrentUser()` (`src/lib/session.ts`) is the authority, used by every page and API route:
   - idle timeout (30 minutes without real activity) and absolute timeout (8 hours since sign-in);
   - **device binding** (§3);
   - one database lookup: the user and their role are active, and the cookie's **session version** equals the database's;
   - name, role, permissions, branch and district are refreshed from the database, so an admin's change applies on the next request.

**What ends a session:** sign-out; the idle or absolute timeout; a newer sign-in to the same account (one session per user); a password change or an admin's password reset; deactivating the user or their role; a different browser presenting the cookie; changing `IRON_SESSION_PASSWORD`.

## 2. If someone copies the cookie

A session cookie proves who you are: whoever holds a working copy acts as that user. They **cannot** read or edit it, give themselves more permissions, change the user's password (the current password is needed) or the user's email (admins only).

| Protection | Effect on a copied cookie |
|---|---|
| **Sign-out ends the session on the server** | A copy taken earlier stops working the moment the owner signs out |
| **Device binding** | A copy used from another browser is refused |
| **One session per user** | It dies when the owner signs in again |
| **Password change / admin reset / deactivation** | It dies at once |
| **Absolute timeout** | It never outlives 8 hours, whatever the thief does |
| **Password confirmation for high-risk actions** | A stolen admin session can't reset passwords, change roles or change Settings without the admin's password |
| **Sign-in notices** | The owner sees a sign-in that wasn't theirs |
| **Strict Content Security Policy** | An injected script can't run, so it can't act as the signed-in user |

## 3. Device binding

At sign-in the session records a fingerprint of the browser (its User-Agent) and, when known, the address. A request presenting the cookie from a different browser is refused, the attempt is logged (`session.binding_mismatch`), and that request is signed out. The owner's own browser keeps working.

| Setting (`.env`) | Default | Meaning |
|---|---|---|
| `SESSION_BIND_USER_AGENT` | `true` | Same browser required. A browser update changes the User-Agent, which simply means signing in again |
| `SESSION_BIND_IP` | `off` | `subnet`: same network (IPv4 /24, IPv6 /64). `exact`: same address. Off by default because addresses change legitimately (mobile data, VPN, DHCP). Needs `TRUST_PROXY=true` behind a reverse proxy; an unknown address is never treated as a mismatch |

This stops the common case and makes theft visible. It is not proof against an attacker who also copies the User-Agent; the other protections cover that.

## 4. Password confirmation for high-risk actions

These actions need the signed-in user's password to have been entered within the last **10 minutes** (at sign-in, or in the *Confirm your password* dialog):

| Action | Where |
|---|---|
| Reset a user's password, change a user's role, change a user's email | Users |
| Create, edit or delete a role (its permissions) | Roles & Permissions |
| Save Settings | Settings |

When it is needed the app shows **Confirm your password**; after confirming, the action continues by itself and nothing more is asked for 10 minutes. Wrong passwords are rate-limited and lock the check for 15 minutes after 5 failures, and are written to the audit log (`REAUTH_FAILED`).

`SESSION_REAUTH_MINUTES` sets the window (default 10; `0` switches the requirement off).

## 5. Sign-in notices

- **After signing in**, the "Signed in successfully." notice also shows the **previous sign-in** underneath: when, from which browser, and the address when known, with "Not you? Change your password." It is one notice, not two.
- **My Profile → Account** keeps it on view: *This sign-in* and *Previous sign-in* (time, browser, address).
- **When a newer sign-in ends a session**, the sign-in page says so, with the time: *"Your account was signed in from another browser or device at …, which ended this session. If that wasn't you, sign in and change your password immediately."* A timeout says *"Your session timed out."*
- Every sign-in is in the audit log (`LOGIN`) with the browser and address; sign-outs as `LOGOUT`.

## 6. Content Security Policy

Pages are served with a policy that carries a **one-time nonce per request**: only scripts with that nonce (the app's own, stamped by Next.js) run. `script-src` no longer allows `'unsafe-inline'` on pages. Styles still allow inline, because the UI library writes inline styles and a style can't run code.

- Set in `src/proxy.ts`; the root layout puts the nonce on its one inline script.
- `CSP_NONCE=false` switches back to the static policy in `next.config.ts` (which still covers API and static responses).
- In `next dev` the policy also allows `'unsafe-eval'` (needed by Fast Refresh); never in production.

## 7. If you suspect a stolen session

1. The user **signs out**, signs in again or **changes their password**: any of these ends every older session at once.
2. For someone else's account, an admin **resets the password** or **deactivates** the user.
3. Check **Admin → Audit Log** for that user's `LOGIN` entries (browser, address) and actions, and the server log for `session.binding_mismatch`.
4. If the server secret may have leaked, change `IRON_SESSION_PASSWORD`: everyone is signed out.

## 8. What is still not covered

| Gap | Note |
|---|---|
| Malware or a malicious browser extension on the user's PC | It acts inside the real browser; no web app can fully prevent this |
| A thief who also copies the User-Agent and stays active | Limited to the 8-hour absolute timeout, and ended by the owner's sign-out or next sign-in |
| No second factor | Two-step sign-in for Administrator / HO roles would be the strongest addition |
| One session per user | The same account can't be used in two browsers at once (by design) |

## 9. Settings summary (`.env`)

| Variable | Default | |
|---|---|---|
| `SESSION_IDLE_TIMEOUT_MINUTES` | 30 | Signed out after this long without activity |
| `SESSION_ABSOLUTE_TIMEOUT_HOURS` | 8 | Signed out this long after sign-in, whatever the activity |
| `SESSION_COOKIE_SECURE` | `true` in production | HTTPS-only cookie |
| `SESSION_BIND_USER_AGENT` | `true` | §3 |
| `SESSION_BIND_IP` | `off` | §3 |
| `SESSION_REAUTH_MINUTES` | 10 | §4 |
| `CSP_NONCE` | `true` | §6 |

## 10. Code

| Part | File |
|---|---|
| Session, timeouts, database checks, binding check | `src/lib/session.ts` |
| Device binding rules | `src/lib/sessionBinding.ts` |
| Password confirmation: rule, endpoint, dialog | `src/lib/reauth.ts`, `src/app/api/auth/reauth/route.ts`, `src/components/auth/ReauthPrompt.tsx`, `src/lib/api-client.ts` |
| Sign-in (binding, previous sign-in), sign-out (server-side), why a session ended | `src/app/api/auth/login`, `logout`, `session-ended` |
| Page gate, cross-site check, Content Security Policy nonce | `src/proxy.ts` |
| Tests | `tests/sessionSecurity.test.ts`, `tests/sessionTimeout.test.ts` |

## 11. Test cases

| # | Steps | Expected |
|---|---|---|
| S1 | Sign in; copy the session cookie into another browser | The other browser is sent to sign-in; yours keeps working |
| S2 | Copy the cookie into a second profile of the **same** browser, then **sign out** in the first | The copy stops working on its next request |
| S3 | Sign in on a second device | The first shows *"signed in from another browser or device at …"* |
| S4 | Sign in again | One notice: "Signed in successfully." with *Previous sign-in: time, browser* underneath. My Profile → Account shows *This sign-in* and *Previous sign-in* |
| S5 | As admin, wait 10+ minutes, then reset a user's password | *Confirm your password* appears; after confirming, the reset goes through |
| S6 | In that dialog enter a wrong password 5 times | Locked for 15 minutes; `REAUTH_FAILED` in the audit log |
| S7 | As admin, right after signing in, save Settings | No dialog (the password was just entered) |
| S8 | Open any page, view the response headers | `Content-Security-Policy` has `script-src 'self' 'nonce-…' 'strict-dynamic'` and no `'unsafe-inline'`; the page works, theme and sidebar state apply without a flash |
| S9 | Leave the app idle 30+ minutes | *"Your session timed out."* |
