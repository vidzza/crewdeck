// Fills a fresh, throwaway Crewdeck server with a realistic bar week (test data only).
// Used by run.sh. API = server URL, SETUP_CODE = the server's CREWDECK_SETUP_CODE.
const API = process.env.API || 'http://127.0.0.1:8097'
const CODE = process.env.SETUP_CODE || 'duo-check-code'
const PW = 'demo-pass-123' // every demo person uses this test password (check.mjs signs in with it)

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
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(data).slice(0, 200)}`)
  return data
}
const login = async (id) => (await req('POST', '/api/collections/users/auth-with-password', { identity: id, password: PW })).token

await req('POST', '/api/ch/setup', {
  company: 'The Copper Bar',
  location: { name: 'Downtown', address: '1 Main St' },
  name: 'Olivia Owner',
  email: 'owner@demo.test',
  password: PW,
  timezone: 'America/Mexico_City',
  code: CODE,
})
const OT = await login('owner@demo.test')
const pos = (await req('GET', '/api/collections/positions/records?sort=sort', null, OT)).items
const P = Object.fromEntries(pos.map((p) => [p.name, p.id]))
const loc = (await req('GET', '/api/collections/locations/records', null, OT)).items[0]

const people = [
  ['Gina Garcia', 'gina@demo.test', 'admin', 'General Manager', 24],
  ['Andy Alvarez', 'andy@demo.test', 'manager', 'Assistant Manager', 20],
  ['Beto Ruiz', 'beto@demo.test', 'employee', 'Bartender', 16],
  ['Fer Molina', 'fer@demo.test', 'employee', 'Bartender', 16],
  ['Carla Diaz', 'carla@demo.test', 'employee', 'Barback', 13],
  ['Gabe Santos', 'gabe@demo.test', 'employee', 'Barback', 13],
  ['Eva Lopez', 'eva@demo.test', 'employee', 'Cocktails', 12],
  ['Dani Cruz', 'dani@demo.test', 'employee', 'Bouncer', 15],
]
const U = {}
for (const [name, email, access, p, rate] of people) {
  const u = await req('POST', '/api/collections/users/records', { name, email, password: PW, passwordConfirm: PW, access, active: true, positions: [P[p]], locations: [loc.id] }, OT)
  U[name.split(' ')[0]] = u.id
  await req('POST', '/api/collections/pay_rates/records', { user: u.id, hourly: rate }, OT)
}

// This week, Monday to Sunday (local time).
const now = new Date()
const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
const at = (day, h, m = 0) => new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + day, h, m)
const shift = (who, p, day, h1, h2, extra = {}) => ({
  location: loc.id,
  position: P[p],
  user: who ? U[who] : '',
  starts_at: at(day, h1).toISOString(),
  ends_at: at(day, h2 > h1 ? h2 : h2 + 24).toISOString(),
  published: true,
  ...extra,
})
const plan = []
for (let day = 1; day < 7; day++) {
  const busy = day >= 3 // Thu–Sun (closed Mondays)
  plan.push(shift(day % 2 ? 'Beto' : 'Fer', 'Bartender', day, 19, 3))
  if (busy) plan.push(shift(day % 2 ? 'Fer' : 'Beto', 'Bartender', day, 21, 3))
  plan.push(shift(day % 2 ? 'Carla' : 'Gabe', 'Barback', day, 18, 2))
  if (busy) plan.push(shift('Eva', 'Cocktails', day, 20, 2))
  if (busy) plan.push(shift('Dani', 'Bouncer', day, 21, 3))
  plan.push(shift(day < 4 ? 'Andy' : 'Gina', day < 4 ? 'Assistant Manager' : 'General Manager', day, 17, 1))
}
plan.push(shift('', 'Bouncer', 5, 22, 3)) // Saturday needs a second bouncer
plan.push(shift('', 'Barback', 6, 18, 23))
plan.push(shift('Gabe', 'Barback', 5, 20, 2, { published: false })) // draft
plan.push(shift('Eva', 'Cocktails', 2, 20, 0, { published: false })) // draft
plan.push(shift('Beto', 'Bartender', 4, 12, 18, { notes: 'Inventory' }))
const made = []
for (const s of plan) made.push(await req('POST', '/api/collections/shifts/records', s, OT))

// Approved time off for Carla on Saturday (she's also scheduled → shows as a conflict).
const CT = await login('carla@demo.test')
const to = await req('POST', '/api/ch/timeoff', { starts_at: at(5, 0).toISOString(), ends_at: at(6, 0).toISOString(), kind: 'vacation', note: 'Wedding' }, CT)
await req('POST', `/api/ch/timeoff/${to.id}/approve`, {}, OT)

// Requests waiting for the owner (only while those shifts are still in the future).
const later = (s) => s && new Date(s.starts_at) > now
const betoThu = made.find((s) => s.user === U.Beto && new Date(s.starts_at).getTime() === at(3, 19).getTime())
if (later(betoThu)) {
  const rq = await req('POST', '/api/ch/requests', { type: 'cover', shift: betoThu.id, target_user: U.Fer, note: 'Family dinner' }, await login('beto@demo.test'))
  await req('POST', `/api/ch/requests/${rq.id}/accept`, {}, await login('fer@demo.test'))
}
const openSat = made.find((s) => !s.user && new Date(s.starts_at).getTime() === at(5, 22).getTime())
if (later(openSat)) await req('POST', '/api/ch/requests', { type: 'pickup', shift: openSat.id }, await login('dani@demo.test'))

console.log(`Demo data: ${made.length} shifts for the week of ${mon.toDateString()}`)
