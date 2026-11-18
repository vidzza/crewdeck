/// <reference path="../pb_data/types.d.ts" />

// Crewdeck — initial schema.
// Workflows (clock in/out, shift changes, time off) go through the /api/ch/* routes
// in pb_hooks; workflow collections are read-only through the regular API.

migrate((app) => {
  const AUTH =
    '@request.auth.id != "" && @request.auth.collectionName = "users" && @request.auth.active = true'
  const MGR =
    AUTH +
    ' && (@request.auth.access = "owner" || @request.auth.access = "admin" || @request.auth.access = "manager")'
  const ADMIN = AUTH + ' && (@request.auth.access = "owner" || @request.auth.access = "admin")'

  const dates = () => [
    { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ]

  const users = app.findCollectionByNameOrId("users")

  // ---------- positions ----------
  const positions = new Collection({
    type: "base",
    name: "positions",
    listRule: AUTH,
    viewRule: AUTH,
    createRule: ADMIN,
    updateRule: ADMIN,
    deleteRule: ADMIN,
    fields: [
      { name: "name", type: "text", required: true, max: 60 },
      { name: "color", type: "text", max: 20 },
      { name: "sort", type: "number", onlyInt: true },
      { name: "active", type: "bool" },
    ].concat(dates()),
  })
  app.save(positions)

  // ---------- locations (bars / branches) ----------
  const locations = new Collection({
    type: "base",
    name: "locations",
    listRule: AUTH,
    viewRule: AUTH,
    createRule: ADMIN,
    updateRule: ADMIN,
    deleteRule: '@request.auth.access = "owner"',
    fields: [
      { name: "name", type: "text", required: true, max: 80 },
      { name: "address", type: "text", max: 200 },
      { name: "lat", type: "number" },
      { name: "lng", type: "number" },
      { name: "radius_m", type: "number", min: 10, max: 2000 },
      { name: "timezone", type: "text", max: 60 },
      { name: "ot_weekly_hours", type: "number", min: 0, max: 168 },
      { name: "active", type: "bool" },
    ].concat(dates()),
  })
  app.save(locations)

  // ---------- sections (areas inside the bar, optional own GPS) ----------
  const sections = new Collection({
    type: "base",
    name: "sections",
    listRule: AUTH,
    viewRule: AUTH,
    createRule: ADMIN,
    updateRule: ADMIN,
    deleteRule: ADMIN,
    fields: [
      { name: "location", type: "relation", required: true, maxSelect: 1, collectionId: locations.id, cascadeDelete: true },
      { name: "name", type: "text", required: true, max: 60 },
      { name: "color", type: "text", max: 20 },
      { name: "lat", type: "number" },
      { name: "lng", type: "number" },
      { name: "radius_m", type: "number", min: 0, max: 2000 },
      { name: "sort", type: "number", onlyInt: true },
    ].concat(dates()),
  })
  app.save(sections)

  // ---------- users: extra fields and rules ----------
  users.fields.add(new SelectField({ name: "access", required: true, maxSelect: 1, values: ["owner", "admin", "manager", "employee"] }))
  users.fields.add(new RelationField({ name: "positions", maxSelect: 20, collectionId: positions.id }))
  users.fields.add(new TextField({ name: "phone", max: 30 }))
  users.fields.add(new BoolField({ name: "active" }))

  users.listRule = AUTH
  users.viewRule = AUTH
  users.createRule = ADMIN + ' && (@request.auth.access = "owner" || @request.body.access != "owner")'
  users.updateRule =
    "(" + ADMIN + ' && (@request.auth.access = "owner" || (access != "owner" && @request.body.access != "owner"))) || ' +
    '(id = @request.auth.id && @request.body.access:isset = false && @request.body.active:isset = false && @request.body.positions:isset = false)'
  users.deleteRule = AUTH + ' && @request.auth.access = "owner" && id != @request.auth.id'
  users.manageRule = ADMIN + ' && (@request.auth.access = "owner" || access != "owner")'
  users.authRule = "active = true"
  app.save(users)

  // ---------- pay_rates (wages, admins only) ----------
  const payRates = new Collection({
    type: "base",
    name: "pay_rates",
    listRule: ADMIN,
    viewRule: ADMIN,
    createRule: ADMIN,
    updateRule: ADMIN,
    deleteRule: ADMIN,
    fields: [
      { name: "user", type: "relation", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true },
      { name: "hourly", type: "number", min: 0 },
    ].concat(dates()),
    indexes: ["CREATE UNIQUE INDEX idx_pay_rates_user ON pay_rates (user)"],
  })
  app.save(payRates)

  // ---------- shifts ----------
  const shifts = new Collection({
    type: "base",
    name: "shifts",
    listRule: AUTH + " && (published = true || " + MGR.replace(AUTH + " && ", "") + ")",
    viewRule: AUTH + " && (published = true || " + MGR.replace(AUTH + " && ", "") + ")",
    // Managers build drafts; publishing or editing published shifts = owner/admin.
    createRule:
      "(" + ADMIN + ") || (" + MGR + ' && @request.auth.access = "manager" && (@request.body.published:isset = false || @request.body.published = false))',
    updateRule:
      "(" + ADMIN + ") || (" + MGR + ' && @request.auth.access = "manager" && published = false && (@request.body.published:isset = false || @request.body.published = false))',
    deleteRule: "(" + ADMIN + ") || (" + MGR + ' && @request.auth.access = "manager" && published = false)',
    fields: [
      { name: "location", type: "relation", required: true, maxSelect: 1, collectionId: locations.id, cascadeDelete: true },
      { name: "section", type: "relation", maxSelect: 1, collectionId: sections.id },
      { name: "position", type: "relation", maxSelect: 1, collectionId: positions.id },
      { name: "user", type: "relation", maxSelect: 1, collectionId: users.id },
      { name: "starts_at", type: "date", required: true },
      { name: "ends_at", type: "date", required: true },
      { name: "notes", type: "text", max: 300 },
      { name: "published", type: "bool" },
      { name: "created_by", type: "relation", maxSelect: 1, collectionId: users.id },
    ].concat(dates()),
    indexes: [
      "CREATE INDEX idx_shifts_user ON shifts (user, starts_at)",
      "CREATE INDEX idx_shifts_starts ON shifts (starts_at)",
    ],
  })
  app.save(shifts)

  // ---------- shift_requests (cover / swap / drop / pickup) ----------
  const shiftRequests = new Collection({
    type: "base",
    name: "shift_requests",
    listRule:
      AUTH +
      ' && (requester = @request.auth.id || target_user = @request.auth.id || @request.auth.access = "owner" || @request.auth.access = "admin" || @request.auth.access = "manager" || (type = "cover" && target_user = "" && status = "pending_peer"))',
    viewRule:
      AUTH +
      ' && (requester = @request.auth.id || target_user = @request.auth.id || @request.auth.access = "owner" || @request.auth.access = "admin" || @request.auth.access = "manager" || (type = "cover" && target_user = "" && status = "pending_peer"))',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "type", type: "select", required: true, maxSelect: 1, values: ["cover", "swap", "drop", "pickup"] },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["pending_peer", "pending_admin", "approved", "rejected", "declined", "cancelled"] },
      { name: "shift", type: "relation", required: true, maxSelect: 1, collectionId: shifts.id, cascadeDelete: true },
      { name: "requester", type: "relation", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true },
      { name: "target_user", type: "relation", maxSelect: 1, collectionId: users.id },
      { name: "target_shift", type: "relation", maxSelect: 1, collectionId: shifts.id },
      { name: "note", type: "text", max: 300 },
      { name: "peer_responded_at", type: "date" },
      { name: "decided_by", type: "relation", maxSelect: 1, collectionId: users.id },
      { name: "decided_at", type: "date" },
      { name: "decision_note", type: "text", max: 300 },
    ].concat(dates()),
    indexes: ["CREATE INDEX idx_shift_requests_status ON shift_requests (status)"],
  })
  app.save(shiftRequests)

  // ---------- time_off ----------
  const timeOff = new Collection({
    type: "base",
    name: "time_off",
    listRule: AUTH + ' && (user = @request.auth.id || @request.auth.access = "owner" || @request.auth.access = "admin" || @request.auth.access = "manager")',
    viewRule: AUTH + ' && (user = @request.auth.id || @request.auth.access = "owner" || @request.auth.access = "admin" || @request.auth.access = "manager")',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "user", type: "relation", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true },
      { name: "starts_at", type: "date", required: true },
      { name: "ends_at", type: "date", required: true },
      { name: "kind", type: "select", required: true, maxSelect: 1, values: ["vacation", "sick", "personal", "unpaid"] },
      { name: "note", type: "text", max: 300 },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["pending", "approved", "rejected", "cancelled"] },
      { name: "decided_by", type: "relation", maxSelect: 1, collectionId: users.id },
      { name: "decided_at", type: "date" },
      { name: "decision_note", type: "text", max: 300 },
    ].concat(dates()),
  })
  app.save(timeOff)

  // ---------- timecards ----------
  const geoValues = ["inside", "uncertain", "outside", "low_accuracy", "no_gps", "not_configured", "manual"]
  const timecards = new Collection({
    type: "base",
    name: "timecards",
    listRule: AUTH + ' && (user = @request.auth.id || @request.auth.access = "owner" || @request.auth.access = "admin" || @request.auth.access = "manager")',
    viewRule: AUTH + ' && (user = @request.auth.id || @request.auth.access = "owner" || @request.auth.access = "admin" || @request.auth.access = "manager")',
    createRule: MGR,
    // Managers can fix hours; only owner/admin can approve.
    updateRule: "(" + ADMIN + ") || (" + MGR + " && @request.body.approved:isset = false)",
    deleteRule: ADMIN,
    fields: [
      { name: "user", type: "relation", required: true, maxSelect: 1, collectionId: users.id },
      { name: "location", type: "relation", maxSelect: 1, collectionId: locations.id },
      { name: "section", type: "relation", maxSelect: 1, collectionId: sections.id },
      { name: "shift", type: "relation", maxSelect: 1, collectionId: shifts.id },
      { name: "clock_in", type: "date", required: true },
      { name: "clock_out", type: "date" },
      { name: "break_started_at", type: "date" },
      { name: "break_min", type: "number", min: 0 },
      { name: "in_lat", type: "number" },
      { name: "in_lng", type: "number" },
      { name: "in_acc", type: "number" },
      { name: "in_dist", type: "number" },
      { name: "in_geo", type: "select", maxSelect: 1, values: geoValues },
      { name: "out_lat", type: "number" },
      { name: "out_lng", type: "number" },
      { name: "out_acc", type: "number" },
      { name: "out_dist", type: "number" },
      { name: "out_geo", type: "select", maxSelect: 1, values: geoValues },
      { name: "reason", type: "text", max: 300 },
      { name: "flagged", type: "bool" },
      { name: "flag_reason", type: "text", max: 300 },
      { name: "approved", type: "bool" },
      { name: "approved_by", type: "relation", maxSelect: 1, collectionId: users.id },
      { name: "notes", type: "text", max: 300 },
      { name: "edited", type: "bool" },
      { name: "edited_by", type: "relation", maxSelect: 1, collectionId: users.id },
    ].concat(dates()),
    indexes: ["CREATE INDEX idx_timecards_user ON timecards (user, clock_in)", "CREATE INDEX idx_timecards_in ON timecards (clock_in)"],
  })
  app.save(timecards)

  // ---------- notifications (in-app) ----------
  const notifications = new Collection({
    type: "base",
    name: "notifications",
    listRule: AUTH + " && user = @request.auth.id",
    viewRule: AUTH + " && user = @request.auth.id",
    createRule: null,
    updateRule: AUTH + " && user = @request.auth.id && @request.body.user:isset = false",
    deleteRule: AUTH + " && user = @request.auth.id",
    fields: [
      { name: "user", type: "relation", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true },
      { name: "title", type: "text", required: true, max: 200 },
      { name: "body", type: "text", max: 1000 },
      { name: "link", type: "text", max: 200 },
      { name: "read", type: "bool" },
    ].concat(dates()),
    indexes: ["CREATE INDEX idx_notifications_user ON notifications (user, read)"],
  })
  app.save(notifications)

  // ---------- audit_log ----------
  const audit = new Collection({
    type: "base",
    name: "audit_log",
    listRule: ADMIN,
    viewRule: ADMIN,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "actor", type: "relation", maxSelect: 1, collectionId: users.id },
      { name: "action", type: "text", required: true, max: 80 },
      { name: "target_collection", type: "text", max: 60 },
      { name: "target_id", type: "text", max: 30 },
      { name: "data", type: "json", maxSize: 20000 },
    ].concat(dates()),
  })
  app.save(audit)

  // ---------- seed data ----------
  const POS = [
    ["General Manager", "#af52de"],
    ["Assistant Manager", "#5856d6"],
    ["Bartender", "#34c759"],
    ["Barback", "#ff9500"],
    ["Cocktails", "#ff2d55"],
    ["Bouncer", "#8e8e93"],
  ]
  POS.forEach((p, i) => {
    const r = new Record(positions)
    r.set("name", p[0])
    r.set("color", p[1])
    r.set("sort", i)
    r.set("active", true)
    app.save(r)
  })

  const loc = new Record(locations)
  loc.set("name", "My Bar")
  loc.set("radius_m", 100)
  loc.set("timezone", "America/Mexico_City")
  loc.set("ot_weekly_hours", 40)
  loc.set("active", true)
  app.save(loc)

  const SECS = [
    ["Main Bar", "#007aff"],
    ["Cocktail Bar", "#ff2d55"],
    ["Floor", "#30b0c7"],
    ["Door", "#8e8e93"],
  ]
  SECS.forEach((s, i) => {
    const r = new Record(sections)
    r.set("location", loc.id)
    r.set("name", s[0])
    r.set("color", s[1])
    r.set("sort", i)
    app.save(r)
  })
}, (app) => {
  ;["audit_log", "notifications", "timecards", "time_off", "shift_requests", "shifts", "pay_rates", "sections", "locations", "positions"].forEach((n) => {
    try {
      app.delete(app.findCollectionByNameOrId(n))
    } catch (_) {}
  })
  const users = app.findCollectionByNameOrId("users")
  ;["access", "positions", "phone", "active"].forEach((f) => users.fields.removeByName(f))
  users.listRule = "id = @request.auth.id"
  users.viewRule = "id = @request.auth.id"
  users.createRule = ""
  users.updateRule = "id = @request.auth.id"
  users.deleteRule = "id = @request.auth.id"
  users.manageRule = null
  users.authRule = ""
  app.save(users)
})
