// Dates: the server stores UTC; the app shows the phone's local time.

export const DAY = 24 * 3600 * 1000

export function d(s: string | Date | null | undefined): Date | null {
  if (!s) return null
  if (s instanceof Date) return s
  const x = new Date(s.includes('T') ? s : s.replace(' ', 'T'))
  return isNaN(x.getTime()) ? null : x
}

export function startOfDay(x: Date) {
  const r = new Date(x)
  r.setHours(0, 0, 0, 0)
  return r
}

// Weeks run Monday to Sunday
export function startOfWeek(x: Date) {
  const r = startOfDay(x)
  const dow = (r.getDay() + 6) % 7
  r.setDate(r.getDate() - dow)
  return r
}

export function addDays(x: Date, n: number) {
  const r = new Date(x)
  r.setDate(r.getDate() + n)
  return r
}

export function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

const pad = (n: number) => String(n).padStart(2, '0')

// 12-hour clock: "8:00 PM"
export function fmtTime(x: Date | string | null) {
  const v = d(x)
  if (!v) return '—'
  const h = v.getHours()
  return `${h % 12 || 12}:${pad(v.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`
}

// "8 PM", "8:30 PM" (no ":00" — easier to scan in a grid)
export function fmtClock(x: Date | string | null) {
  const v = d(x)
  if (!v) return '—'
  const h = v.getHours()
  const m = v.getMinutes()
  return `${h % 12 || 12}${m ? `:${pad(m)}` : ''} ${h < 12 ? 'AM' : 'PM'}`
}
// "8p", "8:30p" for tight spaces
export function fmtClockShort(x: Date | string | null) {
  const v = d(x)
  if (!v) return '—'
  const h = v.getHours()
  const m = v.getMinutes()
  return `${h % 12 || 12}${m ? `:${pad(m)}` : ''}${h < 12 ? 'a' : 'p'}`
}
// "26h", "26.5h"
export const fmtH = (h: number) => `${Math.round(h * 10) / 10}h`

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "Mon, Nov 16"
export function fmtDay(x: Date | string | null) {
  const v = d(x)
  return v ? `${DAYS[v.getDay()]}, ${MONTHS[v.getMonth()]} ${v.getDate()}` : '—'
}

export function fmtRange(a: string | Date, b: string | Date) {
  return `${fmtTime(a)} – ${fmtTime(b)}`
}

export function fmtShift(s: { starts_at: string; ends_at: string }) {
  return `${fmtDay(s.starts_at)} · ${fmtRange(s.starts_at, s.ends_at)}`
}

const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// "Wednesday, November 18"
export function fmtDayLong(x: Date | string | null) {
  const v = d(x)
  return v ? `${DAYS_LONG[v.getDay()]}, ${MONTHS_LONG[v.getMonth()]} ${v.getDate()}` : '—'
}
export const weekdayLetter = (x: Date) => DAYS[x.getDay()].slice(0, 1)
export const weekdayShort = (x: Date) => DAYS[x.getDay()]

// "Nov 16 – 22" or "Nov 30 – Dec 6"
export function fmtWeek(monday: Date) {
  const sun = addDays(monday, 6)
  const end = sun.getMonth() === monday.getMonth() ? `${sun.getDate()}` : `${MONTHS[sun.getMonth()]} ${sun.getDate()}`
  return `${MONTHS[monday.getMonth()]} ${monday.getDate()} – ${end}`
}

export function hoursBetween(a: string | Date, b: string | Date | null) {
  const x = d(a)
  const y = d(b) || new Date()
  if (!x) return 0
  return Math.max(0, (y.getTime() - x.getTime()) / 3600000)
}

export function fmtHours(h: number) {
  const m = Math.round(h * 60)
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`
}

// <input type="date|time"> helpers
export function toDateInput(x: Date) {
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}
export function toTimeInput(x: Date) {
  return `${pad(x.getHours())}:${pad(x.getMinutes())}`
}
export function toLocalInput(x: Date | string | null) {
  const v = d(x)
  return v ? `${toDateInput(v)}T${toTimeInput(v)}` : ''
}
export function fromInputs(date: string, time: string) {
  return new Date(`${date}T${time || '00:00'}`)
}
