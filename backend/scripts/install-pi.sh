#!/usr/bin/env bash
# Installs or updates Crewdeck on a Raspberry Pi that already runs other apps.
# It only touches /opt/crewdeck, the "crewdeck" user and the "crewdeck" service.
# It never stops, restarts or reconfigures anything else (not cloudflared, not other apps),
# and it never runs apt. Safe to run again to update: the database is kept.
#
# Usage on the Pi (deploy-to-pi.sh does this for you):
#   sudo bash ~/crewdeck-release/install-pi.sh
set -euo pipefail

PB_VERSION="${PB_VERSION:-0.40.6}"
APP_DIR=/opt/crewdeck
REL="$(cd "$(dirname "$0")" && pwd)"

die() { echo "!! $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "Run with sudo."

case "$(uname -m)" in
  aarch64 | arm64) ARCH=arm64 ;;
  armv7l | armv6l) ARCH=armv7 ;;
  x86_64) ARCH=amd64 ;;
  *) die "Unsupported architecture: $(uname -m)" ;;
esac

for f in pb_hooks pb_migrations pb_public crewdeck.service crewdeck.env.example; do
  [ -e "$REL/$f" ] || die "Missing $f in $REL (run deploy-to-pi.sh from the Mac)."
done
# macOS metadata files ("._name") would be read as broken hooks/migrations: drop them.
find "$REL" -name '._*' -type f -delete
for cmd in curl unzip ss systemctl; do
  command -v "$cmd" >/dev/null || die "'$cmd' is not installed. Install it yourself (sudo apt-get install $cmd) and run this again."
done

# Settings: create once, never overwrite.
mkdir -p "$APP_DIR"
if [ ! -f "$APP_DIR/crewdeck.env" ]; then
  cp "$REL/crewdeck.env.example" "$APP_DIR/crewdeck.env"
  echo "==> Created $APP_DIR/crewdeck.env with default settings"
fi
PORT="$(grep -E '^CREWDECK_PORT=' "$APP_DIR/crewdeck.env" | tail -1 | cut -d= -f2 | tr -d '[:space:]')"
[ -n "$PORT" ] || die "CREWDECK_PORT is not set in $APP_DIR/crewdeck.env"

# Never take a port another app is using.
if ss -Hltn "( sport = :$PORT )" | grep -q .; then
  OWNER="$(ss -Hltnp "( sport = :$PORT )" 2>/dev/null | grep -o 'users:(("[^"]*"' | head -1 | cut -d'"' -f2)"
  if [ "$OWNER" != "pocketbase" ] || ! systemctl is-active --quiet crewdeck; then
    die "Port $PORT is already used by '${OWNER:-another program}'. Pick a free port in $APP_DIR/crewdeck.env and run again. Nothing was changed."
  fi
fi

echo "==> Service user"
id crewdeck >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin crewdeck
mkdir -p "$APP_DIR/pb_data" "$APP_DIR/backups"

CURRENT=""
if [ -x "$APP_DIR/pocketbase" ]; then
  # Point it at empty folders so a bad hook or migration can't break the version check.
  VTMP="$(mktemp -d)"
  CURRENT="$("$APP_DIR/pocketbase" --version --dir="$VTMP/d" --hooksDir="$VTMP/h" --migrationsDir="$VTMP/m" 2>/dev/null | awk '{print $NF}')" || CURRENT=""
  rm -rf "$VTMP"
fi
if [ "$CURRENT" != "$PB_VERSION" ]; then
  echo "==> Downloading PocketBase $PB_VERSION ($ARCH)"
  TMP="$(mktemp -d)"
  curl -fsSL -o "$TMP/pb.zip" "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${ARCH}.zip"
  unzip -q -o "$TMP/pb.zip" pocketbase -d "$TMP"
  install -m 0755 "$TMP/pocketbase" "$APP_DIR/pocketbase"
  rm -rf "$TMP"
else
  echo "==> PocketBase $PB_VERSION already installed"
fi

echo "==> Copying the app, hooks and migrations"
for d in pb_hooks pb_migrations pb_public; do
  rm -rf "$APP_DIR/$d.new"
  cp -R "$REL/$d" "$APP_DIR/$d.new"
  rm -rf "$APP_DIR/$d"
  mv "$APP_DIR/$d.new" "$APP_DIR/$d"
done
chmod 600 "$APP_DIR/crewdeck.env"
chown -R crewdeck:crewdeck "$APP_DIR"

echo "==> Crewdeck service (port $PORT, low priority)"
install -m 0644 "$REL/crewdeck.service" /etc/systemd/system/crewdeck.service
systemctl daemon-reload
systemctl enable crewdeck >/dev/null 2>&1
systemctl restart crewdeck

ok=""
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
[ -n "$ok" ] || die "Crewdeck did not start. Check: journalctl -u crewdeck -n 50 (nothing else was touched)."
echo "==> Crewdeck is running on http://127.0.0.1:$PORT"

# Auto-update from GitHub (only Crewdeck; see crewdeck-update.sh).
if [ -f "$REL/crewdeck-update.sh" ]; then
  # Write a new file and rename it, so an update that is running this very script isn't disturbed.
  install -m 0755 "$REL/crewdeck-update.sh" /usr/local/sbin/crewdeck-update.new
  mv -f /usr/local/sbin/crewdeck-update.new /usr/local/sbin/crewdeck-update
  install -m 0644 "$REL/crewdeck-update.service" /etc/systemd/system/crewdeck-update.service
  install -m 0644 "$REL/crewdeck-update.timer" /etc/systemd/system/crewdeck-update.timer
  systemctl daemon-reload
  systemctl enable --now crewdeck-update.timer >/dev/null 2>&1
  echo "==> Auto-update is on (checks GitHub every 2 minutes)"
fi

# Daily local backup of Crewdeck's database only (needs sqlite3; skipped if it's missing).
if command -v sqlite3 >/dev/null; then
  cat > /etc/cron.daily/crewdeck-backup <<EOF
#!/bin/sh
sqlite3 $APP_DIR/pb_data/data.db ".backup '$APP_DIR/backups/data-\$(date +%F).db'"
find $APP_DIR/backups -name 'data-*.db' -mtime +14 -delete
chown -R crewdeck:crewdeck $APP_DIR/backups
EOF
  chmod 755 /etc/cron.daily/crewdeck-backup
else
  echo "    (sqlite3 not installed: daily local backup skipped; use PocketBase backups instead)"
fi

cat <<EOF

Done. Crewdeck answers on http://localhost:$PORT on this Pi.
Point the Cloudflare Tunnel hostname scheduler.hackxolotl.com to http://localhost:$PORT
EOF
