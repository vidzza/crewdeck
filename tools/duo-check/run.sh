#!/usr/bin/env bash
# One command to check every Crewdeck screen on iPhone Duo sizes (closed and open) in WebKit,
# the engine behind Safari on iPhone. No Xcode needed. It builds the app, starts a throwaway
# server with demo data, runs check.mjs and shuts everything down. Screenshots: tools/duo-check/out/
#
#   tools/duo-check/run.sh                      every size
#   SIZES=duo-closed,duo-open tools/duo-check/run.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PORT="${PORT:-8097}"
CODE="duo-check-code"

[ -d "$HERE/node_modules/playwright-core" ] || (cd "$HERE" && npm install --no-audit --no-fund >/dev/null)
"$HERE/node_modules/.bin/playwright-core" install webkit >/dev/null # once, ~300 MB; then it's a no-op

cd "$ROOT/backend"
./scripts/build-server.sh bin/crewdeck-server >/dev/null
(cd "$ROOT/web" && VITE_API_URL=/ ./node_modules/.bin/vite build >/dev/null)

DATA="$(mktemp -d)"
trap 'kill $PB_PID 2>/dev/null || true; rm -rf "$DATA"' EXIT
./bin/crewdeck-server superuser upsert su@duo-check.test duo-check-super --dir="$DATA" --migrationsDir=pb_migrations >/dev/null
TZ=America/Mexico_City CREWDECK_SETUP_CODE="$CODE" ./bin/crewdeck-server serve --http="127.0.0.1:$PORT" --dir="$DATA" \
  --hooksDir=pb_hooks --migrationsDir=pb_migrations --publicDir="$ROOT/web/dist" --automigrate=false >/dev/null 2>&1 &
PB_PID=$!
for _ in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 0.5; done

API="http://127.0.0.1:$PORT" SETUP_CODE="$CODE" node "$HERE/seed.mjs"
BASE="http://127.0.0.1:$PORT" node "$HERE/check.mjs"
