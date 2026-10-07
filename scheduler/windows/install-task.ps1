# Registers (or updates) the Windows Task Scheduler task that runs
# auto-transfer.ps1 every 5 minutes, as SYSTEM (whether or not anyone is
# signed in to Windows). Run once, from the app folder, in an ADMINISTRATOR
# PowerShell:
#
#   powershell -ExecutionPolicy Bypass -File scheduler\windows\install-task.ps1
#
# Remove it again with scheduler\windows\uninstall-task.ps1.

$ErrorActionPreference = "Stop"
$taskName = "NIB Control360 Auto Transfer"
$script = Join-Path $PSScriptRoot "auto-transfer.ps1"

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
# Windows' default is "start only on AC power": on a laptop running on battery
# the task would silently never run. It must run on battery too.
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description "Carries outstanding findings into the next reporting period when a period ends (docs/auto-transfer.md)." -Force | Out-Null

$logPath = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path "logs\auto-transfer.log"
Write-Host "Installed '$taskName': runs every 5 minutes."
Write-Host "Run it now:  Start-ScheduledTask -TaskName '$taskName'"
Write-Host "Check:       Get-ScheduledTaskInfo -TaskName '$taskName'   (LastTaskResult 0 = OK)"
Write-Host "Log:         $logPath"
