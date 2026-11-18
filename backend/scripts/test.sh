#!/usr/bin/env bash
# Automatic backend test: builds the Crewdeck server, starts it with a temporary database,
# runs backend/tests/e2e.mjs and shuts it down. Needs Go and Node 18+.
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/build-server.sh bin/crewdeck-server
DATA="$(mktemp -d)"
trap 'kill $PB_PID 2>/dev/null || true; rm -rf "$DATA"' EXIT
./bin/crewdeck-server superuser upsert su@test.com superpass123 --dir="$DATA" --migrationsDir=pb_migrations >/dev/null
# CREWDECK_PUSH_TEST_HOST lets the server send to the fake push service the test runs on that port.
TZ=America/Mexico_City CREWDECK_SETUP_CODE=test-code-123 CREWDECK_PUSH_TEST_HOST=127.0.0.1:8098 ./bin/crewdeck-server serve --http=127.0.0.1:8099 \
  --dir="$DATA" --hooksDir=pb_hooks --migrationsDir=pb_migrations --automigrate=false >/dev/null 2>&1 &
PB_PID=$!
for _ in $(seq 1 20); do curl -fsS http://127.0.0.1:8099/api/health >/dev/null 2>&1 && break; sleep 0.5; done
API=http://127.0.0.1:8099 PUSH_PORT=8098 node tests/e2e.mjs
