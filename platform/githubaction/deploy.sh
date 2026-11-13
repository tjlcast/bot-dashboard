#!/usr/bin/env bash
set -euo pipefail

: "${DEPLOY_DIR:?DEPLOY_DIR is required}"
: "${PLATFORM_IMAGE:?PLATFORM_IMAGE is required}"
PLATFORM_PORT="${PLATFORM_PORT:-3000}"

archive="$DEPLOY_DIR/platform-image.tar.gz"
compose_file="$DEPLOY_DIR/compose.server.yaml"

test -f "$archive"
test -f "$compose_file"

docker load --input "$archive"
PLATFORM_IMAGE="$PLATFORM_IMAGE" PLATFORM_PORT="$PLATFORM_PORT" \
  docker compose -p agent-control-plane -f "$compose_file" up -d --remove-orphans

container_id="$(docker compose -p agent-control-plane -f "$compose_file" ps -q platform)"
test -n "$container_id"

for _ in $(seq 1 18); do
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}running{{end}}' "$container_id")"
  if [ "$health" = "healthy" ]; then
    rm -f "$archive"
    echo "Platform deployment is healthy."
    exit 0
  fi
  if [ "$health" = "unhealthy" ] || [ "$health" = "exited" ]; then
    docker compose -p agent-control-plane -f "$compose_file" logs --tail 100 platform
    exit 1
  fi
  sleep 5
done

docker compose -p agent-control-plane -f "$compose_file" logs --tail 100 platform
echo "Platform did not become healthy in time." >&2
exit 1
