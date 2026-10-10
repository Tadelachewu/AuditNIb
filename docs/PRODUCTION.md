# Running NIB Control360 in Production

A step-by-step runbook for running this app **safely** on a server with real bank data: what to install, how to configure it, how to start it as a service behind HTTPS, how to update it, and a go-live checklist.

> **Golden rules**
> 1. Only a **built** app (`npm run build` + `npm start`), never `npm run dev`.
> 2. `APP_ENV=production`.
> 3. **HTTPS only**, through a reverse proxy. The app itself listens on `127.0.0.1` only.
> 4. **Fresh secrets** generated on the production server, never copied from a developer's `.env`.
> 5. `npx prisma migrate deploy` for database changes. **Never** `migrate dev` or `migrate reset`. The migration history was restarted on 2026-10-06 (`0_init` baseline); an existing database adopts it once as described in [database-migrations.md](database-migrations.md) §4.
> 6. Back up the **database**, the **storage folder**, and the **file encryption key**.

---

## 1. How it fits together

```
 Users (browser)
      │  HTTPS :443 only
      ▼
┌─────────────────────┐      ┌──────────────────────────────┐
│ Reverse proxy       │ ───▶ │ NIB Control360 (Node.js)     │
│ Nginx / IIS         │ HTTP │ npm start on 127.0.0.1:9005   │
│ TLS certificate     │      │ runs as a low-privilege user │
└─────────────────────┘      └───┬─────────┬─────────┬──────┘
                                 │         │         │
                          PostgreSQL     Redis    storage/ folder
                          (all data)   (rate limit, (encrypted uploads)
                                        drafts)
   Outbound only: SMTP server (email) · api.pwnedpasswords.com (breached-password check)
```

| Component | Why it's needed |
|---|---|
| **PostgreSQL** | All application data. |
| **Redis** (or Memurai on Windows) | Login lockout and rate limits, upload rate limits, and Register Finding draft recovery. **Needed in production**: if Redis is down, rate limiting and lockout silently turn **off**, because they're designed not to block logins. With the optional BullMQ email driver it also dispatches notification emails, and must then be durable (§6.3). |
| **Storage folder** | Evidence and import files, encrypted ([files.md](files.md)). |
| **Reverse proxy** | HTTPS certificate, the only public entry point, security headers, upload size limit. |
| **SMTP** *(optional)* | Notification and password-reset emails ([EMAIL_SETUP.md](EMAIL_SETUP.md)). Notification emails are queued in the database and delivered with retries ([email-queue.md](email-queue.md)). |

---

## 2. Server prerequisites

| Item | Version / note |
|---|---|
| **Node.js** | **22 LTS** (20.9 or newer is the minimum for Next.js 16). Use the same major version on every server. |
| **PostgreSQL** | 14 or newer. Can be on the same server or a separate database server. |
| **Redis** | 6 or newer. On Windows use **Memurai**. **Set a password** (`requirepass`) and bind it to localhost or a private network. |
| **Reverse proxy** | Nginx (Linux), or IIS with URL Rewrite + Application Request Routing (Windows). |
| **TLS certificate** | From the bank's CA, or Let's Encrypt for internet-facing hosts. |
| **Git** | To fetch releases. |
| **Service manager** | `systemd` (Linux) or **NSSM** (Windows) to run the app as a service. |

**Accounts:** create a dedicated OS account (for example `nibapp`) with **no admin rights**. It runs the app and owns the app folder and storage folder.

**Firewall:** open **443** (and 80 only to redirect to 443) to users. Keep the app port (9005), PostgreSQL (5432) and Redis (6379) **closed** to the network. Only the reverse proxy talks to the app, and only the app talks to the database and Redis.

---

## 3. Get the code

```bash
# as the app account, in the install folder (e.g. /opt/nib-control360 or D:\apps\nib-control360)
git clone <repository-url> nib-control360
cd nib-control360
git checkout <release tag or commit>     # deploy a known version, not "whatever is on main"
```

Before each deployment, check that the release commit contains **every** file it needs: `git status` on the developer machine must show nothing staged or uncommitted. A `package.json` that refers to a file that wasn't committed breaks `npm start`; this has happened before with `scripts/run.mjs`.

