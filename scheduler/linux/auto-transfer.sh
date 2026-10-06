#!/usr/bin/env sh
# NIB Control360 - automatic transfer at period end (docs/auto-transfer.md).
# Called every 5 minutes by cron (install-cron.sh) or a systemd timer
# (install-systemd.sh). Reads AUTO_TRANSFER_CRON_SECRET and PORT from the
# app's .env / .env.local. Logs to scheduler/logs/auto-transfer.log.
#
# Optional overrides (environment variables):
#   AUTO_TRANSFER_URL           full endpoint URL (default http://localhost:<PORT>/api/system/auto-transfer)
#   AUTO_TRANSFER_CRON_SECRET   the secret (default: from the app's .env files)

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_DIR="$APP_DIR/scheduler/logs"
LOG="$LOG_DIR/auto-transfer.log"
mkdir -p "$LOG_DIR"

now() { date '+%Y-%m-%dT%H:%M:%S'; }

# Value of KEY from the app's env files (.env.local wins over .env).
env_value() {
  value=""
  for file in "$APP_DIR/.env" "$APP_DIR/.env.local"; do
    [ -f "$file" ] || continue
    line=$(grep -E "^[[:space:]]*$1[[:space:]]*=" "$file" | tail -n 1)
    if [ -n "$line" ]; then
      value=$(printf '%s' "${line#*=}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | tr -d "\"'")
    fi
  done
  printf '%s' "$value"
}

SECRET="${AUTO_TRANSFER_CRON_SECRET:-$(env_value AUTO_TRANSFER_CRON_SECRET)}"
PORT="$(env_value PORT)"
PORT="${PORT:-9005}"
URL="${AUTO_TRANSFER_URL:-http://localhost:$PORT/api/system/auto-transfer}"

if [ -z "$SECRET" ]; then
  echo "$(now) ERROR AUTO_TRANSFER_CRON_SECRET is not set in $APP_DIR/.env" >> "$LOG"
  exit 1
fi

STATUS=0
if RESPONSE=$(curl -fsS -m 60 -X POST "$URL" -H "x-auto-transfer-secret: $SECRET" 2>&1); then
  echo "$(now) $RESPONSE" >> "$LOG"
else
  echo "$(now) ERROR $URL - $RESPONSE" >> "$LOG"
  STATUS=1
fi

# Keep the log small: the last 2,000 lines.
tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
exit $STATUS
