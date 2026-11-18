/// <reference path="../pb_data/types.d.ts" />
// Shared Crewdeck logic. PocketBase handlers run in isolated contexts,
// so every handler require()s this file.

const ADMIN = ["owner", "admin"]
const MGR = ["owner", "admin", "manager"]
const MAX_ACCURACY_M = 200 // above this the GPS fix is not trustworthy

// ---------- users / permissions ----------
function access(u) {
  return u ? u.getString("access") : ""
}
function isAdmin(u) {
  return ADMIN.indexOf(access(u)) >= 0
}
function isMgr(u) {
  return MGR.indexOf(access(u)) >= 0
}
function requireUser(e) {
  const u = e.auth
  if (!u || u.collection().name !== "users") throw new UnauthorizedError("Please sign in.")
  if (!u.getBool("active")) throw new ForbiddenError("Your account is deactivated.")
  return u
}
function requireAdmin(e) {
  const u = requireUser(e)
  if (!isAdmin(u)) throw new ForbiddenError("Only the owner or an admin can do this.")
  return u
}
function requireMgr(e) {
  const u = requireUser(e)
  if (!isMgr(u)) throw new ForbiddenError("Only managers, admins or the owner can do this.")
  return u
}
function body(e) {
  return e.requestInfo().body || {}
}
// id of the app user making the request ("" for the dashboard superuser).
function uid(e) {
  return e.auth && e.auth.collection().name === "users" ? e.auth.id : ""
}

// ---------- people / company ----------
// Phone numbers sign in as their last 10 digits, so "+1 (555) 123-4567" and "555 123 4567" match.
function normPhone(p) {
  const d = String(p || "").replace(/\D/g, "")
  return d.length > 10 ? d.slice(-10) : d
}
function userLocs(u) {
  return u ? u.getStringSlice("locations") : []
}
function companyName(app) {
  const c = app.findRecordsByFilter("company", "", "created", 1, 0)
  return c.length ? c[0].getString("name") : ""
}

// ---------- dates ----------
// PocketBase stores "2026-11-16 22:00:00.000Z"; filters must use that format.
function pbDate(d) {
  return d.toISOString().replace("T", " ")
}
function toDate(s) {
  if (!s) return null
  s = String(s)
  if (s.indexOf("T") < 0) s = s.replace(" ", "T")
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}
function getDate(rec, field) {
  return toDate(rec.getString(field))
}
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
function pad(n) {
  return n < 10 ? "0" + n : "" + n
}
// Uses the process time zone (TZ in the systemd service).
function fmtDay(d) {
  return DAYS[d.getDay()] + " " + MONTHS[d.getMonth()] + " " + d.getDate()
}
function fmtTime(d) {
  const h = d.getHours()
  return (h % 12 || 12) + ":" + pad(d.getMinutes()) + (h < 12 ? " AM" : " PM")
}
function fmtShift(shift) {
  const s = getDate(shift, "starts_at")
  const e = getDate(shift, "ends_at")
  if (!s || !e) return "shift"
  return fmtDay(s) + ", " + fmtTime(s) + "–" + fmtTime(e)
}

// ---------- lookups ----------
function findFirst(app, coll, filter, params) {
  try {
    return app.findFirstRecordByFilter(coll, filter, params || {})
  } catch (_) {
    return null
  }
}
function findById(app, coll, id) {
  if (!id) return null
  try {
    return app.findRecordById(coll, id)
  } catch (_) {
    return null
  }
}
function userName(app, id) {
  const u = findById(app, "users", id)
  return u ? u.getString("name") || u.getString("email") : "someone"
}

// ---------- notifications ----------
function notify(app, userIds, title, text, link) {
  const col = app.findCollectionByNameOrId("notifications")
  const seen = {}
  ;(userIds || []).forEach((id) => {
    if (!id || seen[id]) return
    seen[id] = true
    const r = new Record(col)
    r.set("user", id)
    r.set("title", title)
    r.set("body", text || "")
    r.set("link", link || "")
    r.set("read", false)
    app.save(r)
  })
}
function adminIds(app) {
  return app
    .findRecordsByFilter("users", "active = true && (access = 'owner' || access = 'admin')", "", 0, 0)
    .map((r) => r.id)
}
function telegram(text) {
  const token = $os.getenv("TELEGRAM_BOT_TOKEN")
  const chat = $os.getenv("TELEGRAM_CHAT_ID")
  if (!token || !chat) return
  try {
    $http.send({
      url: "https://api.telegram.org/bot" + token + "/sendMessage",
      method: "POST",
      body: JSON.stringify({ chat_id: chat, text: text }),
      headers: { "content-type": "application/json" },
      timeout: 8,
    })
  } catch (err) {
    console.log("telegram error", err)
  }
}
function notifyAdmins(app, title, text, link) {
  notify(app, adminIds(app), title, text, link)
  telegram(title + (text ? "\n" + text : ""))
}
function audit(app, actorId, action, coll, id, data) {
  const r = new Record(app.findCollectionByNameOrId("audit_log"))
  r.set("actor", actorId || "")
  r.set("action", action)
  r.set("target_collection", coll || "")
  r.set("target_id", id || "")
  r.set("data", data || {})
  app.save(r)
}

