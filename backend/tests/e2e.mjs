// End-to-end test of the Crewdeck backend. Run it with backend/scripts/test.sh.
const API = process.env.API || 'http://127.0.0.1:8099'
let pass = 0
let fail = 0
const ok = (cond, msg, extra) => {
  if (cond) {
    pass++
    console.log('  ✓', msg)
  } else {
    fail++
    console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : '')
  }
}
async function req(method, path, body, token) {
  const r = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try {
    data = await r.json()
  } catch {}
  return { status: r.status, data }
}
const login = async (email, password) => (await req('POST', '/api/collections/users/auth-with-password', { identity: email, password })).data
const pbDate = (d) => d.toISOString().replace('T', ' ')
const H = 3600 * 1000

const BAR = { lat: 19.4326, lng: -99.1332 }
const FAR = { lat: 19.4426, lng: -99.1332 } // ~1.1 km away

console.log('\n# Setup')
ok((await req('GET', '/api/ch/status')).data.needsSetup === true, 'needsSetup is true at first')
const SETUP = { company: 'Test Company', location: { name: 'Downtown', address: '1 Main St' }, name: 'Owner Test', email: 'owner@test.com', password: 'password123', timezone: 'America/Denver' }
ok((await req('GET', '/api/ch/status')).data.needsCode === true, 'status says a setup code is required')
ok((await req('POST', '/api/ch/setup', { ...SETUP, code: 'wrong' })).status === 403, 'setup with a wrong code → 403')
ok((await req('POST', '/api/ch/setup', { ...SETUP, company: '', code: 'test-code-123' })).status === 400, 'setup without a company name → 400')
let r = await req('POST', '/api/ch/setup', { ...SETUP, code: 'test-code-123' })
ok(r.status === 200, 'setup with the right code', r)
ok((await req('POST', '/api/ch/setup', { ...SETUP, email: 'x@test.com', code: 'test-code-123' })).status === 400, 'setup again → 400')
ok((await req('GET', '/api/ch/status')).data.company === 'Test Company', 'status shows the company name')
ok((await req('POST', '/api/collections/users/records', { email: 'hacker@test.com', password: 'password123', passwordConfirm: 'password123', access: 'owner', active: true })).status >= 400, 'public sign-up is blocked')

const owner = await login('owner@test.com', 'password123')
ok(owner?.token, 'owner signs in', owner)
const OT = owner.token

console.log('\n# Team')
const positions = (await req('GET', '/api/collections/positions/records?sort=sort', null, OT)).data.items
ok(positions.length === 6, '6 positions seeded', positions.map((p) => p.name))
const mk = async (name, email, access, posIdx) => {
  const r = await req(
    'POST',
    '/api/collections/users/records',
    { name, email, password: 'password123', passwordConfirm: 'password123', access, active: true, positions: [positions[posIdx].id] },
    OT,
  )
  ok(r.status === 200, `create ${name} (${access})`, r.data)
  return r.data
}
const gm = await mk('Gina GM', 'gm@test.com', 'admin', 0)
const am = await mk('Andy AM', 'am@test.com', 'manager', 1)
const e1 = await mk('Beto Bartender', 'e1@test.com', 'employee', 2)
const e2 = await mk('Carla Barback', 'e2@test.com', 'employee', 3)
const e3 = await mk('Dani Bouncer', 'e3@test.com', 'employee', 5)
const GT = (await login('gm@test.com', 'password123')).token
const AT = (await login('am@test.com', 'password123')).token
const T1 = (await login('e1@test.com', 'password123')).token
const T2 = (await login('e2@test.com', 'password123')).token
const T3 = (await login('e3@test.com', 'password123')).token
ok(GT && AT && T1 && T2 && T3, 'everyone can sign in')

ok((await req('POST', '/api/collections/users/records', { email: 'z@test.com', password: 'password123', passwordConfirm: 'password123', access: 'employee', active: true }, T1)).status >= 400, 'employee can NOT create users')
ok((await req('PATCH', `/api/collections/users/records/${e1.id}`, { access: 'owner' }, T1)).status >= 400, 'employee can NOT make themselves owner')
ok((await req('PATCH', `/api/collections/users/records/${e1.id}`, { phone: '555' }, T1)).status === 200, 'employee CAN change their phone')
ok((await req('PATCH', `/api/collections/users/records/${owner.record.id}`, { name: 'hack' }, GT)).status >= 400, 'admin can NOT edit the owner')
ok((await req('POST', '/api/collections/users/records', { email: 'o2@test.com', password: 'password123', passwordConfirm: 'password123', access: 'owner', active: true }, GT)).status >= 400, 'admin can NOT create owners')
const usersAsEmp = (await req('GET', '/api/collections/users/records', null, T1)).data
ok(usersAsEmp.items.length === 6 && !usersAsEmp.items.find((u) => u.id !== e1.id && u.email), 'employee sees the team without emails', usersAsEmp.items.map((u) => u.email))
ok((await req('GET', '/api/collections/pay_rates/records', null, T1)).data?.items?.length === 0, "employee can't see pay (empty list)")
r = await req('POST', '/api/collections/pay_rates/records', { user: e1.id, hourly: 100 }, GT)
ok(r.status === 200, 'admin saves an hourly rate', r.data)
ok((await req('GET', '/api/collections/pay_rates/records', null, T1)).data.items.length === 0, 'employee still cannot see pay')

// deactivate / reactivate
await req('PATCH', `/api/collections/users/records/${e3.id}`, { active: false }, GT)
ok(!(await login('e3@test.com', 'password123'))?.token, 'deactivated user cannot sign in')
await req('PATCH', `/api/collections/users/records/${e3.id}`, { active: true }, GT)

// change own password
r = await req('PATCH', `/api/collections/users/records/${e3.id}`, { oldPassword: 'password123', password: 'password456', passwordConfirm: 'password456' }, T3)
ok(r.status === 200, 'employee changes their own password', r.data)
const T3b = (await login('e3@test.com', 'password456'))?.token
ok(!!T3b, 'signs in with the new password')
const T3c = T3b

