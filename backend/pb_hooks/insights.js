/// <reference path="../pb_data/types.d.ts" />
// Analytics for owners/admins (the Insights screen) and the read-only API (see API.md).
// Handlers run in isolated contexts, so each one require()s this file.

const L = require(`${__hooks}/lib.js`)

const H = 3600 * 1000
const DAY = 24 * H
const LATE_GRACE_MIN = 5 // clocking in up to 5 minutes after the shift starts isn't "late"
const OT_PREMIUM = 1.5 // overtime is paid at 1.5× the hourly rate
const MAX_ROWS = 5000

const r2 = (n) => Math.round((n || 0) * 100) / 100
const pad = (n) => (n < 10 ? "0" + n : "" + n)
const dayKey = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
function startOfDay(d) {
  const x = new Date(d.getTime())
  x.setHours(0, 0, 0, 0)
  return x
}
function startOfWeek(d) {
  const x = startOfDay(d)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)) // weeks start on Monday
  return x
}
function addDays(d, n) {
  const x = new Date(d.getTime())
  x.setDate(x.getDate() + n)
  return x
}
// "2026-11-17" = local midnight; anything else is parsed as a date-time.
function parseDay(s) {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s))
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = L.toDate(s)
  return d && !isNaN(d.getTime()) ? d : null
}
const iso = (rec, field) => {
  const d = L.getDate(rec, field)
  return d ? d.toISOString() : null
}

// ?from=YYYY-MM-DD&to=YYYY-MM-DD (to is exclusive) or ?days=N (the last N days, today included).
// Default: this week (Monday to Sunday).
function range(q) {
  q = q || {}
  let from = parseDay(q.from)
  let to = parseDay(q.to)
  const days = parseInt(q.days, 10)
  if (!from && days > 0) {
    to = addDays(startOfDay(new Date()), 1)
    from = addDays(to, -days)
  }
  if (!from) from = startOfWeek(new Date())
  if (!to) to = addDays(from, 7)
  if (to.getTime() <= from.getTime()) throw new BadRequestError("'to' must be after 'from'.")
  if (to.getTime() - from.getTime() > 400 * DAY) throw new BadRequestError("Pick a range of a year or less.")
  return { from: from, to: to }
}

function hoursWorked(tc, now) {
  const ci = L.getDate(tc, "clock_in")
  if (!ci) return 0
  const co = L.getDate(tc, "clock_out") || now
  return Math.max(0, (co.getTime() - ci.getTime()) / H - tc.getFloat("break_min") / 60)
}

function lookups(app) {
  const users = {}
  app.findRecordsByFilter("users", "", "name", 0, 0).forEach((u) => (users[u.id] = u))
  const rates = {}
  app.findRecordsByFilter("pay_rates", "", "", 0, 0).forEach((r) => (rates[r.getString("user")] = r.getFloat("hourly")))
  const positions = {}
  app.findRecordsByFilter("positions", "", "sort", 0, 0).forEach((p) => (positions[p.id] = p))
  const locations = {}
  app.findRecordsByFilter("locations", "", "name", 0, 0).forEach((l) => (locations[l.id] = l))
  const sections = {}
  app.findRecordsByFilter("sections", "", "sort", 0, 0).forEach((s) => (sections[s.id] = s))
  const nameOf = (id) => (users[id] ? users[id].getString("name") || users[id].getString("email") : null)
  return { users, rates, positions, locations, sections, nameOf }
}

