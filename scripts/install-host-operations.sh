#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
command -v python3 >/dev/null
command -v systemctl >/dev/null
mkdir -p "$project_dir/storage/operations"
case "$project_dir" in *'
'*) echo 'Project path must not contain newlines' >&2; exit 1;; esac
escaped_dir=$(printf '%s' "$project_dir" | sed 's/\\/\\\\/g; s/"/\\"/g; s/%/%%/g')
cat > /etc/systemd/system/image-operations-collector.service <<EOF
[Unit]
Description=Image website host operations snapshot

[Service]
Type=oneshot
ExecStart=/usr/bin/env python3 "$escaped_dir/scripts/collect-host-operations.py" --output "$escaped_dir/storage/operations/host.json"
TimeoutStartSec=15
Nice=10
IOSchedulingClass=idle
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths="$escaped_dir/storage/operations"
EOF
cat > /etc/systemd/system/image-operations-collector.timer <<'EOF'
[Unit]
Description=Collect website host status every 20 seconds

[Timer]
OnBootSec=15s
OnUnitActiveSec=20s
AccuracySec=1s

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now image-operations-collector.timer
systemctl start image-operations-collector.service
echo 'Host collector enabled.'