console.log('\n# Location')
const loc = (await req('GET', '/api/collections/locations/records', null, OT)).data.items[0]
ok(loc.name === 'Downtown' && loc.address === '1 Main St', 'first location comes from setup', loc)
ok((await req('GET', '/api/collections/sections/records', null, OT)).data.items.length === 0, 'fresh install has no example sections')
const company = (await req('GET', '/api/collections/company/records', null, T1)).data.items
ok(company.length === 1 && company[0].name === 'Test Company', 'employees can read the company name')
ok((await req('PATCH', `/api/collections/company/records/${company[0].id}`, { name: 'Hacked' }, T1)).status >= 400, 'employee can NOT rename the company')
r = await req('POST', '/api/collections/sections/records', { location: loc.id, name: 'Main Bar', color: '#007aff' }, GT)
ok(r.status === 200, 'admin adds a section', r.data)
const sections = [r.data]
ok((await req('GET', `/api/collections/users/records/${e1.id}`, null, OT)).data.locations?.[0] === loc.id, 'new people are placed at the only location')

console.log('\n# Clock-in before GPS is set up')
r = await req('POST', '/api/ch/clock/in', BAR, T3c)
ok(r.status === 200 && r.data.ok && r.data.geo === 'not_configured', 'allowed while GPS is not set up', r.data)
r = await req('POST', '/api/ch/clock/out', BAR, T3c)
ok(r.status === 200 && r.data.ok, 'clock-out works', r.data)

ok((await req('PATCH', `/api/collections/locations/records/${loc.id}`, { lat: BAR.lat, lng: BAR.lng, radius_m: 100 }, T1)).status >= 400, 'employee can NOT move the GPS point')
r = await req('PATCH', `/api/collections/locations/records/${loc.id}`, { lat: BAR.lat, lng: BAR.lng, radius_m: 100 }, GT)
ok(r.status === 200, 'admin sets the GPS point', r.data)

console.log('\n# Time clock')
r = await req('POST', '/api/ch/clock/in', { lat: BAR.lat + 0.0002, lng: BAR.lng, acc: 15 }, T1)
ok(r.data?.ok && r.data.geo === 'inside', 'clock-in inside (≈22 m, ±15)', r.data)
ok((await req('POST', '/api/ch/clock/in', { ...BAR, acc: 10 }, T1)).status === 400, 'double clock-in is blocked')
r = await req('POST', '/api/ch/clock/break', {}, T1)
ok(r.data?.onBreak === true, 'starts a break', r.data)
r = await req('POST', '/api/ch/clock/break', {}, T1)
ok(r.data?.onBreak === false, 'ends the break', r.data)
r = await req('POST', '/api/ch/clock/out', { ...BAR, acc: 10 }, T1)
ok(r.data?.ok && typeof r.data.hours === 'number', 'clock-out returns hours', r.data)

r = await req('POST', '/api/ch/clock/in', { lat: BAR.lat + 0.0009, lng: BAR.lng, acc: 30 }, T2)
ok(r.data?.ok && r.data.geo === 'uncertain', 'at the edge (≈100 m, ±30) is accepted as "uncertain"', r.data)
await req('POST', '/api/ch/clock/out', {}, T2)

r = await req('POST', '/api/ch/clock/in', { ...FAR, acc: 10 }, T2)
ok(r.data?.ok === false && r.data.needReason && r.data.geo === 'outside' && r.data.dist > 1000, 'outside without a reason → asks for a reason', r.data)
r = await req('POST', '/api/ch/clock/in', { ...FAR, acc: 10, reason: 'Getting ice' }, T2)
ok(r.data?.ok && r.data.geo === 'outside', 'outside with a reason → saved', r.data)
const flaggedCard = r.data.timecard
r = await req('POST', '/api/ch/clock/out', {}, T2)
r = await req('POST', '/api/ch/clock/in', {}, T3c)
ok(r.data?.needReason && r.data.geo === 'no_gps', 'no GPS → asks for a reason', r.data)
r = await req('POST', '/api/ch/clock/in', { ...BAR, acc: 900 }, T3c)
ok(r.data?.needReason && r.data.geo === 'low_accuracy', 'weak GPS (±900) → asks for a reason', r.data)

let cards = (await req('GET', `/api/collections/timecards/records?filter=${encodeURIComponent(`id="${flaggedCard}"`)}`, null, T2)).data.items
ok(cards[0]?.flagged === true && cards[0]?.approved === false, 'outside clock-in is marked "needs review"', cards[0])
ok((await req('GET', '/api/collections/timecards/records', null, T1)).data.items.every((c) => c.user === e1.id), 'employee only sees their own clock-ins')
ok((await req('PATCH', `/api/collections/timecards/records/${flaggedCard}`, { approved: true }, AT)).status >= 400, 'manager can NOT approve clock-ins')
r = await req('PATCH', `/api/collections/timecards/records/${flaggedCard}`, { notes: 'ok', break_min: 15 }, AT)
ok(r.status === 200 && r.data.edited === true && r.data.edited_by === am.id, 'manager fixes hours → marked edited', r.data)
r = await req('PATCH', `/api/collections/timecards/records/${flaggedCard}`, { approved: true }, GT)
ok(r.status === 200 && r.data.approved && r.data.approved_by === gm.id, 'admin approves the clock-in', r.data)
ok((await req('PATCH', `/api/collections/timecards/records/${flaggedCard}`, { break_min: 0 }, T2)).status >= 400, 'employee can NOT edit their clock-ins')
const ownerNotes = (await req('GET', '/api/collections/notifications/records?sort=-created', null, OT)).data.items
ok(ownerNotes.some((n) => n.title.includes('outside')), 'owner got an "outside" alert', ownerNotes.map((n) => n.title))