---

## 4. Configure `.env` (production)

Create `.env` in the app folder **on the server**. Start from `.env.example`, and **never copy a developer's `.env`**: it contains development settings and keys.

### 4.1 Generate the secrets (once, on the server)

```bash
# Session cookie encryption (IRON_SESSION_PASSWORD) - 48+ random characters
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# File encryption key (FILE_ENCRYPTION_KEY) - exactly 32 bytes, base64
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 4.2 The production `.env`

```ini
# --- Environment ---
APP_ENV=production                 # disables /dev-reset and the login page's demo accounts
PORT=9005
HOST=127.0.0.1                     # only the reverse proxy on this machine can reach the app

# --- Secrets (generated above; never commit, never reuse from dev) ---
IRON_SESSION_PASSWORD=<48+ random characters>
FILE_ENCRYPTION_KEY=<32-byte base64 key>

# --- Database: a dedicated app user, not the postgres superuser ---
DATABASE_URL=postgresql://nib_app:<strong password>@localhost:5432/auditapp?schema=public

# --- Redis, with a password ---
REDIS_URL=redis://:<redis password>@localhost:6379

# --- Sessions ---
SESSION_COOKIE_SECURE=true         # cookie only ever sent over HTTPS
SESSION_IDLE_TIMEOUT_MINUTES=30
SESSION_ABSOLUTE_TIMEOUT_HOURS=8

# --- Public address (used in email links) ---
APP_BASE_URL=https://control360.nibbank.com.et

# --- Uploads ---
STORAGE_DIR=/var/lib/nib-control360/storage     # or D:\nib-storage on Windows; outside the app folder

# --- Email (only if Settings > Notification Delivery uses SMTP) ---
SMTP_USER=
SMTP_PASSWORD=