// ---------- GPS ----------
function distM(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const k = Math.PI / 180
  const dLat = (lat2 - lat1) * k
  const dLng = (lng2 - lng1) * k
  const a =
    Math.pow(Math.sin(dLat / 2), 2) + Math.cos(lat1 * k) * Math.cos(lat2 * k) * Math.pow(Math.sin(dLng / 2), 2)
  return 2 * R * Math.asin(Math.sqrt(a))
}
function hasCoords(rec) {
  const lat = rec.getFloat("lat")
  const lng = rec.getFloat("lng")
  return !(lat === 0 && lng === 0)
}
// Places people can clock in at: sections with their own GPS, and locations.
function geoPlaces(app, onlyLocationId, onlySectionId, allowed) {
  const ok = (locId) => !allowed || allowed.length === 0 || allowed.indexOf(locId) >= 0
  const places = []
  app.findRecordsByFilter("sections", "", "sort", 0, 0).forEach((s) => {
    if (onlySectionId && s.id !== onlySectionId) return
    if (onlyLocationId && s.getString("location") !== onlyLocationId) return
    if (!ok(s.getString("location"))) return
    if (!hasCoords(s)) return
    const loc = findById(app, "locations", s.getString("location"))
    places.push({
      location: s.getString("location"),
      section: s.id,
      name: s.getString("name"),
      lat: s.getFloat("lat"),
      lng: s.getFloat("lng"),
      radius: s.getFloat("radius_m") || (loc ? loc.getFloat("radius_m") : 0) || 100,
    })
  })
  app.findRecordsByFilter("locations", "active = true", "", 0, 0).forEach((l) => {
    if (onlyLocationId && l.id !== onlyLocationId) return
    if (!ok(l.id)) return
    if (!hasCoords(l)) return
    places.push({ location: l.id, section: "", name: l.getString("name"), lat: l.getFloat("lat"), lng: l.getFloat("lng"), radius: l.getFloat("radius_m") || 100 })
  })
  return places
}
// inside: the whole accuracy circle fits; uncertain: it overlaps; outside: it doesn't.
function checkGeo(app, b, locationId, sectionId, allowed) {
  let places = geoPlaces(app, locationId, sectionId, allowed)
  if (places.length === 0 && sectionId) places = geoPlaces(app, locationId, "", allowed)
  if (places.length === 0 && locationId) places = geoPlaces(app, "", "", allowed)
  const lat = Number(b.lat)
  const lng = Number(b.lng)
  const acc = Number(b.acc)
  const res = { geo: "not_configured", dist: null, radius: null, place: null, location: locationId || "", section: sectionId || "" }
  if (places.length === 0) return res
  if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0) || b.lat === undefined || b.lat === null) {
    res.geo = "no_gps"
    return res
  }
  let best = null
  places.forEach((p) => {
    const d = distM(lat, lng, p.lat, p.lng)
    if (!best || d - p.radius < best.d - best.p.radius) best = { p: p, d: d }
  })
  res.dist = Math.round(best.d)
  res.radius = best.p.radius
  res.place = best.p.name
  res.location = best.p.location
  res.section = best.p.section || sectionId || ""
  const a = isFinite(acc) && acc > 0 ? acc : 0
  if (a > MAX_ACCURACY_M) res.geo = "low_accuracy"
  else if (best.d + a <= best.p.radius) res.geo = "inside"
  else if (best.d - a <= best.p.radius) res.geo = "uncertain"
  else res.geo = "outside"
  return res
}
function geoNeedsReason(geo) {
  return geo === "outside" || geo === "no_gps" || geo === "low_accuracy"
}
const GEO_TXT = {
  inside: "inside",
  uncertain: "at the edge",
  outside: "outside",
  low_accuracy: "with inaccurate GPS",
  no_gps: "without GPS",
  not_configured: "(GPS not set up)",
  manual: "manually",
}