console.log('\n# Schedule')
const base = new Date(Date.now() + 2 * 24 * H)
base.setUTCHours(2, 0, 0, 0) // 8 PM in Mexico City
const shift = (u, offH, durH = 6) => ({
  location: loc.id,
  section: sections[0].id,
  position: positions[2].id,
  user: u,
  starts_at: new Date(base.getTime() + offH * H).toISOString(),
  ends_at: new Date(base.getTime() + (offH + durH) * H).toISOString(),
})
ok((await req('POST', '/api/collections/shifts/records', { ...shift(e1.id, 0), published: true }, AT)).status >= 400, 'manager can NOT publish')
r = await req('POST', '/api/collections/shifts/records', shift(e1.id, 0), AT)
ok(r.status === 200 && r.data.published === false && r.data.created_by === am.id, 'manager creates a draft', r.data)
const s1 = r.data
ok((await req('POST', '/api/collections/shifts/records', shift(e1.id, 0), T1)).status >= 400, 'employee can NOT create shifts')
ok((await req('GET', `/api/collections/shifts/records`, null, T1)).data.items.length === 0, "employee can't see drafts")
const s2 = (await req('POST', '/api/collections/shifts/records', shift(e2.id, 24), GT)).data
const s3 = (await req('POST', '/api/collections/shifts/records', shift(e1.id, 48), GT)).data
const sOpen = (await req('POST', '/api/collections/shifts/records', shift('', 72), GT)).data
ok((await req('POST', '/api/ch/schedule/publish', { from: new Date(Date.now()).toISOString(), to: new Date(Date.now() + 10 * 24 * H).toISOString() }, AT)).status === 403, 'manager can NOT publish the week')
r = await req('POST', '/api/ch/schedule/publish', { from: new Date(Date.now()).toISOString(), to: new Date(Date.now() + 10 * 24 * H).toISOString() }, GT)
ok(r.data?.published === 4 && r.data.notified === 2, 'admin publishes 4 shifts and notifies 2 people', r.data)
ok((await req('GET', `/api/collections/shifts/records`, null, T1)).data.items.length === 4, 'employee now sees published shifts')
ok((await req('PATCH', `/api/collections/shifts/records/${s1.id}`, { notes: 'x' }, AT)).status >= 400, 'manager can NOT edit published shifts')
const e1Notes = (await req('GET', '/api/collections/notifications/records', null, T1)).data.items
ok(e1Notes.some((n) => n.title.includes('schedule is out')), 'employee got "Your schedule is out"')

console.log('\n# Shift changes: cover')
ok((await req('POST', '/api/ch/requests', { type: 'cover', shift: s2.id }, T1)).status === 403, "can't ask to cover someone else's shift")
r = await req('POST', '/api/ch/requests', { type: 'cover', shift: s1.id, target_user: e2.id, note: 'exam' }, T1)
ok(r.status === 200, 'Beto asks Carla to cover', r.data)
const rq1 = r.data.id
ok((await req('POST', '/api/ch/requests', { type: 'drop', shift: s1.id }, T1)).status === 400, 'no duplicate request for the same shift')
ok((await req('POST', `/api/ch/requests/${rq1}/accept`, {}, T3c)).status === 403, "Dani can't accept (it isn't for him)")
ok((await req('POST', `/api/ch/requests/${rq1}/approve`, {}, GT)).status === 400, "admin can't approve before the coworker accepts")
r = await req('POST', `/api/ch/requests/${rq1}/accept`, {}, T2)
ok(r.status === 200, 'Carla accepts', r.data)
ok((await req('POST', `/api/ch/requests/${rq1}/approve`, {}, AT)).status === 403, 'manager can NOT approve changes')
r = await req('POST', `/api/ch/requests/${rq1}/approve`, {}, GT)
ok(r.status === 200, 'admin approves', r.data)
let s1now = (await req('GET', `/api/collections/shifts/records/${s1.id}`, null, OT)).data
ok(s1now.user === e2.id, 'the shift now belongs to Carla')
const audit = (await req('GET', '/api/collections/audit_log/records?sort=-created', null, OT)).data.items
ok(audit.some((a) => a.action === 'request.approve'), 'approval is in the history log')
ok((await req('GET', '/api/collections/audit_log/records', null, T1)).data.items.length === 0, "employee can't see the history log")

console.log('\n# Shift changes: swap with a conflict')
// s1 (Carla, day 0) ⇄ s3 (Beto, day 2). An overlapping shift for Beto on day 0 creates a conflict.
const clash = (await req('POST', '/api/collections/shifts/records', { ...shift(e1.id, 1), published: true }, GT)).data
r = await req('POST', '/api/ch/requests', { type: 'swap', shift: s1.id, target_shift: s3.id }, T2)
ok(r.status === 200, 'Carla proposes a swap with Beto', r.data)
const rq2 = r.data.id
r = await req('POST', `/api/ch/requests/${rq2}/accept`, {}, T1)
ok(r.status === 200, 'Beto accepts')
r = await req('POST', `/api/ch/requests/${rq2}/approve`, {}, OT)
ok(r.status === 409 && r.data.conflicts?.length > 0, 'approving warns about the overlap (409)', r.data)
r = await req('POST', `/api/ch/requests/${rq2}/approve`, { force: true }, OT)
ok(r.status === 200, 'owner approves anyway', r.data)
s1now = (await req('GET', `/api/collections/shifts/records/${s1.id}`, null, OT)).data
const s3now = (await req('GET', `/api/collections/shifts/records/${s3.id}`, null, OT)).data
ok(s1now.user === e1.id && s3now.user === e2.id, 'shifts were swapped')
await req('DELETE', `/api/collections/shifts/records/${clash.id}`, null, GT)

