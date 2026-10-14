# Backup and Restore

How to back up NIB Control360 and bring it back after a failure, a bad update or a lost server. For the rest of running the app in production, see [PRODUCTION.md](PRODUCTION.md).

Commands are given for **Windows** (PowerShell) first, with the **Linux** equivalent where it differs. Replace the example names (`auditapp`, `nib_app`, `D:\nib-storage`, `D:\backups`) with your own.

---

## 1. What to back up

A restore is only complete with **all four** of these:

| # | What | Where it is | Why it matters |
|---|---|---|---|
| 1 | **PostgreSQL database** | The database in `DATABASE_URL` | Everything except the files: users, roles, findings, periods, settings, audit log, notifications, the email outbox, automatic-transfer and reminder run records |
| 2 | **Storage folder** | `STORAGE_DIR` in `.env` (default: `storage\` in the app folder) | Evidence, comment attachments and import originals, **encrypted** ([files.md](files.md)) |
| 3 | **`FILE_ENCRYPTION_KEY`** | `.env` | Without this exact key the stored files can't be read by anyone |
| 4 | **The rest of `.env`** | `.env` in the app folder | Database and Redis addresses, `IRON_SESSION_PASSWORD`, SMTP credentials, `AUTO_TRANSFER_CRON_SECRET`, `APP_BASE_URL`, `APP_ENV` and the other settings |

Also record, with each backup:

- **The app version** (the git tag or commit that was running: `git describe --tags --always`). A restore should run the same version, or a newer one that migrates the database forward.

### Not needed

| What | Why not |
|---|---|
| **Redis** | Holds only short-lived data: sign-in rate limits and lockouts, new-finding autosave drafts, job locks, and (with the BullMQ driver) the email hand-off. Every email lives in the database outbox, so nothing is lost if Redis starts empty |
| **`node_modules`, `.next`** | Rebuilt by `npm ci` and `npm run build` |
| **The scheduler task** | Reinstalled with `scheduler\windows\install-task.ps1` ([scheduler/README.md](../scheduler/README.md)) |
| **Logs** | Optional. Keep them only if your log policy requires it |

---

## 2. How often

| What | When |
|---|---|
| Database + storage folder | **Daily**, and **before every update** |
| `FILE_ENCRYPTION_KEY` and `.env` | Once, into a password manager or vault, and again **after any change** |
| Test restore | Before go-live, then at least every 3 months |

Keep the key and `.env` **separate** from the database and storage backups. Anyone holding both the storage backup and the key can read every evidence file.

---

## 3. Taking a backup

### 3.1 The order matters

1. **Database first.**
2. **Then the storage folder.**

Taken in this order, every file the database refers to is in the storage copy. A file uploaded between the two steps ends up as an extra file with no record, which is harmless (`npm run storage:cleanup` reports it). The other order can leave records pointing to files that aren't in the backup.

The app can keep running during the backup.

### 3.2 Database password without typing it

`pg_dump` and `pg_restore` read the password from a password file:

- **Windows:** `%APPDATA%\postgresql\pgpass.conf` for the account that runs the backup
- **Linux:** `~/.pgpass`, with `chmod 600`

One line:

```
localhost:5432:auditapp:nib_app:<password>
```

Use the same values as in `DATABASE_URL`. `pg_dump` doesn't understand Prisma's `?schema=public`, so pass host, user and database separately as below.

### 3.3 Backup script (Windows)

Save as `D:\backups\backup-nib.ps1` (outside the app folder):

```powershell
$ErrorActionPreference = "Stop"
$stamp      = Get-Date -Format "yyyyMMdd-HHmm"
$backupRoot = "D:\backups\nib"
$appFolder  = "D:\apps\nib-control360"
$storage    = "D:\nib-storage"            # STORAGE_DIR from .env
$keepDays   = 30
$dest       = Join-Path $backupRoot $stamp
New-Item -ItemType Directory -Force $dest | Out-Null

# 1. Database (custom format: compressed, restorable table by table)
& pg_dump -h localhost -p 5432 -U nib_app -d auditapp -Fc -f "$dest\auditapp.dump"
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }

# 2. Storage folder (after the database)
robocopy $storage "$dest\storage" /E /COPY:DAT /R:2 /W:5 /NP /NFL /NDL | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }

# 3. Which version was running
git -C $appFolder describe --tags --always | Out-File "$dest\app-version.txt"

# 4. Quick check: the dump can be read
& pg_restore --list "$dest\auditapp.dump" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "dump is unreadable" }

# 5. Remove old backups
Get-ChildItem $backupRoot -Directory | Where-Object { $_.CreationTime -lt (Get-Date).AddDays(-$keepDays) } | Remove-Item -Recurse -Force

