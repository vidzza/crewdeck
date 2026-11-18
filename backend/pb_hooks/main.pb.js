/// <reference path="../pb_data/types.d.ts" />
// Crewdeck routes: /api/ch/*
// Each handler runs in isolation: shared code is loaded with require().

// ---------- status / first-run setup ----------
routerAdd("GET", "/api/ch/status", (e) => {
  const L = require(`${__hooks}/lib.js`)
  const users = $app.findRecordsByFilter("users", "", "", 1, 0)
  return e.json(200, {
    ok: true,
    needsSetup: users.length === 0,
    needsCode: !!$os.getenv("CREWDECK_SETUP_CODE"),
    company: L.companyName($app),
    time: new Date().toISOString(),
  })
})

// Creates the company, its first location and the owner. Only works while there are no users.
routerAdd("POST", "/api/ch/setup", (e) => {
  const L = require(`${__hooks}/lib.js`)
  const b = L.body(e)
  const code = $os.getenv("CREWDECK_SETUP_CODE")
  if (code && String(b.code || "") !== code) throw new ForbiddenError("Wrong setup code.")
  if ($app.findRecordsByFilter("users", "", "", 1, 0).length > 0) throw new BadRequestError("Setup has already been completed.")
  const companyName = String(b.company || "").trim()
  const loc = b.location || {}
  const locName = String(loc.name || "").trim() || companyName
  const name = String(b.name || "").trim()
  const email = String(b.email || "").trim().toLowerCase()
  const password = String(b.password || "")
  if (!companyName) throw new BadRequestError("Enter your company's name.")
  if (!name || !email || password.length < 8) throw new BadRequestError("Name, email and a password (8+ characters) are required.")

  $app.runInTransaction((tx) => {
    const cc = tx.findCollectionByNameOrId("company")
    const existing = tx.findRecordsByFilter("company", "", "created", 1, 0)
    const c = existing.length ? existing[0] : new Record(cc)
    c.set("name", companyName)
    tx.save(c)

    let l = L.findFirst(tx, "locations", "", {})
    if (!l) l = new Record(tx.findCollectionByNameOrId("locations"))
    l.set("name", locName)
    l.set("address", String(loc.address || "").trim())
    l.set("lat", Number(loc.lat) || 0)
    l.set("lng", Number(loc.lng) || 0)
    l.set("radius_m", Number(loc.radius_m) || 100)
    if (b.timezone) l.set("timezone", String(b.timezone))
    if (!l.getFloat("ot_weekly_hours")) l.set("ot_weekly_hours", 40)
    l.set("active", true)
    tx.save(l)

    const u = new Record(tx.findCollectionByNameOrId("users"))
    u.set("name", name)
    u.set("email", email)
    u.set("phone", String(b.phone || "").trim())
    u.set("phone_login", L.normPhone(b.phone))
    u.setPassword(password)
    u.set("verified", true)
    u.set("access", "owner")
    u.set("active", true)
    u.set("locations", [l.id])
    u.set("joined_at", new Date().toISOString())
    tx.save(u)
  })
  return e.json(200, { ok: true })
})

// ---------- invite links (join, or get back in after forgetting the password) ----------
routerAdd(
  "POST",
  "/api/ch/invites",
  (e) => {
    const L = require(`${__hooks}/lib.js`)
    const me = L.requireAdmin(e)
    const b = L.body(e)
    const u = L.findById($app, "users", b.user)
    if (!u) throw new NotFoundError("Person not found.")
    if (u.getString("access") === "owner" && me.getString("access") !== "owner") throw new ForbiddenError("Only the owner can do this for the owner.")
    if (!u.getBool("active")) throw new BadRequestError("Turn this person back on first.")
    // One live link per person: older links stop working.
    $app.findRecordsByFilter("invites", "user = {:u}", "", 0, 0, { u: u.id }).forEach((i) => $app.delete(i))
    const r = new Record($app.findCollectionByNameOrId("invites"))
    r.set("user", u.id)
    r.set("token", $security.randomString(32))
    r.set("expires_at", new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString())
    r.set("created_by", me.id)
    $app.save(r)
    return e.json(200, { ok: true, token: r.getString("token"), expires_at: r.getString("expires_at"), joined: !!u.getString("joined_at") })
  },
  $apis.requireAuth("users"),
)

