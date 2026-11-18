#!/usr/bin/env bash
# Read Crewdeck data from a terminal (also how Claude reads it). Read-only. See API.md.
#
#   ./backend/scripts/crewdeck-api.sh setup                     save a key (create it in Settings → API Access)
#   ./backend/scripts/crewdeck-api.sh                           list the endpoints
#   ./backend/scripts/crewdeck-api.sh summary                   this week's insights
#   ./backend/scripts/crewdeck-api.sh summary 'days=30'
#   ./backend/scripts/crewdeck-api.sh timecards 'from=2026-11-10&to=2026-11-17'
#   ./backend/scripts/crewdeck-api.sh people | locations | shifts | requests | time-off | audit
#
# Key: $CREWDECK_API_KEY, or the file ~/.config/crewdeck/api-key (written by "setup", readable only by you).
# Server: $CREWDECK_URL (default https://scheduler.hackxolotl.com).
set -euo pipefail
URL="${CREWDECK_URL:-https://scheduler.hackxolotl.com}"
KEY_FILE="${CREWDECK_API_KEY_FILE:-$HOME/.config/crewdeck/api-key}"
cmd="${1:-}"

if [ "$cmd" = "setup" ]; then
  mkdir -p "$(dirname "$KEY_FILE")"
  printf "Paste the API key from Crewdeck → Settings → API Access (it won't show): "
  IFS= read -rs key
  echo
  key="$(printf '%s' "$key" | tr -d '[:space:]')"
  case "$key" in cdk_*) ;; *) echo "That doesn't look like a Crewdeck key (they start with cdk_). Nothing was saved." >&2; exit 1 ;; esac
  code="$(curl -s -o /dev/null -w '%{http_code}' -H "X-API-Key: $key" "$URL/api/ch/v1")"
  [ "$code" = 200 ] || { echo "The server didn't accept that key (answer $code). Nothing was saved." >&2; exit 1; }
  (umask 077 && printf '%s' "$key" > "$KEY_FILE")
  echo "Saved. The key works and is stored in $KEY_FILE (only you can read it)."
  exit 0
fi

KEY="${CREWDECK_API_KEY:-$(cat "$KEY_FILE" 2>/dev/null || true)}"
[ -n "$KEY" ] || { echo "No API key yet. Create one in Settings → API Access, then run: $0 setup" >&2; exit 1; }
query="${2:-}"
out="$(curl -sS -H "X-API-Key: $KEY" "$URL/api/ch/v1${cmd:+/$cmd}${query:+?$query}")"
if command -v python3 >/dev/null; then printf '%s' "$out" | python3 -I -m json.tool --no-ensure-ascii 2>/dev/null || printf '%s\n' "$out"; else printf '%s\n' "$out"; fi
