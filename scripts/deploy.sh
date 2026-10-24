#!/bin/sh
# Production update: pull main, build with the commit stamped in, replace only
# the app container, then reclaim old images and build cache.
# Usage (on the server): sh scripts/deploy.sh
set -e
cd "$(dirname "$0")/.."

git switch main
git pull --ff-only origin main
APP_COMMIT=$(git rev-parse --short HEAD)
export APP_COMMIT
echo "Deploying $APP_COMMIT"

# Build first; the running container is replaced only after a successful build.
docker compose build app
docker compose up -d --no-deps app

# Fail loudly if the new container does not stay up (e.g. a missing module).
sleep 15
if ! docker compose ps app --format '{{.State}}' | grep -q '^running$'; then
  echo "app container is not running; recent logs:" >&2
  docker compose logs --tail=60 app >&2
  exit 1
fi
docker compose logs --tail=20 app

# Images still used by running containers are kept.
docker image prune -f
docker builder prune -f --filter until=72h
df -h /
