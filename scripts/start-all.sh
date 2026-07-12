#!/usr/bin/env bash
# Start Neolink bridge, then SecurityOS. Run from repo root.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS="$ROOT/data/logs"
mkdir -p "$LOGS"

echo "Starting Neolink bridge..."
if ! lsof -ti :8554 >/dev/null 2>&1; then
  (cd "$ROOT/tools/neolink" && nohup ./neolink-bin rtsp --config neolink.toml >> "$LOGS/neolink.log" 2>&1 &)
  echo "  neolink  -> rtsp://127.0.0.1:8554 (log: data/logs/neolink.log)"
  sleep 3
else
  echo "  neolink  -> already running"
fi

"$ROOT/scripts/start.sh"
