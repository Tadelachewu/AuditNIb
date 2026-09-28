# Account Recovery — Admin Lockout Playbook

This document is the **single source of truth** for regaining access to
NIB Control360 when the normal self-service forgot-password flow is
**unusable** — most commonly the "sole admin dead-end":

1.  The admin (or another admin) set this account's password and flagged
    it as "temporary" → `mustChangePassword = true` + 24h TTL.
2.  The TTL elapsed before the user changed it via `/profile`.
3.  The login route now blocks with
    *"Temporary password has expired. Contact an administrator to reset it."*
    — and *you* are the only administrator.
4.  On top of that, the `email` column for this account is wrong / a
    placeholder / never set → the self-service `/forgot-password` flow
    matches the username but refuses to send anything (see
    "can't deliver to this address" guard), so no reset URL ever
    arrives.

In that state, the UI is intentionally unrecoverable — every door needs
something you don't have.  This document lists the DB/CLI escape hatches,
ordered from **fastest to run** to **most surgical / most disruptive**.

---

## 0. Prerequisites — what you need to pick a path

| Path | Required access |
|------|-----------------|
| 1. Direct SQL | Postgres credentials (`DATABASE_URL`), a client (psql, pgAdmin, DBeaver, Prisma Studio, etc.) |
| 2. One-off TS script | Shell on the app host + Node, write access to `prisma/`, valid `DATABASE_URL` / env. |
| 3. Emergency admin (new row) | Same as Path 2. |

Path 1 is almost always cheapest.  Paths 2 and 3 exist for teams where
only a deployment engineer can run arbitrary SQL and you (the admin
user) only have project shell + Node.

**Every path ends with the same 4 column writes on the user row:**

| Column (SQL)              | Set to                      | Why |
|---------------------------|-----------------------------|-----|
| `email`                   | A deliverable address       | Fixes the root of the forgot-password silence |
| `password_hash`           | Fresh bcrypt($2b$10$…)      | New known password |
| `must_change_password`    | FALSE                       | Escapes the forced-rotation trap |
| `password_expires_at`     | NULL                        | Removes the 24h TTL check |
| `session_version`         | `session_version + 1`       | Invalidates any stale cookie issued before recovery |
| `updated_at`              | NOW()                       | Standard touch |

### 0a. Hashing algorithm — so you know what "a hash" means

