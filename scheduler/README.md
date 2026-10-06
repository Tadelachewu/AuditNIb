# Scheduler files: automatic transfer at period end

Ready-to-use files for running the **automatic transfer** on a schedule, every 5 minutes. A scheduler is optional: without one it still runs within about 5 minutes while anyone is using the app. With one it runs on time even when nobody is signed in. Full guide: [docs/auto-transfer.md](../docs/auto-transfer.md) §4.

The scripts:
- read `AUTO_TRANSFER_CRON_SECRET` and `PORT` from the app's own `.env` / `.env.local`, so the secret lives in one place;
- call `http://localhost:<PORT>/api/system/auto-transfer`;
- log to `scheduler/logs/auto-transfer.log` (last 2,000 lines; not in git).

## First, once

1. `.env` must have `AUTO_TRANSFER_CRON_SECRET=<32+ random characters>`, and the app must have been restarted after setting it.
2. Run the script once by hand (below). The log should say `nothing due` or `ran: …`.

## Windows: Task Scheduler

| File | Purpose |
|---|---|
| `windows/auto-transfer.ps1` | The call (what the task runs) |
| `windows/install-task.ps1` | Creates the task **NIB Control360 Auto Transfer**: every 5 minutes, as SYSTEM, whether or not anyone is signed in |
| `windows/uninstall-task.ps1` | Removes the task |

From the app folder:

```powershell
# 1. Test once
powershell -ExecutionPolicy Bypass -File scheduler\windows\auto-transfer.ps1
Get-Content scheduler\logs\auto-transfer.log -Tail 5

# 2. Install (in an ADMINISTRATOR PowerShell)
powershell -ExecutionPolicy Bypass -File scheduler\windows\install-task.ps1

# Run now / check / remove
Start-ScheduledTask -TaskName "NIB Control360 Auto Transfer"
Get-ScheduledTaskInfo -TaskName "NIB Control360 Auto Transfer"     # LastTaskResult 0 = OK
powershell -ExecutionPolicy Bypass -File scheduler\windows\uninstall-task.ps1
```

You can also see the task in the **Task Scheduler** window (Task Scheduler Library).

## Linux / macOS: cron

| File | Purpose |
|---|---|
| `linux/auto-transfer.sh` | The call |
| `linux/install-cron.sh` | Adds a crontab entry for the current user, every 5 minutes; `--remove` takes it out |

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
