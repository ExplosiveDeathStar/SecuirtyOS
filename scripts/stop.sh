#!/usr/bin/env bash
# Stop SecurityOS + Neolink bridge. Data, events, and clips are untouched.
set -uo pipefail

stop_port() {
  local port="$1" name="$2"
  local pids
  pids="$(lsof -ti :"$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    kill $pids 2>/dev/null
    echo "  stopped $name (port $port)"
  else
    echo "  $name not running"
  fi
}

echo "Stopping SecurityOS..."
stop_port 3000 "frontend"
stop_port 8001 "worker"
stop_port 4000 "backend"
stop_port 8554 "neolink"
echo "Done. Start again with scripts/start-all.sh"
