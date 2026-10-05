# Forgot Password — Rules

How a user who forgot their password sets a new one, and every rule along the way.
For the full technical reference (code locations, response shapes, rate-limit keys) see
[login-and-password.md](login-and-password.md) §2–3.

---

## 1. Requesting a reset link

**Sign in page → Forgot password**

| Rule | Detail |
|---|---|
| What to enter | Your **username or email**, either one, any letter case |
| Which accounts | **Active accounts only.** A deactivated user gets no link |
| The answer | Always the same: *"If an active account matches that username or email, a password reset link has been sent."* It doesn't reveal whether the account exists, so the page can't be used to find out who is registered |
| Limit per computer | **5 requests per 15 minutes** from one IP address |
| Limit per account | **3 requests per hour** for the same username or email |
| Over a limit | *"Too many requests…"* - wait and try again |
| Only the newest link works | Requesting a new link cancels any earlier, unused link for that user |
| Where it goes | The user's email address on file, sent with the same SMTP settings as notifications (Admin → Settings → Notification Delivery) |
| If sending fails | The page says to ask the administrator to check Notification Delivery |
| Audit log | Recorded as `PASSWORD_RESET_REQUESTED` |

## 2. The link

- Valid for **30 minutes**.
- Can be used **only once**.
- Random and unguessable (32 random bytes).
- Built from the address the site was opened on (e.g. `http://localhost:9005`, or the public address behind a proxy). A link requested on `localhost` only opens on that same machine.

## 3. Setting the new password

The new password must have:

- at least **8 characters**
- a **lowercase** letter
- an **uppercase** letter
- a **number**
- a **special character** (e.g. `@ # $ !`)

It must also **not be a commonly used password**, and **not appear in a known data breach** (checked against a breach database).

| Rule | Detail |
|---|---|
| Attempts | **10 per 15 minutes** per link |
| Expired, already used or unknown link | *"This password reset link is invalid or has expired. Request a new one."* |
| User deactivated after requesting | Refused: *"Account not found or deactivated"* |

## 4. After a successful reset

- The password is changed and the link is used up.
- **Every open session of that user is signed out**, on every device (they see *"Your session ended…"* there).
- Any "must change password" requirement (e.g. from an admin-set temporary password) is cleared.
- Recorded in the audit log as `PASSWORD_RESET`.
- The user signs in with the new password.

## 5. Good to know

- The new password **may be the same as the old one**; this isn't checked.
- If email delivery isn't set up (provider **None**, or SMTP details missing), no email can go out. An administrator can instead reset the password from **Admin → Users** (a temporary password valid for 24 hours, which the user must change at first sign-in).
- An admin reset or a user's own password change signs out that user's other sessions too.

## 6. Manual test cases

| # | Steps | Expected |
|---|---|---|
| F1 | Request a link with a valid username | Same success message; email arrives with a "Reset my password" button |
| F2 | Request with the email address instead | Same as F1 |
| F3 | Request with an unknown username | Same success message; no email |
| F4 | Request for a deactivated user | Same success message; no email |
| F5 | Request 4 times in an hour for one account | 4th: *"Too many requests for this address…"* |
| F6 | Request twice, use the **first** link | *"…invalid or has expired…"* |
| F7 | Use a link after 30 minutes | *"…invalid or has expired…"* |
| F8 | Use a link twice | Second time: *"…invalid or has expired…"* |
| F9 | Set a weak password (e.g. `password1`) | Refused with the rule it breaks |
| F10 | Set a valid password | Success; sign in works with the new password |
| F11 | Be signed in on another browser, then reset | The other browser shows *"Your session ended…"* on the next click |
