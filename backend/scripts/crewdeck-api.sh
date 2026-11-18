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
  find_key() { grep -oE 'cdk_[A-Za-z0-9]{40}' | head -1 || true; }
  key=""
  from_clipboard=""
  # Copied with "Copy Key"? Use it straight from the clipboard (on a Mac).
  if command -v pbpaste >/dev/null; then
    key="$(pbpaste 2>/dev/null | find_key)"
    if [ -n "$key" ]; then
      printf "Found a Crewdeck key on your clipboard (%s…). Use it? [Y/n] " "${key:0:10}"
      IFS= read -r ans
      case "$ans" in n | N | no | No) key="" ;; *) from_clipboard=1 ;; esac
    fi
  fi
  if [ -z "$key" ]; then
    printf "Paste the API key from Crewdeck → Settings → API Access, then press Enter (it won't show): "
    IFS= read -rs raw
    echo
    key="$(printf '%s' "$raw" | find_key)"
    if [ -z "$raw" ]; then
      echo "Nothing was pasted. Tap Copy Key in Crewdeck first (on the Mac, or on your iPhone with Handoff on), then run this again." >&2
      exit 1
    elif [ -z "$key" ]; then
      echo "What was pasted (${#raw} characters) isn't a Crewdeck key: it starts with cdk_ and is 44 characters long. Nothing was saved." >&2
      exit 1
    fi
  fi
  code="$(curl -s -m 20 -o /dev/null -w '%{http_code}' -H "X-API-Key: $key" "$URL/api/ch/v1" || true)"
  [ "$code" = 000 ] && { echo "Couldn't reach $URL. Check the internet connection and run this again. Nothing was saved." >&2; exit 1; }
  [ "$code" = 200 ] || { echo "The server didn't accept that key (answer $code): it may have been revoked. Nothing was saved." >&2; exit 1; }
  (umask 077 && printf '%s' "$key" > "$KEY_FILE")
  # Don't leave a working key sitting on the clipboard.
  [ -n "$from_clipboard" ] && printf '' | pbcopy
  echo "Saved. The key works and is stored in $KEY_FILE (only you can read it)."
  exit 0
fi

KEY="${CREWDECK_API_KEY:-$(cat "$KEY_FILE" 2>/dev/null || true)}"
[ -n "$KEY" ] || { echo "No API key yet. Create one in Settings → API Access, then run: $0 setup" >&2; exit 1; }
query="${2:-}"
out="$(curl -sS -H "X-API-Key: $KEY" "$URL/api/ch/v1${cmd:+/$cmd}${query:+?$query}")"
if command -v python3 >/dev/null; then printf '%s' "$out" | python3 -I -m json.tool --no-ensure-ascii 2>/dev/null || printf '%s\n' "$out"; else printf '%s\n' "$out"; fi
