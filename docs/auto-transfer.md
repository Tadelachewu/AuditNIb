# Automatic Transfer at Period End

When a reporting period ends, every finding still outstanding in it is carried into the **next period**, automatically and **once**. Findings in **excluded operation areas** stay. Locking a period no longer transfers anything.

Replaces the old "transfer outstanding cases when locking a period" option (see `TRANSFER_ON_LOCK.md`, now historical).

---

## 1. The rule

| | |
|---|---|
| **When** | Once the period's **end** *and* its **submission window's end** have passed (whichever is later), plus an optional delay. A grace window that runs past the period end is respected: nothing moves while people may still submit into the period |
| **Which periods** | Every period, open **or locked**, not yet handled |
| **What moves** | Findings currently in that period that are **with the branch and not fully closed**: Sent to Branch Manager (/R), Partially Rectified, Rectified (awaiting closure), Rectification Returned, Transferred |
| **What stays** | Drafts and findings in review, returned or rejected findings, closed findings, and findings whose **operation area is excluded** |
| **Where to** | The **next period** by calendar (Oct → Nov, Dec → Jan), one step, even if that period is locked (a lock only blocks submission) |
| **How** | The same transfer as a manual one: unclosed rectification goes back to the branch, closed work stays with the period, history and audit are recorded. Method **Automatic**, by **System (automatic transfer)** |
| **How often** | Once per period. A finding moved back into an already-handled period later is not swept again; it needs a manual transfer |
| **Rescheduled period** | If a period that was already handled is edited to end (or its submission window to end) **later than now**, it is **re-armed** and swept again when it really ends. Moving the end to a time that has already passed changes nothing |
| **Dev Reset** | Wipes the record of which periods were swept (with the findings), so every period is handled afresh. Periods that have already ended are swept at the next check, and with nothing in them are simply marked Done |
| **Deleting a period** | Its record is deleted with it |

### No next period yet
Nothing moves. The period shows **Waiting: no next period**, the transfer-permission holders are told once, and the transfer happens automatically as soon as the next period is created.

### Several months missed
If the app wasn't used for a while, the due periods are handled **oldest first** in one go, so a finding in September ends up in the first period that hasn't ended (Sep → Oct → Nov).

## 2. Settings: Admin → Settings → Automatic Transfer

| Setting | Meaning | Default |
|---|---|---|
| **Transfer outstanding findings automatically when a reporting period ends** | Master switch | On |
| **Operation areas excluded from automatic transfer** | Findings in these areas stay in their period (matched regardless of letter case and spacing). Choices: the configured operation areas plus any typed-in value already used on findings | None |
| **Run after (hours past the period end)** | A delay after the end / submission window | 0 |

It has its own **Save** button, separate from the rest of the Settings page. Viewing needs *Settings › View* (or *Reporting Periods › View*); changing it needs *Settings › Edit*. Every change is audit-logged.

## 3. Where you see it

- **Reporting Periods → Auto-transfer column:**
  - *Runs after 31/10/2026, 23:59:00*: pending.
  - **Done** · 12 moved, 3 kept · **by scheduler** / **by in-app check**: what started the sweep; hover for the date and destination.
  - **Waiting: no next period**.
  - **Before install**: the period had already ended when this feature was installed; it is never swept.
  - **Off**: the switch is off.
- **Lock dialog:** a note that locking no longer transfers.
- **The finding:** its Transfer History shows the hop with method *Automatic* and reason *"Automatic transfer at the end of 2026-10 (ended …)"*.
- **Reports → Transfers / Transferred Findings:** listed like any transfer, *Transferred by: System (automatic transfer)*.
- **Notifications** (Email Events → *Automatic transfer*):
  - the transfer-permission holders get one summary per period;
  - each affected branch's rectifiers get one message ("N findings carried into 2026-11");
  - never one notification per finding.
- **Audit log:** one `PERIOD_AUTO_TRANSFER` entry per period, listing the moved and kept references, the exclusions in force and **what started it** (`triggeredBy`: `scheduler` or `in-app`).

## 4. When it actually runs

The app has no background scheduler, so the check runs **lazily**:
- every signed-in browser polls notifications every 30 s;
- each server checks at most **once every 5 minutes**.

So the transfer happens within about 5 minutes after a period becomes due, as long as anyone is using the app. If nobody is signed in, it runs on the next visit.

