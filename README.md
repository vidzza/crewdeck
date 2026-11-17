# Crewdeck

Schedules, a GPS time clock, shift swaps and time off for the bar. Our own version of Homebase, designed like a native Apple app.

- **Live at:** https://scheduler.hackxolotl.com (on the Raspberry Pi, next to GiraBoard)
- **Get it running:** [DEPLOYMENT.md](DEPLOYMENT.md)
- **Full research and design:** [HOMEBASE_RESEARCH.md](HOMEBASE_RESEARCH.md)

| Folder | What it is |
|---|---|
| `web/` | The app (React + Vite + Tailwind, installable PWA). Served by the Pi together with the API. |
| `backend/pb_migrations/` | Database structure and starting data (positions, 4 sections). |
| `backend/pb_hooks/` | Business rules: GPS time clock, approvals, notifications and auto clock-out. |
| `backend/scripts/` | `deploy-to-pi.sh` (build + install on the Pi, next to other apps), local server and `test.sh` (98-check automatic test). |

## Key rules

- **Shift changes:** only the **owner or an admin** approves them. Managers build drafts but can't approve or publish.
- **GPS:**
  - Checked on the server from a single reading when clocking in; nobody is tracked.
  - If someone is outside the radius, they can clock in with a reason and the entry is marked "Needs review".
- **History log:** every hours correction is marked and recorded.
- **Design:** light, Apple-style (iOS) and simple enough for anyone to use without help.
