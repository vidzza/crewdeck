/// <reference path="../pb_data/types.d.ts" />

// Company → locations → people, invite links, and sign-in with email OR phone.
// Also scopes schedules and clock-ins to the locations each person works at.

migrate((app) => {
  const AUTH =
    '@request.auth.id != "" && @request.auth.collectionName = "users" && @request.auth.active = true'
  const ADMIN = '(@request.auth.access = "owner" || @request.auth.access = "admin")'
  const MGR = '@request.auth.access = "manager"'
  const dates = () => [
    { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ]

  const users = app.findCollectionByNameOrId("users")
  const locations = app.findCollectionByNameOrId("locations")

  // ---------- company (one record) ----------
  const company = new Collection({
    type: "base",
    name: "company",
    listRule: AUTH,
    viewRule: AUTH,
    createRule: null,
    updateRule: AUTH + " && " + ADMIN,
    deleteRule: null,
    fields: [{ name: "name", type: "text", required: true, max: 120 }].concat(dates()),
  })
  app.save(company)

  // ---------- users: locations, phone sign-in, joined ----------
  users.fields.add(new RelationField({ name: "locations", maxSelect: 50, collectionId: locations.id }))
  users.fields.add(new TextField({ name: "phone_login", max: 20 }))
  users.fields.add(new DateField({ name: "joined_at" }))
  users.addIndex("idx_users_phone_login", true, "phone_login", "phone_login != ''")
  users.passwordAuth.identityFields = ["email", "phone_login"]
  const email = users.fields.getByName("email")
  email.required = false
  // People can edit their own name/phone, but not their access, locations or join date.
  users.updateRule =
    "(" +
    AUTH +
    " && " +
    ADMIN +
    ' && (@request.auth.access = "owner" || (access != "owner" && @request.body.access != "owner"))) || ' +
    "(id = @request.auth.id && @request.body.access:isset = false && @request.body.active:isset = false && @request.body.positions:isset = false && @request.body.locations:isset = false && @request.body.joined_at:isset = false)"
  app.save(users)

  // ---------- invites (also used to reset a forgotten password) ----------
  const invites = new Collection({
    type: "base",
    name: "invites",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "user", type: "relation", required: true, maxSelect: 1, collectionId: users.id, cascadeDelete: true },
      { name: "token", type: "text", required: true, min: 20, max: 80 },
      { name: "expires_at", type: "date" },
      { name: "used_at", type: "date" },
      { name: "created_by", type: "relation", maxSelect: 1, collectionId: users.id },
    ].concat(dates()),
    indexes: ["CREATE UNIQUE INDEX idx_invites_token ON invites (token)"],
  })
  app.save(invites)

  // ---------- rules scoped by location ----------
  const AT_LOC = "@request.auth.locations.id ?= location"

  const shifts = app.findCollectionByNameOrId("shifts")
  shifts.listRule = AUTH + " && (" + ADMIN + " || (" + AT_LOC + " && (published = true || " + MGR + ")))"
  shifts.viewRule = shifts.listRule
  shifts.createRule =
    AUTH + " && (" + ADMIN + " || (" + MGR + " && @request.auth.locations.id ?= @request.body.location && (@request.body.published:isset = false || @request.body.published = false)))"
  shifts.updateRule =
    AUTH +
    " && (" +
    ADMIN +
    " || (" +
    MGR +
    " && " +
    AT_LOC +
    " && published = false && (@request.body.published:isset = false || @request.body.published = false) && (@request.body.location:isset = false || @request.auth.locations.id ?= @request.body.location)))"
  shifts.deleteRule = AUTH + " && (" + ADMIN + " || (" + MGR + " && " + AT_LOC + " && published = false))"
  app.save(shifts)

  const timecards = app.findCollectionByNameOrId("timecards")
  timecards.listRule = AUTH + " && (user = @request.auth.id || " + ADMIN + " || (" + MGR + " && " + AT_LOC + "))"
  timecards.viewRule = timecards.listRule
  timecards.createRule = AUTH + " && (" + ADMIN + " || (" + MGR + " && @request.auth.locations.id ?= @request.body.location))"
  timecards.updateRule = AUTH + " && (" + ADMIN + " || (" + MGR + " && " + AT_LOC + " && @request.body.approved:isset = false))"
  app.save(timecards)

  const requests = app.findCollectionByNameOrId("shift_requests")
  requests.listRule =
    AUTH +
    " && (requester = @request.auth.id || target_user = @request.auth.id || " +
    ADMIN +
    " || (" +
    MGR +
    " && @request.auth.locations.id ?= shift.location) || (type = \"cover\" && target_user = \"\" && status = \"pending_peer\" && @request.auth.locations.id ?= shift.location))"
  requests.viewRule = requests.listRule
  app.save(requests)

  // ---------- data ----------
  const allUsers = app.findRecordsByFilter("users", "", "", 0, 0)
  const allLocs = app.findRecordsByFilter("locations", "", "created", 0, 0).map((l) => l.id)
  if (allUsers.length === 0) {
    // Fresh install: no example areas; the owner names the company and first location during setup.
    app.findRecordsByFilter("sections", "", "", 0, 0).forEach((s) => app.delete(s))
  } else {
    // Existing data: everyone works at every location, already joined, phone becomes a sign-in.
    allUsers.forEach((u) => {
      u.set("locations", allLocs)
      if (!u.getString("joined_at")) u.set("joined_at", u.getString("created"))
      const digits = u.getString("phone").replace(/\D/g, "")
      u.set("phone_login", digits.length > 10 ? digits.slice(-10) : digits)
      app.saveNoValidate(u)
    })
    const first = app.findRecordsByFilter("locations", "", "created", 1, 0)[0]
    const c = new Record(company)
    c.set("name", first ? first.getString("name") : "My Company")
    app.save(c)
  }
}, (app) => {
  ;["invites", "company"].forEach((n) => {
    try {
      app.delete(app.findCollectionByNameOrId(n))
    } catch (_) {}
  })
  const users = app.findCollectionByNameOrId("users")
  users.passwordAuth.identityFields = ["email"]
  users.removeIndex("idx_users_phone_login")
  ;["locations", "phone_login", "joined_at"].forEach((f) => users.fields.removeByName(f))
  app.save(users)
})