A scheduler is **optional**: it adds exact timing, so the transfer runs a few minutes after a period ends even when nobody is signed in. Any scheduler that can send an HTTP POST works (§4.1–4.6).

**Safety:**
- **Atomic:** the moved findings and the period's "done" record are written in **one database transaction**. Either both happen or neither, so a period is never swept twice or recorded without moving.
- A short lock (in Redis, or in-process if Redis is down) stops two servers or two calls from sweeping at once.
- A period is only ever swept once; missed runs catch up oldest first.
- A failure is logged (`auto_transfer.failed`) and retried on the next check; it never breaks the request that triggered it.

### 4.1 How a scheduler calls it

```
POST /api/system/auto-transfer
Header: x-auto-transfer-secret: <AUTO_TRANSFER_CRON_SECRET>
```

| Response | Meaning |
|---|---|
| `200 {"ran":true,"runs":[…]}` | Periods were swept (each run: period, status, moved, kept) |
| `200 {"ran":false,"runs":[]}` | Nothing was due. Normal on most calls |
| `403` | Missing or wrong secret |
| `404` | `AUTO_TRANSFER_CRON_SECRET` isn't set: the endpoint is off |
| `429` | 10 wrong secrets in 15 minutes from that address: blocked for 15 minutes |

`GET` on the same URL, with the same header, is a **read-only status check** (it never moves anything): installed / on, periods due now, the next due period and time, periods waiting for a next period, and the last sweep with what started it. The `check` scripts in `scheduler/` use it.

- **No `Origin` header and no sign-in are needed.** `/api/system/*` is exempt from the browser cross-site check; the secret protects it.
- **Call it every 5 minutes.** Calling more often is harmless, and several servers or schedulers are fine (see the lock above).

### 4.2 One-time setup (every scheduler)

1. Generate a secret of 32+ random characters:
   - PowerShell: `-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | ForEach-Object {[char]$_})`
   - Linux: `openssl rand -hex 24`
2. Put it in the app's `.env` as `AUTO_TRANSFER_CRON_SECRET=<the secret>`, then **restart the app**.
3. Test it once by hand (§4.4 or §4.5). Expect `{"ran":false,...}` or `{"ran":true,...}`, not 403 or 404.
4. Keep the secret out of git and logs; give it only to the scheduler.

### 4.3 Ready-made files: the `scheduler/` folder

The app ships the scheduler files in **`scheduler/`** (see [scheduler/README.md](../scheduler/README.md)). The scripts:
- read the secret and port from the app's own `.env`;
- call the endpoint;
- log to `scheduler/logs/auto-transfer.log`.

| Folder | Files |
|---|---|
| `scheduler/windows/` | `auto-transfer.ps1` (the call), `install-task.ps1`, `uninstall-task.ps1`, `check.ps1` (readiness) |
| `scheduler/linux/` | `auto-transfer.sh` (the call), `install-cron.sh`, `install-systemd.sh`, `check.sh` (readiness) |

**Is it ready?** `powershell -ExecutionPolicy Bypass -File scheduler\windows\check.ps1` (Windows) or `sh scheduler/linux/check.sh`. Read-only; ends with READY or NOT READY and the reason.
| `scheduler/kubernetes/` | `auto-transfer-cronjob.yaml` |

### 4.4 Windows: Task Scheduler

From the app folder:

```powershell
# 1. Test once - the log should say "nothing due" or "ran: ..."
powershell -ExecutionPolicy Bypass -File scheduler\windows\auto-transfer.ps1
Get-Content scheduler\logs\auto-transfer.log -Tail 5

# 2. Install - in an ADMINISTRATOR PowerShell
powershell -ExecutionPolicy Bypass -File scheduler\windows\install-task.ps1
```

This creates the task **NIB Control360 Auto Transfer**: every 5 minutes, as SYSTEM, whether or not anyone is signed in to Windows, never two copies at once. It also appears in the Task Scheduler window.

```powershell
Start-ScheduledTask -TaskName "NIB Control360 Auto Transfer"      # run now
Get-ScheduledTaskInfo -TaskName "NIB Control360 Auto Transfer"    # LastTaskResult 0 = OK
powershell -ExecutionPolicy Bypass -File scheduler\windows\uninstall-task.ps1   # remove
```

### 4.5 Linux / macOS: cron or systemd

