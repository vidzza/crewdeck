#!/usr/bin/env bash
# Runs the backend on your computer for testing. Builds the Crewdeck server first (needs Go).
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/build-server.sh bin/crewdeck-server
export TZ="${TZ:-America/Mexico_City}"
exec bin/crewdeck-server serve --http=127.0.0.1:8090 --dir=pb_data --hooksDir=pb_hooks --migrationsDir=pb_migrations --automigrate=false "$@"
