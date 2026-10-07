# Scheduler files: automatic transfer at period end

Ready-to-use files for running the **automatic transfer** on a schedule, every 5 minutes. A scheduler is optional: without one it still runs within about 5 minutes while anyone is using the app. With one it runs on time even when nobody is signed in. Full guide: [docs/auto-transfer.md](../docs/auto-transfer.md) §4.

The scripts:
- read `AUTO_TRANSFER_CRON_SECRET` and `PORT` from the app's own `.env` / `.env.local`, so the secret lives in one place;
- call `http://localhost:<PORT>/api/system/auto-transfer`;
- log to `scheduler/logs/auto-transfer.log` (last 2,000 lines; not in git).

## Is it ready? (read-only check)

```powershell
powershell -ExecutionPolicy Bypass -File scheduler\windows\check.ps1     # Windows
```
```sh
sh scheduler/linux/check.sh                                              # Linux / macOS
```

It never moves anything. It checks:
- the secret in `.env`;
- that the app answers and accepts it;
- that Automatic Transfer is installed and **on**;
- what is due now, and when the next period becomes due;
- the last sweep, and whether it was started **by the scheduler or by the in-app check**;
- the scheduled task / cron entry (installed, last result, next run);
- the last log lines.

It ends with **READY** or **NOT READY** and the reason.

## First, once

1. `.env` must have `AUTO_TRANSFER_CRON_SECRET=<32+ random characters>`, and the app must have been restarted after setting it.
2. Run the script once by hand (below). The log should say `nothing due` or `ran: …`.

Windows: follow the numbered steps in the next section.

## Windows: Task Scheduler (background run)

The task **NIB Control360 Auto Transfer** runs every 5 minutes as **SYSTEM**, in the background (no window), whether or not anyone is signed in, on AC power or battery. Each run only calls the app's endpoint, so **the app itself must be running** for anything to transfer.

| File | Purpose |
|---|---|
| `windows/auto-transfer.ps1` | The call (what the task runs) |
| `windows/install-task.ps1` | Creates or updates the task |
| `windows/uninstall-task.ps1` | Removes the task |
| `windows/check.ps1` | Read-only readiness check |

The examples use `C:\Users\Admin\Desktop\AuditNIb` as the app folder; use yours.

### Step 1: Set the secret (once)

In the app folder's `.env`, add a random value of **at least 16 characters** (32+ recommended):

```
AUTO_TRANSFER_CRON_SECRET=put-a-long-random-value-here
```

To generate one in PowerShell:

```powershell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | % {[char]$_})
```

If the app doesn't run on port `9005`, also set `PORT=<port>` in `.env`. The task reads both values from `.env` / `.env.local`.

### Step 2: Restart the app

The app reads the secret only when it starts:

```powershell
npm run build
npm start          # or restart your Windows service / pm2
```

Without a restart the endpoint answers **404** (secret not set).

### Step 3: Switch the feature on

In the app: **Settings → Automatic Transfer** → tick *Transfer outstanding findings automatically…* → **Save automatic transfer**. Optionally exclude operation areas or set a delay.

### Step 4: Test one run by hand (normal PowerShell)

```powershell
cd C:\Users\Admin\Desktop\AuditNIb
powershell -ExecutionPolicy Bypass -File scheduler\windows\auto-transfer.ps1
Get-Content scheduler\logs\auto-transfer.log -Tail 5
```

The log should say `nothing due` or `ran: …`. A 403 / 404 / connection error means steps 1–2 aren't done (see the table at the end).

### Step 5: Install the background task (ADMINISTRATOR PowerShell)

Start menu → right-click **Windows PowerShell** → **Run as administrator**:

```powershell
cd C:\Users\Admin\Desktop\AuditNIb
powershell -ExecutionPolicy Bypass -File scheduler\windows\install-task.ps1
```

→ `Installed 'NIB Control360 Auto Transfer': runs every 5 minutes.`

### Step 6: Start it now and verify (same administrator window)

```powershell
Start-ScheduledTask -TaskName "NIB Control360 Auto Transfer"
powershell -ExecutionPolicy Bypass -File scheduler\windows\check.ps1
```

`check.ps1` changes nothing and must end with **READY: the scheduler will run the automatic transfer.** It checks:
- the secret is set;
- the app answers with that secret;
- the feature is on;
- what's due;
- the task exists, is enabled and is allowed on battery;
- the last result is `0`.