# --- Email queue (optional; defaults shown - see §6.3 and email-queue.md) ---
# EMAIL_QUEUE_DRIVER=postgres        # or bullmq (Redis dispatches)
# EMAIL_WORKER=inprocess             # or external (run `npm run worker:email` as a service)
```

| Setting | Rule |
|---|---|
| `APP_ENV` | **Must be `production`.** Anything else except `development` also counts as production, but be explicit. |
| `HOST` | `127.0.0.1` when the reverse proxy is on the same machine. Use the server's private IP only if the proxy is on another machine, and then firewall the port to the proxy's address. |
| `IRON_SESSION_PASSWORD` | 32+ random characters. Changing it signs everyone out, so rotate it only if it may have leaked. |
| `FILE_ENCRYPTION_KEY` | **Never change it once files exist**, or they become unreadable. Back it up separately (§8). |
| `DATABASE_URL` | A dedicated database user that owns only this database. |
| `SESSION_COOKIE_SECURE` | **Must be `true`.** |
| `STORAGE_DIR` | Keep it outside the app folder, so redeploying the code never touches uploads. |

**Protect the file:** only the app account (and administrators) should be able to read `.env`.
- Linux: `chmod 600 .env && chown nibapp .env`
- Windows: remove *Users* from the file's permissions, and grant read access only to the app account and Administrators.

---

## 5. Prepare the database

```sql
-- as the postgres superuser, once
CREATE USER nib_app WITH PASSWORD '<strong password>';
CREATE DATABASE auditapp OWNER nib_app;
```

```bash
# in the app folder, as the app account
npm ci                          # exact dependency versions from package-lock.json (also runs prisma generate)
npx prisma migrate deploy       # applies pending migrations - safe, never deletes data
```

**First install only**, on an **empty** database:

```bash
npx prisma db seed
```

- The seed creates the base setup: roles, org structure, settings and **one account per role**.
- The seed accounts have **published passwords**. With `APP_ENV=production` the seed marks every seeded account **"must change password"**, so each one can only reach its Profile page until it sets its own password.
- **Straight after seeding:**
  1. Sign in as `admin` and **set a new strong password**.
  2. Create the **real users** (Admin → Users) with their real emails.
  3. **Deactivate** the other demo accounts (`ho.controller`, `district.controller`, …) unless they have become real people's accounts with new passwords.
  4. Review **Roles & Permissions** and **Settings**.

> **Never run** `npx prisma migrate dev`, `npx prisma migrate reset` or `npx prisma db push` on production. They can drop or rewrite data. Only `migrate deploy`.

---

## 6. Build and start

```bash
npm run build          # production build (webpack)
npm start              # runs `next start` on PORT/HOST from .env (scripts/run.mjs)
```

The startup line should read:

```
> next start -p 9005 -H 127.0.0.1   (PORT=9005, HOST=127.0.0.1)
```

Stop it once it works, then run it as a **service** so it starts on boot and restarts after a crash.

### 6.1 Linux: systemd

`/etc/systemd/system/nib-control360.service`

```ini
[Unit]
Description=NIB Control360
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=nibapp
WorkingDirectory=/opt/nib-control360
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5
# hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/opt/nib-control360 /var/lib/nib-control360/storage

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nib-control360
sudo systemctl status nib-control360
journalctl -u nib-control360 -f        # logs
```

### 6.2 Windows: NSSM service

```powershell
nssm install NIBControl360 "C:\Program Files\nodejs\npm.cmd" start
nssm set NIBControl360 AppDirectory D:\apps\nib-control360
nssm set NIBControl360 ObjectName .\nibapp <password>       # run as the low-privilege account
nssm set NIBControl360 AppStdout D:\apps\logs\nib-control360.log
nssm set NIBControl360 AppStderr D:\apps\logs\nib-control360.err.log
nssm set NIBControl360 AppRotateFiles 1
nssm set NIBControl360 AppRotateBytes 10485760
nssm set NIBControl360 Start SERVICE_AUTO_START
nssm start NIBControl360
```

### 6.3 Email queue and worker

Notification emails are saved in the database with the action that caused them and delivered by a worker with retries ([email-queue.md](email-queue.md)). **The default needs no setup:** the app delivers them itself.

| Choice | `.env` | Extra to run | Use when |
|---|---|---|---|
| **Built-in worker** (default) | nothing | nothing | Normal use |
| **Separate worker process** | `EMAIL_WORKER=external` | `npm run worker:email` as a service | Mail delivery should be isolated from the web process |
| **BullMQ on Redis** | `EMAIL_QUEUE_DRIVER=bullmq` (usually with `EMAIL_WORKER=external`) | `npm run worker:email` as a service; durable Redis (below) | Several worker machines, or the same queue infrastructure for other background jobs |

**Worker as a service**

Linux (`/etc/systemd/system/nib-control360-email.service`):

```ini
[Unit]
Description=NIB Control360 email worker
After=network.target postgresql.service redis.service

[Service]
WorkingDirectory=/opt/nib-control360
ExecStart=/usr/bin/npm run worker:email
User=nibapp
Restart=always
RestartSec=5
# Finishes the sends in progress before exiting.
KillSignal=SIGTERM
TimeoutStopSec=60

[Install]
WantedBy=multi-user.target
```

Windows:

```powershell
nssm install NIBControl360Email "C:\Program Files\nodejs\npm.cmd" run worker:email
nssm set NIBControl360Email AppDirectory D:\apps\nib-control360
nssm set NIBControl360Email ObjectName .\nibapp <password>
nssm set NIBControl360Email AppStdout D:\apps\logs\nib-control360-email.log
nssm set NIBControl360Email AppStderr D:\apps\logs\nib-control360-email.err.log
nssm set NIBControl360Email AppRotateFiles 1
nssm set NIBControl360Email Start SERVICE_AUTO_START
nssm start NIBControl360Email
```

The worker reads the same `.env` as the app. Several workers may run at once; each email is taken by exactly one.

**Redis for BullMQ** (only when `EMAIL_QUEUE_DRIVER=bullmq`)

| Setting | Value | Check |
|---|---|---|
| `maxmemory-policy` | `noeviction` | `redis-cli CONFIG GET maxmemory-policy` |
| `appendonly` | `yes` | `redis-cli CONFIG GET appendonly` |

Without AOF a Redis restart empties the queue. The emails are not lost (the database recovers them within about two minutes), but run Redis durably so that is the exception. If Redis is down, emails are delivered by the built-in worker until it returns.

**After go-live:** Admin → Settings → **Email Queue** shows waiting / sent / failed emails and lets an admin pause, resume and retry.

---

## 7. Reverse proxy and HTTPS

The proxy must terminate TLS, forward to `127.0.0.1:9005`, and **pass the original host and scheme**. Without those headers, every form submit is rejected as cross-site (403), and password-reset emails link to `http://localhost:9005` instead of the public address ([LOGIN_SECURITY_RULES.md §6d](LOGIN_SECURITY_RULES.md)).