"Backup OK: $dest"
```

Schedule it daily (Administrator PowerShell), as an account that can read the storage folder and has the `pgpass.conf` above:

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" -Argument '-NoProfile -ExecutionPolicy Bypass -File "D:\backups\backup-nib.ps1"'
$trigger = New-ScheduledTaskTrigger -Daily -At 1:30am
Register-ScheduledTask -TaskName "NIB Control360 Backup" -Action $action -Trigger $trigger -User "<backup account>" -Password "<password>" -RunLevel Highest
```

Pick a time away from the 1st-of-the-month 00:00 automatic transfer and the reminders' send time.

Then copy `D:\backups\nib` **off the server** (backup software, a network share with restricted access, or offline media), encrypted.

### 3.4 Backup (Linux)

```bash
stamp=$(date +%Y%m%d-%H%M); dest=/var/backups/nib/$stamp; mkdir -p "$dest"
pg_dump -h localhost -U nib_app -d auditapp -Fc -f "$dest/auditapp.dump"
rsync -a /var/lib/nib-control360/storage/ "$dest/storage/"
git -C /opt/nib-control360 describe --tags --always > "$dest/app-version.txt"
pg_restore --list "$dest/auditapp.dump" > /dev/null
find /var/backups/nib -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +
```

Run it daily from cron or a systemd timer.

### 3.5 Before an update

Run the backup script once by hand and check it says `Backup OK` before `git checkout` of the new version ([PRODUCTION.md §9](PRODUCTION.md)).

### 3.6 A readable copy of the files (optional)

The storage folder holds encrypted files under random names. For an archive people can open without the app:

```powershell
npm run storage:export -- D:\exports\nib-files-20261014
```

It writes every file decrypted, under its original name, grouped by finding reference. **Treat that folder as sensitive**: nothing in it is encrypted any more.

---

## 4. Restoring

### 4.1 Which case are you in?

| Situation | Go to |
|---|---|
| Whole server lost, or a new server | §4.2, all steps |
| Bad update: database changed by a migration | §4.2 from step 2, with the **previous** app version |
| Data wrongly changed or deleted in the app | §4.5 first: restoring the whole database also removes everything done since the backup |
| One stored file missing or damaged | §4.6 |

### 4.2 Full restore

**1. Prepare the server**

Install Node.js, PostgreSQL and Redis as in [PRODUCTION.md](PRODUCTION.md). Check out the app version recorded in `app-version.txt` (or a newer one):

```powershell
git clone <repository-url> nib-control360
cd nib-control360
git checkout <version from app-version.txt>
npm ci
```

**2. Put back `.env`** from the vault. It must have the **same `FILE_ENCRYPTION_KEY`** as when the files were stored. Adjust only what differs on the new server (database host, `STORAGE_DIR`, `APP_BASE_URL`).

A different `IRON_SESSION_PASSWORD` is fine: everyone simply signs in again.

**3. Stop everything that writes**

```powershell
nssm stop NIBControl360                                        # the app service
Disable-ScheduledTask -TaskName "NIB Control360 Auto Transfer"  # the scheduler task, if installed
# and the email worker service, if EMAIL_WORKER=external
```

Linux: `sudo systemctl stop nib-control360`, and stop the cron or timer.

**4. Restore the database into an empty database**

```powershell
# Only when replacing an existing database: rename it first rather than dropping it
psql -h localhost -U postgres -c "ALTER DATABASE auditapp RENAME TO auditapp_old_20261014;"

psql -h localhost -U postgres -c "CREATE DATABASE auditapp OWNER nib_app;"
pg_restore -h localhost -U nib_app -d auditapp --no-owner --role=nib_app "D:\backups\nib\20261014-0130\auditapp.dump"
```

`pg_restore` may print warnings about extensions or comments; errors about tables or data are not normal and should be checked before going on.

**5. Restore the storage folder**

```powershell
robocopy "D:\backups\nib\20261014-0130\storage" "D:\nib-storage" /E /COPY:DAT
```

Make sure the app's account can read and write it, and that `STORAGE_DIR` points to it.

**6. Bring the database to the app's version**

```powershell
npx prisma migrate status
```

- *Database schema is up to date*: nothing to do.
- *Following migrations have not yet been applied*: the code is newer than the backup. Run `npx prisma migrate deploy`.

Then build:

```powershell
npm run build
```

**7. Stop side effects before the first start** (see §4.3)

```powershell
psql -h localhost -U nib_app -d auditapp -c "INSERT INTO email_queue_state (id, paused, paused_reason, paused_at, paused_by) VALUES ('singleton', true, 'Paused after restore', now(), 'restore') ON CONFLICT (id) DO UPDATE SET paused = true, paused_reason = 'Paused after restore', paused_at = now(), paused_by = 'restore';"
psql -h localhost -U nib_app -d auditapp -c "INSERT INTO auto_transfer_config (id, enabled) VALUES ('singleton', false) ON CONFLICT (id) DO UPDATE SET enabled = false;"
```

