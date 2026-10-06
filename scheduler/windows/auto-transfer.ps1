# NIB Control360 - automatic transfer at period end (docs/auto-transfer.md).
# Called every 5 minutes by Windows Task Scheduler (see install-task.ps1).
# Reads AUTO_TRANSFER_CRON_SECRET and PORT from the app's .env / .env.local,
# so the secret lives in one place. Logs to scheduler\logs\auto-transfer.log.
#
# Optional overrides (environment variables):
#   AUTO_TRANSFER_URL          full endpoint URL (default http://localhost:<PORT>/api/system/auto-transfer)
#   AUTO_TRANSFER_CRON_SECRET  the secret (default: from the app's .env files)

$ErrorActionPreference = "Stop"
$appDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$logDir = Join-Path $appDir "scheduler\logs"
$log = Join-Path $logDir "auto-transfer.log"
New-Item -ItemType Directory -Force $logDir | Out-Null

function Write-Log([string]$msg) { Add-Content -Path $log -Value "$(Get-Date -Format s) $msg" }

# KEY=VALUE pairs from one env file.
function Read-EnvFile([string]$path) {
  $vars = @{}
  if (Test-Path $path) {
    foreach ($line in Get-Content $path) {
      if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
        $vars[$Matches[1]] = $Matches[2].Trim('"').Trim("'")
      }
    }
  }
  return $vars
}

# .env.local wins over .env (same order as the app).
$envVars = Read-EnvFile (Join-Path $appDir ".env")
$localVars = Read-EnvFile (Join-Path $appDir ".env.local")
foreach ($k in $localVars.Keys) { $envVars[$k] = $localVars[$k] }

$secret = if ($env:AUTO_TRANSFER_CRON_SECRET) { $env:AUTO_TRANSFER_CRON_SECRET } else { $envVars["AUTO_TRANSFER_CRON_SECRET"] }
$port = if ($envVars["PORT"]) { $envVars["PORT"] } else { "9005" }
$url = if ($env:AUTO_TRANSFER_URL) { $env:AUTO_TRANSFER_URL } else { "http://localhost:$port/api/system/auto-transfer" }

if (-not $secret) {
  Write-Log "ERROR AUTO_TRANSFER_CRON_SECRET is not set in $appDir\.env"
  exit 1
}

try {
  $r = Invoke-RestMethod -Method Post -Uri $url -TimeoutSec 60 -Headers @{ "x-auto-transfer-secret" = $secret }
  if ($r.ran) {
    $summary = ($r.runs | ForEach-Object { "$($_.periodId): $($_.status) moved=$($_.movedCount) kept=$($_.keptCount)" }) -join "; "
    Write-Log "ran: $summary"
  } else {
    Write-Log "nothing due"
  }
} catch {
  Write-Log "ERROR $url - $($_.Exception.Message)"
  exit 1
} finally {
  # Keep the log small: the last 2,000 lines.
  if (Test-Path $log) { Set-Content -Path $log -Value (Get-Content $log -Tail 2000) }
}
