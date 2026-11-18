# Crewdeck read-only API

Everything in Crewdeck, readable by other tools (Claude, a spreadsheet, a script). **Read-only:** a key can't create, change or delete anything.

- **Server:** `https://scheduler.hackxolotl.com`
- **Keys:** the owner or an admin creates them in **Settings → API Access**. A key is shown once; only a SHA-256 hash is stored. Revoking a key there stops it immediately. Every key creation and revocation is in the audit log.
- **Auth header:** `X-API-Key: cdk_…` (or `Authorization: Bearer cdk_…`)

## Quick start (terminal)

```bash
./backend/scripts/crewdeck-api.sh setup
```

Paste the key when asked (it isn't shown, and it's saved to `~/.config/crewdeck/api-key`, readable only by you). Then:

```bash
./backend/scripts/crewdeck-api.sh summary
```

```bash
./backend/scripts/crewdeck-api.sh timecards 'days=30'
```

## Dates

Endpoints with a range take either:

- `from=YYYY-MM-DD&to=YYYY-MM-DD`: `to` is not included; dates are midnight in the company's time zone, or
- `days=N`: the last N days, today included.

Default: this week, Monday to Sunday. Longest range: about a year. Times in responses are ISO 8601 in UTC.

## Endpoints

| Endpoint | What it returns | Options |
|---|---|---|
| `GET /api/ch/v1` | This list | |
| `GET /api/ch/v1/summary` | Insights: hours, labor cost, overtime, late clock-ins, no-shows, by day / person / position / location, requests, time off | range, `location=<id>` |
| `GET /api/ch/v1/people` | Everyone: name, email, phone, access level, active, joined date, positions, locations, hourly rate | |
| `GET /api/ch/v1/locations` | Company name, locations (with sections, time clock spot set or not, overtime rule) and positions | |
| `GET /api/ch/v1/shifts` | Shifts, drafts included: who, when, hours, position, section, location, published | range, `location=<id>` |
| `GET /api/ch/v1/timecards` | Clock-ins: hours, breaks, where they clocked in (inside / outside / …), reason, needs review | range, `location=<id>` |
| `GET /api/ch/v1/requests` | Shift swaps, covers, drops and pickups with status | range (by request date), `status=` |
| `GET /api/ch/v1/time-off` | Time off overlapping the range | range, `status=pending\|approved\|rejected\|cancelled` |
| `GET /api/ch/v1/audit` | Latest changes: who did what, newest first | `limit=` (default 100, max 1000) |

## What the summary numbers mean

- **Scheduled hours / cost:** published shifts that start in the range and have a person (open shifts are counted separately).
- **Worked hours:** clock-ins that start in the range, minus breaks; someone still clocked in counts up to now.
- **Overtime:** per person, per week (Monday to Sunday), hours above the location's "Overtime After" (40 by default; without a location filter, the strictest location's).
- **Labor cost:** worked hours × hourly rate, with overtime hours at 1.5×. People without a rate count as $0.
- **Late:** clocked in more than 5 minutes after their shift started.
- **No-show:** a published shift that has ended with no clock-in at all from that person during it.
- **Outside / needs review / auto clock-outs:** clock-ins away from the time clock spot, clock-ins waiting for review, and forgotten clock-outs closed automatically.

## Errors

`401` missing, wrong or revoked key · `400` bad range or unknown location · JSON body: `{"message": "…"}`.