Note which Automatic Transfer setting was on before, so you can switch it back on in step 9.

**8. Start the app and check it** (§4.4)

```powershell
nssm start NIBControl360
```

**9. Switch things back on**, once the checks pass:

1. **Settings → Email Queue:** look at what is *Pending*. Cancel emails that were already sent before the failure, then **Resume** the queue.
2. **Settings → Automatic Transfer:** switch it back on and **Save**.
3. **Settings → Rectification Reminders:** check the settings.
4. **Scheduler task:** `Enable-ScheduledTask -TaskName "NIB Control360 Auto Transfer"`, then run `scheduler\windows\check.ps1` and confirm **READY**.
5. The email worker service, if you run one.

### 4.3 Why step 7 matters

A backup is a picture of the past. When the restored app starts, it acts on that picture:

| Job | What it would do after restoring an older backup |
|---|---|
| **Email queue** | Sends every email that was *Pending* when the backup was taken, including ones that went out after it. People get duplicates |
| **Automatic transfer** | Sweeps any period whose 1st has passed since the backup. That is correct, but you may want to check the data first |
| **Rectification reminders** | Today's run isn't in the restored records, so today's reminders can be sent again. With the email queue paused, only bell notifications are duplicated |

Pausing the queue and switching the transfer off lets you look first, then let them run.

### 4.4 Checks after a restore

| Check | How | Expected |
|---|---|---|
| Sign-in | Sign in as an administrator | Works (everyone else signs in again too) |
| Data is the backup's | Admin → Audit Log | The last entries are from just before the backup time |
| Files and records match | `npm run storage:cleanup` (report only, changes nothing) | No *missing* files. A few *orphans* are normal (§3.1) |
| A file opens | Open a finding with evidence, download a file | Downloads and opens. An error here usually means the wrong `FILE_ENCRYPTION_KEY` |
| Periods | Admin → Reporting Periods | Periods and their Auto-transfer column as expected |
| Scheduler | `scheduler\windows\check.ps1` | READY (after step 9) |
| Email | Settings → Notification Delivery → Send Test Email | Arrives (after resuming the queue) |
| Version | `git describe --tags --always` | The version you meant to run |

### 4.5 Data changed or deleted by mistake

Restoring the whole database undoes **everything** done since the backup, by everyone. Usually it is better to:

1. Restore the backup into a **separate** database on a test server (§4.2 steps 4–6, with another database name, and `APP_ENV=development` only because it is a copy).
2. Look up what was lost there (the finding, its cases, its history).
3. Put it right on the live system through the app, or ask the developers for a targeted fix.

Only restore over the live database when the damage is wider than what can be put right by hand, and after telling users that recent work will be lost.

### 4.6 One stored file missing or damaged

Each record keeps the file's stored name (`evidence.storage_path`, `import_batches.stored_file`). Copy that one file from the storage backup into the same place in the live storage folder (`evidence\` or `imports\`). It is encrypted with the same key, so it works as soon as it is back.

---

## 5. Testing a restore

Do this before go-live and then every few months, on a **test server**, never on the live one:

1. Take the latest backup and the `.env` from the vault.
2. Follow §4.2 on the test server. In its `.env` set `APP_ENV=development`, and point `APP_BASE_URL` and SMTP at test values so no real user gets an email.
3. Run every check in §4.4.
4. Write down the date, the backup used, how long it took, and anything that didn't work.

A backup that has never been restored is not a proven backup.

---

## 6. Security of the backups

- **Encrypt** the backup copies and keep them **off the app server**.
- **Restrict access**: the database dump contains every finding, user and audit entry.
- **Keep the key apart**: `FILE_ENCRYPTION_KEY` and `.env` in a password manager or vault, never in the same place as the storage backup.
- **Never change `FILE_ENCRYPTION_KEY`** on a system that has files: old files and old backups would become unreadable.
- **Readable exports** (§3.6) are not encrypted: keep them only as long as needed.

---

## 7. Checklist

**Set up once**
- [ ] `pgpass.conf` (or `.pgpass`) for the backup account
- [ ] Backup script saved and scheduled daily
- [ ] Backups copied off the server, encrypted
- [ ] `FILE_ENCRYPTION_KEY` and `.env` in the vault, separate from the backups
- [ ] One restore tested (§5)

**Every day (automatic)**
- [ ] Backup ran and printed `Backup OK` (check the task's last result)

**Before every update**
- [ ] Manual backup taken and checked

**Every 3 months**
- [ ] Test restore done and recorded
