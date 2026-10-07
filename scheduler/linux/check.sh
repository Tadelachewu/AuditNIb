#!/usr/bin/env sh
# Is the automatic-transfer scheduler ready? READ-ONLY - never moves anything.
#   sh scheduler/linux/check.sh
# Checks: the secret in .env, the app answering with that secret (feature
# installed / on, due / next), the cron entry or systemd timer, the log.

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="$APP_DIR/scheduler/logs/auto-transfer.log"
OK=1
pass() { echo "  [OK]   $1"; }
fail() { echo "  [FAIL] $1"; OK=0; }
note() { echo "  [INFO] $1"; }

env_value() {
  value=""
  for file in "$APP_DIR/.env" "$APP_DIR/.env.local"; do
    [ -f "$file" ] || continue
    line=$(grep -E "^[[:space:]]*$1[[:space:]]*=" "$file" | tail -n 1)
    [ -n "$line" ] && value=$(printf '%s' "${line#*=}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | tr -d "\"'")
  done
  printf '%s' "$value"
}
SECRET="${AUTO_TRANSFER_CRON_SECRET:-$(env_value AUTO_TRANSFER_CRON_SECRET)}"
PORT="$(env_value PORT)"; PORT="${PORT:-9005}"
URL="${AUTO_TRANSFER_URL:-http://localhost:$PORT/api/system/auto-transfer}"

echo; echo "Automatic transfer - scheduler check ($URL)"; echo

echo "1. Secret"
if [ ${#SECRET} -ge 16 ]; then pass "AUTO_TRANSFER_CRON_SECRET is set (${#SECRET} characters)"; else fail "AUTO_TRANSFER_CRON_SECRET missing or shorter than 16 characters in $APP_DIR/.env"; fi

echo "2. App and feature"
BODY=$(curl -sS -m 30 -w '\n%{http_code}' "$URL" -H "x-auto-transfer-secret: $SECRET" 2>&1)
CODE=$(printf '%s' "$BODY" | tail -n 1)
JSON=$(printf '%s' "$BODY" | sed '$d')
case "$CODE" in
  200)
    pass "App answered and accepted the secret"
    if echo "$JSON" | grep -q '"enabled":true'; then pass "Installed and switched ON"; else fail "Not installed or switched OFF: $JSON"; fi
    note "Status: $JSON" ;;
  403) fail "Wrong secret (403): the running app has a different AUTO_TRANSFER_CRON_SECRET - restart it after changing .env" ;;
  404) fail "Endpoint off (404): the running app has no AUTO_TRANSFER_CRON_SECRET - set it in .env and restart the app" ;;
  429) fail "Blocked (429) after too many wrong secrets - wait 15 minutes" ;;
  *) fail "App not reachable at $URL - is it running? ($JSON)" ;;
esac

echo "3. Schedule"
if crontab -l 2>/dev/null | grep -q "nib-control360-auto-transfer"; then
  pass "cron entry installed: $(crontab -l | grep nib-control360-auto-transfer)"
elif command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nib-auto-transfer.timer; then
  pass "systemd timer active: $(systemctl list-timers --no-legend nib-auto-transfer.timer 2>/dev/null)"
else
  fail "No cron entry or systemd timer - run: sh scheduler/linux/install-cron.sh"
fi

echo "4. Log ($LOG)"
if [ -f "$LOG" ]; then tail -n 3 "$LOG" | sed 's/^/         /'; else note "No log yet (not run yet)"; fi

echo
if [ $OK -eq 1 ]; then echo "READY: the scheduler will run the automatic transfer."; else echo "NOT READY: fix the [FAIL] items above."; exit 1; fi
