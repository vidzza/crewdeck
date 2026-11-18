#!/usr/bin/env bash
# Builds the Crewdeck server (PocketBase + push notifications, see backend/server) with Go.
# Usage: build-server.sh [OUTPUT] [GOOS] [GOARCH] [GOARM]
#   build-server.sh                                    → backend/bin/crewdeck-server for this computer
#   build-server.sh out/bin/crewdeck-server-linux-armv7 linux arm 7   → Raspberry Pi (32-bit)
set -euo pipefail
SRC="$(cd "$(dirname "$0")/../server" && pwd)"
OUT="${1:-$SRC/../bin/crewdeck-server}"
mkdir -p "$(dirname "$OUT")"
OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
command -v go >/dev/null || { echo "Go is needed to build the Crewdeck server: https://go.dev/dl/" >&2; exit 1; }
cd "$SRC"
PB_VERSION="$(go list -m -f '{{.Version}}' github.com/pocketbase/pocketbase)"
CGO_ENABLED=0 GOOS="${2:-$(go env GOOS)}" GOARCH="${3:-$(go env GOARCH)}" GOARM="${4:-}" \
  go build -trimpath -ldflags "-s -w -X github.com/pocketbase/pocketbase.Version=${PB_VERSION#v}" -o "$OUT" .
