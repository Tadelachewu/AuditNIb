#!/usr/bin/env sh
# Adds a crontab entry (current user) that runs auto-transfer.sh every 5 minutes.
#   Install:  sh scheduler/linux/install-cron.sh
#   Remove:   sh scheduler/linux/install-cron.sh --remove

SCRIPT="$(cd "$(dirname "$0")" && pwd)/auto-transfer.sh"
MARK="# nib-control360-auto-transfer"
chmod +x "$SCRIPT"

# Every existing line except a previous entry of ours.
OTHERS=$(crontab -l 2>/dev/null | grep -v "$MARK")

if [ "$1" = "--remove" ]; then
  printf '%s\n' "$OTHERS" | crontab -
  echo "Removed the automatic-transfer cron entry."
  exit 0
fi

printf '%s\n%s\n' "$OTHERS" "*/5 * * * * $SCRIPT $MARK" | crontab -
echo "Installed: every 5 minutes runs $SCRIPT"
echo "Check: crontab -l"
echo "Log:   $(cd "$(dirname "$0")/.." && pwd)/logs/auto-transfer.log"
