# Current Period and Automatic Transfer: UAT Test Cases

Test cases for:

- **The current period**: the previous calendar month's period is the default everywhere and the only period whose findings can be adjusted
- **The automatic transfer**: on the 1st of each month at 00:00, outstanding findings move from the period that stops being current into the new current period ([auto-transfer.md](auto-transfer.md))

The tests move the **UAT server's clock** forward, so the month change can be seen today instead of waiting for the real 1st. Run them on the **UAT server only**, never on production: moved findings can't be moved back automatically, and a period is swept only once.

**Result column:** write Pass / Fail and a note.

---

## 0. Before you start

### Environment

| Need | Check |
|---|---|
| App running | Sign in works |
| Scheduler task installed | `scheduler\windows\check.ps1` shows *Task installed* |
| Automatic Transfer on | Settings → Automatic Transfer: switched on, **Run after = 0**, the test operation area and source **ticked** |
| Administrator PowerShell on the server | Needed to change the clock |
| Optional: reminders off | Settings → Rectification Reminders off, so the date jumps don't send real reminders |

### Test users

| User | Role | Used as |
|---|---|---|
| BC | Branch Controller, branch X | Registers findings, requests adjustments |
| BM | Branch Manager, branch X | Rectifies; receives the transfer message |
| DC | District Controller | District review |
| HO | HO Controller | HO review, manual transfer |
| ADMIN | Administrator | Reporting Periods, Settings |

### Test data (prepared on the real date, in October)

| Item | Set up as |
|---|---|
| Period **2026-09** | Open. Submission window extended to **31 Oct 23:59** |
| Period **2026-10** | Exists and is Open |
| Period **2026-11** | Not created yet (created in §E) |
| Finding **A** | 2026-09. Approved, with the branch (Sent to Branch Manager). Ticked area and source. Optional: one case rectified, not closed |
| Finding **B** | 2026-09. Approved, with the branch. **Unticked** area or source |
| Finding **C** | 2026-09. **Draft** |
| Finding **D** | 2026-09. **Closed** |
| Finding **E** | 2026-09. Submitted, still in **district or HO review** |
| Finding **F** | 2026-10. Approved, with the branch, ticked area and source |
| Finding **G** | 2026-09. Approved, with the branch, operation area listed under Settings → Revolving Findings (for adjustments) |

Write down each finding's reference number.

### Where to look

| What | Where |
|---|---|
| Transfer status per period | Admin → **Reporting Periods**, *Auto-transfer* column |
| What is due, last sweep, task state | `powershell -ExecutionPolicy Bypass -File scheduler\windows\check.ps1` |
| Each run | `scheduler\logs\auto-transfer.log` |
| A finding's moves | Finding page → **Transfer History** |
| Audit | Admin → Audit Log, action `PERIOD_AUTO_TRANSFER` |
| Notifications | The bell of HO and BM |

### Changing the clock (Administrator PowerShell)

```powershell
# Once, before the first change: stop Windows correcting the time
Stop-Service w32time
Set-Service w32time -StartupType Disabled

# Each step
Set-Date "2026-10-31 23:50"
```

After a jump of more than 8 hours everyone is signed out (session limit). Sign in again.

### Running the check at once

The task runs every 5 minutes by itself. To run it now:

```powershell
Start-ScheduledTask -TaskName "NIB Control360 Auto Transfer"
```

Then wait about a minute and run `check.ps1`.

**Known message, not a failure:** if the task was already running (Windows often starts a catch-up run right after the clock changes), Windows refuses the second start and `check.ps1` shows:

```
[FAIL] Last run ... - result 2147946720 (see the log)
```

That code (`0x800710E0`) means "the request was refused because an instance is already running". Check the log: if it has a new line for that time, the app ran normally. The message clears after the next run that isn't refused.

---

## A. Baseline (real date, in October)

| ID | Steps | Expected | Result |
|---|---|---|---|
| A1 | Open the HO, District and Branch dashboards, the Findings list and Reports | Each opens on **2026-09** | |
| A2 | Reporting Periods → 2026-09 *Auto-transfer* | *Runs after 01/11/2026, 00:00:00*. If it shows **Done** (swept under the old rule), edit 2026-09, save its submission window, and check it changes to *Runs after 01/11/2026* | |
| A3 | Reporting Periods → 2026-10 | *Runs after 01/12/2026, 00:00:00* | |
| A4 | Open Register Finding | Period preselected **2026-09**; finding date **blank** | |
| A5 | Open finding G → **Adjust outstanding** | Available | |
| A6 | Open finding F → Adjust outstanding | Not available: only findings in the current period (2026-09) can be adjusted | |
| A7 | Run `check.ps1` | *Nothing due right now*; *Next period due: 2026-09 at 11/01/2026 00:00:00* | |

## B. The last minutes of October (31 Oct 23:50)

