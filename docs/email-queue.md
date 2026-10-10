# Email Queue

Notification emails (submitted, approved, returned, rectified, transferred, reminders, adjustments, support…) are no longer sent "fire and forget". Each one is **saved in the database together with the notification that caused it**, then **delivered by a worker with retries**. A mail outage or an app restart loses nothing, and an action that fails never sends an email.

Two emails are still sent immediately, while the user waits, because they need the result at once: **forgot password** and the **test email** in Settings.

The design is a **transactional outbox** in PostgreSQL with two interchangeable delivery engines: the built-in Postgres worker (default, no extra infrastructure) and **BullMQ on Redis** (§8). The outbox is always the source of truth.

---

## 1. What it fixes

| # | Before | Now |
|---|---|---|
| 1 | A failed send was lost (one log line) | Retried automatically: after 1 min, 5 min, 15 min, 1 h, 4 h; then marked **Failed** and can be retried by hand |
| 2 | Emails in flight during a restart were lost | They are rows in the database; the worker picks them up again |
| 3 | The email started before the database commit, so a rolled-back action could still email | The email row is written **in the same transaction**: no commit, no email |
| 4 | One new SMTP connection per email | One pooled set of connections (3 by default) |
| 5 | No record of delivery | Every email has a status, attempts, last error and sent time; Settings shows them |
| 6 | No rate limit | 10 emails per second by default |
| 7 | Message text went into the HTML unescaped | User-typed text is HTML-escaped; subjects can't carry line breaks |

## 2. How an email travels

```
user action → one database transaction ─┬─ the business change
                                        ├─ the bell notification
                                        └─ the email row (PENDING)
                              commit ───┘
  kick (right after the commit) ─┐
  worker loop (every 20 s) ──────┴─► claim due rows → SMTP → SENT / retry later / FAILED
```

1. `notifyUsers()` decides whether an email is due: the event is on in **Settings → Email Events**, the recipient is active and has an address, and email is configured. If not, nothing is queued (the bell notification is still created).
2. The email is written to `email_outbox` in the same transaction as the notification.
3. After the commit the worker is **kicked**, so delivery normally takes a second or two.
4. The **worker loop** runs every 20 seconds for retries and anything a kick missed.

### When an email is created

Every email starts as a notification. For each recipient the app creates the bell notification, then decides whether an email is also due:

| Rule | If not met |
|---|---|
| The recipient is an **active** user | No notification, no email |
| The recipient isn't an Administrator (support messages excepted) | No notification, no email |
| Email is configured: provider SMTP, host and port set, `SMTP_USER` / `SMTP_PASSWORD` present | Bell only |
| The event is **on** in Settings → Email Events | Bell only |
| The recipient has an **email address** | Bell only |

The content is fixed when the email is queued: subject = the notification's title, body = its message plus an *Open in NIB Control360* link (when `APP_BASE_URL` is set). Support emails are sent ahead of the others.

## 3. Statuses

| Status | Meaning |
|---|---|
| **Pending** | Waiting to be sent (first try, or a retry at its scheduled time) |
| **Queued** | Handed to BullMQ, waiting for a worker (BullMQ driver only) |
| **Sending** | A worker holds it right now |
| **Sent** | Accepted by the mail server |
| **Failed** | Gave up: rejected for good, or all attempts used. Can be retried from Settings |
| **Cancelled** | Expired before it could be sent (72 hours), or cancelled by an admin |

## 4. What happens when sending fails

