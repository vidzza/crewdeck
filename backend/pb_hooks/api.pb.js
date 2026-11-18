/// <reference path="../pb_data/types.d.ts" />
// Insights (analytics) for owners and admins, API key management, and the read-only API (API.md).

// ---------- Insights screen (owner/admin) ----------
routerAdd(
  "GET",
  "/api/ch/insights",
  (e) => {
    const L = require(`${__hooks}/lib.js`)
    const I = require(`${__hooks}/insights.js`)
    L.requireAdmin(e)
    const q = e.requestInfo().query
    return e.json(200, I.analytics($app, I.range(q), q.location || ""))
  },
  $apis.requireAuth("users"),
)

// ---------- API keys (owner/admin) ----------
routerAdd(
  "GET",
  "/api/ch/api-keys",
  (e) => {
    const L = require(`${__hooks}/lib.js`)
    const I = require(`${__hooks}/insights.js`)
    L.requireAdmin(e)
    return e.json(200, { items: I.listKeys($app, (id) => (id ? L.userName($app, id) : null)) })
  },
  $apis.requireAuth("users"),
)

routerAdd(
  "POST",
  "/api/ch/api-keys",
  (e) => {
    const L = require(`${__hooks}/lib.js`)
    const I = require(`${__hooks}/insights.js`)
    const me = L.requireAdmin(e)
    const name = String(L.body(e).name || "").trim()
    if (!name) throw new BadRequestError("Give the key a name, like “Claude” or “Accountant”.")
    if (name.length > 80) throw new BadRequestError("Use a shorter name.")
    const k = I.createKey($app, me.id, name)
    L.audit($app, me.id, "api_key.create", "api_keys", k.id, { name: name, prefix: k.prefix })
    return e.json(200, k)
  },
  $apis.requireAuth("users"),
)

routerAdd(
  "DELETE",
  "/api/ch/api-keys/{id}",
  (e) => {
    const L = require(`${__hooks}/lib.js`)
    const me = L.requireAdmin(e)
    const k = L.findById($app, "api_keys", e.request.pathValue("id"))
    if (!k) throw new NotFoundError("That key doesn't exist.")
    $app.delete(k)
    L.audit($app, me.id, "api_key.revoke", "api_keys", k.id, { name: k.getString("name"), prefix: k.getString("prefix") })
    return e.json(200, { ok: true })
  },
  $apis.requireAuth("users"),
)

// ---------- read-only API (X-API-Key) ----------
routerAdd("GET", "/api/ch/v1", (e) => {
  const I = require(`${__hooks}/insights.js`)
  I.keyAuth(e)
  return e.json(200, I.INDEX)
})

routerAdd("GET", "/api/ch/v1/summary", (e) => {
  const I = require(`${__hooks}/insights.js`)
  I.keyAuth(e)
  const q = e.requestInfo().query
  return e.json(200, I.analytics($app, I.range(q), q.location || ""))
})

routerAdd("GET", "/api/ch/v1/people", (e) => {
  const I = require(`${__hooks}/insights.js`)
  I.keyAuth(e)
  return e.json(200, { items: I.people($app) })
})

routerAdd("GET", "/api/ch/v1/locations", (e) => {
  const I = require(`${__hooks}/insights.js`)
  I.keyAuth(e)
  return e.json(200, I.places($app))
})

routerAdd("GET", "/api/ch/v1/shifts", (e) => {
  const I = require(`${__hooks}/insights.js`)
  I.keyAuth(e)
  const q = e.requestInfo().query
  return e.json(200, { items: I.shiftsIn($app, I.range(q), q.location || "") })
})

routerAdd("GET", "/api/ch/v1/timecards", (e) => {
  const I = require(`${__hooks}/insights.js`)
  I.keyAuth(e)
  const q = e.requestInfo().query
  return e.json(200, { items: I.timecardsIn($app, I.range(q), q.location || "") })
})

routerAdd("GET", "/api/ch/v1/requests", (e) => {
  const I = require(`${__hooks}/insights.js`)
  I.keyAuth(e)
  const q = e.requestInfo().query
  return e.json(200, { items: I.requestsIn($app, I.range(q), q.status || "") })
})

routerAdd("GET", "/api/ch/v1/time-off", (e) => {
  const I = require(`${__hooks}/insights.js`)
  I.keyAuth(e)
  const q = e.requestInfo().query
  return e.json(200, { items: I.timeOffIn($app, I.range(q), q.status || "") })
})

routerAdd("GET", "/api/ch/v1/audit", (e) => {
  const I = require(`${__hooks}/insights.js`)
  I.keyAuth(e)
  return e.json(200, { items: I.auditLog($app, e.requestInfo().query.limit) })
})
