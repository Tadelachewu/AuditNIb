# Password Change — When, Rules, and Link Validity

When NIB Control360 makes a user change their password, the rules every new
password must meet, and how long each temporary password or link stays valid.

- How a forgotten password is reset, step by step: [forgot-password.md](forgot-password.md).
- The full technical reference (code locations, rate-limit keys, response shapes): [login-and-password.md](login-and-password.md).

---

## 1. When the system sends you to Change Password

After signing in, the user lands on **My Profile → Change Password** (the section opens by
itself, with the notice *"A password change is required before you can continue."*). Every
other page sends them back there until the password is changed. They can't skip it.

| # | Case | Why | Where it's set |
|---|---|---|---|
| 1 | **An administrator created the account** (Admin → Users → Add User) | The admin chose the first password, so only the user should know the real one | `POST /api/admin/users` |
| 2 | **An administrator reset the password** (Admin → Users → Edit User → new password) | Same reason. The reset also **signs the user out on every device** | `PATCH /api/admin/users/[id]` |
| 3 | **Signed in with a demo password** (`Admin@123`, `Ho@12345`, `District@123`, `Director@123`, `Branch@123`, `Manager@123`, `Executive@123`) | Those passwords are published in the docs | `POST /api/auth/login` |

Notes:

- **Case 3 applies only when the app runs in production mode** (`NODE_ENV=production`, which
  `next build` / `next start` set by themselves). If `.env` sets `NODE_ENV=development`,
  remove that line, or the demo-password rule (and other production protections) stay off on
  the server.
- **There is no periodic expiry.** A password is never forced to change because it is old
  (for example every 90 days). Only the three cases above trigger it.
- The block applies to **pages only**. Behind the scenes the API still answers, but the user
  can't navigate anywhere except My Profile (`src/proxy.ts`).

### The administrator's temporary password: 24 hours

In cases 1 and 2 the password the admin set is valid for **24 hours** from when it was set.

| Within 24 hours | After 24 hours |
|---|---|
| The user signs in with it and is sent to Change Password | Sign-in is refused: *"Temporary password has expired. Contact an administrator to reset it."* An administrator sets a new temporary password (another 24 hours) |

The 24 hours restart every time an administrator sets a new password.

### Before the forced change can be saved

The account must have an **email address** on file. Without one the change is refused
(*"Set your email address first…"*), because a future forgotten password could only be
reset by email.

---

## 2. Rules for every new password

The same rules apply everywhere a password is set: **Change Password**, **Reset Password**,
**Add User** and **Edit User** (admin), and **Import CSV (users)**. A live checklist under
the field ticks each rule as it is met; the button stays disabled until all are met and the
confirmation matches.

| # | Rule | Message when broken |
|---|---|---|
| 1 | At least **8 characters** | *Password must be at least 8 characters* |
| 2 | A **lowercase** letter | *Password must include a lowercase letter* |
| 3 | An **uppercase** letter | *Password must include an uppercase letter* |
| 4 | A **number** | *Password must include a number* |
| 5 | A **special character** (e.g. @ # $ !) | *Password must include a special character* |
| 6 | Not a **commonly used password** (a built-in list of about 90, e.g. `password123`, `Welcome1`, `changeme123`, and the demo passwords) | *This password is too common - choose something less predictable* |
| 7 | Not found in a **known data breach** (checked on the server only, see below) | *This password has appeared in a known data breach - choose a different one* |
| 8 | **Different from the current password** | *Choose a password different from your current one.* |

**Rule 7, the breach check:** the server checks the password against the *Have I Been Pwned*
database without ever sending the password itself (only the first 5 characters of its SHA-1
fingerprint leave the server; the match is done locally). If the service can't be reached
within **3 seconds**, this check is skipped, so an outage never blocks a password change.
Rules 1–6 are always enforced.

The rules live in one place, `src/lib/passwordValidation.ts`, used by both the server and
the forms, so a form never accepts what the server would reject.

---

## 3. Change Password (My Profile)

**My Profile → Change Password**, or the account menu (top right) → **Change Password**.

| Rule | Detail |
|---|---|
| Fields | **Current password**, **New password**, **Confirm new password**, each with a show / hide (eye) button |
| Current password | Must be correct |
| Wrong current password | **5 wrong tries in 15 minutes locks Change Password for 15 minutes** |
| New password | All the rules in §2 |
| After the change | Every **other** session of the account is signed out; the current one stays signed in. A forced change (§1) is cleared and the user can use the app |
| Audit log | Recorded as `CHANGE_PASSWORD` (never the password itself) |

---

## 4. Reset link (Forgot password): validity

Full steps and messages: [forgot-password.md](forgot-password.md).

| Rule | Detail |
|---|---|
| Valid for | **30 minutes** from when it was requested |
| Uses | **Once.** After the new password is set the link no longer works |
| Several requests | **Only the newest link works.** Requesting a new one cancels any earlier, unused link |
| Requests allowed | **3 per hour** for the same username or email; **5 per 15 minutes** from one device (IP address). Beyond that: *"Too many requests… try again later"* |
| Expired, used or replaced link | *"This password reset link is invalid or has expired. Request a new one."* |
| Account deactivated after the link was sent | The link no longer works (*"Account not found or deactivated"*) |
| New password | All the rules in §2; the page has show / hide (eye) buttons on both fields |
| After the reset | Every session of the account is signed out, and a forced change (§1) is cleared. The user is **not** signed in automatically: they sign in with the new password |
| Privacy | The page gives the same answer whether or not the account exists, and the link goes only to the email address on file |
| Storage | Only a SHA-256 fingerprint of the link's token is stored, never the token itself |

---

## 5. All the time limits at a glance

| What | Limit |
|---|---|
| Administrator's temporary password | **24 hours** |
| Reset link | **30 minutes**, single use |
| Reset link requests | 3 per hour per account; 5 per 15 minutes per device |
| Wrong current password (Change Password) | 5 in 15 minutes → locked **15 minutes** |
| Wrong password at sign-in | 5 in 15 minutes → account locked **15 minutes** (see [login-and-password.md](login-and-password.md) §1.3) |
| Breach check | skipped if no answer within **3 seconds** |
| Periodic password expiry | **none** |