### 7.1 Nginx

```nginx
server {
    listen 80;
    server_name control360.nibbank.com.et;
    return 301 https://$host$request_uri;          # HTTP -> HTTPS
}

server {
    listen 443 ssl http2;
    server_name control360.nibbank.com.et;

    ssl_certificate     /etc/ssl/nib/control360.crt;
    ssl_certificate_key /etc/ssl/nib/control360.key;
    ssl_protocols       TLSv1.2 TLSv1.3;

    client_max_body_size 12m;                      # 10 MB upload limit + form overhead
    server_tokens off;

    location / {
        proxy_pass http://127.0.0.1:9005;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;              # REQUIRED
        proxy_set_header X-Forwarded-Host  $host;              # REQUIRED
        proxy_set_header X-Forwarded-Proto https;              # REQUIRED
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_read_timeout 120s;                               # large imports / exports
    }
}
```

### 7.2 IIS (Windows)

1. Install **URL Rewrite** and **Application Request Routing (ARR)**. In ARR → *Server Proxy Settings*, tick **Enable proxy**.
2. Create an HTTPS site bound to the certificate, with a rule that rewrites `(.*)` to `http://127.0.0.1:9005/{R:1}`.
3. Set the server variables: `HTTP_X_FORWARDED_PROTO` = `https` and `HTTP_X_FORWARDED_HOST` = `{HTTP_HOST}`. Turn **off** ARR's *Reverse rewrite host in response headers*, so the original Host is kept.
4. Request Filtering → *Maximum allowed content length*: `12582912` (12 MB).
5. Add an HTTP → HTTPS redirect rule on the port-80 binding.

### 7.3 What the app already sends

Every response already includes a strict **Content-Security-Policy**, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` and **HSTS** (`next.config.ts`). The `X-Powered-By` header is off. The proxy doesn't need to add these, but mustn't strip them.

---

## 8. Backups

Back up **four** things. Without all four, a restore is incomplete.

| What | How | How often |
|---|---|---|
| **Database** | `pg_dump -Fc -U nib_app auditapp > auditapp-YYYYMMDD.dump` | Daily, and **before every update** |
| **Storage folder** (`STORAGE_DIR`) | File-level copy or snapshot, taken together with the database dump | Daily |
| **`FILE_ENCRYPTION_KEY`** | In a password manager or vault, **separate** from the file backups | Once, and after any change |
| **`.env`** (the rest) | In the vault, with the key | After any change |

- **Test a restore** into a separate test server at least once before go-live and periodically after. That test server must use `APP_ENV=development` only if its data is a disposable copy.
- Keep backups encrypted, and off the app server.

---

## 9. Updating to a new version

```bash
# 1. back up first (§8)
pg_dump -Fc -U nib_app auditapp > before-update-$(date +%F).dump

# 2. fetch the release
git fetch && git checkout <new release tag>

# 3. install, migrate, build
npm ci
npx prisma migrate deploy
npm run build

# 4. restart the service
sudo systemctl restart nib-control360          # or: nssm restart NIBControl360
# ... and the email worker, if you run one (§6.3)
sudo systemctl restart nib-control360-email    # or: nssm restart NIBControl360Email
```

- **If the release notes mention storage changes,** run `npm run storage:migrate` once ([files.md](files.md)).
- **Check** the app loads and you can sign in, then check today's Admin → Audit Log.
- **Rollback:** check out the previous tag, run `npm ci && npm run build`, and restart. If that release's migration changed the database, restore the pre-update dump.

---

## 10. Go-live security checklist

**Configuration**
- [ ] `APP_ENV=production`: the login page shows **no** "Demo accounts" panel, and `/dev-reset` says the tool is turned off
- [ ] `SESSION_COOKIE_SECURE=true`
- [ ] `IRON_SESSION_PASSWORD` and `FILE_ENCRYPTION_KEY` freshly generated on this server, and the key backed up in the vault
- [ ] `HOST=127.0.0.1` (or firewalled so only the proxy can reach the app port)
- [ ] `.env` readable only by the app account
- [ ] `APP_BASE_URL` set to the public `https://` address