// ---------- analytics ----------
function analytics(app, rng, locationId) {
  const now = new Date()
  const X = lookups(app)
  const loc = locationId ? X.locations[locationId] : null
  if (locationId && !loc) throw new BadRequestError("Unknown location.")

  // Weekly overtime limit: the location's, or the strictest one across locations.
  const limits = Object.keys(X.locations)
    .map((id) => X.locations[id])
    .filter((l) => l.getBool("active") !== false)
    .map((l) => l.getFloat("ot_weekly_hours") || 40)
  const otLimit = loc ? loc.getFloat("ot_weekly_hours") || 40 : limits.length ? limits.reduce((a, b) => Math.min(a, b)) : 40

  const params = { from: L.pbDate(rng.from), to: L.pbDate(rng.to), loc: locationId || "" }
  const locFilter = locationId ? " && location = {:loc}" : ""
  const shifts = app.findRecordsByFilter("shifts", "published = true && starts_at >= {:from} && starts_at < {:to}" + locFilter, "starts_at", 0, 0, params)
  const cards = app.findRecordsByFilter("timecards", "clock_in >= {:from} && clock_in < {:to}" + locFilter, "clock_in", 0, 0, params)
  // Clock-ins around the range, to tell whether someone showed up for a shift.
  const near = app.findRecordsByFilter("timecards", "clock_in >= {:a} && clock_in < {:b}", "", 0, 0, {
    a: L.pbDate(addDays(rng.from, -1)),
    b: L.pbDate(addDays(rng.to, 1)),
  })
  const shiftById = {}
  shifts.forEach((s) => (shiftById[s.id] = s))

  const t = {
    scheduledHours: 0,
    workedHours: 0,
    overtimeHours: 0,
    scheduledCost: 0,
    laborCost: 0,
    shifts: 0,
    openShifts: 0,
    openShiftHours: 0,
    clockIns: 0,
    clockedInNow: 0,
    late: 0,
    noShows: 0,
    outside: 0,
    needsReview: 0,
    autoClockOuts: 0,
  }
  const people = {}
  const person = (id) =>
    people[id] ||
    (people[id] = { id: id, name: X.nameOf(id), scheduledHours: 0, workedHours: 0, overtimeHours: 0, cost: 0, hourly: X.rates[id] || 0, shifts: 0, clockIns: 0, late: 0, noShows: 0, weeks: {} })
  const days = []
  const dayIdx = {}
  for (let d = startOfDay(rng.from); d.getTime() < rng.to.getTime(); d = addDays(d, 1)) {
    dayIdx[dayKey(d)] = days.length
    days.push({ date: dayKey(d), scheduledHours: 0, workedHours: 0 })
  }
  const day = (d) => days[dayIdx[dayKey(d)]] || { scheduledHours: 0, workedHours: 0 }
  const groups = { position: {}, location: {} }
  const group = (kind, id) => {
    const g = groups[kind]
    const key = id || "none"
    if (!g[key]) {
      const rec = id ? (kind === "position" ? X.positions[id] : X.locations[id]) : null
      g[key] = { id: id || null, name: rec ? rec.getString("name") : kind === "position" ? "No position" : "No location", color: rec && kind === "position" ? rec.getString("color") : null, scheduledHours: 0, workedHours: 0 }
    }
    return g[key]
  }
  const lateList = []
  const noShowList = []

  shifts.forEach((s) => {
    const st = L.getDate(s, "starts_at")
    const en = L.getDate(s, "ends_at")
    if (!st || !en) return
    const hrs = Math.max(0, (en.getTime() - st.getTime()) / H)
    const u = s.getString("user")
    if (!u) {
      t.openShifts++
      t.openShiftHours += hrs
      return
    }
    t.shifts++
    t.scheduledHours += hrs
    t.scheduledCost += hrs * (X.rates[u] || 0)
    const p = person(u)
    p.shifts++
    p.scheduledHours += hrs
    day(st).scheduledHours += hrs
    group("position", s.getString("position")).scheduledHours += hrs
    group("location", s.getString("location")).scheduledHours += hrs
    // No-show: the shift is over and they never clocked in for it.
    if (en.getTime() < now.getTime()) {
      const showed = near.some((c) => {
        if (c.getString("user") !== u) return false
        if (c.getString("shift") === s.id) return true
        const ci = L.getDate(c, "clock_in")
        const co = L.getDate(c, "clock_out") || now
        return ci && ci.getTime() < en.getTime() && co.getTime() > st.getTime()
      })
      if (!showed) {
        t.noShows++
        p.noShows++
        noShowList.push({ user: u, name: p.name, shift: s.id, starts_at: st.toISOString(), ends_at: en.toISOString(), location: group("location", s.getString("location")).name })
      }
    }
  })

  cards.forEach((c) => {
    const u = c.getString("user")
    const ci = L.getDate(c, "clock_in")
    const h = hoursWorked(c, now)
    const p = person(u)
    t.clockIns++
    t.workedHours += h
    p.clockIns++
    p.workedHours += h
    day(ci).workedHours += h
    const wk = dayKey(startOfWeek(ci))
    p.weeks[wk] = (p.weeks[wk] || 0) + h
    const sh = c.getString("shift") ? shiftById[c.getString("shift")] || L.findById(app, "shifts", c.getString("shift")) : null
    group("position", sh ? sh.getString("position") : "").workedHours += h
    group("location", c.getString("location")).workedHours += h
    if (!c.getString("clock_out")) t.clockedInNow++
    if (c.getString("in_geo") === "outside") t.outside++
    if (c.getBool("flagged") && !c.getBool("approved")) t.needsReview++
    if (c.getString("flag_reason").indexOf("Auto clock-out") === 0) t.autoClockOuts++
    const st = sh ? L.getDate(sh, "starts_at") : null
    if (st && ci.getTime() > st.getTime() + LATE_GRACE_MIN * 60 * 1000) {
      const mins = Math.round((ci.getTime() - st.getTime()) / 60000)
      t.late++
      p.late++
      lateList.push({ user: u, name: p.name, shift: sh.id, shift_start: st.toISOString(), clock_in: ci.toISOString(), minutes_late: mins })
    }
  })

  const byPerson = Object.keys(people).map((id) => {
    const p = people[id]
    p.overtimeHours = Object.keys(p.weeks).reduce((a, k) => a + Math.max(0, p.weeks[k] - otLimit), 0)
    p.cost = (p.workedHours - p.overtimeHours) * p.hourly + p.overtimeHours * p.hourly * OT_PREMIUM
    t.overtimeHours += p.overtimeHours
    t.laborCost += p.cost
    delete p.weeks
    ;["scheduledHours", "workedHours", "overtimeHours", "cost"].forEach((k) => (p[k] = r2(p[k])))
    return p
  })
  byPerson.sort((a, b) => b.workedHours - a.workedHours || b.scheduledHours - a.scheduledHours)

  const groupList = (kind) =>
    Object.keys(groups[kind])
      .map((k) => groups[kind][k])
      .map((g) => ({ id: g.id, name: g.name, color: g.color, scheduledHours: r2(g.scheduledHours), workedHours: r2(g.workedHours) }))
      .sort((a, b) => b.workedHours + b.scheduledHours - (a.workedHours + a.scheduledHours))

  // Requests and time off in the range.
  const reqs = app.findRecordsByFilter("shift_requests", "created >= {:from} && created < {:to}", "", 0, 0, params)
  const requests = { total: reqs.length, pending: 0, approved: 0, rejected: 0, byType: {} }
  reqs.forEach((r) => {
    const st = r.getString("status")
    if (st === "pending_peer" || st === "pending_admin") requests.pending++
    else if (st === "approved") requests.approved++
    else if (st === "rejected" || st === "declined") requests.rejected++
    const ty = r.getString("type")
    requests.byType[ty] = (requests.byType[ty] || 0) + 1
  })
  const offs = app.findRecordsByFilter("time_off", "starts_at < {:to} && ends_at > {:from}", "", 0, 0, params)
  const timeOff = { pending: 0, approved: 0, approvedDays: 0 }
  offs.forEach((o) => {
    if (o.getString("status") === "pending") timeOff.pending++
    if (o.getString("status") === "approved") {
      timeOff.approved++
      const s = Math.max(L.getDate(o, "starts_at").getTime(), rng.from.getTime())
      const e = Math.min(L.getDate(o, "ends_at").getTime(), rng.to.getTime())
      timeOff.approvedDays += Math.max(0, e - s) / DAY
    }
  })
  timeOff.approvedDays = Math.round(timeOff.approvedDays * 10) / 10

  const team = { active: 0, notJoined: 0 }
  Object.keys(X.users).forEach((id) => {
    const u = X.users[id]
    if (!u.getBool("active")) return
    if (locationId && ["owner", "admin"].indexOf(u.getString("access")) < 0 && L.userLocs(u).indexOf(locationId) < 0) return
    team.active++
    if (!u.getString("joined_at")) team.notJoined++
  })

  ;["scheduledHours", "workedHours", "overtimeHours", "scheduledCost", "laborCost", "openShiftHours"].forEach((k) => (t[k] = r2(t[k])))
  return {
    range: { from: rng.from.toISOString(), to: rng.to.toISOString(), location: loc ? { id: loc.id, name: loc.getString("name") } : null },
    overtimeAfterHours: otLimit,
    hasPayRates: Object.keys(X.rates).some((k) => X.rates[k] > 0),
    totals: t,
    byDay: days.map((d) => ({ date: d.date, scheduledHours: r2(d.scheduledHours), workedHours: r2(d.workedHours) })),
    byPerson: byPerson,
    byPosition: groupList("position"),
    byLocation: groupList("location"),
    late: lateList,
    noShows: noShowList,
    requests: requests,
    timeOff: timeOff,
    team: team,
  }
}