console.log('\n# Drop and pick up')
r = await req('POST', '/api/ch/requests', { type: 'drop', shift: s3.id }, T2)
ok(r.status === 200, 'Carla drops her shift', r.data)
const rq3 = r.data.id
r = await req('POST', `/api/ch/requests/${rq3}/approve`, {}, GT)
ok(r.status === 200, 'admin approves the drop', r.data)
ok((await req('GET', `/api/collections/shifts/records/${s3.id}`, null, OT)).data.user === '', 'the shift is now open')
r = await req('POST', '/api/ch/requests', { type: 'pickup', shift: sOpen.id }, T3c)
ok(r.status === 200, 'Dani asks for an open shift', r.data)
const rq4 = r.data.id
ok((await req('POST', '/api/ch/requests', { type: 'pickup', shift: s1.id }, T3c)).status === 400, "can't pick up a shift that's taken")
r = await req('POST', `/api/ch/requests/${rq4}/reject`, { note: 'already covered' }, GT)
ok(r.status === 200, 'admin declines with a reason')
ok((await req('GET', `/api/collections/shifts/records/${sOpen.id}`, null, OT)).data.user === '', 'the shift stays open after declining')
r = await req('POST', '/api/ch/requests', { type: 'cover', shift: s1.id }, T1)
ok(r.status === 200, 'Beto asks anyone to cover')
const rq5 = r.data.id
const seenBy3 = (await req('GET', '/api/collections/shift_requests/records', null, T3c)).data.items
ok(seenBy3.some((x) => x.id === rq5), 'Dani sees the open cover request')
r = await req('POST', `/api/ch/requests/${rq5}/cancel`, {}, T1)
ok(r.status === 200, 'Beto cancels it')
ok((await req('POST', `/api/ch/requests/${rq5}/accept`, {}, T3c)).status === 400, "a cancelled request can't be accepted")

console.log('\n# Time off')
const tStart = new Date(base.getTime() + 5 * 24 * H)
r = await req('POST', '/api/ch/timeoff', { starts_at: tStart.toISOString(), ends_at: new Date(tStart.getTime() + 24 * H).toISOString(), kind: 'vacation', note: 'wedding' }, T1)
ok(r.status === 200, 'Beto requests a day off', r.data)
const to1 = r.data.id
ok((await req('POST', `/api/ch/timeoff/${to1}/approve`, {}, T2)).status === 403, 'employee can NOT approve')
ok((await req('POST', `/api/ch/timeoff/${to1}/approve`, {}, AT)).status === 403, 'manager can NOT approve')
r = await req('POST', `/api/ch/timeoff/${to1}/approve`, {}, GT)
ok(r.status === 200, 'admin approves the day off')
ok((await req('GET', '/api/collections/time_off/records', null, T2)).data.items.length === 0, "Carla can't see other people's time off")
ok((await req('POST', '/api/collections/time_off/records', { user: e1.id, starts_at: pbDate(tStart), ends_at: pbDate(tStart), kind: 'sick', status: 'approved' }, T1)).status >= 400, "can't self-approve by creating a record directly")
r = await req('POST', `/api/ch/timeoff/${to1}/cancel`, {}, T1)
ok(r.status === 200, 'Beto cancels his approved (future) day off')

console.log('\n# Copy week')
const wk = new Date(base.getTime() - 3 * 24 * H)
r = await req('POST', '/api/ch/schedule/copy', { from: wk.toISOString(), to: new Date(wk.getTime() + 7 * 24 * H).toISOString() }, AT)
ok(r.status === 200 && r.data.copied >= 1, 'manager copies a week as drafts', r.data)
ok((await req('POST', '/api/ch/schedule/copy', { from: wk.toISOString(), to: wk.toISOString() }, T1)).status === 403, 'employee can NOT copy weeks')

console.log('\n# Notifications')
const n2 = (await req('GET', '/api/collections/notifications/records', null, T2)).data
ok(n2.items.length > 0 && n2.items.every((n) => n.user === e2.id), 'Carla only sees her own notifications', n2.items.length)
r = await req('POST', '/api/ch/notifications/read-all', {}, T2)
ok(r.status === 200 && r.data.count > 0, 'mark all as read', r.data)

console.log('\n# Invites and phone sign-in')
ok((await req('POST', '/api/collections/users/records', { name: 'No Contact', password: 'password123', passwordConfirm: 'password123', access: 'employee', active: true }, GT)).status === 400, 'a person needs a phone or an email')
const tmpPw = 'tmp-' + Math.random().toString(36).slice(2) + 'X9'
r = await req('POST', '/api/collections/users/records', { name: 'Paula Phone', phone: '+1 (555) 010-2020', password: tmpPw, passwordConfirm: tmpPw, access: 'employee', active: true, positions: [positions[2].id] }, GT)
ok(r.status === 200 && r.data.phone_login === '5550102020' && !r.data.joined_at, 'admin adds someone with only a phone', r.data)
const paula = r.data
ok((await req('POST', '/api/collections/users/records', { name: 'Dup', phone: '555-010-2020', password: tmpPw, passwordConfirm: tmpPw, access: 'employee', active: true }, GT)).status === 400, 'the same phone can not be used twice')
ok((await req('POST', '/api/ch/invites', { user: paula.id }, T1)).status === 403, 'employee can NOT create invite links')
r = await req('POST', '/api/ch/invites', { user: paula.id }, GT)
ok(r.status === 200 && r.data.token?.length >= 32, 'admin creates an invite link', r.data)
const firstToken = r.data.token
r = await req('POST', '/api/ch/invites', { user: paula.id }, GT)
const token = r.data.token
ok((await req('GET', `/api/ch/invites/${firstToken}`)).data.ok === false, 'a new link replaces the old one')
r = await req('GET', `/api/ch/invites/${token}`)
ok(r.data.ok && r.data.name === 'Paula Phone' && r.data.company === 'Test Company' && r.data.invitedBy === 'Gina GM', 'the link shows who it is for', r.data)
ok((await req('POST', `/api/ch/invites/${token}/accept`, { password: 'short' })).status === 400, 'password needs 8+ characters')
r = await req('POST', `/api/ch/invites/${token}/accept`, { password: 'paula-pass-1', email: 'paula@test.com' })
ok(r.status === 200 && r.data.token && r.data.record?.joined_at, 'accepting signs her in and marks her as joined', r.data)
ok((await req('POST', `/api/ch/invites/${token}/accept`, { password: 'paula-pass-2' })).status === 400, 'a used link can not be used again')
ok(!!(await login('(555) 010 2020'.replace(/\D/g, ''), 'paula-pass-1'))?.token, 'she signs in with her phone number')
ok(!!(await login('paula@test.com', 'paula-pass-1'))?.token, 'or with the email she added')
r = await req('POST', '/api/ch/invites', { user: paula.id }, GT)
r = await req('POST', `/api/ch/invites/${r.data.token}/accept`, { password: 'paula-pass-new' })
ok(r.status === 200 && !!(await login('5550102020', 'paula-pass-new'))?.token, 'a new link resets a forgotten password')
ok((await req('POST', '/api/ch/invites', { user: owner.record.id }, GT)).status === 403, 'admin can NOT reset the owner')