// ---------- time clock ----------
function openCard(app, userId) {
  return findFirst(app, "timecards", "user = {:u} && clock_out = ''", { u: userId })
}
function currentShift(app, userId, now) {
  const lo = pbDate(now)
  const hi = pbDate(new Date(now.getTime() + 2 * 3600 * 1000))
  const list = app.findRecordsByFilter(
    "shifts",
    "user = {:u} && published = true && starts_at <= {:hi} && ends_at >= {:lo}",
    "starts_at",
    1,
    0,
    { u: userId, lo: lo, hi: hi },
  )
  return list.length ? list[0] : null
}

function clockIn(app, u, b) {
  if (openCard(app, u.id)) throw new BadRequestError("You're already clocked in. Clock out first.")
  const now = new Date()
  const shift = currentShift(app, u.id, now)
  const g = checkGeo(app, b, shift ? shift.getString("location") : "", shift ? shift.getString("section") : "", userLocs(u))
  const reason = String(b.reason || "").trim()
  const needs = geoNeedsReason(g.geo)
  if (needs && !reason) {
    return { ok: false, needReason: true, geo: g.geo, dist: g.dist, radius: g.radius, place: g.place }
  }
  let locationId = g.location
  if (!locationId) locationId = userLocs(u)[0] || ""
  if (!locationId) {
    const first = findFirst(app, "locations", "active = true", {})
    locationId = first ? first.id : ""
  }
  const tc = new Record(app.findCollectionByNameOrId("timecards"))
  tc.set("user", u.id)
  tc.set("location", locationId)
  tc.set("section", g.section || "")
  tc.set("shift", shift ? shift.id : "")
  tc.set("clock_in", now.toISOString())
  tc.set("break_min", 0)
  if (b.lat !== undefined && b.lat !== null) {
    tc.set("in_lat", Number(b.lat) || 0)
    tc.set("in_lng", Number(b.lng) || 0)
    tc.set("in_acc", Number(b.acc) || 0)
  }
  if (g.dist !== null) tc.set("in_dist", g.dist)
  tc.set("in_geo", g.geo)
  tc.set("reason", reason)
  tc.set("flagged", needs)
  tc.set("flag_reason", needs ? "Clocked in " + GEO_TXT[g.geo] + (g.dist !== null ? " (" + g.dist + " m away)" : "") : "")
  tc.set("approved", !needs)
  app.save(tc)
  if (needs) {
    notifyAdmins(
      app,
      "⚠️ " + (u.getString("name") || "Someone") + " clocked in " + GEO_TXT[g.geo],
      (g.dist !== null ? g.dist + " m from " + g.place + ". " : "") + "Reason: " + reason,
      "#/hours",
    )
  }
  return { ok: true, timecard: tc.id, geo: g.geo, dist: g.dist, radius: g.radius, place: g.place, shift: shift ? shift.id : null }
}

function closeBreak(tc, now) {
  const bs = getDate(tc, "break_started_at")
  if (!bs) return
  tc.set("break_min", Math.round(tc.getFloat("break_min") + (now.getTime() - bs.getTime()) / 60000))
  tc.set("break_started_at", "")
}

function clockOut(app, u, b) {
  const tc = openCard(app, u.id)
  if (!tc) throw new BadRequestError("You're not clocked in.")
  const now = new Date()
  closeBreak(tc, now)
  const g = checkGeo(app, b, tc.getString("location"), tc.getString("section"), userLocs(u))
  tc.set("clock_out", now.toISOString())
  if (b.lat !== undefined && b.lat !== null) {
    tc.set("out_lat", Number(b.lat) || 0)
    tc.set("out_lng", Number(b.lng) || 0)
    tc.set("out_acc", Number(b.acc) || 0)
  }
  if (g.dist !== null) tc.set("out_dist", g.dist)
  tc.set("out_geo", g.geo)
  app.save(tc)
  const ci = getDate(tc, "clock_in")
  const hours = (now.getTime() - ci.getTime()) / 3600000 - tc.getFloat("break_min") / 60
  return { ok: true, timecard: tc.id, hours: Math.round(hours * 100) / 100, geo: g.geo }
}

function toggleBreak(app, u) {
  const tc = openCard(app, u.id)
  if (!tc) throw new BadRequestError("You're not clocked in.")
  const now = new Date()
  let onBreak
  if (tc.getString("break_started_at")) {
    closeBreak(tc, now)
    onBreak = false
  } else {
    tc.set("break_started_at", now.toISOString())
    onBreak = true
  }
  app.save(tc)
  return { ok: true, onBreak: onBreak, break_min: tc.getFloat("break_min") }
}