Run it as administrator: in a normal window an installed task can look missing.

### Day-to-day

| Need | How |
|---|---|
| See what it did | `Get-Content scheduler\logs\auto-transfer.log -Tail 20` |
| Was a sweep done by the scheduler? | Settings → Automatic Transfer shows the last run and who triggered it (*scheduler* or *app*); `check.ps1` shows it too |
| Run immediately | `Start-ScheduledTask -TaskName "NIB Control360 Auto Transfer"` |
| Last result | `Get-ScheduledTaskInfo -TaskName "NIB Control360 Auto Transfer"` (LastTaskResult `0` = OK) |
| See it in the GUI | **Task Scheduler** → Task Scheduler Library → *NIB Control360 Auto Transfer* |
| Remove | `powershell -ExecutionPolicy Bypass -File scheduler\windows\uninstall-task.ps1` (administrator) |

### Good to know

- **Start the app on boot** (Windows service via NSSM, pm2, etc.). The task can't transfer anything while the app is stopped.
- **App or PC off at period end:** the first run after the app is back catches up. Each period is swept **once**, never twice.
- **Changed the secret or port:** restart the app. The task re-reads `.env` on every run, so it doesn't need reinstalling.
- **Moved the app folder:** run `install-task.ps1` again from the new folder. The task stores the script's path.

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Log: **404** | The running app has no `AUTO_TRANSFER_CRON_SECRET` | Set it in `.env`, restart the app |
| Log: **403** | The task's secret differs from the running app's | Restart the app after editing `.env` |
| Log: **429** | Too many wrong secrets | Fix the secret, wait 15 minutes |
| Log: connection refused / not reachable | App not running, or wrong `PORT` | Start the app; set `PORT` in `.env` |
| `check.ps1`: *Not installed / switched OFF* | Feature off or its migration not applied | Settings → Automatic Transfer → on; `npx prisma migrate deploy` |
| `check.ps1`: *Task not found* | Not installed, or a non-administrator window | Run step 5 / the check as administrator |
| `check.ps1`: *only starts on AC power* | Task installed by an older script | Run `install-task.ps1` again (administrator) |
| Task never ran (result `0x41303` or `267011`) | Not triggered yet, or blocked on battery | Wait 5 minutes or `Start-ScheduledTask`; reinstall if it's the battery case |
| `running scripts is disabled on this system` | Execution policy | Always call through `powershell -ExecutionPolicy Bypass -File …` as shown |

## Linux / macOS: cron

| File | Purpose |
|---|---|
| `linux/auto-transfer.sh` | The call |
| `linux/install-cron.sh` | Adds a crontab entry for the current user, every 5 minutes; `--remove` takes it out |
| `linux/check.sh` | Read-only readiness check |

```sh
sh scheduler/linux/auto-transfer.sh; tail -n 5 scheduler/logs/auto-transfer.log   # test once
sh scheduler/linux/install-cron.sh                                                 # install
crontab -l                                                                         # check
sh scheduler/linux/install-cron.sh --remove                                        # remove
```

## Linux: systemd timer (instead of cron)

```sh
sudo sh scheduler/linux/install-systemd.sh            # install and start
systemctl list-timers | grep nib-auto-transfer        # check
journalctl -u nib-auto-transfer                       # runs
sudo sh scheduler/linux/install-systemd.sh --remove   # remove
```

## Kubernetes

`kubernetes/auto-transfer-cronjob.yaml`: a CronJob calling the app's Service every 5 minutes. The instructions are in the file.

## Other schedulers

Any scheduler that can send `POST /api/system/auto-transfer` with the header `x-auto-transfer-secret: <secret>` works (Azure Logic Apps, AWS EventBridge, Google Cloud Scheduler…).

| Response | Meaning |
|---|---|
| 200 `{"ran":false}` | Nothing due (normal) |
| 200 `{"ran":true,"runs":[…]}` | Periods were swept |
| 403 | Wrong secret |
| 404 | Secret not set in `.env` |
| 429 | Too many wrong secrets: wait 15 minutes |

## Moving the app

The scripts find the app relative to their own location. If you move the app folder, run the install script again so the task or cron entry points to the new place.