console.log('\n# Second location')
r = await req('POST', '/api/collections/locations/records', { name: 'Uptown', lat: 19.5, lng: -99.2, radius_m: 100, active: true }, T1)
ok(r.status >= 400, 'employee can NOT add locations')
r = await req('POST', '/api/collections/locations/records', { name: 'Uptown', lat: 19.5, lng: -99.2, radius_m: 100, ot_weekly_hours: 40, active: true }, GT)
ok(r.status === 200, 'admin adds a second location', r.data)
const up = r.data
r = await req('POST', '/api/collections/users/records', { name: 'Ursula Uptown', email: 'ursula@test.com', password: 'password123', passwordConfirm: 'password123', access: 'employee', active: true, locations: [up.id], positions: [positions[2].id] }, GT)
ok(r.status === 200 && r.data.locations.length === 1 && r.data.locations[0] === up.id, 'admin adds someone who only works Uptown', r.data)
const ursula = r.data
const TU = (await login('ursula@test.com', 'password123')).token
ok((await req('PATCH', `/api/collections/users/records/${ursula.id}`, { locations: [up.id, loc.id] }, TU)).status >= 400, 'people can NOT add themselves to other locations')
const upStart = new Date(Date.now() + 4 * 24 * H)
r = await req('POST', '/api/collections/shifts/records', { location: up.id, position: positions[2].id, user: ursula.id, starts_at: upStart.toISOString(), ends_at: new Date(upStart.getTime() + 6 * H).toISOString(), published: true }, GT)
ok(r.status === 200, 'admin schedules Ursula Uptown', r.data)
const upShift = r.data
ok(!(await req('GET', '/api/collections/shifts/records?perPage=200', null, T1)).data.items.some((x) => x.location === up.id), "Downtown staff don't see Uptown shifts")
const uSees = (await req('GET', '/api/collections/shifts/records?perPage=200', null, TU)).data.items
ok(uSees.length > 0 && uSees.every((x) => x.location === up.id), 'Uptown staff only see Uptown shifts', uSees.map((x) => x.location))
ok((await req('POST', '/api/collections/shifts/records', { location: up.id, user: '', starts_at: upStart.toISOString(), ends_at: new Date(upStart.getTime() + 6 * H).toISOString() }, AT)).status >= 400, "a Downtown manager can NOT schedule Uptown")
const betoShift = (await req('GET', '/api/collections/shifts/records?perPage=200&sort=-starts_at', null, T1)).data.items.find((x) => x.user === e1.id && new Date(x.starts_at) > new Date())
r = await req('POST', '/api/ch/requests', { type: 'cover', shift: betoShift.id, target_user: ursula.id }, T1)
ok(r.status === 400, "can't ask someone from another location to cover", r.data)
r = await req('POST', '/api/ch/clock/in', { lat: 19.5001, lng: -99.2, acc: 10 }, TU)
ok(r.data?.ok && r.data.geo === 'inside' && r.data.place === 'Uptown', 'Ursula clocks in at Uptown', r.data)
await req('POST', '/api/ch/clock/out', {}, TU)
r = await req('POST', '/api/ch/clock/in', { lat: 19.4326, lng: -99.1332, acc: 10 }, TU)
ok(r.data?.needReason && r.data.geo === 'outside', "Downtown's location doesn't count for Uptown staff", r.data)

console.log('\n# Auto clock-out')
const su = (await req('POST', '/api/collections/_superusers/auth-with-password', { identity: 'su@test.com', password: 'superpass123' })).data
if (su?.token) {
  // A clock-in from 16 hours ago with no clock-out
  const old = await req('POST', '/api/collections/timecards/records', { user: e3.id, location: loc.id, clock_in: new Date(Date.now() - 16 * H).toISOString() }, su.token)
  ok(old.status === 200, 'old open clock-in created', old.data)
  r = await req('POST', '/api/ch/admin/autoclose', {}, su.token)
  ok(r.status === 200, 'auto clock-out runs')
  const closed = (await req('GET', `/api/collections/timecards/records/${old.data.id}`, null, OT)).data
  ok(closed.clock_out && closed.flagged && !closed.approved, 'it was closed and marked for review', closed)
} else console.log('  (no superuser: skipped)')