```sh
sh scheduler/linux/auto-transfer.sh; tail -n 5 scheduler/logs/auto-transfer.log   # test once
sh scheduler/linux/install-cron.sh              # cron, current user, every 5 min (--remove to undo)
sudo sh scheduler/linux/install-systemd.sh      # or a systemd timer instead (--remove to undo)
```

If the scheduler runs on another machine than the app, set `AUTO_TRANSFER_URL` (the full endpoint address) and `AUTO_TRANSFER_CRON_SECRET` in the scheduler's environment. The scripts use those instead of the local `.env`.

### 4.6 Kubernetes and cloud schedulers

- **Kubernetes:** `scheduler/kubernetes/auto-transfer-cronjob.yaml`, a CronJob every 5 minutes with the secret from a Kubernetes Secret (instructions in the file).
- **Azure Logic Apps, AWS EventBridge, Google Cloud Scheduler:** an HTTP POST to the same URL with the same header, every 5 minutes.

> **Notifications from a sweep** are emailed through the email queue, not by the sweep itself. How the two background runs differ: [email-queue.md §9](email-queue.md).

## 5. Installation (database)

The feature has its own two tables:
- `auto_transfer_config`: the settings;
- `auto_transfer_runs`: one row per handled period.

The migration also:
- marks every period that **had already ended** as handled ("Before install"), so installing it never suddenly moves old findings;
- removes the old `settings.auto_transfer_on_lock` column.

Migration: `prisma/migrations/20261006120000_auto_transfer_at_period_end/migration.sql`, applied on top of the `0_init` baseline. How the migration history was restarted to install it, and how to install it on other databases: [database-migrations.md](database-migrations.md).

```
npx prisma migrate deploy
```

Then restart the app. Until the migration is applied the feature stays **idle**: nothing moves, Settings shows "not installed", and a single warning is logged.

## 6. Design (for developers)

A self-contained module, `src/lib/autoTransfer/`, loosely coupled to the rest of the app:

| File | Role |
|---|---|
| `types.ts` | Config and run types, defaults, the System actor (client-safe) |
| `rules.ts` | **Pure** rules: when due, next period, exclusion, what a sweep would do |
| `store.ts` | `AutoTransferStore` interface + the Prisma implementation (its own two tables only) |
| `service.ts` | `sweepPeriods()` (moves findings, audit, notifications) and `runAutoTransferIfDue()` (throttle, lock, store); dependencies injectable for tests |
| `index.ts` | Public surface |

**Touch points with the rest of the app:**
- It reuses `transferFinding()` and `AUTO_TRANSFERABLE_STATUSES` from `src/lib/findings.ts`, and the notification and audit helpers.
- It's called from `GET /api/notifications` (one line) and `POST /api/system/auto-transfer`.
- Its UI is `AutoTransferSettings.tsx` (Settings) and `useAutoTransferStatus.tsx` (the Reporting Periods column), both talking only to `/api/admin/auto-transfer`.
- Nothing else depends on it. Removing it means deleting the module, those two components, the two routes, the one line in the notification route, and the tables.

Tests: `tests/autoTransfer.test.ts`:
- the rules;
- moved, kept and excluded findings;
- unclosed work reset;
- cascade;
- a locked destination;
- no next period;
- notifications and audit;
- the service: runs once, not before the end, off, not installed, locked, already handled at install, throttle, never throws.

## 7. Manual test cases

| # | Steps | Expected |
|---|---|---|
| A1 | Create a period ending a few minutes from now (submission window ending at the same time) and its next period; register and approve a finding in it; stay signed in | Within ~5 minutes after the end the finding is in the next period, status Transferred, Transfer History "Automatic" by System |
| A2 | As A1, but give the finding an excluded operation area | It stays; the Auto-transfer column shows "1 kept" |
| A3 | As A1 without creating the next period | Column "Waiting: no next period"; one notification; create the next period → the finding moves on the next check |
| A4 | Submission window ending a day after the period end | Nothing moves until the window ends |
| A5 | Switch Automatic Transfer off, let a period end | Nothing moves; column "Off" |
| A6 | Lock a period with outstanding findings | Nothing moves; the dialog says locking doesn't transfer |
| A7 | After A1, transfer the finding back manually | It stays (the period is already handled); it shows in Needs transfer |
| A8 | A draft and a closed finding in the period | Neither moves |
