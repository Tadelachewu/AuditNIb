# Rectification Reminders

A finding that sits with the branch too long without rectification progress gets a reminder: a bell notification and an email to the branch's Branch Manager / Controller.

The reminder now runs **once a day at a set time, on a schedule**, whether or not anyone is signed in. Before, it was only checked while someone had the app open.

---

## 1. Settings: Admin → Settings → Rectification Reminders

| Setting | Meaning | Default |
|---|---|---|
| **Send reminder notifications…** | On / off | Off |
| **Remind after (days without progress)** | How many calendar days a finding may wait before it is reminded, and how long before it is reminded again | 7 |
| **Send at (server time)** | Time of day of the daily run | 08:00 |
| **On these days** | Weekdays it runs on | Monday to Friday |

Save the Settings form to apply a change. The panel under the fields shows the **saved** schedule: today's run done or not, the next run, how many findings would be reminded now, the last runs and who started them, and a **Run now** button.

## 2. Which findings are reminded

All three must hold at the moment of the run:

| # | Rule |
|---|---|
| 1 | **It is waiting for the branch:** Sent to Branch Manager, Sent to Branch Manager/R (reversed), Partially Rectified, Rectification Returned, or Transferred with something still to rectify |
| 2 | **No progress for N calendar days** (N = *Remind after*) |
| 3 | **Not reminded in the last N calendar days** |

Not reminded: drafts, findings in review, **Rectified** (the branch has done its part; it waits for verification and closing), Closed, Rejected.

### What counts as progress

The count restarts from the latest of these steps on the finding:

| Restarts the count | Doesn't restart it |
|---|---|
| Approved and sent to the branch | Comments |
| The branch records a rectification | Evidence uploads |
| The branch resubmits a returned rectification | District verifies a rectification |
| A rectification is returned to the branch | A portion is closed |
| Reverse (back with the branch) | An adjustment (in review or approved) |
| Transfer to another period (manual or automatic) | Edits that don't change the workflow |

Days are **calendar days**: sent on the 7th at 17:00, with N = 5, it is reminded by the run on the 12th.

### Who is reminded

Every active user whose role has **Findings › Rectify** for that finding's branch (by default the Branch Manager and Branch Controller). Each gets the bell notification, and the email when *Rectification reminder* is on in Settings → Email Events and they have an address. The email goes through the email queue ([email-queue.md](email-queue.md)), so it is retried if the mail server is down.

## 3. When it runs

- **Due:** on a ticked weekday, from the *Send at* time until midnight, if today's run hasn't been done.
- **Once a day:** the day's run is recorded; it never runs twice, however many servers, scheduler calls or signed-in users there are.
- **Server was down at the send time:** it runs at the first call after it is back, the same day. A whole missed **day** is not replayed (the findings are simply reminded by the next run).
- **Times are the server's local time.**

### What starts it

| Trigger | When | Recorded as |
|---|---|---|
| **Scheduler** (Windows task / cron, every 5 minutes) | Within 5 minutes of the send time, with nobody signed in | *scheduler* |
| **Signed-in user's page** (backup) | The first time someone is signed in after the send time, checked at most every 5 minutes per server | *app* |
| **Run now** (Settings) | Immediately, whatever the time or weekday | *administrator* |

The scheduler is the **same task as the automatic transfer** ([scheduler/README.md](../scheduler/README.md)): one call runs both jobs. If that task is already installed, **nothing more needs installing**.

**Run now** reminds every finding that is overdue at that moment. A finding reminded within the last N days is still skipped, so pressing it twice sends nothing new. It is written to the audit log (`REMINDERS_RUN_NOW`).

### Checking it

```powershell
powershell -ExecutionPolicy Bypass -File scheduler\windows\check.ps1
```

The **Rectification reminders** lines show: on / off, the send time, today's run done or due, the next run, how many findings are overdue now, and the last run with who started it. They are informational and don't change READY / NOT READY. The task's log (`scheduler\logs\auto-transfer.log`) gets a line such as `reminders: 4 finding(s), 6 user(s) notified` when a run sends something.

## 4. Example (Remind after = 5, 08:00, Monday to Friday)

| Date | Event | Reminder |
|---|---|---|
| Thu 1 Oct | HO approves → Sent to Branch Manager | Count starts |
| Tue 6 Oct 08:00 | Daily run | ✅ "after 5 days" |
| Fri 9 Oct | The branch records a partial rectification | Count restarts |
| Mon 12 Oct | District verifies it | Count does **not** restart |
| Wed 14 Oct 08:00 | Daily run | ✅ 5 days since the rectification (and 8 since the last reminder) |
| Sat 17 / Sun 18 Oct | Not ticked days | No run |
| Mon 19 Oct 08:00 | Daily run | ✅ 5 days since the last reminder |

