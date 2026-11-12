#!/usr/bin/env bash
set -euo pipefail

PIDS="$(pgrep -f 'node.*server/index\.js' || true)"

if [[ -z "$PIDS" ]]; then
  echo "No platform service process found."
  exit 0
fi

kill $PIDS
echo "Stopped platform service process(es): $PIDS"
