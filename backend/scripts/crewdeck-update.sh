#!/usr/bin/env bash
# Crewdeck auto-update. Runs every 2 minutes from crewdeck-update.timer (as root).
# Checks the "release" branch on GitHub; if there's a new version it backs up Crewdeck
# (server, app files and database), installs it, and rolls back if the new version doesn't start.
# Only ever touches /opt/crewdeck and the crewdeck service — never other apps on the Pi.
set -euo pipefail

REPO="${CREWDECK_REPO:-vidzza/crewdeck}"
APP_DIR=/opt/crewdeck
STATE="$APP_DIR/RELEASE"
FAILED="$APP_DIR/RELEASE_FAILED"

exec 9>/run/crewdeck-update.lock
flock -n 9 || exit 0 # another update is running

latest="$(curl -fsS -m 20 -H 'Accept: application/vnd.github.sha' "https://api.github.com/repos/$REPO/commits/release" 2>/dev/null || true)"
[ "${#latest}" -eq 40 ] || exit 0 # offline or rate-limited: try next time
[ "$latest" = "$(cat "$STATE" 2>/dev/null || true)" ] && exit 0
[ "$latest" = "$(cat "$FAILED" 2>/dev/null || true)" ] && exit 0 # this version already failed; wait for a fix

echo "New Crewdeck release ${latest:0:7} (installed: $(cut -c1-7 "$STATE" 2>/dev/null || echo none))"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
curl -fsSL -m 180 -o "$WORK/release.tgz" "https://codeload.github.com/$REPO/tar.gz/$latest"
mkdir "$WORK/src"
tar -xzf "$WORK/release.tgz" -C "$WORK/src" --strip-components=1
[ -f "$WORK/src/install-pi.sh" ] || { echo "Release has no install-pi.sh; skipping"; echo "$latest" > "$FAILED"; exit 1; }

# Backup for rollback. Crewdeck stops for a few seconds so the database copy is clean.
BK="$APP_DIR/rollback"
rm -rf "$BK"
mkdir -p "$BK"
systemctl stop crewdeck || true
[ -d "$APP_DIR/pb_data" ] && cp -a "$APP_DIR/pb_data" "$BK/pb_data"
for d in pb_hooks pb_migrations pb_public; do
  [ -d "$APP_DIR/$d" ] && cp -a "$APP_DIR/$d" "$BK/$d"
done
[ -f /etc/systemd/system/crewdeck.service ] && cp -a /etc/systemd/system/crewdeck.service "$BK/"
[ -f "$APP_DIR/pocketbase" ] && cp -a "$APP_DIR/pocketbase" "$BK/pocketbase"

if bash "$WORK/src/install-pi.sh"; then
  echo "$latest" > "$STATE"
  rm -f "$FAILED"
  echo "Crewdeck updated to ${latest:0:7}"
else
  echo "!! Update ${latest:0:7} failed — restoring the previous version"
  systemctl stop crewdeck || true
  if [ -d "$BK/pb_data" ]; then
    rm -rf "$APP_DIR/pb_data"
    cp -a "$BK/pb_data" "$APP_DIR/pb_data"
  fi
  for d in pb_hooks pb_migrations pb_public; do
    if [ -d "$BK/$d" ]; then
      rm -rf "$APP_DIR/$d"
      cp -a "$BK/$d" "$APP_DIR/$d"
    fi
  done
  [ -f "$BK/crewdeck.service" ] && cp -a "$BK/crewdeck.service" /etc/systemd/system/crewdeck.service
  [ -f "$BK/pocketbase" ] && cp -a "$BK/pocketbase" "$APP_DIR/pocketbase"
  chown -R crewdeck:crewdeck "$APP_DIR"
  systemctl daemon-reload
  systemctl start crewdeck
  echo "$latest" > "$FAILED"
  exit 1
fi