// Closes forgotten clock-ins: at shift end (+2 h grace) or after 14 h.
function autoClose(app) {
  const now = new Date()
  const open = app.findRecordsByFilter("timecards", "clock_out = ''", "", 0, 0)
  open.forEach((tc) => {
    const ci = getDate(tc, "clock_in")
    if (!ci) return
    const shift = findById(app, "shifts", tc.getString("shift"))
    const se = shift ? getDate(shift, "ends_at") : null
    let out = null
    if (se && now.getTime() > se.getTime() + 2 * 3600 * 1000 && se.getTime() > ci.getTime()) out = se
    else if (now.getTime() > ci.getTime() + 14 * 3600 * 1000) out = new Date(ci.getTime() + 8 * 3600 * 1000)
    if (!out) return
    closeBreak(tc, out)
    tc.set("clock_out", out.toISOString())
    tc.set("out_geo", "manual")
    tc.set("flagged", true)
    tc.set("approved", false)
    tc.set("flag_reason", "Auto clock-out: forgot to clock out")
    app.save(tc)
    const name = userName(app, tc.getString("user"))
    notify(app, [tc.getString("user")], "You were clocked out automatically", "You forgot to clock out. An admin will review your hours.", "#/hours")
    notifyAdmins(app, "⏰ Auto clock-out: " + name, "Forgot to clock out. Please review their hours.", "#/hours")
  })
}

// ---------- reminders (sent as push notifications to phones that turned them on) ----------
// • About 1 hour before a published shift starts (again if the shift is moved).
// • 30 minutes after a shift ended, if the person is still clocked in (once per clock-in).
function sendReminders(app) {
  const now = new Date()
  const soon = app.findRecordsByFilter(
    "shifts",
    "published = true && user != '' && starts_at > {:now} && starts_at <= {:until}",
    "starts_at",
    0,
    0,
    { now: pbDate(now), until: pbDate(new Date(now.getTime() + 3600 * 1000)) },
  )
  soon.forEach((s) => {
    if (s.getString("reminded_at") === s.getString("starts_at")) return
    const start = getDate(s, "starts_at")
    const loc = findById(app, "locations", s.getString("location"))
    const pos = findById(app, "positions", s.getString("position"))
    const where = [loc ? loc.getString("name") : "", pos ? pos.getString("name") : ""].filter((x) => x).join(" · ")
    notify(app, [s.getString("user")], "⏰ Your shift starts at " + fmtTime(start), where || fmtShift(s), "#/today")
    s.set("reminded_at", s.getString("starts_at"))
    app.save(s)
  })

  app.findRecordsByFilter("timecards", "clock_out = '' && out_reminded = false && shift != ''", "", 0, 0).forEach((tc) => {
    const shift = findById(app, "shifts", tc.getString("shift"))
    const end = shift ? getDate(shift, "ends_at") : null
    if (!end || now.getTime() < end.getTime() + 30 * 60 * 1000) return
    notify(app, [tc.getString("user")], "Still clocked in?", "Your shift ended at " + fmtTime(end) + ". Clock out if you're done.", "#/today")
    tc.set("out_reminded", true)
    app.save(tc)
  })
}

// ---------- shifts ----------
function overlappingShifts(app, userId, s, e, excludeIds) {
  if (!userId) return []
  const ex = excludeIds || []
  return app
    .findRecordsByFilter("shifts", "user = {:u} && starts_at < {:e} && ends_at > {:s}", "starts_at", 0, 0, { u: userId, s: pbDate(s), e: pbDate(e) })
    .filter((r) => ex.indexOf(r.id) < 0)
}
function overlappingTimeOff(app, userId, s, e) {
  if (!userId) return []
  return app.findRecordsByFilter(
    "time_off",
    "user = {:u} && status = 'approved' && starts_at < {:e} && ends_at > {:s}",
    "",
    0,
    0,
    { u: userId, s: pbDate(s), e: pbDate(e) },
  )
}
function conflictsFor(app, userId, shift, excludeIds) {
  const s = getDate(shift, "starts_at")
  const e = getDate(shift, "ends_at")
  const out = []
  overlappingShifts(app, userId, s, e, excludeIds).forEach((o) => out.push(userName(app, userId) + " already works " + fmtShift(o)))
  overlappingTimeOff(app, userId, s, e).forEach(() => out.push(userName(app, userId) + " has approved time off that day"))
  return out
}

module.exports = {
  isAdmin,
  isMgr,
  requireUser,
  requireAdmin,
  requireMgr,
  body,
  uid,
  normPhone,
  userLocs,
  companyName,
  pbDate,
  toDate,
  getDate,
  fmtShift,
  fmtDay,
  findFirst,
  findById,
  userName,
  notify,
  notifyAdmins,
  adminIds,
  audit,
  clockIn,
  clockOut,
  toggleBreak,
  autoClose,
  sendReminders,
  conflictsFor,
  overlappingShifts,
  checkGeo,
  distM,
}
