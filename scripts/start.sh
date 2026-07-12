#!/usr/bin/env bash
# Start all SecurityOS services in the background (logs in data/logs/).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS="$ROOT/data/logs"
mkdir -p "$LOGS"

echo "Starting SecurityOS..."

# 1. Backend API (builds first so code changes are picked up)
if ! lsof -ti :4000 >/dev/null 2>&1; then
  (cd "$ROOT/backend" && npm run build >/dev/null && nohup node dist/index.js > "$LOGS/backend.log" 2>&1 &)
  echo "  backend  -> http://127.0.0.1:4000 (log: data/logs/backend.log)"
else
  echo "  backend  -> already running"
fi

# 2. Detection worker (stable defaults for CPU — don't set FPS above 20)
if ! lsof -ti :8001 >/dev/null 2>&1; then
  (cd "$ROOT/worker" && \
    SECURITYOS_PIPELINE_FPS=12 \
    SECURITYOS_DETECT_EVERY=2 \
    SECURITYOS_PREVIEW_WIDTH=1280 \
    SECURITYOS_INFERENCE_WIDTH=960 \
    nohup .venv/bin/python -m worker.main > "$LOGS/worker.log" 2>&1 &)
  echo "  worker   -> http://127.0.0.1:8001 (log: data/logs/worker.log)"
else
  echo "  worker   -> already running"
fi

# 3. Frontend (serves the production build)
if ! lsof -ti :3000 >/dev/null 2>&1; then
  (cd "$ROOT/frontend" && npm run build >/dev/null && nohup npx next start -H 127.0.0.1 > "$LOGS/frontend.log" 2>&1 &)
  echo "  frontend -> http://localhost:3000 (log: data/logs/frontend.log)"
else
  echo "  frontend -> already running"
fi

echo "Done. Open http://localhost:3000"