## 5. Install

1. `npx prisma migrate deploy` (applies `20261011120000_reminder_runs`: the table `reminder_runs`).
2. `npx prisma generate` (or `npm install`), rebuild, restart.
3. Make sure the scheduler task is installed and READY ([scheduler/README.md](../scheduler/README.md)).
4. Settings → Rectification Reminders: switch on, set the days, time and weekdays, **Save**.

Before step 1 the app still works: the old check keeps running (only while someone is signed in, at most once an hour), the time and weekdays aren't used, and the Settings panel says the daily run isn't installed.

## 6. What changed from the old check

| | Before | Now |
|---|---|---|
| Runs when nobody is signed in | No | Yes (scheduler) |
| Time of day | Any, whenever someone signed in | The set time, on the set weekdays |
| Lateness | Up to an hour, plus however long nobody was signed in | Within 5 minutes |
| Duplicates from two simultaneous checks | Possible | No: a lock, and one recorded run per day |
| "Days without progress" | Reset by any update (district verification, partial close, adjustment…) | Reset only by branch work and by the finding being put in the branch's hands |
| Day counting | Hours since the last update | Calendar days |
| Run history | None | Last runs in Settings, with who started them |
| Manual run | None | **Run now** |

## 7. Design (for developers)

| Part | File |
|---|---|
| Types | `src/lib/reminders/types.ts` (client-safe) |
| Rules (pure): schedule, calendar days, progress steps, overdue selection | `src/lib/reminders/rules.ts` |
| Run log storage (`reminder_runs`, plain SQL) | `src/lib/reminders/store.ts` |
| The run: lock, once-per-day record, notifications, status | `src/lib/reminders/service.ts` |
| Scheduler call (runs the automatic transfer, then the reminders) | `src/app/api/system/auto-transfer/route.ts` |
| Signed-in backup | `src/app/api/notifications/route.ts` |
| Admin API / UI | `src/app/api/admin/reminders`, `src/components/admin/ReminderStatusPanel.tsx`, Settings page |
| Tests | `tests/reminders.test.ts` |

- **Once a day:** the scheduled run's id is its local date, inserted with `ON CONFLICT DO NOTHING` in the same transaction as the notifications. A second run of the same day inserts nothing and the whole transaction is rolled back. A Redis lock (in-process fallback) avoids even starting it twice.
- **Settings** are stored in the existing `rectificationReminders` JSON (`sendAt`, `days` added; no column change). `lastCheckedAt` is only used by the old check before the migration.
- **Dev Reset** forgets the runs, so a reset system can run again the same day.
- Log events: `reminders.ran`, `reminders.failed`, `reminders.not_installed`.

## 8. Test cases

**Automated** (`tests/reminders.test.ts`): defaults for older settings; due only after the send time on a ticked day and once a day; the next run; calendar-day counting; overdue selection from the last progress step; which steps restart the count; only findings waiting for the branch; re-reminding after the threshold; the run notifies the branch's rectifiers and records itself; never twice a day; two simultaneous callers; not due / off / locked / not installed; the signed-in backup is throttled; Run now; status.

**Manual**

| # | Steps | Expected |
|---|---|---|
| R1 | Reminders on, 1 day, *Send at* a few minutes ahead, today ticked. A finding sent to the branch 1+ day ago. Nobody signed in | Within 5 minutes of the time the Branch Manager / Controller get the bell and the email; the log has `reminders: 1 finding(s)…`; Settings shows the run *by the scheduler* |
| R2 | Run the task again | Nothing is sent; today's run is done |
| R3 | Untick today's weekday, save | Not due today; the panel shows the next ticked day |
| R4 | A finding the district verified yesterday, but last rectified 6 days ago (N = 5) | It **is** reminded |
| R5 | The branch records a rectification today | Not reminded for N days |
| R6 | **Run now** on a Sunday | Overdue findings are reminded; pressing it again reminds nobody |
| R7 | Stop the app over the send time, start it an hour later | The run happens on the scheduler's next call that day |
| R8 | Disable the scheduler task; sign in after the send time | The run happens within 5 minutes, recorded *by the app* |
| R9 | Mail server down during the run | Bell notifications appear; the emails wait in the email queue and are sent later |
| R10 | Switch *Rectification reminder* off in Email Events | Bell only |