routerAdd("GET", "/api/ch/invites/{token}", (e) => {
  const L = require(`${__hooks}/lib.js`)
  const inv = L.findFirst($app, "invites", "token = {:t}", { t: e.request.pathValue("token") })
  const now = new Date()
  if (!inv || inv.getString("used_at") || (L.getDate(inv, "expires_at") && L.getDate(inv, "expires_at") < now))
    return e.json(200, { ok: false, reason: "expired", company: L.companyName($app) })
  const u = L.findById($app, "users", inv.getString("user"))
  if (!u || !u.getBool("active")) return e.json(200, { ok: false, reason: "expired", company: L.companyName($app) })
  return e.json(200, {
    ok: true,
    company: L.companyName($app),
    name: u.getString("name"),
    email: u.getString("email"),
    phone: u.getString("phone"),
    joined: !!u.getString("joined_at"),
    invitedBy: L.userName($app, inv.getString("created_by")),
  })
})

routerAdd("POST", "/api/ch/invites/{token}/accept", (e) => {
  const L = require(`${__hooks}/lib.js`)
  const b = L.body(e)
  const inv = L.findFirst($app, "invites", "token = {:t}", { t: e.request.pathValue("token") })
  const now = new Date()
  if (!inv || inv.getString("used_at") || (L.getDate(inv, "expires_at") && L.getDate(inv, "expires_at") < now))
    throw new BadRequestError("This link has expired. Ask your manager for a new one.")
  const password = String(b.password || "")
  if (password.length < 8) throw new BadRequestError("Your password needs at least 8 characters.")
  const u = L.findById($app, "users", inv.getString("user"))
  if (!u || !u.getBool("active")) throw new BadRequestError("This link has expired. Ask your manager for a new one.")
  const name = String(b.name || "").trim()
  const email = String(b.email || "").trim().toLowerCase()
  $app.runInTransaction((tx) => {
    const rec = tx.findRecordById("users", u.id)
    if (name) rec.set("name", name)
    if (email && !rec.getString("email")) rec.set("email", email)
    rec.setPassword(password)
    rec.set("verified", true)
    if (!rec.getString("joined_at")) rec.set("joined_at", now.toISOString())
    tx.save(rec)
    const i = tx.findRecordById("invites", inv.id)
    i.set("used_at", now.toISOString())
    tx.save(i)
  })
  const fresh = $app.findRecordById("users", u.id)
  return $apis.recordAuthResponse(e, fresh, "password")
})

// ---------- time clock ----------
routerAdd(
  "POST",
  "/api/ch/clock/in",
  (e) => {
    const L = require(`${__hooks}/lib.js`)
    const u = L.requireUser(e)
    return e.json(200, L.clockIn($app, u, L.body(e)))
  },
  $apis.requireAuth("users"),
)

routerAdd(
  "POST",
  "/api/ch/clock/out",
  (e) => {
    const L = require(`${__hooks}/lib.js`)
    const u = L.requireUser(e)
    return e.json(200, L.clockOut($app, u, L.body(e)))
  },
  $apis.requireAuth("users"),
)

routerAdd(
  "POST",
  "/api/ch/clock/break",
  (e) => {
    const L = require(`${__hooks}/lib.js`)
    const u = L.requireUser(e)
    return e.json(200, L.toggleBreak($app, u))
  },
  $apis.requireAuth("users"),
)

