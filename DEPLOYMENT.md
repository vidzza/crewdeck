# Crewdeck — Deployment Guide

Crewdeck runs on the Raspberry Pi **next to GiraBoard**, and is published at **https://scheduler.hackxolotl.com** through the Cloudflare Tunnel that's already on the Pi.

```
Phones ──► https://scheduler.hackxolotl.com ──► Cloudflare Tunnel (existing connector)
                                                   └─► Pi: Crewdeck on http://localhost:8095
                                                        (app + API + SQLite, one small program)
```

## Rules for sharing the Pi with GiraBoard

- Crewdeck lives only in `/opt/crewdeck`, runs as its own `crewdeck` user and its own `crewdeck` service.
- The installer **never** stops, restarts or edits other services (GiraBoard, cloudflared), and never runs `apt`.
- It refuses to install if its port (8095) is already used by something else.
- It runs at **lower priority** than other apps, with at most one CPU core and a memory ceiling, so it can't slow GiraBoard down.
- It only listens on `127.0.0.1`; the only way in from outside is the tunnel.

---

## Step 1. Let this computer reach the Pi with an SSH key (once)

From this folder, in a terminal, run this and type the Pi's password when asked:

```bash
ssh-copy-id USER@PI_HOST
```

After that, `ssh USER@PI_HOST` works without a password.

## Step 2. Install (or update) Crewdeck

```bash
./backend/scripts/deploy-to-pi.sh USER@PI_HOST
```

It builds the app here, copies it to `~/crewdeck-release` on the Pi and runs the installer there with `sudo`. It finishes with "Crewdeck is running on http://127.0.0.1:8095". Run the same command to update; the database is kept.

Settings live in `/opt/crewdeck/crewdeck.env` on the Pi (created once, never overwritten):

| Setting | Default | What it is |
|---|---|---|
| `TZ` | `America/Chicago` | The bar's time zone, for notification text |
| `CREWDECK_PORT` | `8095` | Local port; must be free |
| `CREWDECK_ORIGINS` | `https://scheduler.hackxolotl.com` | The public address |
| `CREWDECK_SETUP_CODE` | empty | Optional code for creating the owner account |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | empty | Optional admin alerts on Telegram |

After editing it: `sudo systemctl restart crewdeck` (only Crewdeck restarts).

## Step 3. Add the subdomain to the existing tunnel

`hackxolotl.com` must be in the same Cloudflare account as the tunnel.

**If the tunnel is managed from the Cloudflare dashboard** (most common):
1. [one.dash.cloudflare.com](https://one.dash.cloudflare.com) → **Networks → Tunnels** → the Pi's tunnel → **Edit** → **Public Hostname** → **Add a public hostname**.
2. Subdomain `scheduler`, Domain `hackxolotl.com`, Service type `HTTP`, URL `localhost:8095`.
3. Save. Cloudflare creates the DNS record by itself. GiraBoard's hostnames are not touched and the tunnel doesn't restart.

**If the tunnel uses a config file on the Pi** (`/etc/cloudflared/config.yml`): add a rule for `scheduler.hackxolotl.com` → `http://localhost:8095` **above** the final catch-all rule, validate it, add the DNS route, and restart `cloudflared`. That restart briefly interrupts GiraBoard for a few seconds, so do it at a quiet time.

Check it: `https://scheduler.hackxolotl.com/api/health` should answer `API is healthy`.

## Step 4. First use (ideally at the bar)

1. Open **https://scheduler.hackxolotl.com** → **Welcome** → create the owner account.
2. **Settings → Bar & Time Clock:** stand in the middle of the bar, tap **Use My Current Location**, then **Save**. Leave the radius at 100 m.
3. **Settings → Sections** and **Positions:** rename and recolor.
4. **Settings → Team → +:** add each person with their email, a starting password, access level and positions.
5. **Schedule:** add shifts (or **Copy Last Week**), then tap the blue banner to publish.

Each employee opens the link, signs in, taps **Allow** for location, and adds it to the Home Screen (the app shows how).

## Backups

- A daily copy of Crewdeck's database goes to `/opt/crewdeck/backups` (kept 14 days; needs `sqlite3` on the Pi).
- For off-Pi backups, open the PocketBase dashboard (`https://scheduler.hackxolotl.com/_/`) → **Settings → Backups** and add a Cloudflare R2 bucket. Protect `/_/` with Cloudflare Access first.
- Create the dashboard superuser on the Pi:

```bash
sudo -u crewdeck /opt/crewdeck/pocketbase superuser upsert YOUR_EMAIL A_LONG_PASSWORD --dir=/opt/crewdeck/pb_data
```

## Useful commands on the Pi

| What | Command |
|---|---|
| Status | `systemctl status crewdeck` |
| Logs | `journalctl -u crewdeck -f` |
| Restart Crewdeck only | `sudo systemctl restart crewdeck` |
| Stop Crewdeck only | `sudo systemctl stop crewdeck` |
| Memory and CPU it uses | `systemctl status crewdeck` (Memory / CPU lines) |

## Removing Crewdeck completely

Nothing else on the Pi depends on it:

```bash
sudo systemctl disable --now crewdeck && sudo rm -f /etc/systemd/system/crewdeck.service /etc/cron.daily/crewdeck-backup && sudo systemctl daemon-reload
```

Then delete the tunnel's `scheduler` public hostname. `/opt/crewdeck` holds the data; delete it only when you're sure.

## Testing on this computer

1. Install [Go](https://go.dev/dl/) and Node. The server is Crewdeck's own build of PocketBase 0.40.6 (`backend/server`), which adds push notifications; the scripts build it into `backend/bin/crewdeck-server`.
2. Automatic backend test (222 checks, push notifications, insights and the API included):

```bash
./backend/scripts/test.sh
```

3. Run the app locally: `./backend/scripts/dev.sh` in one terminal, `cd web && npm install && npm run dev` in another, then open `http://localhost:5173`.
