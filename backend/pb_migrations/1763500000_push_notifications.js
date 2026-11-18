/// <reference path="../pb_data/types.d.ts" />

// Push notifications: the devices where each person turned notifications on,
// plus markers so each reminder is sent only once.

migrate((app) => {
  const users = app.findCollectionByNameOrId("users")

  // Only the server reads and writes these (through /api/ch/push/*), never the app directly.
  const subs = new Collection({
    type: "base",
    name: "push_subscriptions",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "user", type: "relation", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true },
      { name: "endpoint", type: "text", required: true, max: 1000 },
      { name: "p256dh", type: "text", required: true, max: 200 },
      { name: "auth", type: "text", required: true, max: 100 },
      { name: "ua", type: "text", max: 300 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_push_endpoint ON push_subscriptions (endpoint)",
      "CREATE INDEX idx_push_user ON push_subscriptions (user)",
    ],
  })
  app.save(subs)

  // "Your shift starts at…": the start time it was sent for (a moved shift gets a new reminder).
  const shifts = app.findCollectionByNameOrId("shifts")
  shifts.fields.add(new DateField({ name: "reminded_at" }))
  app.save(shifts)

  // "Still clocked in?": sent once per clock-in.
  const timecards = app.findCollectionByNameOrId("timecards")
  timecards.fields.add(new BoolField({ name: "out_reminded" }))
  app.save(timecards)
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("push_subscriptions"))
  } catch (_) {}
  const shifts = app.findCollectionByNameOrId("shifts")
  shifts.fields.removeByName("reminded_at")
  app.save(shifts)
  const timecards = app.findCollectionByNameOrId("timecards")
  timecards.fields.removeByName("out_reminded")
  app.save(timecards)
})