// ---------- shift changes ----------
// Types: cover (someone takes my shift), swap, drop (give it up), pickup (claim an open shift).
// They ALWAYS end in pending_admin: only the owner/admin approves.
routerAdd(
  "POST",
  "/api/ch/requests",
  (e) => {
    const L = require(`${__hooks}/lib.js`)
    const u = L.requireUser(e)
    const b = L.body(e)
    const type = String(b.type || "")
    if (["cover", "swap", "drop", "pickup"].indexOf(type) < 0) throw new BadRequestError("Invalid request type.")
    const shift = L.findById($app, "shifts", b.shift)
    if (!shift || !shift.getBool("published")) throw new BadRequestError("That shift doesn't exist or isn't published.")
    const now = new Date()
    if (L.getDate(shift, "starts_at").getTime() <= now.getTime()) throw new BadRequestError("That shift has already started.")

    const active = $app.findRecordsByFilter(
      "shift_requests",
      "(shift = {:s} || target_shift = {:s}) && (status = 'pending_peer' || status = 'pending_admin')",
      "",
      1,
      0,
      { s: shift.id },
    )
    if (active.length) throw new BadRequestError("There's already an open request for that shift.")

    let targetUser = ""
    let targetShift = null
    if (type === "pickup") {
      if (shift.getString("user")) throw new BadRequestError("That shift is already taken.")
    } else {
      if (shift.getString("user") !== u.id) throw new ForbiddenError("That's not your shift.")
    }
    const locId = shift.getString("location")
    const worksHere = (person) => {
      const locs = L.userLocs(person)
      return locs.length === 0 || locs.indexOf(locId) >= 0
    }
    if (type === "pickup" && !worksHere(u)) throw new ForbiddenError("You don't work at this location.")
    if (type === "cover" && b.target_user) {
      const t = L.findById($app, "users", b.target_user)
      if (!t || !t.getBool("active") || t.id === u.id) throw new BadRequestError("Pick someone else.")
      if (!worksHere(t)) throw new BadRequestError(t.getString("name") + " doesn't work at this location.")
      targetUser = t.id
    }
    if (type === "swap") {
      targetShift = L.findById($app, "shifts", b.target_shift)
      if (!targetShift || !targetShift.getBool("published") || !targetShift.getString("user")) throw new BadRequestError("Pick the shift you want to swap for.")
      if (targetShift.getString("user") === u.id) throw new BadRequestError("That shift is already yours.")
      if (L.getDate(targetShift, "starts_at").getTime() <= now.getTime()) throw new BadRequestError("The other shift has already started.")
      targetUser = targetShift.getString("user")
    }

    const r = new Record($app.findCollectionByNameOrId("shift_requests"))
    r.set("type", type)
    r.set("status", type === "cover" || type === "swap" ? "pending_peer" : "pending_admin")
    r.set("shift", shift.id)
    r.set("requester", u.id)
    r.set("target_user", targetUser)
    r.set("target_shift", targetShift ? targetShift.id : "")
    r.set("note", String(b.note || "").slice(0, 300))
    $app.save(r)

    const me = u.getString("name") || "Someone"
    const when = L.fmtShift(shift)
    if (type === "cover" && targetUser) {
      L.notify($app, [targetUser], me + " asked you to cover a shift", when, "#/requests")
    } else if (type === "cover") {
      const others = $app
        .findRecordsByFilter("users", "active = true && id != {:me}", "", 0, 0, { me: u.id })
        .filter((x) => worksHere(x))
        .map((x) => x.id)
      L.notify($app, others, "Shift up for grabs", me + " needs someone to cover: " + when, "#/requests")
    } else if (type === "swap") {
      L.notify($app, [targetUser], me + " wants to swap shifts", "Their " + when + " for your " + L.fmtShift(targetShift), "#/requests")
    } else {
      L.notifyAdmins(
        $app,
        type === "drop" ? "🔁 " + me + " wants to drop a shift" : "🙋 " + me + " wants to pick up an open shift",
        when + " · Waiting for your approval",
        "#/requests",
      )
    }
    return e.json(200, { ok: true, id: r.id })
  },
  $apis.requireAuth("users"),
)

