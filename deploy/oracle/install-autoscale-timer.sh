#!/usr/bin/env bash
# Reliable native scheduling for the GitHub workflow autoscaler; this host never runs worker jobs.
set -euo pipefail
if [[ $(id -u) -ne 0 ]]; then echo "Run with sudo/root" >&2; exit 1; fi

install -d -m 0755 /usr/local/libexec
cat > /usr/local/libexec/jarvis-autoscale-reconcile.sh <<'RUNNER'
#!/usr/bin/env bash
set -euo pipefail
PORT="$(grep -oE '127[.]0[.]0[.]1:[0-9]+' /etc/caddy/upstream.conf | head -n1 | cut -d: -f2)"
TOKEN="$(grep -m1 '^CRON_SECRET=' /opt/jarvis/shared/.env | cut -d= -f2-)"
if [[ ! "$PORT" =~ ^[0-9]{4,5}$ || -z "$TOKEN" ]]; then
  echo "Auto scaling: invalid Caddy port or missing CRON_SECRET" >&2
  exit 1
fi
curl --fail-with-body --silent --show-error --max-time 150 \
  -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:$PORT/api/cron/autoscale"
RUNNER
chmod 0755 /usr/local/libexec/jarvis-autoscale-reconcile.sh

cat > /etc/systemd/system/jarvis-autoscale.service <<'SERVICE'
[Unit]
Description=Jarvis HH3D GitHub worker autoscale reconciliation (API only)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=jarvis
Group=jarvis
ExecStart=/usr/local/libexec/jarvis-autoscale-reconcile.sh
TimeoutStartSec=160
NoNewPrivileges=true
SERVICE

cat > /etc/systemd/system/jarvis-autoscale.timer <<'TIMER'
[Unit]
Description=Reconcile GitHub worker scaling every 10 minutes

[Timer]
OnCalendar=*-*-* *:00/10:00
AccuracySec=10s
Persistent=true
Unit=jarvis-autoscale.service

[Install]
WantedBy=timers.target
TIMER

bash -n /usr/local/libexec/jarvis-autoscale-reconcile.sh
systemd-analyze verify /etc/systemd/system/jarvis-autoscale.service /etc/systemd/system/jarvis-autoscale.timer
systemctl daemon-reload
systemctl enable --now jarvis-autoscale.timer
systemctl list-timers --all jarvis-autoscale.timer --no-pager