console.log('\n# Push notifications')
{
  const http = await import('node:http')
  const crypto = await import('node:crypto')
  const PUSH_PORT = Number(process.env.PUSH_PORT || 8098)
  // A fake push service, standing in for Apple/Google. Paths starting with /gone answer 410 (device unsubscribed).
  const got = []
  const fake = http.createServer((rq, rs) => {
    const chunks = []
    rq.on('data', (c) => chunks.push(c))
    rq.on('end', () => {
      got.push({ path: rq.url, headers: rq.headers, body: Buffer.concat(chunks) })
      rs.writeHead(rq.url.startsWith('/gone') ? 410 : 201).end()
    })
  })
  await new Promise((done) => fake.listen(PUSH_PORT, '127.0.0.1', done))

  const b64u = (b) => Buffer.from(b).toString('base64url')
  const device = () => {
    const ecdh = crypto.createECDH('prime256v1')
    ecdh.generateKeys()
    return { ecdh, auth: crypto.randomBytes(16) }
  }
  const subOf = (d, path) => ({ endpoint: `http://127.0.0.1:${PUSH_PORT}${path}`, keys: { p256dh: b64u(d.ecdh.getPublicKey()), auth: b64u(d.auth) } })
  // Decrypt a Web Push message the way a phone does (RFC 8291, aes128gcm).
  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest()
  const decrypt = (d, body) => {
    try {
      const salt = body.subarray(0, 16)
      const idlen = body[20]
      const asPub = body.subarray(21, 21 + idlen)
      const ct = body.subarray(21 + idlen)
      const uaPub = d.ecdh.getPublicKey()
      const prkKey = hmac(d.auth, d.ecdh.computeSecret(asPub))
      const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub, Buffer.from([1])]))
      const prk = hmac(salt, ikm)
      const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16)
      const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12)
      const dec = crypto.createDecipheriv('aes-128-gcm', cek, nonce)
      dec.setAuthTag(ct.subarray(ct.length - 16))
      const plain = Buffer.concat([dec.update(ct.subarray(0, ct.length - 16)), dec.final()])
      let end = plain.length - 1
      while (end >= 0 && plain[end] === 0) end--
      return plain[end] === 2 ? JSON.parse(plain.subarray(0, end).toString()) : null
    } catch {
      return null
    }
  }
  const waitPush = async (d, path, pred, ms = 6000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      for (const p of got) {
        if (p.path !== path) continue
        const msg = decrypt(d, p.body)
        if (msg && pred(msg)) return { ...p, msg }
      }
      await new Promise((done) => setTimeout(done, 100))
    }
    return null
  }

  r = await req('GET', '/api/ch/push/key')
  ok(r.status === 200 && /^[A-Za-z0-9_-]{80,}$/.test(r.data?.key || ''), 'public push key is served', r.data)
  const d1 = device()
  ok((await req('POST', '/api/ch/push/subscribe', subOf(d1, '/d1'))).status === 401, 'subscribing needs a signed-in person')
  ok((await req('POST', '/api/ch/push/subscribe', { ...subOf(d1, '/d1'), endpoint: 'http://127.0.0.1:3000/x' }, T1)).status === 400, "can't point push at another app on the server")
  ok((await req('POST', '/api/ch/push/subscribe', { ...subOf(d1, '/d1'), endpoint: 'https://evil.example.com/push' }, T1)).status === 400, 'only real push services are accepted')
  ok((await req('POST', '/api/ch/push/subscribe', { ...subOf(d1, '/d1'), keys: { p256dh: 'abc', auth: 'def' } }, T1)).status === 400, 'broken device keys are refused')
  r = await req('POST', '/api/ch/push/subscribe', subOf(d1, '/d1'), T1)
  ok(r.status === 200, 'Beto turns on notifications', r.data)
  ok((await req('GET', '/api/collections/push_subscriptions/records', null, OT)).status >= 400, "devices can't be listed through the API, not even by the owner")

  r = await req('POST', '/api/ch/push/test', {}, T1)
  ok(r.data?.sent === 1 && r.data?.failed === 0, 'test notification is delivered', r.data)
  let p = await waitPush(d1, '/d1', (m) => m.title === 'Notifications are on')
  ok(p, 'it decrypts on the device with the right title')
  ok(p && p.headers['content-encoding'] === 'aes128gcm' && /^vapid t=.+, k=.+/.test(p.headers.authorization || '') && p.headers.ttl === '86400', 'it is encrypted and signed like real Web Push', p?.headers)

  const soonStart = new Date(Date.now() + 30 * 60 * 1000)
  r = await req('POST', '/api/collections/shifts/records', { location: loc.id, position: positions[2].id, user: e1.id, starts_at: soonStart.toISOString(), ends_at: new Date(soonStart.getTime() + 5 * H).toISOString(), published: true }, OT)
  ok(r.status === 200, 'owner gives Beto a shift starting in 30 minutes', r.data)
  const soonShift = r.data
  p = await waitPush(d1, '/d1', (m) => m.title === 'You were assigned a shift')
  ok(p && p.msg.url === '#/schedule' && p.msg.badge >= 1, 'in-app notification also arrives as a push, with the unread count', p?.msg)

  if (su?.token) {
    r = await req('POST', '/api/ch/admin/reminders', {}, su.token)
    ok(r.status === 200, 'reminders run')
    p = await waitPush(d1, '/d1', (m) => m.title.startsWith('⏰ Your shift starts at'))
    ok(p && p.msg.url === '#/today', '"your shift starts" reminder reaches the phone', p?.msg)
    await req('POST', '/api/ch/admin/reminders', {}, su.token)
    const f = encodeURIComponent("title ~ 'Your shift starts'")
    ok((await req('GET', `/api/collections/notifications/records?filter=${f}`, null, T1)).data.totalItems === 1, 'the reminder is sent only once')
    r = await req('PATCH', `/api/collections/shifts/records/${soonShift.id}`, { starts_at: new Date(soonStart.getTime() + 10 * 60 * 1000).toISOString() }, OT)
    ok(r.status === 200, 'owner moves the shift 10 minutes later', r.data)
    await req('POST', '/api/ch/admin/reminders', {}, su.token)
    ok((await req('GET', `/api/collections/notifications/records?filter=${f}`, null, T1)).data.totalItems === 2, 'a moved shift gets a new reminder')

    r = await req('POST', '/api/collections/shifts/records', { location: loc.id, position: positions[3].id, user: e2.id, starts_at: new Date(Date.now() - 6 * H).toISOString(), ends_at: new Date(Date.now() - 40 * 60 * 1000).toISOString(), published: true }, OT)
    ok(r.status === 200, 'a shift for Carla that ended 40 minutes ago', r.data)
    const tc = await req('POST', '/api/collections/timecards/records', { user: e2.id, location: loc.id, shift: r.data.id, clock_in: new Date(Date.now() - 6 * H).toISOString() }, su.token)
    ok(tc.status === 200, 'Carla is still clocked in for it', tc.data)
    await req('POST', '/api/ch/admin/reminders', {}, su.token)
    await req('POST', '/api/ch/admin/reminders', {}, su.token)
    const f2 = encodeURIComponent("title = 'Still clocked in?'")
    ok((await req('GET', `/api/collections/notifications/records?filter=${f2}`, null, T2)).data.totalItems === 1, '"still clocked in?" is sent once')
  } else console.log('  (no superuser: reminders skipped)')

  const d2 = device()
  await req('POST', '/api/ch/push/subscribe', subOf(d2, '/gone'), T1)
  r = await req('POST', '/api/ch/push/test', {}, T1)
  ok(r.data?.sent === 1 && r.data?.failed === 1, 'a phone that unsubscribed fails…', r.data)
  r = await req('POST', '/api/ch/push/test', {}, T1)
  ok(r.data?.sent === 1 && r.data?.failed === 0, '…and is forgotten', r.data)

  await req('POST', '/api/ch/push/unsubscribe', { endpoint: subOf(d1, '/d1').endpoint }, T2)
  ok((await req('POST', '/api/ch/push/test', {}, T1)).data?.sent === 1, "someone else can't turn off Beto's phone")
  await req('POST', '/api/ch/push/subscribe', subOf(d1, '/d1'), T2)
  ok((await req('POST', '/api/ch/push/test', {}, T1)).data?.sent === 0, 'when Carla signs in on that phone, Beto stops getting pushes there')
  ok((await req('POST', '/api/ch/push/test', {}, T2)).data?.sent === 1, '…and Carla gets them instead')
  await req('POST', '/api/ch/push/unsubscribe', { endpoint: subOf(d1, '/d1').endpoint }, T2)
  ok((await req('POST', '/api/ch/push/test', {}, T2)).data?.sent === 0, 'turning notifications off stops them')
  fake.close()
}

