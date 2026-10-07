# Is the automatic-transfer scheduler ready? READ-ONLY - never moves anything.
#   powershell -ExecutionPolicy Bypass -File scheduler\windows\check.ps1
#
# Checks: the secret in .env, the app answering with that secret, the feature
# installed and on, what is due / next, the Windows task (exists, enabled,
# allowed on battery, last and next run, last result) and the last log lines.

$appDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$taskName = "NIB Control360 Auto Transfer"
$log = Join-Path $appDir "scheduler\logs\auto-transfer.log"
$ok = $true
function Pass([string]$m) { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Fail([string]$m) { Write-Host "  [FAIL] $m" -ForegroundColor Red; $script:ok = $false }
function Note([string]$m) { Write-Host "  [INFO] $m" -ForegroundColor Yellow }

function Read-EnvFile([string]$path) {
  $vars = @{}
  if (Test-Path $path) {
    foreach ($line in Get-Content $path) {
      if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') { $vars[$Matches[1]] = $Matches[2].Trim('"').Trim("'") }
    }
  }
  return $vars
}
$envVars = Read-EnvFile (Join-Path $appDir ".env")
$localVars = Read-EnvFile (Join-Path $appDir ".env.local")
foreach ($k in $localVars.Keys) { $envVars[$k] = $localVars[$k] }
$secret = if ($env:AUTO_TRANSFER_CRON_SECRET) { $env:AUTO_TRANSFER_CRON_SECRET } else { $envVars["AUTO_TRANSFER_CRON_SECRET"] }
$port = if ($envVars["PORT"]) { $envVars["PORT"] } else { "9005" }
$url = if ($env:AUTO_TRANSFER_URL) { $env:AUTO_TRANSFER_URL } else { "http://localhost:$port/api/system/auto-transfer" }

Write-Host "`nAutomatic transfer - scheduler check ($url)`n"

Write-Host "1. Secret"
if ($secret -and $secret.Length -ge 16) { Pass "AUTO_TRANSFER_CRON_SECRET is set ($($secret.Length) characters)" } else { Fail "AUTO_TRANSFER_CRON_SECRET missing or shorter than 16 characters in $appDir\.env" }

Write-Host "2. App and feature"
try {
  $s = Invoke-RestMethod -Method Get -Uri $url -TimeoutSec 30 -Headers @{ "x-auto-transfer-secret" = $secret }
  Pass "App answered and accepted the secret"
  if (-not $s.installed) { Fail "Not installed: $($s.reason)" }
  elseif (-not $s.enabled) { Fail "Automatic Transfer is switched OFF (Settings -> Automatic Transfer)" }
  else { Pass "Installed and switched ON (delay $($s.delayHours) h, $($s.excludedOperationAreas.Count) excluded operation area(s))" }
  if ($s.installed) {
    if ($s.dueNow.Count -gt 0) { Note "Due now (moves on the next run): $($s.dueNow -join ', ')" } else { Pass "Nothing due right now" }
    if ($s.nextDue) { Note "Next period due: $($s.nextDue.period) at $(([datetime]$s.nextDue.at).ToLocalTime())" }
    if ($s.waitingForNextPeriod.Count -gt 0) { Note "Waiting for the next period to be created: $($s.waitingForNextPeriod -join ', ')" }
    if ($s.lastRun) {
      $by = if ($s.lastRun.triggeredBy) { $s.lastRun.triggeredBy } else { "(not recorded)" }
      Note "Last sweep: $($s.lastRun.period) -> $($s.lastRun.to) at $(([datetime]$s.lastRun.at).ToLocalTime()), moved $($s.lastRun.moved), kept $($s.lastRun.kept), by $by"
    }
  }
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  if ($code -eq 403) { Fail "Wrong secret (403): the app's AUTO_TRANSFER_CRON_SECRET differs - restart the app after changing .env" }
  elseif ($code -eq 404) { Fail "Endpoint off (404): the RUNNING app has no AUTO_TRANSFER_CRON_SECRET - set it in .env and restart the app" }
  elseif ($code -eq 429) { Fail "Blocked (429) after too many wrong secrets - wait 15 minutes" }
  else { Fail "App not reachable at $url - is it running? ($($_.Exception.Message))" }
}

Write-Host "3. Windows task"
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) {
  Fail "Task '$taskName' not found - install it (ADMINISTRATOR PowerShell): powershell -ExecutionPolicy Bypass -File scheduler\windows\install-task.ps1   (in a non-administrator window an installed task can also look missing)"
} else {
  $info = Get-ScheduledTaskInfo -TaskName $taskName
  if ($task.State -eq "Disabled") { Fail "Task is DISABLED" } else { Pass "Task installed (state: $($task.State))" }
  if ($task.Settings.DisallowStartIfOnBatteries) {
    Fail "Task only starts on AC power - on battery it never runs. Re-install it (ADMINISTRATOR): powershell -ExecutionPolicy Bypass -File scheduler\windows\install-task.ps1"
  } else { Pass "Allowed to run on battery" }
  if ($info.LastRunTime -and $info.LastRunTime.Year -gt 2000) {
    if ($info.LastTaskResult -eq 0) { Pass "Last run $($info.LastRunTime) - result 0 (OK)" } else { Fail "Last run $($info.LastRunTime) - result $($info.LastTaskResult) (see the log)" }
  } else { Note "Task hasn't run yet (result 0x41303 = not run yet)" }
  if ($info.NextRunTime) { Note "Next run: $($info.NextRunTime)" }
}

Write-Host "4. Log ($log)"
if (Test-Path $log) { Get-Content $log -Tail 3 | ForEach-Object { Write-Host "         $_" } } else { Note "No log yet (the task hasn't run)" }

Write-Host ""
if ($ok) { Write-Host "READY: the scheduler will run the automatic transfer." -ForegroundColor Green } else { Write-Host "NOT READY: fix the [FAIL] items above." -ForegroundColor Red; exit 1 }