routerAdd(
  "POST",
  "/api/ch/requests/{id}/{action}",
  (e) => {
    const L = require(`${__hooks}/lib.js`)
    const u = L.requireUser(e)
    const b = L.body(e)
    const action = e.request.pathValue("action")
    const r = L.findById($app, "shift_requests", e.request.pathValue("id"))
    if (!r) throw new NotFoundError("Request not found.")
    const status = r.getString("status")
    const type = r.getString("type")
    const requester = r.getString("requester")
    const shift = L.findById($app, "shifts", r.getString("shift"))
    if (!shift) throw new BadRequestError("The shift no longer exists.")
    const me = u.getString("name") || "Someone"
    const when = L.fmtShift(shift)
    const now = new Date()

    if (action === "accept") {
      if (status !== "pending_peer") throw new BadRequestError("This request is no longer waiting for a reply.")
      if (requester === u.id) throw new BadRequestError("You can't accept your own request.")
      const target = r.getString("target_user")
      if (target && target !== u.id) throw new ForbiddenError("This request isn't for you.")
      if (type === "swap") {
        const ts = L.findById($app, "shifts", r.getString("target_shift"))
        if (!ts || ts.getString("user") !== u.id) throw new BadRequestError("Your shift changed; this swap is no longer possible.")
      }
      r.set("target_user", u.id)
      r.set("status", "pending_admin")
      r.set("peer_responded_at", now.toISOString())
      $app.save(r)
      L.notify($app, [requester], me + " accepted your request", when + " · Waiting for admin approval", "#/requests")
      L.notifyAdmins($app, "🔁 Shift change needs approval", L.userName($app, requester) + " → " + me + " · " + when, "#/requests")
      return e.json(200, { ok: true })
    }

    if (action === "decline") {
      if (status !== "pending_peer") throw new BadRequestError("This request is no longer waiting for a reply.")
      if (r.getString("target_user") !== u.id) throw new ForbiddenError("This request isn't for you.")
      r.set("status", "declined")
      r.set("peer_responded_at", now.toISOString())
      $app.save(r)
      L.notify($app, [requester], me + " can't make it", me + " declined your request for " + when, "#/requests")
      return e.json(200, { ok: true })
    }

    if (action === "cancel") {
      if (requester !== u.id && !L.isAdmin(u)) throw new ForbiddenError("Only the person who asked can cancel it.")
      if (status !== "pending_peer" && status !== "pending_admin") throw new BadRequestError("It can no longer be cancelled.")
      r.set("status", "cancelled")
      $app.save(r)
      return e.json(200, { ok: true })
    }

    if (action === "reject") {
      if (!L.isAdmin(u)) throw new ForbiddenError("Only the owner or an admin can approve or reject shift changes.")
      if (status !== "pending_peer" && status !== "pending_admin") throw new BadRequestError("This request has already been resolved.")
      r.set("status", "rejected")
      r.set("decided_by", u.id)
      r.set("decided_at", now.toISOString())
      r.set("decision_note", String(b.note || "").slice(0, 300))
      $app.save(r)
      L.audit($app, u.id, "request.reject", "shift_requests", r.id, { type: type })
      L.notify($app, [requester, r.getString("target_user")], "❌ Shift change rejected", when + (b.note ? " · " + b.note : ""), "#/requests")
      return e.json(200, { ok: true })
    }

    if (action === "approve") {
      if (!L.isAdmin(u)) throw new ForbiddenError("Only the owner or an admin can approve shift changes.")
      if (status !== "pending_admin") throw new BadRequestError("This request isn't ready to be approved.")
      const target = r.getString("target_user")
      const ts = type === "swap" ? L.findById($app, "shifts", r.getString("target_shift")) : null

      // The shift may have changed since it was requested.
      if (type === "pickup" && shift.getString("user")) throw new BadRequestError("Someone else already took that shift.")
      if (type !== "pickup" && shift.getString("user") !== requester) throw new BadRequestError("The shift already changed hands.")
      if (type === "swap" && (!ts || ts.getString("user") !== target)) throw new BadRequestError("The other shift already changed.")

      let conflicts = []
      if (type === "cover") conflicts = L.conflictsFor($app, target, shift, [shift.id])
      if (type === "pickup") conflicts = L.conflictsFor($app, requester, shift, [shift.id])
      if (type === "swap") {
        conflicts = L.conflictsFor($app, target, shift, [shift.id, ts.id]).concat(L.conflictsFor($app, requester, ts, [shift.id, ts.id]))
      }
      if (conflicts.length && !b.force) return e.json(409, { ok: false, conflicts: conflicts, message: conflicts.join(" · ") })

      $app.runInTransaction((tx) => {
        const s = tx.findRecordById("shifts", shift.id)
        if (type === "cover") s.set("user", target)
        if (type === "drop") s.set("user", "")
        if (type === "pickup") s.set("user", requester)
        if (type === "swap") {
          const t2 = tx.findRecordById("shifts", ts.id)
          s.set("user", target)
          t2.set("user", requester)
          tx.save(t2)
        }
        tx.save(s)
        const rr = tx.findRecordById("shift_requests", r.id)
        rr.set("status", "approved")
        rr.set("decided_by", u.id)
        rr.set("decided_at", now.toISOString())
        rr.set("decision_note", String(b.note || "").slice(0, 300))
        tx.save(rr)
        L.audit(tx, u.id, "request.approve", "shift_requests", r.id, { type: type, shift: shift.id, conflicts: conflicts })
      })
      L.notify($app, [requester, target], "✅ Shift change approved", when, "#/schedule")
      return e.json(200, { ok: true })
    }

    throw new BadRequestError("Invalid action.")
  },
  $apis.requireAuth("users"),
)

