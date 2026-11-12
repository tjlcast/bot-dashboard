#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-3000}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

if pgrep -f 'node.*server/index\.js' >/dev/null; then
  echo "Platform service is already running."
  exit 0
fi

cd "$PROJECT_ROOT"
PORT="$PORT" nohup node server/index.js > service.log 2>&1 &
echo "Service started (PID $!): http://localhost:$PORT"
