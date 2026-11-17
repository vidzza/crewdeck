#!/usr/bin/env bash
# Runs the backend on your computer for testing. Needs the binary at backend/bin/pocketbase
# (download it for your system from https://github.com/pocketbase/pocketbase/releases).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -x bin/pocketbase ]; then
  echo "Missing backend/bin/pocketbase. Download it from https://github.com/pocketbase/pocketbase/releases/tag/v0.40.6" >&2
  exit 1
fi
export TZ="${TZ:-America/Mexico_City}"
exec bin/pocketbase serve --http=127.0.0.1:8090 --dir=pb_data --hooksDir=pb_hooks --migrationsDir=pb_migrations --automigrate=false "$@"