| The mail server says | What the worker does |
|---|---|
| Accepted | **Sent** |
| Temporary problem (can't connect, timeout, 4xx, throttled) | Back to **Pending**; retried after 1 min → 5 min → 15 min → 1 h → 4 h (±20%). After the 6th attempt: **Failed** |
| Rejected for good (5xx, invalid address) | **Failed** at once |
| Sign-in refused (wrong `SMTP_USER` / `SMTP_PASSWORD`) | The **whole queue is paused** and the attempt isn't counted. Fix the credentials, restart the app, then **Resume** in Settings |
| Fails 5 times in a row | Sending stops for 2 minutes (circuit breaker), then continues |

Other safeguards:
- **No double sending:** a worker claims rows with `FOR UPDATE SKIP LOCKED`; two workers or two servers never take the same email.
- **No double queuing:** each email has a unique key (`notification:<id>`).
- **Crash recovery:** a row left *Sending* for 10 minutes is released and retried.
- **Stale mail:** an email older than 72 hours is cancelled, never sent late.
- Delivery is *at least once*: if the app dies in the instant between the mail server accepting an email and the row being marked Sent, that one email can be sent twice. Each email carries a stable `Message-ID` so mail servers can drop the duplicate.

## 5. Settings → Email Queue

Shows **Waiting**, **Sent today**, **Failed**, **Cancelled / expired**; the oldest waiting email; the last delivery run; whether the queue is paused and why; the failed emails with the reason; and a **Sent today** list (click to open): when each email was queued, when it was sent, how long that took, the recipient, subject, event and number of tries (the latest 100; the count is always the full number).

*Sent* means the mail server accepted the email. A later bounce or a spam filter isn't visible here. Forgot-password and test emails aren't listed (they don't go through the queue).

| Button | Does |
|---|---|
| **Pause sending** / **Resume sending** | Emails keep queuing while paused and go out on resume |
| **Send waiting now** | Runs the worker immediately |
| **Retry all failed** / **Retry** | Puts failed emails back in the queue with fresh attempts |
| **Cancel** | Drops a failed or waiting email |

Viewing needs *Settings › View*; the buttons need *Settings › Edit*. Pause, resume, retry and cancel are written to the audit log (`EMAIL_QUEUE_…`).

Error text shown here is a sanitized summary (for example `Rejected by the mail server (550)`). The full error is in the server log only.

## 6. Install

1. `npx prisma migrate deploy` (applies `20261010120000_email_outbox`: tables `email_outbox`, `email_queue_state`).
2. `npx prisma generate` (or `npm install`), then rebuild and restart the app.

Before step 1 the app still works: notification emails are sent once, right after the commit, without retries, and Settings → Email Queue says the queue isn't installed.

## 7. Configuration (`.env`, all optional)

| Variable | Default | Meaning |
|---|---|---|
| `EMAIL_QUEUE_DRIVER` | `postgres` | `postgres`: the built-in worker. `bullmq`: BullMQ on Redis dispatches (§8) |
| `EMAIL_WORKER` | `inprocess` | `inprocess`: the app delivers. `external`: a separate worker process does (below) |
| `EMAIL_BATCH_SIZE` | 20 | Emails claimed per batch |
| `EMAIL_POOL_SIZE` | 3 | SMTP connections kept open |
| `EMAIL_RATE_PER_SEC` | 10 | Emails per second |
| `EMAIL_MAX_ATTEMPTS` | 6 | Tries before Failed (1–7) |

`SMTP_USER`, `SMTP_PASSWORD`, `APP_BASE_URL` and Settings → Notification Delivery work as before (see EMAIL_SETUP.md).

### Separate worker process (optional)

For higher volume, or to keep email off the web process:

1. Set `EMAIL_WORKER=external` in `.env` and restart the app (it then only queues).
2. Run `npm run worker:email` as a service (NSSM / pm2 on Windows, systemd on Linux, a Deployment on Kubernetes). Several workers can run at once.

## 8. BullMQ driver (Redis)

Set `EMAIL_QUEUE_DRIVER=bullmq` to dispatch with BullMQ. Nothing else changes for users or admins.

### Who does what

| | Role |
|---|---|
| **PostgreSQL outbox** | Source of truth **and scheduler**: every email, its status, attempts, last error and next retry time |
| **BullMQ on Redis** | Dispatcher: pushes due emails to workers at once, with a concurrency (`EMAIL_POOL_SIZE`) and a rate limit (`EMAIL_RATE_PER_SEC`) |

```
commit ─► outbox row PENDING
relay  ─► row QUEUED + BullMQ job (job id = outbox id, so never two jobs for one email)
worker ─► row SENDING ─► SENT            (job done)
                      ─► PENDING + retry time   (temporary failure: rescheduled in the outbox)
                      ─► FAILED          (rejected for good, or attempts used up)
```

- **A job is one attempt.** Retries are not BullMQ retries: a failed attempt goes back to the outbox with its next retry time, and the relay hands it off again when due. So the retry schedule survives a Redis restart or flush.
- **The relay** runs right after each commit (kick) and every 20 seconds (10 in the standalone worker).
- **Lost jobs are recovered:** a row *Queued* for more than 2 minutes whose job no longer exists in Redis goes back to *Pending* and is handed off again.
- **Redis down:** the hand-off fails fast, the rows go straight back to *Pending*, and that pass is delivered by the built-in Postgres worker. When Redis returns, BullMQ takes over again by itself. Settings → Email Queue shows a notice meanwhile. Email never waits for Redis.
- **No double sending:** a worker only takes a row that is still *Queued* (one atomic update). A duplicate or stale job finds nothing to do.
- Pause / Resume, Retry, Cancel, expiry, wrong-credentials pause and the circuit breaker behave the same as with the Postgres worker.

### Where the BullMQ worker runs

| `EMAIL_WORKER` | Relay | BullMQ worker |
|---|---|---|
| `inprocess` (default) | In the app | In the app |
| `external` | In the app (after each commit, so it is pushed at once) and in the worker | `npm run worker:email` (run as a service; several can run) |

For production with BullMQ, `external` is recommended: mail delivery is then isolated from web requests and can be restarted on its own. The worker shuts down gracefully (`SIGTERM` / `SIGINT`): it finishes the sends in progress, then exits.

### Redis requirements

BullMQ makes Redis hold work in progress, so it must be run as a durable service:

| Setting | Required value | Why |
|---|---|---|
| `maxmemory-policy` | `noeviction` | Any other policy can silently delete queued jobs |
| Persistence | `appendonly yes` (AOF) | Without it a Redis restart empties the queue (the outbox recovers the emails after ~2 minutes, but that is the safety net, not the plan) |
| Version | Redis 6.2 or newer recommended (tested here on 7.2; Memurai on Windows is Redis-compatible) | BullMQ relies on newer Redis commands |
| Access | Password / ACL, bound to the app network only | The queue is internal |
| Monitoring | Memory, connected clients, AOF status | It is now part of mail delivery |

Check a server: `redis-cli CONFIG GET maxmemory-policy` and `redis-cli CONFIG GET appendonly`.

BullMQ uses its own Redis connections: a fail-fast one for handing off (never blocks a request) and a blocking one for the worker. The app's existing Redis client (rate limiting, drafts) is untouched.

### Switching

| From → to | What to do |
|---|---|
| postgres → bullmq | Set `EMAIL_QUEUE_DRIVER=bullmq`, restart. Emails already waiting are handed to BullMQ |
| bullmq → postgres | Remove the setting, restart. Emails still *Queued* are taken over by the Postgres worker within 2 minutes |

Both are safe at any time; no email is lost or sent twice by switching.

### Built-in worker vs BullMQ

Both deliver the same emails from the same outbox, with the same retry rules, statuses and admin screen. They differ only in **how a due email reaches a worker**.

| | Built-in worker (default) | BullMQ (`EMAIL_QUEUE_DRIVER=bullmq`) |
|---|---|---|
| How a worker gets an email | It **asks the database** for due emails: right after each save, and every 20 seconds | The app **hands the email to Redis**, and Redis **pushes** it to a waiting worker |
| Needs | PostgreSQL only | PostgreSQL **and** a durable Redis (`noeviction`, AOF on) |
| Extra process to run | None (inside the app) | Recommended: `npm run worker:email` as its own service |
| Speed, normal case | A second or two | A second or two |
| Speed for retries | When the retry time arrives, within 20 s | Same: the outbox schedules retries in both |
| Concurrency and rate limit | `EMAIL_POOL_SIZE`, `EMAIL_RATE_PER_SEC`, per worker process | Same settings, enforced by BullMQ across **all** workers together |
| Several worker machines | Works: each claims different rows by polling | Better: Redis shares work between them at once |
| If Redis is down | Not affected | Falls back to the built-in worker automatically |
| If the database is down | Nothing can be queued or sent | Same: the outbox is the source of truth for both |
| Can an email be lost | No: it is a database row | No: it is a database row; a lost Redis job is recovered in about 2 minutes |
| What to monitor | Settings → Email Queue | Settings → Email Queue, **plus** Redis (memory, persistence) and the worker service |

**Identical in both:** when an email is created, the same-transaction save, the retry schedule, the wrong-password pause, the circuit breaker, the 72-hour expiry, Pause / Resume / Retry / Cancel, and housekeeping.

**Which to use**

- **Built-in worker** for normal use: it delivers just as fast at this app's volume, has one less service that can fail, and needs no Redis hardening.
- **BullMQ** when one of these is true:
  - several servers or worker machines should share the work at once;
  - other background jobs (large imports, report generation) will use the same queue system;
  - email volume reaches many per second, sustained.

## 9. Email worker vs the automatic-transfer run

Both are background work, but they solve different problems and are started differently.

| | Email worker | Automatic transfer ([auto-transfer.md](auto-transfer.md)) |
|---|---|---|
| Purpose | Deliver messages to people | Move outstanding findings to the next period when a period ends |
| Triggered by | An **event**: a notification was just saved | **Time**: a period's end and submission window have passed (+ delay hours) |
| How often there is work | Many times a day | About once a month per period |
| Who starts it | The app itself: a wake-up after each save, plus its own 20-second loop | The **Windows task / cron** every 5 minutes, or a signed-in user's page as a backup |
| Needs an OS scheduler | **No** | **Yes**, to be on time when nobody is signed in |
| Needs the app running | Yes (or the standalone worker) | Yes: the task only calls the app |
| Work list kept in | `email_outbox`: one row per email, with status | `auto_transfer_runs`: one row per period swept |
| Unit of work | One email | One period: all its outstanding findings in one transaction |
| If it fails | Retried per email, up to 6 times | The whole sweep rolls back; the next run tries again |
| "Once only" guarantee | A row is claimed by one worker only, plus a unique key | A lock plus the run record: a period is never swept twice |
| Several servers | Safe: each takes different emails | Safe: one takes the lock, the others skip |
| Uses Redis | Only with the BullMQ driver (fallback if down) | For the lock (in-process fallback if down) |
| After a long stop | Waiting emails go out when the worker is back; older than 72 hours are cancelled | Every missed period is swept, oldest first |
| Changes business data | No: it only sends | Yes: finding periods, transfer history, audit log |
| Admin view | Settings → Email Queue | Settings → Automatic Transfer; `scheduler/…/check` scripts |
| Secret needed | No | `AUTO_TRANSFER_CRON_SECRET` for the scheduler's call |

**How they connect:** a sweep creates notifications ("your branch's findings were carried into November"). They are saved in the sweep's own transaction and become outbox rows; the transfer run ends at once, and the email worker delivers them at its own pace, so a large sweep can't flood the mail server.

**What to install:** email needs nothing extra with the defaults (it starts with the app). Automatic transfer needs the scheduled task and the secret ([scheduler/README.md](../scheduler/README.md)).

**Rectification reminders** work like the automatic transfer: time-triggered, started by that same scheduled task (once a day at a set time), with a signed-in user's page as the backup. Their emails also go through this queue. See [rectification-reminders.md](rectification-reminders.md).

## 10. Housekeeping

Hourly, the worker blanks the bodies of emails sent more than 7 days ago, deletes Sent / Cancelled rows older than 90 days and Failed rows older than 180 days.

## 11. Logs

`email.sent`, `email.retry`, `email.failed`, `email.attempt_failed` (full error), `email.queue_paused`, `email.breaker_open`, `email.worker_started`, `email_queue.not_installed`. BullMQ driver: `email.bullmq_worker_started`, `email.redis_unavailable` (fell back to the Postgres worker), `email.jobs_recovered`, `email.bullmq_error`.

## 12. Code

| Part | File |
|---|---|
| Types | `src/lib/emailQueue/types.ts` |
| Rules (pure): what to queue, rendering, backoff, error classification | `src/lib/emailQueue/rules.ts` |
| Storage (claim, apply, pause, cleanup, admin queries) | `src/lib/emailQueue/store.ts` |
| SMTP pool | `src/lib/emailQueue/transport.ts` |
| BullMQ driver: relay, job handler, lost-job recovery, queue and worker | `src/lib/emailQueue/bullmq.ts` |
| Worker, kick, loop, hand-off from `updateDb()` | `src/lib/emailQueue/service.ts` |
| Queued by | `notifyUsers()` in `src/lib/notifications.ts` |
| Saved in the transaction by | `updateDb()` in `src/lib/db.ts` |
| Loop started in | `src/instrumentation.ts` |
| Admin API / UI | `src/app/api/admin/email-queue`, `src/components/admin/EmailQueuePanel.tsx` |
| Standalone worker | `scripts/email-worker.ts` |
| Tests | `tests/emailQueue.test.ts` |
| Synchronous emails (forgot password, test email) | `src/lib/mail.ts` |

## 13. Test cases

**Automated** (`tests/emailQueue.test.ts`): what is queued and what isn't; rendering, link and HTML escaping; backoff schedule; error classification; sent / retry / give up / expired; wrong credentials pause the queue without using attempts; circuit breaker; not configured / not installed; insert happens in the caller's transaction. BullMQ driver (with a fake queue): one job per email and never twice; a job is one attempt; stale / duplicate jobs do nothing; give up and pause rules; lost-job recovery; Redis down falls back to the Postgres worker.

**Manual**

| # | Steps | Expected |
|---|---|---|
| M1 | Submit a finding | Reviewer gets the email within seconds; Settings → Email Queue: *Sent today* +1 |
| M2 | Stop the mail server (or set a wrong SMTP host), submit a finding | Action succeeds; email is *Waiting*, retried later; sent once the server is back |
| M3 | Wrong `SMTP_PASSWORD`, restart, submit | Queue shows **Paused** with the reason; fix, restart, **Resume** → sent |
| M4 | Switch an event off in Email Events, trigger it | Bell notification only; nothing queued |
| M5 | Restart the app with emails waiting | They are sent after the restart |
| M6 | A failed email → **Retry** | Back to Waiting, then Sent |
| M7 | **Pause sending**, trigger a notification, **Resume** | Queued while paused, sent on resume |
| M8 | A reason containing `<b>x</b>` | Shown as text in the email, not bold |
| M9 | `EMAIL_QUEUE_DRIVER=bullmq`, restart, submit a finding | Sent within a second or two; the panel says *Dispatch: BullMQ on Redis* |
| M10 | BullMQ driver: stop Redis, submit a finding | Still sent (built-in worker); the panel shows the Redis notice; start Redis → BullMQ again |
| M11 | BullMQ driver, `EMAIL_WORKER=external`: stop `npm run worker:email`, submit, start it | Email is *Waiting* while stopped, sent when the worker starts |
| M12 | BullMQ driver: `redis-cli FLUSHALL` with emails waiting | They are queued again within ~2 minutes and sent |