[auth.ts](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/auth.ts#L5-L11):

```ts
import bcrypt from "bcryptjs";
const SALT_ROUNDS = 10;
export function hashPassword(plain: string): string { return bcrypt.hashSync(plain, SALT_ROUNDS); }
export function verifyPassword(plain: string, hash: string): boolean { return bcrypt.compareSync(plain, hash); }
```

bcrypt, 10 rounds.  Hashes are portable — a hash produced on any machine
with the same algorithm and 10 rounds verifies everywhere.

**How to compute one on any machine that has Node + the project installed:**

```bash
node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" "MyNewStrongPass_47!"
# → prints something like:
#   $2b$10$rJ1x9KcL2p3Q4n5B7v8M9uO6iI5b4v3c2X1z0.aA9bB8c7dE6fG5h
```

If the server has no Node, run it on your laptop — same result.

**Schema → Postgres column map** (from [schema.prisma#L159-L209](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/prisma/schema.prisma#L159-L209)):

| Prisma field          | Postgres column        |
|-----------------------|------------------------|
| `User.passwordHash`   | `password_hash`        |
| `User.mustChangePassword` | `must_change_password` |
| `User.passwordExpiresAt`  | `password_expires_at`  |
| `User.sessionVersion` | `session_version`      |

---

## Path 1 — Direct SQL (recommended, ~2 min)

### Step 1. Locate the admin row

```sql
SELECT id, username, name, email, status, role,
       must_change_password, password_expires_at, session_version
FROM users
WHERE role = 'ADMIN'
ORDER BY created_at ASC;
```

You should see your admin account.  Copy its `id` and note the current
bad email.

### Step 2. Produce a new bcrypt hash

(see §0a above.)

### Step 3. UPDATE — 4 corrections atomically

```sql
UPDATE users
SET
  email                 = 'your-real-address@nibbank.com.et',
  password_hash         = '$2b$10$rJ1x9KcL2p3Q4n5B7v8M9uO6iI5b4v3c2X1z0.aA9bB8c7dE6fG5h',
  must_change_password  = FALSE,
  password_expires_at   = NULL,
  session_version       = session_version + 1,
  updated_at            = NOW()
WHERE id = 'user-admin';        -- ⚠ REPLACE WITH REAL id from step 1
```

**If you forget any of these:**

| Forgotten column     | Symptom after login attempt |
|----------------------|------------------------------|
| `must_change_password = FALSE` | Still get *"Temporary password has expired."* — re-run the update. |
| `password_expires_at = NULL`  | Same symptom.  Both must be cleared together because the login check is `(mustChangePassword && expiresAt < now)` — see [login/route.ts#L112-L117](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/auth/login/route.ts#L112-L117). |
| `session_version bump` | Any old session cookie the user may have saved in their browser still works — harmless, but the bump is cheap and strictly safer. |
| email fix | Next time you need forgot-password, it's still broken. |

### Step 4. Log in

```
username: <username from step 1>
password: MyNewStrongPass_47!
```

### Step 5. Immediately fix the root of the email problem

Once inside, go to **Admin → Users → your account → Edit** and make
sure the email shown is the one you just wrote.  If any other admin
account has the wrong email, fix them now.  Then go to **Settings →
Notifications → Test Email** and send a test message to confirm SMTP
can reach it.

---

## Path 2 — One-off TS script (if no SQL client, but Node works)

### Step 1. Create `prisma/recover-admin.ts`

```ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth";

const prisma = new PrismaClient();

async function main() {
  const [, , userId, newEmail, newPassword] = process.argv;
  if (!userId || !newEmail || !newPassword) {
    console.error(
      "Usage: npx tsx prisma/recover-admin.ts <userId> <newEmail> <newPassword>\n"
      + "Hint: find <userId> via: npx prisma studio"
    );
    process.exit(1);
  }
  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, email: true, role: true,
              mustChangePassword: true, passwordExpiresAt: true },
  });
  if (!before) { console.error("No user with id", userId); process.exit(2); }
  if (before.role !== "ADMIN") {
    console.warn(`Warning: user.role = ${before.role}, not ADMIN.`);
  }
  const result = await prisma.user.update({
    where: { id: userId },
    data: {
      email: newEmail,
      passwordHash: hashPassword(newPassword),
      mustChangePassword: false,
      passwordExpiresAt: null,
      sessionVersion: { increment: 1 },
    },
    select: { id: true, username: true, email: true, role: true },
  });
  console.log("Recovered:", result);
}

main().finally(() => prisma.$disconnect());
```

### Step 2. Run it

```bash
npx tsx prisma/recover-admin.ts user-admin you@nibbank.com.et "NewStrongPass_47!"
```

Same end state as Path 1 step 3.  This uses the project's real Prisma
client and real `hashPassword()` — no manual bcrypt invocation needed.

---

## Path 3 — Upsert a second (emergency) ADMIN

Use only when:
- the existing admin's `id` / `username` is unknown;
- OR the existing admin row has been corrupted in some other way
  (`status = INACTIVE`, etc.) and you just need *a* way in.

This creates (or reactivates) a second admin row, auditably distinct
from the real one — when you're back in you fix the original from
**Admin → Users** and disable the emergency account.

### Step 1. Create `prisma/emergency-admin.ts`

```ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth";
import { v4 as uuid } from "uuid";

const prisma = new PrismaClient();

async function main() {
  const [, , username, email, password] = process.argv;
  if (!username || !email || !password) {
    console.error(
      "Usage: npx tsx prisma/emergency-admin.ts <username> <email> <password>"
    );
    process.exit(1);
  }
  const now = new Date();
  const result = await prisma.user.upsert({
    where: { username },
    create: {
      id: uuid(),
      name: "Emergency Admin",
      username,
      email,
      phone: null,
      passwordHash: hashPassword(password),
      role: "ADMIN",
      status: "ACTIVE",
      districtId: null,
      branchId: null,
      departmentId: null,
      mustChangePassword: false,
      passwordExpiresAt: null,
      sessionVersion: 1,
      createdAt: now,
      updatedAt: now,
    },
    update: {
      name: "Emergency Admin",
      email,
      passwordHash: hashPassword(password),
      role: "ADMIN",
      status: "ACTIVE",
      districtId: null,
      branchId: null,
      departmentId: null,
      mustChangePassword: false,
      passwordExpiresAt: null,
      sessionVersion: { increment: 1 },
      updatedAt: now,
    },
    select: { id: true, username: true, email: true, role: true, status: true },
  });
  console.log("Done. Log in with:", result.username);
}

main().finally(() => prisma.$disconnect());
```

### Step 2. Run it

```bash
npx tsx prisma/emergency-admin.ts emergency-admin break-glass@nibbank.com.et "TempPass_47!"
```

### Step 3. Once you're logged in as emergency-admin

1.  **Admin → Users → original admin → Edit**
    - Correct the email.
    - Save.
2.  **Admin → Users → original admin → Reset Password**
    (the admin UI at [users/[id]/route.ts#L161-L174](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/admin/users/%5Bid%5D/route.ts#L161-L174)).
    - This re-sets `mustChangePassword = true` + 24h TTL, so the user
      has to log in right away and change it via `/profile` this time.
3.  **Disable the emergency account.**
    Admin → Users → emergency-admin → Edit → Status → INACTIVE.
    Keep it around, disabled, for the next time — re-enable via this
    same script (the `update` branch of upsert re-activates it).

---

## Why the self-service flow deliberately fails here

Two safety nets conspire to create the dead end.  **Neither is a bug —
both are defenses that are firing correctly.**  A recovery path via SQL
is intentionally the *only* way out.

### Net A — `/forgot-password` refuses to send when email is undeliverable

At [forgot-password/route.ts#L123-L128](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/auth/forgot-password/route.ts#L123-L128):

```ts
const hasUsableEmail = Boolean(user.email) && isValidEmailForSending(user.email);
if (!hasUsableEmail) {
  console.warn(`… User "${user.username}" matched but their email "${user.email}" is not deliverable. An admin must correct it in Admin -> Users.`);
  return NextResponse.json({ ok: true, smtpConfigured, … });
}
```

If we *didn't* have this check, an attacker could request a reset for
`admin` with a malformed email, watch the server error out (Nodemailer
rejects bad domains), and learn that `admin` exists via a different
response timing / error shape than a nonexistent username.  Returning
`ok: true` regardless is part of the username-enumeration defense — a
malicious client cannot tell "this user exists and the email was
garbage" from "I just sent a link to a valid address I don't own".

The cost of that defense: a legitimate admin with a garbage email gets
silence.  Which is why this recovery doc exists.

### Net B — Temporary passwords must expire

At [login/route.ts#L112-L117](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/auth/login/route.ts#L112-L117):

```ts
if (user.mustChangePassword && user.passwordExpiresAt && new Date(user.passwordExpiresAt).getTime() < Date.now()) {
  return NextResponse.json({ error: "Temporary password has expired. Contact an administrator to reset it." }, { status: 403 });
}
```

An admin-chosen password is not a *real* credential.  It's a shared
secret between the admin and the user that the admin still (in
theory) knows.  Allowing it to work forever would be the actual
vulnerability: a fired admin could quietly keep logging in as any
user whose password they set last year.  24h is long enough for the
"please go change this" email to be acted on; short enough to bound
the shared-secret risk.

---

## Prevention — make this recovery doc a "break glass, never used" thing

Three operational rules, all easy.

### Rule 1. Never be the sole active ADMIN

- Always create a second break-glass ADMIN account,
  `status = INACTIVE` + known-good email.
- When a recovery hits (once a year is optimistic), Path 3
  re-activates it in one command, you do your cleanup, you put it
  back INACTIVE.
- If you want to be really belt-and-suspenders, it can have a
  deliverable email address but 2FA disabled + its password on paper
  in a sealed envelope with CIO.

### Rule 2. Email must be verified into place

(This is not yet in the code today; treat it as a checklist for the
admin who's *editing* a user.)

- Before you ever click "Save" on a user row, send a **Settings →
  Test Email** to that new address and wait for it to arrive.  A
  non-deliverable email on an admin row *will* create this exact
  dead-end the next time you reset their password and the 24h TTL
  fires.

### Rule 3. The sole-active-admin anti-pattern

If a user is the **only active** `role = 'ADMIN'`, admin workflows
should prevent:
- setting `must_change_password = true` on that same user, and
- changing their email address to an unvalidated one (test-send first,
  apply second).

Without that guard it is trivially easy for an admin to type these
exact keystrokes: `reset my own password` → which forces rotation +
24h expiry → then forgets to log out and back in within 24h →
self-lockout.

---

## Quick-reference decision tree

```
Dead end (can't log in AND forgot-password emails never come)?
│
├─ Do you have Postgres access (DATABASE_URL + a client)?
│     ├─ YES → Path 1 (SQL UPDATE, ~2 min, recommended)
│     └─ NO  →
│           ├─ Know the admin user id/username? → Path 2 (recover-admin.ts)
│           └─ Don't know the id, or the row is bad? → Path 3 (emergency-admin.ts)
│
└─ Once logged back in:
      1. Fix the original admin's email immediately.
      2. Send a Settings → Test Email to confirm SMTP delivery.
      3. Consider a 2nd, INACTIVE break-glass admin.
```
