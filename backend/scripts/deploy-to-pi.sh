#!/usr/bin/env bash
# Builds Crewdeck on this computer and installs it on the Pi, next to the apps already there.
# Usage: ./backend/scripts/deploy-to-pi.sh user@host
set -euo pipefail

HOST="${1:?Usage: deploy-to-pi.sh user@host}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REL="$(mktemp -d)"
trap 'rm -rf "$REL"' EXIT
# On macOS use Apple's ssh: the Homebrew build can be blocked by Local Network privacy.
SSH=ssh
[ -x /usr/bin/ssh ] && SSH=/usr/bin/ssh

echo "==> Building the app (served by the Pi itself)"
(cd "$ROOT/web" && VITE_API_URL=/ npx vite build --outDir "$REL/pb_public" --emptyOutDir --logLevel warn)
cp -R "$ROOT/backend/pb_hooks" "$ROOT/backend/pb_migrations" "$REL/"

echo "==> Building the Crewdeck server for the Pi (needs Go)"
"$ROOT/backend/scripts/build-server.sh" "$REL/bin/crewdeck-server-linux-arm64" linux arm64
"$ROOT/backend/scripts/build-server.sh" "$REL/bin/crewdeck-server-linux-armv7" linux arm 7
cp "$ROOT/backend/crewdeck.service" "$ROOT/backend/crewdeck.env.example" "$ROOT/backend/scripts/install-pi.sh" \
  "$ROOT/backend/scripts/crewdeck-update.sh" "$ROOT/backend/crewdeck-update.service" "$ROOT/backend/crewdeck-update.timer" "$REL/"

echo "==> Copying the release to $HOST:~/crewdeck-release"
COPYFILE_DISABLE=1 tar --no-xattrs -C "$REL" -czf - . | $SSH "$HOST" 'rm -rf ~/crewdeck-release && mkdir -p ~/crewdeck-release && tar -C ~/crewdeck-release -xzf -'

echo "==> Installing (only touches /opt/crewdeck and the crewdeck service)"
$SSH -t "$HOST" 'sudo bash ~/crewdeck-release/install-pi.sh'