```powershell
Set-Date "2026-10-31 23:50"
```

| ID | Steps | Expected | Result |
|---|---|---|---|
| B1 | Start the task, wait a minute, run `check.ps1` | As below. Nothing moved | |
| B2 | Open findings A–F | Each still in its starting period | |
| B3 | Open a dashboard | Still **2026-09** | |
| B4 | Open the log | A new line *nothing due* | |

Expected `check.ps1` (task result may show the known message above):

```
2. App and feature
  [OK]   App answered and accepted the secret
  [OK]   Installed and switched ON (delay 0 h, ...)
  [OK]   Nothing due right now
  [INFO] Next period due: 2026-09 at 11/01/2026 00:00:00
4. Log
         2026-10-31T23:5x:xx nothing due
```

## C. The month change (1 Nov 00:05)

```powershell
Set-Date "2026-11-01 00:05"
Start-ScheduledTask -TaskName "NIB Control360 Auto Transfer"
```

Wait about a minute, then run the checks.

| ID | Steps | Expected | Result |
|---|---|---|---|
| C1 | Run `check.ps1` | *Last sweep: 2026-09 -> 2026-10 ...* with the moved and kept counts; *Next period due: 2026-10 at 12/01/2026 00:00:00* | |
| C2 | Open the log | A line for the sweep of 2026-09 | |
| C3 | Finding **A** | Now in **2026-10**. Status Transferred | |
| C4 | Finding A → Transfer History | Method **Automatic**, by *System (automatic transfer)*, reason *"Automatic transfer: 2026-09 stopped being the current period (…)"* | |
| C5 | Finding A, if a case was rectified but not closed | That rectification is reset: the branch must rectify it again | |
| C6 | Finding **B** (unticked) | Still in 2026-09 | |
| C7 | Findings **C** (draft), **D** (closed), **E** (in review) | Still in 2026-09 | |
| C8 | Finding **F** | Still in 2026-10 (not moved on to 2026-11) | |
| C9 | Reporting Periods → 2026-09 | **Done** · moved and kept counts · *by scheduler* | |
| C10 | Reporting Periods → 2026-10 | *Runs after 01/12/2026, 00:00:00* | |
| C11 | HO's bell | One summary: *2026-09 is no longer current: N finding(s) moved to 2026-10*, mentioning the kept ones | |
| C12 | BM's bell | One message: *N of your findings were still outstanding in 2026-09; they were carried into 2026-10* (one per branch, not per finding) | |
| C13 | Audit Log | One `PERIOD_AUTO_TRANSFER` entry for 2026-09 listing moved and kept references | |
| C14 | Start the task again, wait, check | Nothing more moves; 2026-09 is swept only once | |

## D. After the change (still 1 Nov)

| ID | Steps | Expected | Result |
|---|---|---|---|
| D1 | Open the dashboards, Findings list, Reports and report templates | Each opens on **2026-10** | |
| D2 | Open a dashboard filtered to 2026-09 | Finding A shows as *Transferred → 2026-10*; cases closed in 2026-09 stay counted there | |
| D3 | Register Finding | Period preselected **2026-10**; finding date blank | |
| D4 | Adjust finding **A** (now in 2026-10) | Available | |
| D5 | Adjust finding **F** | Available | |
| D6 | Adjust a finding still in 2026-09 (e.g. B, if in a revolving area) | Not available: only 2026-10 findings can be adjusted | |
| D7 | Submit an adjustment on A | Refused unless 2026-10's submission window has been extended past 31 Oct: *submission window isn't open* (save as draft works) | |
| D8 | Extend 2026-10's submission window to 30 Nov, submit the adjustment again | Submitted; once approved it is reported under 2026-10 | |
| D9 | Register and submit a finding in 2026-10 with 2026-10's window at its default | Draft only; submit refused | |
| D10 | Approve finding **E** (district, then HO) | Lands with the branch in **2026-09**; not moved automatically (2026-09 was already swept) | |
| D11 | HO transfers finding E to 2026-10 by hand | Moved; Transfer History shows method **Manual** | |
| D12 | Submit draft **C** in 2026-09 | Refused if 2026-09's window has closed; edit its period to 2026-10 (it gets a new reference number), then submit if 2026-10's window is open | |

## E. The next month (1 Dec 00:05)

| ID | Steps | Expected | Result |
|---|---|---|---|
| E1 | Do **not** create 2026-11. `Set-Date "2026-12-01 00:05"`, start the task, check | 2026-10 shows **Waiting: no next period**; nothing moves; HO is told once to create the next period | |
| E2 | Start the task again | No second "create the next period" notification | |
| E3 | Create 2026-11 (any status), start the task, check | Outstanding findings in 2026-10 (A, F, E) move to **2026-11**; 2026-10 shows Done | |
| E4 | Open a dashboard | Opens on **2026-11** | |