// ---------- time off ----------
routerAdd(
  "POST",
  "/api/ch/timeoff",
  (e) => {
    const L = require(`${__hooks}/lib.js`)
    const u = L.requireUser(e)
    const b = L.body(e)
    const s = L.toDate(b.starts_at)
    const en = L.toDate(b.ends_at)
    if (!s || !en || en.getTime() <= s.getTime()) throw new BadRequestError("Please check the dates.")
    const kind = ["vacation", "sick", "personal", "unpaid"].indexOf(b.kind) >= 0 ? b.kind : "personal"
    let userId = u.id
    if (b.user && b.user !== u.id) {
      if (!L.isAdmin(u)) throw new ForbiddenError("Only an admin can add time off for someone else.")
      userId = b.user
    }
    const r = new Record($app.findCollectionByNameOrId("time_off"))
    r.set("user", userId)
    r.set("starts_at", s.toISOString())
    r.set("ends_at", en.toISOString())
    r.set("kind", kind)
    r.set("note", String(b.note || "").slice(0, 300))
    r.set("status", "pending")
    $app.save(r)
    const shifts = L.overlappingShifts($app, userId, s, en, [])
    L.notifyAdmins(
      $app,
      "🌴 " + L.userName($app, userId) + " requested time off",
      L.fmtDay(s) + " to " + L.fmtDay(new Date(en.getTime() - 1000)) + (shifts.length ? " · Has " + shifts.length + " shift(s) on those dates" : ""),
      "#/timeoff",
    )
    return e.json(200, { ok: true, id: r.id, shiftsInRange: shifts.length })
  },
  $apis.requireAuth("users"),
)

routerAdd(
  "POST",
  "/api/ch/timeoff/{id}/{action}",
  (e) => {
    const L = require(`${__hooks}/lib.js`)
    const u = L.requireUser(e)
    const b = L.body(e)
    const action = e.request.pathValue("action")
    const r = L.findById($app, "time_off", e.request.pathValue("id"))
    if (!r) throw new NotFoundError("Request not found.")
    const status = r.getString("status")
    const owner = r.getString("user")
    const s = L.getDate(r, "starts_at")
    const now = new Date()
    const range = L.fmtDay(s) + " to " + L.fmtDay(new Date(L.getDate(r, "ends_at").getTime() - 1000))

    if (action === "cancel") {
      if (owner !== u.id && !L.isAdmin(u)) throw new ForbiddenError("That's not your request.")
      if (status === "pending" || (status === "approved" && s.getTime() > now.getTime())) {
        r.set("status", "cancelled")
        $app.save(r)
        if (status === "approved") L.notifyAdmins($app, "🌴 " + L.userName($app, owner) + " cancelled approved time off", range, "#/timeoff")
        return e.json(200, { ok: true })
      }
      throw new BadRequestError("It can no longer be cancelled.")
    }
    if (action === "approve" || action === "reject") {
      if (!L.isAdmin(u)) throw new ForbiddenError("Only the owner or an admin can approve time off.")
      if (status !== "pending") throw new BadRequestError("This request has already been resolved.")
      r.set("status", action === "approve" ? "approved" : "rejected")
      r.set("decided_by", u.id)
      r.set("decided_at", now.toISOString())
      r.set("decision_note", String(b.note || "").slice(0, 300))
      $app.save(r)
      L.audit($app, u.id, "timeoff." + action, "time_off", r.id, {})
      L.notify(
        $app,
        [owner],
        action === "approve" ? "✅ Time off approved" : "❌ Time off rejected",
        range + (b.note ? " · " + b.note : ""),
        "#/timeoff",
      )
      return e.json(200, { ok: true })
    }
    throw new BadRequestError("Invalid action.")
  },
  $apis.requireAuth("users"),
)

