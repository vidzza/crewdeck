#!/usr/bin/env bash
# Automatic backend test (98 checks): starts PocketBase with a temporary database,
# runs backend/tests/e2e.mjs and shuts it down. Needs backend/bin/pocketbase and Node 18+.
set -euo pipefail
cd "$(dirname "$0")/.."
DATA="$(mktemp -d)"
trap 'kill $PB_PID 2>/dev/null || true; rm -rf "$DATA"' EXIT
./bin/pocketbase superuser upsert su@test.com superpass123 --dir="$DATA" --migrationsDir=pb_migrations >/dev/null
TZ=America/Mexico_City CREWDECK_SETUP_CODE=test-code-123 ./bin/pocketbase serve --http=127.0.0.1:8099 \
  --dir="$DATA" --hooksDir=pb_hooks --migrationsDir=pb_migrations --automigrate=false >/dev/null 2>&1 &
PB_PID=$!
for _ in $(seq 1 20); do curl -fsS http://127.0.0.1:8099/api/health >/dev/null 2>&1 && break; sleep 0.5; done
API=http://127.0.0.1:8099 node tests/e2e.mjs
