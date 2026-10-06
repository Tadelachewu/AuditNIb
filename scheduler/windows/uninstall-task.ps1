# Removes the automatic-transfer task. Run in an ADMINISTRATOR PowerShell:
#   powershell -ExecutionPolicy Bypass -File scheduler\windows\uninstall-task.ps1

$taskName = "NIB Control360 Auto Transfer"
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Removed '$taskName' (if it existed)."
