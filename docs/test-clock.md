# Test Clock (`APP_TEST_NOW`)

Simulates the **business date** on a test or UAT server, so date-driven features (the current period, the automatic transfer, rectification reminders, submission windows) can be tested today, without changing the server's Windows clock. The database, Redis, Windows and any other app on the server keep the real time.

**Never on production:** the setting is ignored unless `APP_ENV` is set to something other than `production`.

---

## 1. Switching it on and off

In the server's `.env`:

```
APP_ENV=development           # or uat - anything except production
APP_TEST_NOW=2026-11-01T00:05:00
```

Then **restart the app and the email worker** (`npm run dev` / `npm start`, or the services).

- The value is a local date and time, `YYYY-MM-DDTHH:MM:SS`.
- When the app starts, its business clock is set to that moment, and then **keeps ticking**: one minute later it is 00:06.
- To move to another date, change the value and restart.
- **To switch it off:** delete the line (or leave it empty) and restart.

While it is on:
- **On screen:** every page shows a purple bar, **"Test clock: 01/11/2026, 00:05 …"**.
- **In the log:** the app writes the warning `test_clock.on` (with the simulated time).

An `APP_TEST_NOW` that is ignored (production, no `APP_ENV`, or not a date) is logged as `test_clock.ignored`, and the app runs on real time.

---

## 2. What follows the test date

| Feature | Uses the test date for |
|---|---|
| **Current period** | The default period on dashboards, Findings, Reports, report templates, exports and Register Finding; which findings can be adjusted |
| **Automatic transfer** | When a period is due (1st of the month after next), what is due now, "Runs after" on Reporting Periods, `check.ps1` / scheduler status |
| **Rectification reminders** | Send time and weekdays, "days without progress", next run |
| **Submission windows** | Submitting a finding or an adjustment |
| **Finding date** | "Can't be in the future", Register Finding's default date |
| **Case age** | Days since registration |
| **Date defaults** | Weekly Executive Summary weeks, Mid-Month Snapshot "today", report-template exports' "as of" date, Reports' Today / Week / Month filter, a new scoring rule's effective date, a new reporting period's default dates |

The browser gets the business date from the server, so a tester's own PC date doesn't matter.

## 3. What keeps the real time

| Feature | Why |
|---|---|
| Sessions, idle and absolute timeouts, sign-in lockouts, rate limits | Security timers must stay real |
| Email queue and retries | The database decides when an email is due by its own (real) clock |
| When a record was created or changed, the audit log, notification times, transfer history dates | Records always show when something really happened |
| Communications withdraw window (10 minutes) | A real "undo" window |

So a transfer done on the test date of 1 November shows **today's real date** in Transfer History and the Audit Log. The business result (what moved, which period is current) is what the test checks. The Audit Log's automatic-transfer entry adds "*on the test clock: …*", and the job log lines have `testClock: true`.

---

## 4. Testing the automatic transfer with it

The test cases are in [current-period-uat.md](current-period-uat.md). In short:

1. `APP_TEST_NOW=2026-10-31T23:50:00`, restart. Nothing is due; dashboards open on 2026-09.
2. `APP_TEST_NOW=2026-11-01T00:05:00`, restart. Start the scheduler task (or open any page and wait up to 5 minutes). The outstanding findings of 2026-09 move to 2026-10; dashboards open on 2026-10.
3. Delete the line, restart.

**A period is swept only once.** If 2026-09 already shows **Done** on Reporting Periods (for example from an earlier test), nothing moves on 1 November. You can either:
- **Re-arm it:** with `APP_TEST_NOW=2026-10-31T23:50:00` running, edit 2026-09 and save its submission window, then switch to 1 November as above.
- **Test the next month instead:** `APP_TEST_NOW=2026-12-01T00:05:00` sweeps 2026-10 into 2026-11 (2026-11 must exist).

Jumping the date back does **not** undo a transfer. Use a test database.

---

## 5. For developers

- `src/lib/clock.ts`: `appNow()` / `appDate()`, the business clock (real time plus the test offset). Use it for anything that asks "what day is it" for a business rule; keep `Date.now()` for real timestamps and timers.
- The offset is fixed when the server first reads it (at start). In the browser it comes from the server (`TestClockProvider` in the app layout), and `TestClockBar` shows the banner.
- `src/lib/testClock.ts`: the status and its log line. Tests: `tests/testClock.test.ts`.