console.log('\n# Insights (analytics)')
{
  // A controlled past week at a test location: Mon shift (10 min late), Tue shift (no-show),
  // Wed open shift, Thu extra clock-in. $20/h, overtime after 6 h/week at this location.
  const DAYMS = 24 * H
  const base = new Date(Date.now() - 70 * DAYMS)
  const mon = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()))
  mon.setUTCDate(mon.getUTCDate() - ((mon.getUTCDay() + 6) % 7))
  const at = (dayOffset, hh, mm = 0) => new Date(mon.getTime() + dayOffset * DAYMS + (hh * 60 + mm) * 60000).toISOString()
  const ymd = (d) => d.toISOString().slice(0, 10)
  const FROM = ymd(mon)
  const TO = ymd(new Date(mon.getTime() + 7 * DAYMS))

  r = await req('POST', '/api/collections/locations/records', { name: 'Lab', active: true, radius_m: 100, ot_weekly_hours: 6 }, OT)
  ok(r.status === 200, 'owner adds a test location', r.data)
  const lab = r.data
  const rate = (await req('GET', `/api/collections/pay_rates/records?filter=${encodeURIComponent(`user = '${e1.id}'`)}`, null, OT)).data.items[0]
  ok((await req('PATCH', `/api/collections/pay_rates/records/${rate.id}`, { hourly: 20 }, OT)).status === 200, 'Beto earns $20/h')
  const shift = async (body) => (await req('POST', '/api/collections/shifts/records', { location: lab.id, position: positions[2].id, published: true, ...body }, OT)).data
  const sA = await shift({ user: e1.id, starts_at: at(0, 17), ends_at: at(0, 21) })
  const sB = await shift({ user: e1.id, starts_at: at(1, 17), ends_at: at(1, 21) })
  const sC = await shift({ user: '', starts_at: at(2, 17), ends_at: at(2, 21) })
  ok(sA?.id && sB?.id && sC?.id, 'three shifts that week (one open)')
  if (su?.token) {
    const c1 = await req('POST', '/api/collections/timecards/records', { user: e1.id, location: lab.id, shift: sA.id, clock_in: at(0, 17, 10), clock_out: at(0, 21), break_min: 0 }, su.token)
    const c2 = await req('POST', '/api/collections/timecards/records', { user: e1.id, location: lab.id, clock_in: at(3, 16), clock_out: at(3, 20), break_min: 0 }, su.token)
    ok(c1.status === 200 && c2.status === 200, 'two clock-ins that week', [c1.data, c2.data])
  }
  const Q = `?from=${FROM}&to=${TO}&location=${lab.id}`

  ok((await req('GET', `/api/ch/insights${Q}`, null, T1)).status === 403, "employees can't see insights")
  ok((await req('GET', `/api/ch/insights${Q}`, null, AT)).status === 403, "managers can't see insights")
  ok((await req('GET', `/api/ch/insights${Q}`)).status === 401, 'insights need sign-in')
  r = await req('GET', `/api/ch/insights${Q}`, null, GT)
  ok(r.status === 200, 'an admin sees insights', r.data)
  const T = r.data?.totals || {}
  const near = (a, b) => Math.abs(a - b) < 0.02
  ok(T.scheduledHours === 8 && T.shifts === 2 && T.openShifts === 1, '8 h scheduled in 2 shifts, plus 1 open shift', T)
  ok(near(T.workedHours, 7.83), '7.83 h worked', T)
  ok(T.late === 1 && r.data.late[0]?.minutes_late === 10, 'one clock-in 10 minutes late', r.data.late)
  ok(T.noShows === 1 && r.data.noShows[0]?.shift === sB.id, 'the Tuesday shift is a no-show', r.data.noShows)
  ok(near(T.overtimeHours, 1.83), '1.83 h of overtime past the 6 h limit', T)
  ok(T.laborCost === 175 && T.scheduledCost === 160, 'labor cost $175 (overtime at 1.5×), scheduled $160', T)
  ok(r.data.byDay.length === 7 && r.data.byDay[0].scheduledHours === 4 && near(r.data.byDay[0].workedHours, 3.83), 'by day: Monday 4 h scheduled, 3.83 h worked', r.data.byDay[0])
  ok(r.data.byPerson[0]?.name === 'Beto Bartender' && r.data.byPerson[0].noShows === 1 && r.data.hasPayRates, 'by person', r.data.byPerson[0])
  ok(r.data.byPosition.some((p) => p.name === positions[2].name && p.scheduledHours === 8), 'by position', r.data.byPosition)
  ok((await req('GET', '/api/ch/insights?from=2020-01-01&to=2026-01-01', null, OT)).status === 400, 'ranges longer than a year are refused')
  ok((await req('GET', '/api/ch/insights?days=30', null, OT)).data?.byDay?.length === 30, '?days=30 gives the last 30 days')
  r = await req('GET', '/api/ch/insights', null, OT)
  ok(r.status === 200 && r.data.byDay.length === 7, 'default is this week')

  console.log('\n# Read-only API')
  ok((await req('POST', '/api/ch/api-keys', { name: 'Nope' }, T1)).status === 403, "employees can't create API keys")
  ok((await req('POST', '/api/ch/api-keys', { name: 'Nope' }, AT)).status === 403, "managers can't create API keys")
  ok((await req('POST', '/api/ch/api-keys', { name: ' ' }, OT)).status === 400, 'a key needs a name')
  r = await req('POST', '/api/ch/api-keys', { name: 'Claude' }, OT)
  ok(r.status === 200 && /^cdk_[A-Za-z0-9]{40}$/.test(r.data?.key || ''), 'owner creates a key (shown once)', r.data)
  const KEY = r.data.key
  const keyId = r.data.id
  const list = (await req('GET', '/api/ch/api-keys', null, OT)).data.items
  ok(list.some((k) => k.id === keyId && k.name === 'Claude' && k.prefix === KEY.slice(0, 10)) && list.every((k) => !('key' in k) && !('hash' in k)), 'the list never shows the key again', list)
  ok((await req('GET', '/api/collections/api_keys/records', null, OT)).status >= 400, "keys can't be read through the regular API")

  const kreq = async (path, key, header = 'X-API-Key', method = 'GET', body) => {
    const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', [header]: header === 'Authorization' ? `Bearer ${key}` : key }, body: body ? JSON.stringify(body) : undefined })
    let data = null
    try {
      data = await res.json()
    } catch {}
    return { status: res.status, data }
  }
  ok((await req('GET', '/api/ch/v1')).status === 401, 'no key → 401')
  ok((await kreq('/api/ch/v1', 'cdk_' + 'x'.repeat(40))).status === 401, 'wrong key → 401')
  r = await kreq('/api/ch/v1', KEY)
  ok(r.status === 200 && r.data?.endpoints?.['GET /api/ch/v1/summary'], 'key in X-API-Key works and lists the endpoints', r.data)
  ok((await kreq('/api/ch/v1', KEY, 'Authorization')).status === 200, 'key as "Authorization: Bearer" works too')
  r = await kreq(`/api/ch/v1/summary${Q}`, KEY)
  ok(r.status === 200 && r.data.totals.laborCost === 175 && r.data.totals.noShows === 1, 'summary matches the Insights screen', r.data?.totals)
  r = await kreq('/api/ch/v1/people', KEY)
  const beto = r.data?.items?.find((p) => p.id === e1.id)
  ok(beto && beto.hourly === 20 && beto.positions.length > 0 && !('password' in beto) && !('tokenKey' in beto), 'people, with pay and no secrets', beto)
  r = await kreq(`/api/ch/v1/shifts?from=${FROM}&to=${TO}&location=${lab.id}`, KEY)
  ok(r.data?.items?.length === 3 && r.data.items.some((s) => s.open_shift) && r.data.items[0].name === 'Beto Bartender', 'shifts, open shift included', r.data)
  r = await kreq(`/api/ch/v1/timecards?from=${FROM}&to=${TO}&location=${lab.id}`, KEY)
  ok(r.data?.items?.length === 2 && near(r.data.items[0].hours, 3.83), 'timecards with hours', r.data)
  ok((await kreq('/api/ch/v1/locations', KEY)).data?.locations?.some((l) => l.name === 'Lab'), 'locations')
  ok((await kreq('/api/ch/v1/requests?days=30', KEY)).status === 200 && (await kreq('/api/ch/v1/time-off?days=30', KEY)).status === 200, 'requests and time off')
  r = await kreq('/api/ch/v1/audit?limit=20', KEY)
  ok(r.data?.items?.some((a) => a.action === 'api_key.create'), 'audit log shows who created the key', r.data?.items?.slice(0, 3))
  ok((await kreq('/api/ch/v1/summary', KEY, 'X-API-Key', 'POST', {})).status >= 400, 'the API is read-only')
  ok((await kreq('/api/collections/shifts/records', KEY, 'X-API-Key', 'POST', { location: lab.id, starts_at: at(4, 17), ends_at: at(4, 21) })).status >= 400, "a key can't create records")
  r = await kreq('/api/collections/pay_rates/records', KEY)
  ok(r.status >= 400 || r.data?.items?.length === 0, "a key doesn't unlock the regular API (no pay rates)", r.data)
  ok((await req('DELETE', `/api/ch/api-keys/${keyId}`, null, T1)).status === 403, "employees can't revoke keys")
  ok((await req('DELETE', `/api/ch/api-keys/${keyId}`, null, OT)).status === 200, 'owner revokes the key')
  ok((await kreq('/api/ch/v1', KEY)).status === 401, 'a revoked key stops working')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
