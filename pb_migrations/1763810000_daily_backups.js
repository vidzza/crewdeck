/// <reference path="../pb_data/types.d.ts" />

// Daily backup of everything (schedules, hours, people, settings), kept for 14 days,
// using PocketBase's own backups (pb_data/backups). The Pi has no sqlite3, so the
// installer's backup can't run there. 11:00 UTC = 4 AM in Denver, when the bar is closed.
// Backups can be downloaded or restored from the PocketBase dashboard (/_/ → Settings → Backups).

migrate(
  (app) => {
    const s = app.settings()
    if (s.backups.cron) return // someone already set up backups: keep theirs
    unmarshal({ backups: { cron: "0 11 * * *", cronMaxKeep: 14 } }, s)
    app.save(s)
  },
  (app) => {
    const s = app.settings()
    if (s.backups.cron !== "0 11 * * *") return
    unmarshal({ backups: { cron: "", cronMaxKeep: 0 } }, s)
    app.save(s)
  },
)