// ---------- schedule: publish and copy week ----------
routerAdd(
  "POST",
  "/api/ch/schedule/publish",
  (e) => {
    const L = require(`${__hooks}/lib.js`)
    const u = L.requireAdmin(e)
    const b = L.body(e)
    const from = L.toDate(b.from)
    const to = L.toDate(b.to)
    if (!from || !to) throw new BadRequestError("Invalid date range.")
    const drafts = $app.findRecordsByFilter(
      "shifts",
      "published = false && starts_at >= {:f} && starts_at < {:t}" + (b.location ? " && location = {:l}" : ""),
      "starts_at",
      0,
      0,
      { f: L.pbDate(from), t: L.pbDate(to), l: String(b.location || "") },
    )
    const who = {}
    $app.runInTransaction((tx) => {
      drafts.forEach((d) => {
        const s = tx.findRecordById("shifts", d.id)
        s.set("published", true)
        tx.save(s)
        if (s.getString("user")) who[s.getString("user")] = true
      })
    })
    const ids = Object.keys(who)
    L.notify($app, ids, "📅 Your schedule is out", "Week of " + L.fmtDay(from), "#/schedule")
    L.audit($app, u.id, "schedule.publish", "shifts", "", { from: b.from, to: b.to, count: drafts.length })
    return e.json(200, { ok: true, published: drafts.length, notified: ids.length })
  },
  $apis.requireAuth("users"),
)

routerAdd(
  "POST",
  "/api/ch/schedule/copy",
  (e) => {
    const L = require(`${__hooks}/lib.js`)
    const u = L.requireMgr(e)
    const b = L.body(e)
    const from = L.toDate(b.from)
    const to = L.toDate(b.to)
    if (!from || !to) throw new BadRequestError("Invalid date range.")
    const offset = to.getTime() - from.getTime()
    const end = new Date(from.getTime() + 7 * 24 * 3600 * 1000)
    if (b.location && !L.isAdmin(u) && L.userLocs(u).indexOf(String(b.location)) < 0) throw new ForbiddenError("You don't manage this location.")
    const src = $app.findRecordsByFilter(
      "shifts",
      "starts_at >= {:f} && starts_at < {:t}" + (b.location ? " && location = {:l}" : ""),
      "starts_at",
      0,
      0,
      { f: L.pbDate(from), t: L.pbDate(end), l: String(b.location || "") },
    )
    const col = $app.findCollectionByNameOrId("shifts")
    let n = 0
    $app.runInTransaction((tx) => {
      src.forEach((s) => {
        const ns = new Date(L.getDate(s, "starts_at").getTime() + offset)
        const ne = new Date(L.getDate(s, "ends_at").getTime() + offset)
        const r = new Record(col)
        ;["location", "section", "position", "user", "notes"].forEach((f) => r.set(f, s.get(f)))
        r.set("starts_at", ns.toISOString())
        r.set("ends_at", ne.toISOString())
        r.set("published", false)
        r.set("created_by", u.id)
        tx.save(r)
        n++
      })
    })
    return e.json(200, { ok: true, copied: n })
  },
  $apis.requireAuth("users"),
)

// ---------- notifications: mark all read ----------
routerAdd(
  "POST",
  "/api/ch/notifications/read-all",
  (e) => {
    const L = require(`${__hooks}/lib.js`)
    const u = L.requireUser(e)
    const list = $app.findRecordsByFilter("notifications", "user = {:u} && read = false", "", 0, 0, { u: u.id })
    list.forEach((n) => {
      n.set("read", true)
      $app.save(n)
    })
    return e.json(200, { ok: true, count: list.length })
  },
  $apis.requireAuth("users"),
)

// ---------- hooks ----------
// Tell employees when an admin changes or deletes a published shift.
onRecordUpdateRequest((e) => {
  const before = e.record.original()
  e.next()
  const L = require(`${__hooks}/lib.js`)
  if (!before.getBool("published") && !e.record.getBool("published")) return
  const oldU = before.getString("user")
  const newU = e.record.getString("user")
  const timeChanged =
    before.getString("starts_at") !== e.record.getString("starts_at") || before.getString("ends_at") !== e.record.getString("ends_at")
  if (oldU !== newU) {
    if (oldU) L.notify($app, [oldU], "You were taken off a shift", L.fmtShift(before), "#/schedule")
    if (newU) L.notify($app, [newU], "You were assigned a shift", L.fmtShift(e.record), "#/schedule")
  } else if (timeChanged && newU) {
    L.notify($app, [newU], "Your shift time changed", L.fmtShift(before) + " → " + L.fmtShift(e.record), "#/schedule")
  }
  L.audit($app, L.uid(e), "shift.update", "shifts", e.record.id, { from: { user: oldU, s: before.getString("starts_at") }, to: { user: newU, s: e.record.getString("starts_at") } })
}, "shifts")