To test a locked destination, create 2026-11 **locked** in E3: the findings still move (a lock only blocks submitting).

## F. Missed months (optional)

| ID | Steps | Expected | Result |
|---|---|---|---|
| F1 | Create and open 2026-12. Leave a finding outstanding in 2026-11. Set the clock to **2027-02-01 00:05**, start the task | 2026-11 and 2026-12 are swept oldest first in one run; the finding ends in the period whose 1st has not yet come (2027-01 if it exists, otherwise 2026-12 shows *Waiting: no next period*) | |

## G. Variations: window not extended, period locked

Run on the real date in October (2026-09 is current). Prepare the findings for §A–§F first, because both variations stop new submissions into 2026-09.

### G1. 2026-09's submission window not extended (ends 30 Sep)

| ID | Steps | Expected | Result |
|---|---|---|---|
| G1.1 | Register Finding in 2026-09 | Notice *2026-09 isn't accepting submissions today*; **Save Draft** works, **Save & Submit** is disabled | |
| G1.2 | Submit an existing 2026-09 draft | Refused: *2026-09's submission window has closed - save this as a draft instead* | |
| G1.3 | Resubmit a returned 2026-09 finding | Refused, same message | |
| G1.4 | Adjust finding G: Save draft, then Submit | Draft saved; submit refused: *submission window isn't open* | |
| G1.5 | Review, approve, rectify, verify and close existing 2026-09 findings | All work as normal | |
| G1.6 | Manual transfer out of / into 2026-09 | Works | |
| G1.7 | Reporting Periods → 2026-09 | Still *Runs after 01/11/2026*: the window doesn't change the transfer date | |
| G1.8 | Month change (§C) | The same findings move as in §C | |

### G2. 2026-09 locked, drafts allowed

| ID | Steps | Expected | Result |
|---|---|---|---|
| G2.1 | Register Finding | 2026-09 is listed and preselected; **Save Draft** works; submit refused: *2026-09 is locked - save as a draft instead* | |
| G2.2 | Submit an existing 2026-09 draft | Refused: *2026-09 is locked and cannot accept changes* | |
| G2.3 | Adjust finding G: Save draft, then Submit | Draft saved; submit refused: *2026-09 is locked* | |
| G2.4 | Review, approve, rectify, verify, close, reverse, comments, evidence on 2026-09 findings | All work as normal | |
| G2.5 | Manual transfer out of / into 2026-09 | Works | |
| G2.6 | Month change (§C) | The same findings move as in §C: a lock never blocks the automatic transfer | |
| G2.7 | DC and BM bells after locking | A *2026-09 locked* notification | |

### G3. 2026-09 locked, drafts blocked

| ID | Steps | Expected | Result |
|---|---|---|---|
| G3.1 | Register Finding | 2026-09 is **not** in the period list; the form preselects an earlier period that accepts drafts, or none | |
| G3.2 | Edit or delete an existing 2026-09 draft | Refused: *2026-09 is locked and drafts are blocked for it* | |
| G3.3 | Everything in G2.4–G2.6 | Same as G2 | |

### G4. 2026-10 locked when it becomes current

| ID | Steps | Expected | Result |
|---|---|---|---|
| G4.1 | Lock 2026-10, then run the month change (§C) | Findings still move into 2026-10 | |
| G4.2 | On 1 Nov, submit a finding or an adjustment in 2026-10 | Refused: 2026-10 is locked. Drafts follow its *drafts allowed* setting | |
| G4.3 | BM rectifies finding A in 2026-10; DC verifies; HO closes | All work | |
| G4.4 | Unlock 2026-10 (and extend its window), submit again | Accepted | |

## H. Put the clock back

```powershell
Set-Service w32time -StartupType Automatic
Start-Service w32time
w32tm /resync
```

| ID | Steps | Expected | Result |
|---|---|---|---|
| H1 | After the clock is back to the real date, open Reporting Periods | Periods swept during the test still show **Done**; moved findings stay where they are | |
| H2 | To repeat the test: save 2026-09's submission window | 2026-09 shows *Runs after 01/11/2026* again (re-armed) | |

---

## Sign-off

| Area | Cases | Passed | Failed | Tester | Date |
|---|---|---|---|---|---|
| A. Baseline | 7 | | | | |
| B. Last minutes of October | 4 | | | | |
| C. Month change | 14 | | | | |
| D. After the change | 12 | | | | |
| E. Next month | 4 | | | | |
| F. Missed months | 1 | | | | |
| G. Window not extended / locked | 22 | | | | |
| H. Clock back | 2 | | | | |

**Restore after testing:** server clock synchronised, Rectification Reminders and Automatic Transfer settings as intended, submission windows as intended, and delete the test periods and findings (or use Dev Reset on a development server).
