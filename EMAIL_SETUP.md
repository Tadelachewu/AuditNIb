# Setting up email notifications

Every in-app notification (submit, district/HO review, reject, return,
rectification, transfer, period lock/unlock, rectification reminders — the
same list of events documented in `HOW_IT_WORKS.md`) can also send a real
email to the recipient. This isn't a separate feature to turn on per
trigger — it's automatic for every notification, once email sending is
configured, for any recipient who has an email address on their account.

Nothing is configured out of the box: a fresh install has `Provider: None`,
so no email ever leaves the server until an admin sets this up.

## What's needed

1. Each user needs an **email address**. Seeded/demo users already have one
   (`@nib-control360.local`). For real accounts: `/admin/users` → Add User
   or Edit → "Email" field, or a user can set their own from `/profile`.
2. **SMTP delivery** needs to be configured in two places:
   - **Settings UI** (`/admin/settings` → "Notification Delivery" card) —
     not secret, safe to edit through the app: Provider, From address, SMTP
     host, SMTP port.
   - **`.env.local`** (secret, never in the UI or committed to git, same
     convention as `IRON_SESSION_PASSWORD`) — `SMTP_USER` and
     `SMTP_PASSWORD`, the mailbox credentials.

Both are required together. If either is missing, email sending silently
no-ops (a console warning is logged, but the triggering action — e.g.
submitting a finding — still succeeds normally; a down or misconfigured
mail server can never block real work).

## Configure it

1. In `.env.local` (create it from `.env.example` if you haven't already),
   add:
   ```
   SMTP_USER=notifications@yourbank.example
   SMTP_PASSWORD=the-mailbox-password-or-app-password
   ```
   Restart `npm run dev` after editing `.env.local` — env vars are only
   read at process start.
2. In `/admin/settings` → Notification Delivery:
   - **Provider**: `SMTP relay`
   - **From address**: the address recipients will see as the sender —
     typically the same as `SMTP_USER`
   - **SMTP host** / **SMTP port**: your mail server's details (examples
     below)
   - Save.
3. Click **Send Test Email** (same card) — sends a test message to your
   own account's email address and reports success or the exact failure
   reason inline. This is the concrete way to confirm delivery actually
   works, not just that the form saved.

## Worked examples

### A bank/corporate SMTP relay (typical for production)

Ask IT for the internal mail relay's hostname and port, and a mailbox (or
service account) to send from. Commonly:

```
SMTP host: mail.yourbank.internal   (or smtp.yourbank.internal)
SMTP port: 587
SMTP_USER: notifications@yourbank.example
SMTP_PASSWORD: <mailbox password>
```

Internal relays often allow unauthenticated or IP-allowlisted sending on
port 25 with no `SMTP_USER`/`SMTP_PASSWORD` needed — if that's your setup,
ask IT whether the relay still requires a login; this app currently always
sends authenticated (both env vars are required for sending to proceed).

### Gmail (dev/test fallback only)

Useful for testing locally without access to a corporate relay. Requires a
Google Account with 2-Step Verification enabled and an
[App Password](https://myaccount.google.com/apppasswords) (not your normal
Gmail password — Google blocks plain-password SMTP login).

```
SMTP host: smtp.gmail.com
SMTP port: 465
SMTP_USER: youraddress@gmail.com
SMTP_PASSWORD: <16-character app password>
From address: youraddress@gmail.com
```

Not recommended for real production traffic (rate-limited, and mail from a
personal Gmail account can look suspicious to recipients) — use it only to
confirm the plumbing works end-to-end.

## Microsoft Graph / Outlook — not implemented yet

`Provider` also offers `Outlook / Graph API` in the dropdown, but selecting
it currently **no-ops** (a console warning is logged, no email sends). It
needs an Azure AD app registration and OAuth token flow, which is
materially more setup than SMTP and hasn't been built. Use `SMTP relay`
instead — most Exchange/Outlook environments also expose a standard SMTP
endpoint (ask IT; the port is usually `587`) that works fine with the
setup above.

## How it works, briefly

- `src/lib/mail.ts` builds a `nodemailer` SMTP transporter from the
  Settings above and sends the email. It's called from
  `src/lib/notifications.ts`, right next to where each in-app notification
  is created — every existing trigger gets email for free, with no changes
  needed per trigger.
- Sending is fire-and-forget: the in-app notification (bell icon) is always
  created first and is the source of truth; the email is a best-effort
  mirror of it and never blocks or fails the underlying action.
- A user with no email address on their account simply never receives
  email notifications — the in-app bell still works as before.
