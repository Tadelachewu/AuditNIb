#!/usr/bin/env sh
# Installs a systemd timer that runs auto-transfer.sh every 5 minutes
# (an alternative to cron).
#   Install (root):  sudo sh scheduler/linux/install-systemd.sh
#   Remove (root):   sudo sh scheduler/linux/install-systemd.sh --remove
set -e

UNIT=nib-auto-transfer
SCRIPT="$(cd "$(dirname "$0")" && pwd)/auto-transfer.sh"
RUN_AS="${SUDO_USER:-$(id -un)}"

if [ "$1" = "--remove" ]; then
  systemctl disable --now "$UNIT.timer" 2>/dev/null || true
  rm -f "/etc/systemd/system/$UNIT.service" "/etc/systemd/system/$UNIT.timer"
  systemctl daemon-reload
  echo "Removed $UNIT.timer"
  exit 0
fi

chmod +x "$SCRIPT"

printf '%s\n' \
  "[Unit]" \
  "Description=NIB Control360 automatic transfer at period end" \
  "[Service]" \
  "Type=oneshot" \
  "User=$RUN_AS" \
  "ExecStart=$SCRIPT" > "/etc/systemd/system/$UNIT.service"

printf '%s\n' \
  "[Unit]" \
  "Description=Run NIB Control360 automatic transfer every 5 minutes" \
  "[Timer]" \
  "OnBootSec=2min" \
  "OnUnitActiveSec=5min" \
  "Persistent=true" \
  "[Install]" \
  "WantedBy=timers.target" > "/etc/systemd/system/$UNIT.timer"

systemctl daemon-reload
systemctl enable --now "$UNIT.timer"
echo "Installed $UNIT.timer (every 5 minutes, as $RUN_AS)."
echo "Check: systemctl list-timers | grep $UNIT   and   journalctl -u $UNIT"
