#!/usr/bin/env python3
"""Bounded Linux metrics, no container credentials in the exported snapshot."""
import argparse
import datetime
import json
import os
from pathlib import Path
import subprocess

def container_state(name):
    try:
        result = subprocess.run(['docker', 'inspect', '--format', '{{.State.Status}}', name], capture_output=True, text=True, timeout=3, check=True)
        state = result.stdout.strip()
        return state if state in ('created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead') else None
    except (OSError, subprocess.SubprocessError):
        return None

def collect(output, app='image-pro', mysql='image-pro-mysql'):
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    previous = {}
    try:
        if output.stat().st_size < 32768:
            previous = json.loads(output.read_text())
    except (OSError, ValueError):
        pass
    ticks = [int(value) for value in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
    cpu = {'total': sum(ticks), 'idle': ticks[3] + ticks[4]}
    old = previous.get('_cpu', {})
    total_delta = cpu['total'] - old.get('total', cpu['total'])
    idle_delta = cpu['idle'] - old.get('idle', cpu['idle'])
    percent = max(0, min(100, round(100 * (total_delta - idle_delta) / total_delta, 2))) if total_delta > 0 else None
    memory = {}
    for line in Path('/proc/meminfo').read_text().splitlines():
        parts = line.split()
        if parts[0] in ('MemTotal:', 'MemAvailable:'):
            memory[parts[0][:-1]] = int(parts[1]) * 1024
    snapshot = {'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'cpuPercent': percent, 'memoryTotalBytes': memory.get('MemTotal'), 'memoryAvailableBytes': memory.get('MemAvailable'), '_cpu': cpu, 'containers': {'app': container_state(app), 'mysql': container_state(mysql)}}
    temporary = output.with_suffix('.tmp')
    with temporary.open('w', encoding='utf-8') as stream:
        json.dump(snapshot, stream, ensure_ascii=True)
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(temporary, 0o644)
    os.replace(temporary, output)
    return snapshot

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--app', default='image-pro')
    parser.add_argument('--mysql', default='image-pro-mysql')
    args = parser.parse_args()
    collect(args.output, args.app, args.mysql)
