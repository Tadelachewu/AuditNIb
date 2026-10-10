# Background Jobs: Test Cases

Test cases for the background jobs:

- **Email queue and worker**: built-in worker and BullMQ ([email-queue.md](email-queue.md))
- **Automatic transfer at period end**: the scheduler run ([auto-transfer.md](auto-transfer.md), [scheduler/README.md](../scheduler/README.md))
- **Rectification reminders**: the daily scheduled run ([rectification-reminders.md](rectification-reminders.md))

Run them on a **test server**, never on production: several cases stop services, change `.env`, or edit rows with SQL.

**Result column:** write Pass / Fail and a note. A case marked *(SQL)* needs database access; one marked *(restart)* needs the app restarted.

---

## 0. Before you start

### Environment

| Need | Check |
|---|---|
| App running, migrations applied | `npx prisma migrate status` → *Database schema is up to date!* |
| SMTP working | Settings → Notification Delivery → **Send Test Email** arrives |
| `APP_BASE_URL` set | Emails contain an *Open in NIB Control360* link |
| Email queue installed | Settings → **Email Queue** shows the counters, not "isn't installed" |
| Redis running | Needed for §F (BullMQ) and the auto-transfer lock |
| Scheduler task installed | `scheduler\windows\check.ps1` ends with **READY** (for §G) |

### Test users (each with a real mailbox you can read)

| User | Role | Used as |
|---|---|---|
| BC | Branch Controller, branch X | Registers and submits findings |
| BM | Branch Manager, branch X | Receives rectification notifications |
| DC | District Controller, branch X's district | Reviewer: receives *Submitted* |
| HO | HO Controller | Second reviewer |
| ADMIN | Administrator | Settings, Email Queue |
| NOMAIL | Any active role, **no email address** | Bell-only checks |
| OFF | Any role, **deactivated** | Gets nothing |

### Where to look

| What | Where |
|---|---|
| Counts, failed list, pause state | Settings → **Email Queue** (refreshes every 15 s) |
| Bell notification | The bell in the top bar of the recipient |
| One email's row *(SQL)* | `SELECT id, status, attempts, next_attempt_at, last_error, sent_at FROM email_outbox ORDER BY created_at DESC LIMIT 10;` |
| Totals *(SQL)* | `SELECT status, count(*) FROM email_outbox GROUP BY status;` |
| Server log events | `email.sent`, `email.retry`, `email.failed`, `email.queue_paused`, `email.breaker_open`, `email.redis_unavailable`, `email.jobs_recovered`, `auto_transfer.ran` |
| Auto-transfer status | Settings → **Automatic Transfer**; `scheduler\windows\check.ps1`; `scheduler\logs\auto-transfer.log` |

**The standard trigger** used below: BC registers a finding and clicks **Submit** → DC is notified (*Submitted*).

---

## A. When an email is created