onRecordCreateRequest((e) => {
  const L = require(`${__hooks}/lib.js`)
  if (L.uid(e) && !e.record.getString("created_by")) e.record.set("created_by", L.uid(e))
  e.next()
  if (e.record.getBool("published") && e.record.getString("user")) {
    L.notify($app, [e.record.getString("user")], "You were assigned a shift", L.fmtShift(e.record), "#/schedule")
  }
}, "shifts")

onRecordDeleteRequest((e) => {
  const rec = e.record
  e.next()
  if (rec.getBool("published") && rec.getString("user")) {
    const L = require(`${__hooks}/lib.js`)
    L.notify($app, [rec.getString("user")], "One of your shifts was cancelled", L.fmtShift(rec), "#/schedule")
  }
}, "shifts")

// Every hours correction is flagged and logged.
onRecordUpdateRequest((e) => {
  const L = require(`${__hooks}/lib.js`)
  const me = L.uid(e)
  const before = e.record.original()
  const changedTimes =
    before.getString("clock_in") !== e.record.getString("clock_in") ||
    before.getString("clock_out") !== e.record.getString("clock_out") ||
    before.getFloat("break_min") !== e.record.getFloat("break_min")
  if (changedTimes) {
    e.record.set("edited", true)
    e.record.set("edited_by", me)
  }
  if (e.record.getBool("approved") && !before.getBool("approved")) e.record.set("approved_by", me)
  e.next()
  L.audit($app, me, "timecard.update", "timecards", e.record.id, {
    before: { in: before.getString("clock_in"), out: before.getString("clock_out"), brk: before.getFloat("break_min"), approved: before.getBool("approved") },
    after: { in: e.record.getString("clock_in"), out: e.record.getString("clock_out"), brk: e.record.getFloat("break_min"), approved: e.record.getBool("approved") },
  })
}, "timecards")

onRecordCreateRequest((e) => {
  // Timecards created by hand (manager or dashboard) are marked as manual.
  const L = require(`${__hooks}/lib.js`)
  e.record.set("in_geo", "manual")
  e.record.set("edited", true)
  e.record.set("edited_by", L.uid(e))
  e.next()
}, "timecards")

// People: keep the phone sign-in key in sync and make sure there's a way to reach them.
onRecordCreateRequest((e) => {
  const L = require(`${__hooks}/lib.js`)
  e.record.set("phone_login", L.normPhone(e.record.getString("phone")))
  if (!e.record.getString("email") && !e.record.getString("phone_login"))
    throw new BadRequestError("Add a phone number or an email so they can sign in.")
  if (L.userLocs(e.record).length === 0) {
    const locs = $app.findRecordsByFilter("locations", "", "created", 0, 0)
    if (locs.length === 1) e.record.set("locations", [locs[0].id])
  }
  e.next()
}, "users")

onRecordUpdateRequest((e) => {
  const L = require(`${__hooks}/lib.js`)
  e.record.set("phone_login", L.normPhone(e.record.getString("phone")))
  if (!e.record.getString("email") && !e.record.getString("phone_login"))
    throw new BadRequestError("Keep a phone number or an email so they can sign in.")
  e.next()
}, "users")

// ---------- cron: close forgotten clock-ins ----------
cronAdd("crewdeck_autoclose", "*/15 * * * *", () => {
  const L = require(`${__hooks}/lib.js`)
  L.autoClose($app)
})

// Run the auto clock-out by hand (dashboard superuser only; useful for tests).
routerAdd(
  "POST",
  "/api/ch/admin/autoclose",
  (e) => {
    const L = require(`${__hooks}/lib.js`)
    L.autoClose($app)
    return e.json(200, { ok: true })
  },
  $apis.requireSuperuserAuth(),
)

// ---------- cron: shift reminders and "still clocked in?" ----------
cronAdd("crewdeck_reminders", "*/5 * * * *", () => {
  const L = require(`${__hooks}/lib.js`)
  L.sendReminders($app)
})

// Run the reminders by hand (dashboard superuser only; useful for tests).
routerAdd(
  "POST",
  "/api/ch/admin/reminders",
  (e) => {
    const L = require(`${__hooks}/lib.js`)
    L.sendReminders($app)
    return e.json(200, { ok: true })
  },
  $apis.requireSuperuserAuth(),
)