// ---------- API keys ----------
const KEY_PREFIX = "cdk_"
const hashKey = (key) => $security.sha256(key)

function createKey(app, actorId, name) {
  const key = KEY_PREFIX + $security.randomStringWithAlphabet(40, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
  const r = new Record(app.findCollectionByNameOrId("api_keys"))
  r.set("name", name)
  r.set("prefix", key.slice(0, 10))
  r.set("hash", hashKey(key))
  r.set("created_by", actorId || "")
  app.save(r)
  return { id: r.id, name: name, prefix: r.getString("prefix"), key: key }
}

function listKeys(app, nameOf) {
  return app.findRecordsByFilter("api_keys", "", "-created", 0, 0).map((k) => ({
    id: k.id,
    name: k.getString("name"),
    prefix: k.getString("prefix"),
    created: iso(k, "created"),
    created_by: nameOf ? nameOf(k.getString("created_by")) : null,
    last_used_at: iso(k, "last_used_at"),
  }))
}

// Header "X-API-Key: cdk_…" or "Authorization: Bearer cdk_…". Read-only: only GET routes call this.
function keyAuth(e) {
  const h = e.request.header.get("X-API-Key") || ""
  const a = e.request.header.get("Authorization") || ""
  const key = h || (a.indexOf("Bearer ") === 0 ? a.slice(7).trim() : "")
  if (key.indexOf(KEY_PREFIX) !== 0) throw new UnauthorizedError("Missing or invalid API key.")
  let rec = null
  try {
    rec = $app.findFirstRecordByFilter("api_keys", "hash = {:h}", { h: hashKey(key) })
  } catch (_) {
    throw new UnauthorizedError("Missing or invalid API key.")
  }
  const last = L.getDate(rec, "last_used_at")
  if (!last || Date.now() - last.getTime() > 10 * 60 * 1000) {
    rec.set("last_used_at", new Date().toISOString())
    $app.save(rec)
  }
  return rec
}

// ---------- read-only data for the API ----------
function people(app) {
  const X = lookups(app)
  return Object.keys(X.users).map((id) => {
    const u = X.users[id]
    return {
      id: id,
      name: u.getString("name"),
      email: u.getString("email") || null,
      phone: u.getString("phone") || null,
      access: u.getString("access"),
      active: u.getBool("active"),
      joined_at: iso(u, "joined_at"),
      positions: u.getStringSlice("positions").map((p) => (X.positions[p] ? X.positions[p].getString("name") : p)),
      locations: L.userLocs(u).map((l) => (X.locations[l] ? X.locations[l].getString("name") : l)),
      hourly: X.rates[id] || null,
    }
  })
}

function places(app) {
  const X = lookups(app)
  return {
    company: L.companyName(app),
    locations: Object.keys(X.locations).map((id) => {
      const l = X.locations[id]
      return {
        id: id,
        name: l.getString("name"),
        address: l.getString("address"),
        active: l.getBool("active"),
        time_clock_spot_set: !!(l.getFloat("lat") || l.getFloat("lng")),
        radius_m: l.getFloat("radius_m"),
        timezone: l.getString("timezone"),
        overtime_after_hours: l.getFloat("ot_weekly_hours") || 40,
        sections: Object.keys(X.sections)
          .map((s) => X.sections[s])
          .filter((s) => s.getString("location") === id)
          .map((s) => ({ id: s.id, name: s.getString("name") })),
      }
    }),
    positions: Object.keys(X.positions).map((id) => ({ id: id, name: X.positions[id].getString("name"), active: X.positions[id].getBool("active") })),
  }
}

function shiftsIn(app, rng, locationId) {
  const X = lookups(app)
  const loc = locationId ? " && location = {:loc}" : ""
  return app
    .findRecordsByFilter("shifts", "starts_at >= {:from} && starts_at < {:to}" + loc, "starts_at", MAX_ROWS, 0, { from: L.pbDate(rng.from), to: L.pbDate(rng.to), loc: locationId || "" })
    .map((s) => {
      const st = L.getDate(s, "starts_at")
      const en = L.getDate(s, "ends_at")
      return {
        id: s.id,
        starts_at: iso(s, "starts_at"),
        ends_at: iso(s, "ends_at"),
        hours: st && en ? r2((en.getTime() - st.getTime()) / H) : 0,
        user: s.getString("user") || null,
        name: s.getString("user") ? X.nameOf(s.getString("user")) : null,
        open_shift: !s.getString("user"),
        position: X.positions[s.getString("position")] ? X.positions[s.getString("position")].getString("name") : null,
        section: X.sections[s.getString("section")] ? X.sections[s.getString("section")].getString("name") : null,
        location: X.locations[s.getString("location")] ? X.locations[s.getString("location")].getString("name") : null,
        published: s.getBool("published"),
        notes: s.getString("notes"),
      }
    })
}

function timecardsIn(app, rng, locationId) {
  const X = lookups(app)
  const now = new Date()
  const loc = locationId ? " && location = {:loc}" : ""
  return app
    .findRecordsByFilter("timecards", "clock_in >= {:from} && clock_in < {:to}" + loc, "clock_in", MAX_ROWS, 0, { from: L.pbDate(rng.from), to: L.pbDate(rng.to), loc: locationId || "" })
    .map((c) => ({
      id: c.id,
      user: c.getString("user"),
      name: X.nameOf(c.getString("user")),
      clock_in: iso(c, "clock_in"),
      clock_out: iso(c, "clock_out"),
      hours: r2(hoursWorked(c, now)),
      break_min: c.getFloat("break_min"),
      location: X.locations[c.getString("location")] ? X.locations[c.getString("location")].getString("name") : null,
      section: X.sections[c.getString("section")] ? X.sections[c.getString("section")].getString("name") : null,
      shift: c.getString("shift") || null,
      clock_in_place: c.getString("in_geo"),
      clock_in_distance_m: c.getFloat("in_dist") || null,
      clock_out_place: c.getString("out_geo") || null,
      reason: c.getString("reason") || null,
      needs_review: c.getBool("flagged") && !c.getBool("approved"),
      flag_reason: c.getString("flag_reason") || null,
      approved: c.getBool("approved"),
    }))
}

function requestsIn(app, rng, status) {
  const X = lookups(app)
  const st = status ? " && status = {:st}" : ""
  return app
    .findRecordsByFilter("shift_requests", "created >= {:from} && created < {:to}" + st, "-created", MAX_ROWS, 0, { from: L.pbDate(rng.from), to: L.pbDate(rng.to), st: status || "" })
    .map((r) => {
      const sh = L.findById(app, "shifts", r.getString("shift"))
      return {
        id: r.id,
        type: r.getString("type"),
        status: r.getString("status"),
        requester: X.nameOf(r.getString("requester")),
        target: r.getString("target_user") ? X.nameOf(r.getString("target_user")) : null,
        shift: sh ? { id: sh.id, starts_at: iso(sh, "starts_at"), ends_at: iso(sh, "ends_at") } : null,
        note: r.getString("note") || null,
        created: iso(r, "created"),
      }
    })
}

function timeOffIn(app, rng, status) {
  const X = lookups(app)
  const st = status ? " && status = {:st}" : ""
  return app
    .findRecordsByFilter("time_off", "starts_at < {:to} && ends_at > {:from}" + st, "starts_at", MAX_ROWS, 0, { from: L.pbDate(rng.from), to: L.pbDate(rng.to), st: status || "" })
    .map((o) => ({
      id: o.id,
      user: o.getString("user"),
      name: X.nameOf(o.getString("user")),
      starts_at: iso(o, "starts_at"),
      ends_at: iso(o, "ends_at"),
      kind: o.getString("kind"),
      status: o.getString("status"),
      note: o.getString("note") || null,
      decided_by: o.getString("decided_by") ? X.nameOf(o.getString("decided_by")) : null,
    }))
}

function auditLog(app, limit) {
  const X = lookups(app)
  const n = Math.max(1, Math.min(parseInt(limit, 10) || 100, 1000))
  return app.findRecordsByFilter("audit_log", "", "-created", n, 0).map((a) => ({
    created: iso(a, "created"),
    actor: a.getString("actor") ? X.nameOf(a.getString("actor")) : "system",
    action: a.getString("action"),
    target: a.getString("target_collection") + (a.getString("target_id") ? "/" + a.getString("target_id") : ""),
    data: a.get("data"),
  }))
}

const INDEX = {
  name: "Crewdeck read-only API",
  auth: "Send the key as 'X-API-Key: cdk_…' (or 'Authorization: Bearer cdk_…'). Create keys in Settings → API Access.",
  dates: "Ranges: ?from=YYYY-MM-DD&to=YYYY-MM-DD (to not included) or ?days=N. Default: this week, Monday to Sunday.",
  endpoints: {
    "GET /api/ch/v1/summary": "Analytics: hours, labor cost, overtime, late clock-ins, no-shows, by day/person/position/location. ?from&to|days&location",
    "GET /api/ch/v1/people": "Everyone on the team, with access level, positions, locations and hourly rate.",
    "GET /api/ch/v1/locations": "Company, locations (with sections) and positions.",
    "GET /api/ch/v1/shifts": "Shifts, drafts included. ?from&to|days&location",
    "GET /api/ch/v1/timecards": "Clock-ins with hours, place check and review status. ?from&to|days&location",
    "GET /api/ch/v1/requests": "Shift swaps, covers, drops and pickups. ?from&to|days&status",
    "GET /api/ch/v1/time-off": "Time off overlapping the range. ?from&to|days&status",
    "GET /api/ch/v1/audit": "Latest changes (who did what). ?limit=100 (max 1000)",
  },
}

module.exports = { range, analytics, createKey, listKeys, keyAuth, people, places, shiftsIn, timecardsIn, requestsIn, timeOffIn, auditLog, lookups, INDEX }