| ID | Steps | Expected | Result |
|---|---|---|---|
| A1 | Standard trigger | DC gets the bell notification **and** an email within a few seconds. *Sent today* +1 | |
| A2 | Open the email | Subject = the notification title; body = its message; link *Open in NIB Control360* opens that finding | |
| A3 | Settings → Email Events: switch **Submitted** off, save. Standard trigger | DC gets the **bell only**. No new row in the queue (*Sent today* unchanged) | |
| A4 | Switch **Submitted** back on. Trigger a notification whose only recipient is NOMAIL | Bell only for NOMAIL; nothing queued | |
| A5 | Trigger a notification that would go to OFF (deactivated) | No bell, no email for OFF | |
| A6 | Standard trigger while ADMIN also holds the reviewer permission | ADMIN gets **no** finding notification or email (Administrators only get support notifications) | |
| A7 | A user opens a support thread | Support responders get the bell and the email | |
| A8 | Settings → Notification Delivery: provider **None**, save. Standard trigger | Bell only; nothing queued; Email Queue shows *"Email can't be sent right now…"* | |
| A9 | Set the provider back to SMTP. District **returns** a finding with reason `<b>bold</b> & "quoted"` | The registrant's email shows that text literally (not bold) | |
| A10 | Unset `APP_BASE_URL` *(restart)*, standard trigger | Email arrives **without** the link. Set it back afterwards | |
| A11 | Make an action fail after the notification is built (e.g. submit while the period's submission window is closed) | The action is refused; **no** email and no bell | |

## B. Delivery: built-in worker (default)

`.env`: `EMAIL_QUEUE_DRIVER` unset, `EMAIL_WORKER` unset.

| ID | Steps | Expected | Result |
|---|---|---|---|
| B1 | Standard trigger; watch Settings → Email Queue | *Waiting* briefly 1, then 0; *Sent today* +1; "Last delivery run" updates | |
| B1a | Open **Sent today** in Settings → Email Queue | The email is listed, newest first: *Queued at* = when BC submitted, *Sent at* a second or two later, *Took* that difference, DC's address, the subject, event *SUBMITTED*, tries 1 | |
| B2 | *(SQL)* look at the row | `status = SENT`, `attempts = 1`, `sent_at` set, `smtp_message_id` set, `last_error` empty | |
| B3 | An action that notifies several people (e.g. HO approves → every rectifier of the branch) | One email per recipient with an address; each sent once | |
| B4 | Bulk: an automatic transfer or bulk action producing 30+ notifications | All arrive; none duplicated; the app stays responsive while they go out | |
| B5 | A support reply and several workflow notifications queued together (pause first, see D1, then resume) | The support email is sent first | |
| B6 | Forgot password (login page) | The reset email arrives immediately; it does **not** appear in the Email Queue counts | |
| B7 | Settings → **Send Test Email** | Arrives immediately; on a wrong SMTP host the admin sees the error at once | |

## C. Failures and retries

| ID | Steps | Expected | Result |
|---|---|---|---|
| C1 | Settings → Notification Delivery: set the SMTP port to a closed one (e.g. 2526), save. Standard trigger | The action succeeds at once. The email stays *Waiting*. *(SQL)* `status = PENDING`, `attempts = 1`, `last_error` like *Temporary failure (…)*, `next_attempt_at` about 1 minute ahead | |
| C2 | Wait ~1 minute (still wrong port) | `attempts = 2`, next try about 5 minutes ahead | |
| C3 | Restore the correct port, save. Wait for the next retry time, or click **Send waiting now** after it | The email is sent; *Sent today* +1. In the **Sent today** list it shows *Took* of a minute or more, tries 2+ and a *retried* badge | |
| C4 | With the wrong port, trigger 6+ notifications quickly | Log shows `email.breaker_open`; sending stops for about 2 minutes, then resumes trying. Nothing is lost | |
| C5 | *(SQL)* on a waiting row: `UPDATE email_outbox SET attempts = 5, next_attempt_at = now() WHERE id = '…';` with the wrong port still set | After the next attempt: `status = FAILED`, *Failed* +1, the row appears in the failed list with *"…gave up after 6 attempts"* | |
| C6 | Put a wrong `SMTP_PASSWORD` in `.env` *(restart)*. Standard trigger | The queue shows **Paused by system** with *"The mail server refused the sign-in … check SMTP_USER / SMTP_PASSWORD"*. The row stays `PENDING` with `attempts = 0` | |
| C7 | Fix the password *(restart)*, click **Resume sending** | The waiting email is sent | |
| C8 | Give a user an address the mail server rejects (if your relay rejects unknown recipients), trigger a notification to them | `status = FAILED` at once (one attempt), reason *Rejected by the mail server (5xx)* | |
| C9 | *(SQL)* `UPDATE email_outbox SET expires_at = now() - interval '1 minute' WHERE status = 'PENDING' AND id = '…';` then **Send waiting now** | `status = CANCELLED`, *"Expired before it could be sent"*; no email arrives | |
| C10 | The failed list's reason column | Shows a short summary only; no server names, no credentials. The full error is in the server log (`email.attempt_failed`) | |

## D. Admin actions (Settings → Email Queue)

| ID | Steps | Expected | Result |
|---|---|---|---|
| D1 | **Pause sending**. Standard trigger | Red *Paused by <admin>* banner. The email is *Waiting*; nothing is sent | |
| D2 | **Resume sending** | Banner gone; the waiting email is sent within seconds | |
| D3 | With a failed email (C5/C8): **Retry** | It leaves the failed list, becomes *Waiting* with fresh attempts, then is sent (if the cause is fixed) | |
| D4 | Several failed emails: **Retry all failed (N)** | All go back to *Waiting* | |
| D5 | A failed email: **Cancel** | It leaves the failed list; *Cancelled / expired* +1; it is never sent | |
| D6 | **Send waiting now** with something waiting and due | It is sent immediately | |
| D7 | Admin → Audit Log after D1–D5 | Entries `EMAIL_QUEUE_PAUSE`, `EMAIL_QUEUE_RESUME`, `EMAIL_QUEUE_RETRY`, `EMAIL_QUEUE_RETRY_ALL`, `EMAIL_QUEUE_CANCEL` with the admin's name | |
| D8 | Sign in as a role with *Settings › View* but not *Edit* | The counters are visible; no buttons | |
| D9 | A role without *Settings › View* calls `GET /api/admin/email-queue` | 403 | |
| D10 | A role without *Settings › Edit* calls `POST /api/admin/email-queue` | 403; nothing changes | |

## E. Resilience

| ID | Steps | Expected | Result |
|---|---|---|---|
| E1 | Pause (D1), queue 3 emails, **stop the app**, start it, **Resume** | All 3 are sent after the restart; none lost, none doubled | |
| E2 | Wrong SMTP port, queue an email, restart the app, restore the port | The email is still waiting after the restart and is sent on its next retry | |
| E3 | *(SQL)* simulate a worker that died mid-send: `UPDATE email_outbox SET status = 'SENDING', locked_at = now() - interval '11 minutes' WHERE id = '…';` | Within ~20 s it returns to `PENDING` (*"The worker stopped while sending - retried"*) and is then sent | |
| E4 | Two app instances (or the app plus `npm run worker:email`) running, trigger 20 notifications | Every email is sent **exactly once** | |
| E5 | `EMAIL_WORKER=external` *(restart)* with **no** worker process. Standard trigger | The email stays *Waiting*; the panel says the worker is a separate process | |
| E6 | Start `npm run worker:email` | The waiting email is sent; log: `email.worker_started` (mode standalone) | |
| E7 | Stop the worker with Ctrl+C while it is sending a batch | It finishes the sends in progress, logs `email.worker_stopped`, exits. Start it again: the rest are sent, none doubled | |
| E8 | *(SQL)* housekeeping: set a sent row's `sent_at` 8 days back, wait for the hourly cleanup (or restart and wait an hour) | Its `body_text` / `body_html` are blank; the row remains | |

## F. BullMQ driver

`.env`: `EMAIL_QUEUE_DRIVER=bullmq` *(restart)*. Redis: `maxmemory-policy noeviction`, `appendonly yes`.

| ID | Steps | Expected | Result |
|---|---|---|---|
| F1 | Open Settings → Email Queue | Text says *Dispatch: BullMQ on Redis (N queued, N sending)*; log: `email.bullmq_worker_started` | |
| F2 | Standard trigger | Email arrives in a second or two; *Sent today* +1. *(SQL)* `status = SENT`, `attempts = 1` | |
| F3 | Repeat **C1–C3** (wrong port, wait, restore) | Same results: back to `PENDING` with a retry time, then sent. Retries follow the same 1 / 5 / 15 min schedule | |
| F4 | Repeat **C6–C7** (wrong password) | The queue pauses; `attempts` not used up; Resume sends it | |
| F5 | Repeat **D1–D5** (pause, resume, retry, cancel) | Same results as with the built-in worker | |
| F6 | **Stop Redis**. Standard trigger | The action succeeds; the email is **still sent** (within ~20 s) by the built-in worker; the panel shows the amber *"Redis isn't reachable…"* notice; log: `email.redis_unavailable` | |
| F7 | **Start Redis** | The notice disappears; the next email goes through BullMQ again | |
| F8 | Pause, queue 3 emails, Resume and immediately run `redis-cli FLUSHALL` (test server only) | Within about 2 minutes the emails are queued again and sent; log: `email.jobs_recovered` | |
| F9 | `EMAIL_WORKER=external` *(restart)*, `npm run worker:email` running. Standard trigger | Sent in a second or two (the app hands off, the worker sends) | |
| F10 | Same, but stop the worker, trigger, start the worker | *Waiting* while stopped; sent when it starts | |
| F11 | Two `npm run worker:email` processes, 30 notifications | Each email sent exactly once; work shared between both | |
| F12 | Switch back: remove `EMAIL_QUEUE_DRIVER` *(restart)* while a few emails are *Waiting* | They are sent by the built-in worker within about 2 minutes; nothing lost or doubled | |
| F13 | Switch to BullMQ again *(restart)* with emails waiting | They are handed to BullMQ and sent | |

## G. Automatic transfer: the scheduler run

Preparation: Settings → Automatic Transfer **on**, delay 0. A test period **P** whose end and submission end are a few minutes ahead, the **next month's period** existing, and in P:

- finding **F-move**: Sent to Branch Manager, operation area not excluded
- finding **F-part**: Partially Rectified (e.g. 1 of 3 cases closed)
- finding **F-kept**: outstanding, in an operation area ticked as **excluded**
- finding **F-closed**: Closed
- finding **F-draft**: Draft

| ID | Steps | Expected | Result |
|---|---|---|---|
| G1 | Before P is due: `scheduler\windows\check.ps1` | **READY**; *Nothing due right now*; *Next period due: P at <time>*. Nothing moves (the check is read-only) | |
| G2 | Wait until the due time has passed and up to 5 minutes more, without anyone signed in | `scheduler\logs\auto-transfer.log`: `ran: … DONE moved=2 kept=1` | |
| G3 | Open the findings | **F-move** and **F-part** are in the next period (F-part with its unclosed cases); **F-kept**, **F-closed**, **F-draft** stay in P | |
| G4 | Settings → Automatic Transfer | P shows as swept, with the moved and kept references and *triggered by scheduler* | |
| G5 | F-move → Transfer History | A new hop P → next period, recorded as an automatic transfer | |
| G6 | Run the task again: `Start-ScheduledTask -TaskName "NIB Control360 Auto Transfer"` | Log: `nothing due`. P is **not** swept twice | |
| G7 | A period due whose **next period doesn't exist** | Nothing moves; status *waiting for the next period*. Create that period → the next run sweeps it | |
| G8 | Two past periods both due (create them with outstanding findings, feature off; then switch it on) | One run sweeps both, oldest first; findings end in the newest period with one hop per period | |
| G9 | Delay = 1 hour, a period ending now | Not swept until an hour after the due time; `check.ps1` shows the later time | |
| G10 | Switch the feature **off**, let a period become due | Nothing moves; `check.ps1` says switched OFF (NOT READY). Switch on → swept on the next run | |
| G11 | Disable the task, let a period become due, then sign in as any user and leave a page open | Swept within about 5 minutes, recorded *triggered by app* | |
| G12 | Stop the app at the due time; start it 10 minutes later | The first run after the start sweeps the period | |
| G13 | **Lock** a period before it is due | Locking moves nothing; the sweep still happens at the due time | |
| G14 | After a sweep, edit P's end / submission end to a later time | P is due again at the new time and swept once more for anything outstanding then | |
| G15 | `POST /api/system/auto-transfer` with a **wrong** secret | 403; nothing moves. After several wrong tries: 429 | |
| G16 | Remove `AUTO_TRANSFER_CRON_SECRET` *(restart)* | The endpoint answers 404; `check.ps1`: NOT READY with the reason | |
| G17 | A laptop/server **on battery** | The task still runs (`check.ps1`: *Allowed to run on battery*) | |

## H. Both together

| ID | Steps | Expected | Result |
|---|---|---|---|
| H1 | Run G2 with BM and BC of the branch having mailboxes | After the sweep they get the *Automatic transfer* bell notification **and** email; *Sent today* rises by the number of recipients | |
| H2 | Switch **Automatic transfer** off in Email Events, run a sweep | Findings move; bell notifications are created; **no** emails queued | |
| H3 | Pause the email queue, run a sweep, resume | The sweep completes immediately; its emails wait and are sent on resume | |
| H4 | Wrong SMTP port during a sweep | The sweep completes and is recorded; its emails retry later. The transfer is **not** rolled back by the mail failure | |
| H5 | A sweep moving 30+ findings across several branches | The sweep finishes in seconds; emails go out afterwards at the rate limit; none doubled | |
| H6 | Stop the app right after a sweep's log line | After the restart: the period is still swept (not repeated) and any unsent emails from it are delivered | |

## I. Rectification reminders (daily scheduled run)

Details: [rectification-reminders.md](rectification-reminders.md). Preparation: Settings → Rectification Reminders **on**, *Remind after* 1 day, *Send at* a few minutes ahead, today's weekday ticked, saved. A finding **F-old** sent to the branch 1+ day ago *(SQL to backdate its `QUEUE_BRANCH_MANAGER` step in `finding_transitions` if needed)* and **F-new** sent today.

| ID | Steps | Expected | Result |
|---|---|---|---|
| I1 | Before the send time: `scheduler\windows\check.ps1` | *Rectification reminders: ON: daily at <time>…*, *Next run: <today, time>*, *Overdue findings right now: 1* | |
| I2 | Wait until the time has passed and up to 5 minutes more, with nobody signed in | BM and BC of the branch get the *Rectification reminder* bell and email for **F-old** only. Log: `reminders: 1 finding(s), 2 user(s) notified` | |
| I3 | Settings → Rectification Reminders | *today's run is done; next run <next ticked day>*; *Last run … by the scheduler - 1 finding(s), 2 user(s)* | |
| I4 | Start the task again, and sign in as any user | Nothing more is sent: one run per day | |
| I5 | Next day's run (or **Run now**) with F-old untouched and *Remind after* 1 | F-old is reminded again (a day has passed) | |
| I6 | *Remind after* 5; F-old last rectified 6 days ago, **district verified yesterday** | It **is** reminded: verification isn't branch progress | |
| I7 | The branch records a rectification on F-old today | Not reminded for the next 5 days | |
| I8 | A **Rectified** finding (all cases recorded, awaiting close), untouched for weeks | Never reminded | |
| I9 | Untick today's weekday, save | `check.ps1` and the panel show the next ticked day; nothing runs today | |
| I10 | **Run now** on an unticked day / before the send time | Overdue findings are reminded at once; the run is recorded *by an administrator*; Audit Log has `REMINDERS_RUN_NOW` | |
| I11 | **Run now** again straight away | "No finding is overdue for a reminder"; nothing sent | |
| I12 | Stop the app across the send time, start it an hour later | The run happens on the scheduler's next call that day | |
| I13 | Disable the scheduler task; sign in after the send time and leave a page open | The run happens within about 5 minutes, recorded *by the app* | |
| I14 | Switch reminders **off**, save | No run; `check.ps1`: *Switched OFF*; **Run now** is hidden | |
| I15 | Switch **Rectification reminder** off in Email Events, then **Run now** with something overdue | Bell only; no email queued | |
| I16 | Wrong SMTP port during a run | Bell notifications appear; the emails wait in the email queue and are sent after the port is fixed | |
| I17 | A role without *Settings › Edit* calls `POST /api/admin/reminders` | 403; nothing sent | |

## J. Regression: nothing else changed

| ID | Steps | Expected | Result |
|---|---|---|---|
| J1 | Full workflow: register → submit → district approve → HO approve → rectify → verify → close | Every step works as before; each step's notification email arrives once | |
| J2 | Return and reject at each review stage | The registrant gets the email with the reason | |
| J3 | Adjustment: submit → approve; return; reject | *Adjustment submitted / approved / returned / rejected* emails arrive | |
| J4 | Manual transfer of a finding | *Transferred* email arrives | |
| J5 | Comment and reply on a finding | The author gets the *Comment* email | |
| J6 | With SMTP provider **None** | Every workflow action still works; no emails; no errors | |
| J7 | Response time of Submit with a slow or unreachable mail server | Not slower than normal: the action never waits for the mail server | |
| J8 | Automated suite: `npx vitest run` | All tests pass | |

---

## Sign-off

| Area | Cases | Passed | Failed | Tester | Date |
|---|---|---|---|---|---|
| A. Email creation rules | 11 | | | | |
| B. Built-in delivery | 8 | | | | |
| C. Failures and retries | 10 | | | | |
| D. Admin actions | 10 | | | | |
| E. Resilience | 8 | | | | |
| F. BullMQ | 13 | | | | |
| G. Automatic transfer | 17 | | | | |
| H. Both together | 6 | | | | |
| I. Rectification reminders | 17 | | | | |
| J. Regression | 8 | | | | |

**Restore after testing:** correct SMTP host / port / password, Email Events all on, queue resumed, `EMAIL_QUEUE_DRIVER` / `EMAIL_WORKER` as intended, Redis running, scheduler task enabled, Automatic Transfer settings (on/off, delay, exclusions) and Rectification Reminders settings (on/off, days, time, weekdays) as intended, and delete the test periods and findings.