**Network**
- [ ] Only 443 (and 80 → 443) reachable from users; 9005, 5432 and 6379 closed
- [ ] HTTPS certificate valid; HTTP redirects to HTTPS
- [ ] Proxy passes `Host`, `X-Forwarded-Host` and `X-Forwarded-Proto` (test: saving any form works, and a password-reset email links to the `https://` address)
- [ ] Redis has a password and isn't reachable from the network
- [ ] The **tunnel scripts** (`npm run tunnel*`) are never used on this server

**Accounts and data**
- [ ] `admin` password changed; real users created; unused demo accounts deactivated
- [ ] Every user has a real, deliverable email (needed for password reset)
- [ ] Roles & Permissions reviewed; only real administrators hold the Administrator role
- [ ] Settings → Notification Delivery configured, and **Send Test Email** works
- [ ] Settings → **Email Queue** shows no "isn't installed" message, and a real notification (e.g. submit a finding) moves *Sent today* up

**Operations**
- [ ] Runs as a service under a low-privilege account and restarts after a reboot
- [ ] Backups of the database, storage and key scheduled, and **one restore tested**
- [ ] Log files rotated (NSSM `AppRotate*` or `journald`)
- [ ] Redis monitored: if it stops, login lockout and rate limits stop too
- [ ] Email queue watched: *Failed* near zero and nothing *Waiting* for long (Settings → Email Queue)
- [ ] If `EMAIL_WORKER=external`: the email worker service runs and restarts after a reboot
- [ ] If `EMAIL_QUEUE_DRIVER=bullmq`: Redis has `maxmemory-policy noeviction` and `appendonly yes`

*Optional:* to ship without the reset tool at all, delete the three files listed in [reset-data.md §6](reset-data.md). `APP_ENV=production` already disables it.

---

## 11. Never do on production

| Don't | Because |
|---|---|
| `npm run dev` | A development server: slower, verbose errors, dev-only features, relaxed security settings. |
| `npx prisma migrate dev` / `migrate reset` / `db push` | Can drop or rewrite data. Use `migrate deploy`. |
| `APP_ENV=development` | Enables the reset tool and shows demo passwords on the login page. |
| Copying a developer's `.env` | Wrong keys, development settings, and secrets that have already been shared. |
| Changing `FILE_ENCRYPTION_KEY` | Every stored file becomes unreadable. |
| `npm run tunnel` / `tunnel:cloudflare` | Publishes the server through a third-party tunnel, bypassing the proxy, TLS and firewall. |
| Opening port 9005 to the network | Bypasses HTTPS and the proxy. |
| Running as Administrator / root | A compromise of the app would then own the whole server. |

---

## 12. Related documents

| Topic | Document |
|---|---|
| Uploaded files, encryption, backups of files | [files.md](files.md) |
| Email queue, worker, BullMQ driver | [email-queue.md](email-queue.md) |
| Email setup (SMTP) | [EMAIL_SETUP.md](EMAIL_SETUP.md) |
| Evidence upload rules | [EVIDENCE_VALIDATION_RULES.md](../EVIDENCE_VALIDATION_RULES.md) |
| Import rules | [IMPORT_VALIDATION_RULES.md](../IMPORT_VALIDATION_RULES.md) |
| Login, sessions, lockout, password reset | [LOGIN_SECURITY_RULES.md](LOGIN_SECURITY_RULES.md) |
| Email delivery | [EMAIL_SETUP.md](EMAIL_SETUP.md) |
| Reset tool and `APP_ENV` | [reset-data.md](reset-data.md) |
| Who receives which notification | [notifications.md](notifications.md) |
