import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { pb, api, errMsg, isAdmin, isMgr, type PayRate, type Position, type Shift, type ShiftRequest, type TimeOff } from '../lib/pb'
import {
  addDays,
  d,
  DAY,
  fmtClock,
  fmtClockShort,
  fmtDay,
  fmtDayLong,
  fmtH,
  fmtHours,
  fmtShift,
  fromInputs,
  hoursBetween,
  sameDay,
  startOfDay,
  startOfWeek,
  toDateInput,
  toTimeInput,
  weekdayShort,
} from '../lib/dates'
import { useData } from '../store'
import { LocationPicker, TopActions, WeekBar } from '../chrome'
import type { User } from '../lib/pb'
import { ask, Avatar, Banner, Button, Dot, Group, HeaderButton, InputRow, Page, Pill, Row, SelectRow, Sheet, Spinner, SwitchRow, toast } from '../ui'
import { Icon, type IconName } from '../icons'

// Owners and admins work everywhere; people with no locations yet are treated the same.
function worksAt(u: User, locId: string) {
  return !locId || u.access === 'owner' || u.access === 'admin' || !u.locations?.length || u.locations.includes(locId)
}

const KIND_LABEL: Record<string, string> = { vacation: 'Vacation', sick: 'Sick', personal: 'Personal', unpaid: 'Unpaid' }
const GRAY = '#8e8e93'
// "Gina Garcia" → "Gina G." when the name column is narrow.
const shortName = (n: string) => {
  const [first, ...rest] = n.trim().split(/\s+/)
  return rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first
}
// Long positions in small shift boxes: "General Manager" → "GM", "Assistant Manager" → "AM".
const shortPosition = (n: string) => {
  const words = n.trim().split(/\s+/)
  return n.length > 11 && words.length > 1 ? words.map((w) => w[0].toUpperCase()).join('') : n
}
const overlapsDay = (t: TimeOff, day: Date) => d(t.starts_at)! < addDays(day, 1) && d(t.ends_at)! > day
const shiftHours = (s: Shift) => hoursBetween(s.starts_at, s.ends_at)

// Width of an element, kept up to date (phone ↔ iPad ↔ iPhone Duo opened or closed).
function useWidth() {
  const [w, setW] = useState(0)
  const ro = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: HTMLElement | null) => {
    ro.current?.disconnect()
    if (!el) return
    setW(el.getBoundingClientRect().width)
    ro.current = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.current.observe(el)
  }, [])
  return [ref, w] as const
}

export default function Schedule() {
  const { me, users, userName, position, positions, section, currentLocation } = useData()
  const locId = currentLocation?.id || ''
  const mgr = isMgr(me)
  const [week, setWeek] = useState(() => startOfWeek(new Date()))
  const [shifts, setShifts] = useState<Shift[] | null>(null)
  const [timeOff, setTimeOff] = useState<TimeOff[]>([])
  const [pending, setPending] = useState<Map<string, ShiftRequest>>(new Map())
  const [rates, setRates] = useState<Map<string, number>>(new Map())
  const [edit, setEdit] = useState<{ shift?: Shift; day: Date; user?: string } | null>(null)
  const [change, setChange] = useState<Shift | null>(null)
  const [pickup, setPickup] = useState<Shift | null>(null)
  const [dayView, setDayView] = useState<Date | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const f = week
    const t = addDays(week, 7)
    const [s, to, rq, pr] = await Promise.all([
      pb.collection('shifts').getFullList<Shift>({ filter: pb.filter('starts_at >= {:f} && starts_at < {:t}', { f, t }), sort: 'starts_at' }),
      pb
        .collection('time_off')
        .getFullList<TimeOff>({ filter: pb.filter('status = "approved" && starts_at < {:t} && ends_at > {:f}', { f, t }) })
        .catch(() => []),
      pb
        .collection('shift_requests')
        .getFullList<ShiftRequest>({ filter: 'status = "pending_peer" || status = "pending_admin"' })
        .catch(() => []),
      isAdmin(me) ? pb.collection('pay_rates').getFullList<PayRate>().catch(() => []) : Promise.resolve([] as PayRate[]),
    ])
    setShifts(s)
    setTimeOff(to)
    const m = new Map<string, ShiftRequest>()
    rq.forEach((r) => {
      m.set(r.shift, r)
      if (r.target_shift) m.set(r.target_shift, r)
    })
    setPending(m)
    setRates(new Map(pr.map((r) => [r.user, r.hourly])))
  }, [week, me])

  useEffect(() => {
    setShifts(null)
    load().catch((e) => toast(errMsg(e), 'error'))
  }, [load])

  const now = new Date()
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week])
  const here = useMemo(() => (shifts || []).filter((s) => !locId || s.location === locId), [shifts, locId])
  const drafts = here.filter((s) => !s.published).length
  const canEdit = (s: Shift) => isAdmin(me) || (me.access === 'manager' && !s.published)
  const ot = currentLocation?.ot_weekly_hours || 40

  // Hours per person this week, every location (overtime counts everywhere).
  const weekHours = useMemo(() => {
    const m = new Map<string, number>()
    ;(shifts || []).forEach((s) => s.user && m.set(s.user, (m.get(s.user) || 0) + shiftHours(s)))
    return m
  }, [shifts])

  // Rows: who is on this location's schedule. Managers also see everyone they can schedule.
  const rows = useMemo(() => {
    const ids = new Set<string>()
    here.forEach((s) => s.user && ids.add(s.user))
    if (mgr) users.forEach((u) => u.active && (u.access === 'manager' || u.access === 'employee') && worksAt(u, locId) && ids.add(u.id))
    else ids.add(me.id)
    const posRank = new Map(positions.map((p) => [p.id, p.sort]))
    const rank = (id: string) => {
      const u = users.find((x) => x.id === id)
      const r = (u?.positions || []).map((p) => posRank.get(p) ?? 999)
      return r.length ? Math.min(...r) : 999
    }
    return [...ids].sort((a, b) => {
      if (!mgr && (a === me.id || b === me.id)) return a === me.id ? -1 : 1
      return rank(a) - rank(b) || userName(a).localeCompare(userName(b))
    })
  }, [here, users, positions, mgr, me.id, locId, userName])

  // Problems to fix before publishing: someone scheduled during approved time off, or twice at once.
  const conflicts = useMemo(() => {
    const m = new Map<string, string>()
    const all = shifts || []
    here.forEach((s) => {
      if (!s.user) return
      const a = d(s.starts_at)!
      const b = d(s.ends_at)!
      const off = timeOff.find((t) => t.user === s.user && d(t.starts_at)! < b && d(t.ends_at)! > a)
      if (off) return m.set(s.id, `${userName(s.user)} has time off (${KIND_LABEL[off.kind]}) but works ${fmtDay(a)}, ${fmtClock(a)}.`)
      const twice = all.find((o) => o.id !== s.id && o.user === s.user && d(o.starts_at)! < b && d(o.ends_at)! > a)
      if (twice) m.set(s.id, `${userName(s.user)} has two shifts at the same time on ${fmtDay(a)}.`)
    })
    return m
  }, [here, shifts, timeOff, userName])
  const conflictText = [...new Set(conflicts.values())]

  const stats = useMemo(() => {
    const people = new Map<string, number>()
    here.forEach((s) => s.user && people.set(s.user, (people.get(s.user) || 0) + shiftHours(s)))
    let hours = 0
    let cost = 0
    let overtime = 0
    people.forEach((h, uid) => {
      hours += h
      const all = weekHours.get(uid) || h
      const over = Math.max(0, all - ot)
      if (over > 0) overtime++
      const rate = rates.get(uid) || 0
      // Overtime is paid at 1.5×: add the extra half for this location's share of it.
      cost += rate * (h + 0.5 * over * (h / all))
    })
    return { shifts: here.length, hours, open: here.filter((s) => !s.user).length, cost, overtime }
  }, [here, weekHours, rates, ot])

  const onShiftTap = (s: Shift) => {
    const future = d(s.starts_at)! > now
    if (canEdit(s)) return setEdit({ shift: s, day: startOfDay(d(s.starts_at)!) })
    if (s.published && future && (s.user === me.id || !s.user)) {
      if (pending.has(s.id)) return toast('This shift already has a change waiting for the owner.', 'info')
      return s.user ? setChange(s) : setPickup(s)
    }
    setDayView(startOfDay(d(s.starts_at)!))
  }

  const copyWeek = async () => {
    if (!(await ask({ title: "Copy last week's shifts?", message: "They're added to this week as drafts. Nobody sees them until you publish.", confirm: 'Copy' }))) return
    setBusy('copy')
    try {
      const r = await api<{ copied: number; skipped?: number }>('/api/ch/schedule/copy', { from: addDays(week, -7).toISOString(), to: week.toISOString(), location: locId })
      toast(
        r.copied
          ? `Copied ${r.copied} shift${r.copied === 1 ? '' : 's'} as drafts${r.skipped ? ` · ${r.skipped} already here` : ''}`
          : r.skipped
            ? "Last week's shifts are already in this week"
            : 'Last week had no shifts',
        r.copied ? 'ok' : 'info',
      )
      await load()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const publish = async () => {
    if (!(await ask({ title: `Publish ${drafts} shift${drafts === 1 ? '' : 's'}?`, message: 'Everyone on the schedule gets notified.', confirm: 'Publish' }))) return
    setBusy('publish')
    try {
      const r = await api<{ published: number; notified: number }>('/api/ch/schedule/publish', { from: week.toISOString(), to: addDays(week, 7).toISOString(), location: locId })
      toast(`Published · ${r.notified} ${r.notified === 1 ? 'person' : 'people'} notified`)
      await load()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const mine = here.filter((s) => s.user === me.id)
  const openToPick = here.filter((s) => !s.user && s.published && d(s.starts_at)! > now)
  const firstDay = startOfDay(now) > week ? startOfDay(now) : week

  return (
    <Page
      title="Schedule"
      wide
      actions={<TopActions>{mgr && <HeaderButton icon="plus" label="Add shift" onClick={() => setEdit({ day: firstDay })} />}</TopActions>}
    >
      <div className="space-y-3">
        <LocationPicker />
        <WeekBar week={week} onChange={setWeek} />
        {mgr && shifts && (
          <div className="grid grid-cols-4 divide-x divide-ios-sep/60 rounded-2xl bg-white py-2.5">
            <Stat label="Hours" value={fmtH(stats.hours)} sub={`${stats.shifts} shift${stats.shifts === 1 ? '' : 's'}`} />
            <Stat label="Open" value={String(stats.open)} sub={stats.open ? 'Nobody assigned yet' : 'All covered'} tone={stats.open ? 'blue' : undefined} />
            <Stat
              label="Overtime"
              value={String(stats.overtime)}
              sub={stats.overtime ? `${stats.overtime === 1 ? 'person' : 'people'} over ${ot}h` : `Nobody over ${ot}h`}
              tone={stats.overtime ? 'orange' : undefined}
            />
            {isAdmin(me) ? (
              <Stat label="Labor" value={rates.size ? money(stats.cost) : '—'} sub={rates.size ? 'Estimated' : 'Add pay rates in Team'} />
            ) : (
              <Stat label="Drafts" value={String(drafts)} sub="Not published yet" />
            )}
          </div>
        )}
      </div>

      {isAdmin(me) && drafts > 0 && (
        <Banner tone="blue" icon="send" onClick={publish}>
          <b>
            {drafts} draft shift{drafts === 1 ? '' : 's'}
          </b>{' '}
          {drafts === 1 ? "isn't" : "aren't"} visible to the team yet. {busy === 'publish' ? 'Publishing…' : 'Tap to publish this week.'}
        </Banner>
      )}
      {mgr && conflictText.length > 0 && (
        <Banner tone="red" icon="alert">
          <b>
            {conflictText.length} conflict{conflictText.length === 1 ? '' : 's'} this week.
          </b>{' '}
          {conflictText.slice(0, 3).join(' ')}
          {conflictText.length > 3 ? ` And ${conflictText.length - 3} more.` : ''} They're outlined in red below.
        </Banner>
      )}
      {me.access === 'manager' && drafts > 0 && (
        <Banner tone="blue" icon="info">
          {drafts} draft shift{drafts === 1 ? '' : 's'} this week. The owner or an admin publishes them.
        </Banner>
      )}

      {!shifts ? (
        <Spinner />
      ) : (
        <>
          {!mgr && (
            <div className="grid gap-7 lg:grid-cols-2 lg:items-start">
              <Group header={`Your Shifts${mine.length ? ` · ${fmtH(mine.reduce((a, s) => a + shiftHours(s), 0))}` : ''}`}>
                {mine.length === 0 && <Row title={<span className="text-ios-label2">No shifts this week</span>} />}
                {mine.map((s) => (
                  <ShiftRow key={s.id} s={s} pending={pending.has(s.id)} onClick={() => onShiftTap(s)} chevron={s.published && d(s.starts_at)! > now && !pending.has(s.id)} />
                ))}
              </Group>
              {openToPick.length > 0 && (
                <Group header="Open Shifts" footer="Ask for one and the owner approves it.">
                  {openToPick.map((s) => (
                    <ShiftRow key={s.id} s={s} open pending={pending.has(s.id)} onClick={() => onShiftTap(s)} />
                  ))}
                </Group>
              )}
            </div>
          )}

          <section>
            {!mgr && <div className="px-4 pb-[7px] text-[13px] uppercase text-ios-label2">Everyone This Week</div>}
            <WeekGrid
              days={days}
              rows={rows}
              shifts={here}
              timeOff={timeOff}
              pending={pending}
              conflicts={conflicts}
              weekHours={weekHours}
              ot={ot}
              showOpen={mgr || here.some((s) => !s.user)}
              canAdd={mgr}
              onShift={onShiftTap}
              onEmpty={(day, user) => setEdit({ day, user })}
              onDay={setDayView}
            />
            <Legend positions={positions.filter((p) => here.some((s) => s.position === p.id))} drafts={drafts > 0} conflicts={conflicts.size > 0} />
            <p className="px-4 pt-2 text-[13px] text-ios-label2">
              {mgr ? 'Tap a day to see who works when. Tap an empty box to add a shift.' : 'Tap a day to see who works when.'}
              {!mgr && ' Tap one of your shifts to swap it, get it covered or drop it. The owner always gives final approval.'}
            </p>
          </section>
        </>
      )}

      {mgr && (
        <Group>
          <Row icon="plus" iconBg="#007aff" title="Add Shift" tone="link" onClick={() => setEdit({ day: firstDay })} />
          <Row icon="copy" iconBg={GRAY} title={busy === 'copy' ? 'Copying…' : 'Copy Last Week'} tone="link" onClick={copyWeek} />
        </Group>
      )}

      {dayView && (
        <DaySheet
          day={dayView}
          shifts={here}
          timeOff={timeOff}
          pending={pending}
          conflicts={conflicts}
          canAdd={mgr}
          onClose={() => setDayView(null)}
          onShift={(s) => {
            setDayView(null)
            onShiftTap(s)
          }}
          onAdd={() => {
            setEdit({ day: dayView })
            setDayView(null)
          }}
        />
      )}
      {edit && (
        <ShiftEditor
          shift={edit.shift}
          day={edit.day}
          presetUser={edit.user}
          weekShifts={shifts || []}
          timeOff={timeOff}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null)
            load()
          }}
        />
      )}
      {change && (
        <ChangeSheet
          shift={change}
          onClose={() => setChange(null)}
          onDone={() => {
            setChange(null)
            load()
          }}
        />
      )}
      {pickup && (
        <PickupSheet
          shift={pickup}
          onClose={() => setPickup(null)}
          onDone={() => {
            setPickup(null)
            load()
          }}
        />
      )}
    </Page>
  )

  function ShiftRow({ s, open, pending: isPending, onClick, chevron }: { s: Shift; open?: boolean; pending?: boolean; onClick: () => void; chevron?: boolean }) {
    const pos = position(s.position)
    return (
      <Row
        onClick={onClick}
        leading={<span className="h-10 w-[5px] shrink-0 rounded-full" style={{ background: pos?.color || GRAY, opacity: s.published ? 1 : 0.4 }} />}
        title={
          <span className="tabular font-semibold">
            {fmtDay(s.starts_at)} · {fmtClock(s.starts_at)} – {fmtClock(s.ends_at)}
          </span>
        }
        subtitle={[pos?.name, section(s.section)?.name, s.notes].filter(Boolean).join(' · ') || undefined}
        accessory={isPending ? <Pill tone="orange">{open ? 'Requested' : 'Pending'}</Pill> : open ? <Pill tone="blue">Pick Up</Pill> : undefined}
        chevron={chevron}
      />
    )
  }
}

// "$3,718", or "$12.3k" once it gets long, so it never gets cut off on a small screen.
const money = (n: number) => (n >= 10000 ? `$${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : `$${Math.round(n).toLocaleString('en-US')}`)

// One row of numbers for the week. On phones only the number and its name, to keep the grid in view.
function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'blue' | 'orange' }) {
  const color = tone === 'blue' ? 'text-ios-blue' : tone === 'orange' ? 'text-[#c93400]' : ''
  return (
    <div className="min-w-0 px-1 text-center sm:px-4 sm:text-left" title={sub}>
      <div data-time className={`tabular text-[17px] font-bold leading-tight min-[400px]:text-[19px] sm:text-[22px] ${color}`}>
        {value}
      </div>
      <div className="truncate text-[12px] font-medium text-ios-label2 sm:text-[13px]">{label}</div>
      <div className="hidden truncate text-[12px] text-ios-label3 sm:block">{sub}</div>
    </div>
  )
}

function Legend({ positions, drafts, conflicts }: { positions: Position[]; drafts: boolean; conflicts: boolean }) {
  if (!positions.length) return null
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-3 text-[13px] text-ios-label2">
      {positions.map((p) => (
        <span key={p.id} className="inline-flex items-center gap-1.5">
          <Dot color={p.color} size={9} />
          {p.name}
        </span>
      ))}
      {drafts && (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-[9px] w-[14px] rounded-[3px] border border-dashed border-ios-gray" />
          Draft
        </span>
      )}
      {conflicts && (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-[9px] w-[14px] rounded-[3px] border-[1.5px] border-ios-red" />
          Conflict
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-[7px] w-[7px] rounded-full bg-ios-orange" />
        Change waiting for the owner
      </span>
    </div>
  )
}

// ---------- the week at a glance: one row per person, one column per day ----------
type Density = 'compact' | 'medium' | 'full'

function WeekGrid({
  days,
  rows,
  shifts,
  timeOff,
  pending,
  conflicts,
  weekHours,
  ot,
  showOpen,
  canAdd,
  onShift,
  onEmpty,
  onDay,
}: {
  days: Date[]
  rows: string[]
  shifts: Shift[]
  timeOff: TimeOff[]
  pending: Map<string, ShiftRequest>
  conflicts: Map<string, string>
  weekHours: Map<string, number>
  ot: number
  showOpen: boolean
  canAdd: boolean
  onShift: (s: Shift) => void
  onEmpty: (day: Date, user: string) => void
  onDay: (day: Date) => void
}) {
  const { me, users, userName, position } = useData()
  const [ref, width] = useWidth()
  // The name column grows with the screen (a fifth of it): narrow on phones so times stay readable,
  // roomy on the iPhone Duo's inner screen, iPad and computers.
  const nameW = width ? Math.round(Math.min(190, Math.max(54, width * 0.2))) : 66
  const cellW = width ? (width - nameW) / 7 : 0
  const density: Density = cellW >= 104 ? 'full' : cellW >= 62 ? 'medium' : 'compact'
  const cols = { gridTemplateColumns: `${nameW}px repeat(7, minmax(0, 1fr))` }
  const today = new Date()

  const cell = useMemo(() => {
    const m = new Map<string, Shift[]>()
    shifts.forEach((s) => {
      const i = days.findIndex((x) => sameDay(d(s.starts_at)!, x))
      if (i < 0) return
      const k = `${s.user}|${i}`
      m.set(k, [...(m.get(k) || []), s])
    })
    return m
  }, [shifts, days])

  const dayHours = days.map((_, i) => shifts.filter((s) => s.user && sameDay(d(s.starts_at)!, days[i])).reduce((a, s) => a + shiftHours(s), 0))

  const nameCell = (uid: string) => {
    const u = users.find((x) => x.id === uid)
    const name = uid === me.id ? 'You' : userName(uid)
    const h = weekHours.get(uid) || 0
    const over = h > ot
    const pos = position(u?.positions?.[0] || '')
    const hours = <span className={over ? 'font-semibold text-[#c93400]' : ''}>{h ? fmtH(h) : '0h'}</span>
    if (density === 'compact')
      return (
        <div className="min-w-0 px-2 py-1.5">
          <div data-name className={`truncate text-[13px] font-semibold leading-tight ${uid === me.id ? 'text-ios-blue' : ''}`}>
            {name.split(' ')[0]}
          </div>
          <div className="text-[11px] leading-tight text-ios-label2">{hours}</div>
        </div>
      )
    const roomy = nameW >= 150
    return (
      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
        {nameW >= 190 && <Avatar name={userName(uid)} size={30} />}
        <div className="min-w-0">
          <div data-name className={`truncate text-[15px] font-semibold leading-tight ${uid === me.id ? 'text-ios-blue' : ''}`}>
            {roomy ? name : shortName(name)}
          </div>
          <div className="truncate text-[12px] leading-tight text-ios-label2">
            {hours}
            {over && roomy && ' · overtime'}
            {!over && pos && roomy ? ` · ${pos.name}` : ''}
          </div>
        </div>
      </div>
    )
  }

  const row = (uid: string, label: ReactNode, key: string) => (
    <div key={key} role="row" className="grid border-t border-ios-sep/60" style={cols}>
      <div role="rowheader" className="flex items-center border-r border-ios-sep/60">
        {label}
      </div>
      {days.map((x, i) => {
        const list = cell.get(`${uid}|${i}`) || []
        const off = uid ? timeOff.filter((t) => t.user === uid && overlapsDay(t, x)) : []
        const isToday = sameDay(x, today)
        const empty = !list.length && !off.length
        return (
          <div
            key={i}
            role="gridcell"
            className={`group relative flex min-h-[52px] min-w-0 flex-col ${density === 'compact' ? 'gap-[2px] p-[2px]' : 'gap-[3px] p-[3px]'} ${i < 6 ? 'border-r border-ios-sep/40' : ''} ${isToday ? 'bg-ios-blue/[0.045]' : ''}`}
          >
            {off.map((t) => (
              <span key={t.id} className="flex min-h-[22px] items-center justify-center truncate rounded-[6px] bg-ios-fill px-1 text-[11px] font-semibold text-ios-label2" title={`Time off · ${KIND_LABEL[t.kind]}`}>
                {density === 'full' ? `Off · ${KIND_LABEL[t.kind]}` : 'Off'}
              </span>
            ))}
            {list.map((s) => (
              <Chip key={s.id} s={s} density={density} pending={pending.has(s.id)} conflict={conflicts.get(s.id)} onClick={() => onShift(s)} />
            ))}
            {empty && canAdd && (
              <button
                type="button"
                aria-label={`Add a shift${uid ? ` for ${userName(uid)}` : ' (open shift)'} on ${fmtDayLong(x)}`}
                onClick={() => onEmpty(startOfDay(x), uid)}
                className="flex flex-1 items-center justify-center rounded-[6px] text-ios-gray3 opacity-0 transition-opacity hover:bg-ios-fill hover:opacity-100 focus-visible:opacity-100 active:bg-ios-fill active:opacity-100"
              >
                <Icon name="plus" size={16} stroke={2.4} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )

  return (
    <div ref={ref} role="grid" aria-label="Week schedule" className="rounded-2xl bg-white">
      {/* Day headers stay on screen while you scroll down the team. */}
      <div
        role="row"
        className="sticky z-10 grid rounded-t-2xl bg-white/95 backdrop-blur-xl"
        style={{ ...cols, top: 'env(safe-area-inset-top)' }}
      >
        <div className="flex items-end border-r border-ios-sep/60 px-2 pb-1.5 text-[12px] font-medium text-ios-label2">{density === 'compact' ? '' : 'Team'}</div>
        {days.map((x, i) => {
          const isToday = sameDay(x, today)
          return (
            <button
              key={i}
              type="button"
              role="columnheader"
              onClick={() => onDay(x)}
              aria-label={`${fmtDayLong(x)}: see who works when`}
              className={`flex min-w-0 flex-col items-center py-1.5 active:bg-ios-gray5 ${i < 6 ? 'border-r border-ios-sep/40' : ''} ${isToday ? 'bg-ios-blue/[0.045]' : ''} ${i === 6 ? 'rounded-tr-2xl' : ''}`}
            >
              <span className={`text-[11px] font-semibold uppercase ${isToday ? 'text-ios-red' : 'text-ios-label2'}`}>{weekdayShort(x)}</span>
              <span
                className={`mt-0.5 flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-[17px] leading-none ${isToday ? 'bg-ios-red font-semibold text-white' : 'font-medium'}`}
              >
                {x.getDate()}
              </span>
              <span className="mt-0.5 text-[11px] leading-tight text-ios-label2">{dayHours[i] ? fmtH(dayHours[i]) : '—'}</span>
            </button>
          )
        })}
      </div>
      {showOpen &&
        row(
          '',
          <div className="min-w-0 px-2 py-1.5">
            <div data-name className={`truncate font-semibold leading-tight text-ios-blue ${density === 'compact' ? 'text-[13px]' : 'px-1 text-[15px]'}`}>{density === 'compact' ? 'Open' : 'Open Shifts'}</div>
            {density !== 'compact' && <div className="truncate px-1 text-[12px] leading-tight text-ios-label2">Up for grabs</div>}
          </div>,
          'open',
        )}
      {rows.map((uid) => row(uid, nameCell(uid), uid))}
      {rows.length === 0 && !showOpen && <div className="border-t border-ios-sep/60 px-4 py-6 text-center text-[15px] text-ios-label2">No shifts this week</div>}
      <div className="h-1" />
    </div>
  )
}

function Chip({ s, density, pending, conflict, onClick }: { s: Shift; density: Density; pending: boolean; conflict?: string; onClick: () => void }) {
  const { position, section, userName } = useData()
  const pos = position(s.position)
  const color = pos?.color || GRAY
  const draft = !s.published
  const ring = conflict ? ', 0 0 0 2px #ff3b30' : ''
  const style = draft
    ? { background: `${color}12`, border: `1.5px dashed ${color}`, boxShadow: ring.slice(2) || undefined }
    : { background: `${color}24`, boxShadow: `inset 3px 0 0 ${color}${ring}` }
  const label = `${s.user ? userName(s.user) : 'Open shift'}, ${fmtDayLong(s.starts_at)}, ${fmtClock(s.starts_at)} to ${fmtClock(s.ends_at)}${pos ? `, ${pos.name}` : ''}${draft ? ', draft' : ''}${pending ? ', change waiting for the owner' : ''}${conflict ? `. Conflict: ${conflict}` : ''}`
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="relative w-full min-w-0 rounded-[6px] text-left active:opacity-60" style={style}>
      {density === 'compact' ? (
        <span className="block overflow-hidden whitespace-nowrap py-[3px] pl-[4px] pr-[1px] text-[10.5px] leading-[1.2] tracking-[-0.2px]">
          <span data-time className="block font-semibold">
            {fmtClockShort(s.starts_at)}
          </span>
          <span data-time className="block text-ios-label2">
            {fmtClockShort(s.ends_at)}
          </span>
        </span>
      ) : density === 'medium' ? (
        <span className="block px-1.5 py-1 pl-2 text-[12px] leading-[1.25]">
          <span data-time className="block truncate font-semibold">
            {fmtClockShort(s.starts_at)}–{fmtClockShort(s.ends_at)}
          </span>
          <span className="block truncate text-[11px] text-ios-label2">{pos ? shortPosition(pos.name) : draft ? 'Draft' : ''}</span>
        </span>
      ) : (
        <span className="block px-2 py-1 pl-2.5 text-[13px] leading-[1.25]">
          <span data-time className="block truncate font-semibold">
            {fmtClock(s.starts_at)} – {fmtClock(s.ends_at)}
          </span>
          <span className="block truncate text-[12px] text-ios-label2">
            {[pos?.name, section(s.section)?.name].filter(Boolean).join(' · ') || ' '}
            {draft ? ' · Draft' : ''}
          </span>
        </span>
      )}
      {pending && <span className="absolute -right-[3px] -top-[3px] h-[9px] w-[9px] rounded-full bg-ios-orange ring-2 ring-white" />}
    </button>
  )
}

// ---------- one day: who works when, on a timeline ----------
function DaySheet({
  day,
  shifts,
  timeOff,
  pending,
  conflicts,
  canAdd,
  onClose,
  onShift,
  onAdd,
}: {
  day: Date
  shifts: Shift[]
  timeOff: TimeOff[]
  pending: Map<string, ShiftRequest>
  conflicts: Map<string, string>
  canAdd: boolean
  onClose: () => void
  onShift: (s: Shift) => void
  onAdd: () => void
}) {
  const { me, userName, position, section } = useData()
  const list = shifts.filter((s) => sameDay(d(s.starts_at)!, day)).sort((a, b) => d(a.starts_at)!.getTime() - d(b.starts_at)!.getTime())
  const off = timeOff.filter((t) => overlapsDay(t, day))
  const people = new Set(list.filter((s) => s.user).map((s) => s.user)).size
  const hours = list.filter((s) => s.user).reduce((a, s) => a + shiftHours(s), 0)
  const open = list.filter((s) => !s.user).length

  // Timeline from the first start to the last end, on whole hours.
  const H = 3600000
  const t0 = list.length ? Math.floor(Math.min(...list.map((s) => d(s.starts_at)!.getTime())) / H) * H : 0
  const t1 = list.length ? Math.ceil(Math.max(...list.map((s) => d(s.ends_at)!.getTime())) / H) * H : 0
  const spanH = Math.max(1, (t1 - t0) / H)
  const step = [1, 2, 3, 4, 6].find((x) => spanH / x <= 6) || 6
  const ticks = Array.from({ length: Math.floor(spanH / step) + 1 }, (_, i) => t0 + i * step * H)
  const pct = (t: number) => ((t - t0) / (t1 - t0)) * 100

  return (
    <Sheet title={fmtDayLong(day)} onClose={onClose} onDone={onClose} doneLabel="Done" viewOnly>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { v: String(people), l: people === 1 ? 'Person' : 'People' },
          { v: fmtH(hours), l: 'Hours' },
          { v: String(open), l: open === 1 ? 'Open Shift' : 'Open Shifts' },
        ].map((x) => (
          <div key={x.l} className="rounded-2xl bg-white px-2 py-2.5">
            <div className={`tabular text-[22px] font-bold leading-tight ${x.l.startsWith('Open') && open ? 'text-ios-blue' : ''}`}>{x.v}</div>
            <div className="text-[12px] text-ios-label2">{x.l}</div>
          </div>
        ))}
      </div>

      {list.length === 0 ? (
        <Group>
          <Row title={<span className="text-ios-label2">No shifts this day</span>} />
        </Group>
      ) : (
        <section>
          <div className="px-4 pb-[7px] text-[13px] uppercase text-ios-label2">Who Works When</div>
          <div className="rounded-2xl bg-white px-4 pb-2 pt-3">
            <div className="relative mb-1 h-4 text-[11px] text-ios-label2">
              {ticks.map((t, i) => (
                <span
                  key={t}
                  className="absolute top-0 whitespace-nowrap"
                  style={{ left: `${pct(t)}%`, transform: i === 0 ? 'none' : i === ticks.length - 1 && pct(t) > 95 ? 'translateX(-100%)' : 'translateX(-50%)' }}
                >
                  {fmtClockShort(new Date(t))}
                </span>
              ))}
            </div>
            <div className="relative">
              {ticks.map((t) => (
                <span key={t} className="pointer-events-none absolute bottom-0 top-0 w-px bg-ios-sep/50" style={{ left: `${pct(t)}%` }} />
              ))}
              {list.map((s) => {
                const pos = position(s.position)
                const color = pos?.color || GRAY
                const a = d(s.starts_at)!.getTime()
                const b = d(s.ends_at)!.getTime()
                return (
                  <button key={s.id} type="button" onClick={() => onShift(s)} className="relative block w-full py-2 text-left active:opacity-60">
                    <span className="flex items-baseline justify-between gap-2 text-[15px]">
                      <span className={`truncate font-semibold ${!s.user ? 'text-ios-blue' : s.user === me.id ? 'text-ios-blue' : ''}`}>
                        {s.user ? (s.user === me.id ? 'You' : userName(s.user)) : 'Open Shift'}
                        <span className="font-normal text-ios-label2">{[pos?.name, section(s.section)?.name].filter(Boolean).map((x) => ` · ${x}`)}</span>
                      </span>
                      <span className="tabular shrink-0 text-[13px] text-ios-label2">
                        {fmtClock(s.starts_at)} – {fmtClock(s.ends_at)}
                      </span>
                    </span>
                    <span className="relative mt-1.5 block h-[10px] rounded-full bg-ios-fill">
                      <span
                        className="absolute top-0 h-full rounded-full"
                        style={{
                          left: `${pct(a)}%`,
                          width: `${Math.max(2, pct(b) - pct(a))}%`,
                          background: s.published ? color : `repeating-linear-gradient(135deg, ${color}, ${color} 4px, ${color}66 4px, ${color}66 8px)`,
                        }}
                      />
                    </span>
                    {(!s.published || pending.has(s.id) || conflicts.has(s.id)) && (
                      <span className="mt-1 flex flex-wrap gap-1.5">
                        {!s.published && <Pill>Draft</Pill>}
                        {pending.has(s.id) && <Pill tone="orange">{pending.get(s.id)?.type === 'pickup' ? 'Pickup waiting for the owner' : 'Change waiting for the owner'}</Pill>}
                        {conflicts.has(s.id) && <Pill tone="red">{conflicts.get(s.id)?.includes('time off') ? 'Has time off' : 'Double-booked'}</Pill>}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </section>
      )}

      {off.length > 0 && (
        <Group header="Time Off">
          {off.map((t) => (
            <Row key={t.id} icon="sun" iconBg="#ff9500" title={t.user === me.id ? 'You' : userName(t.user)} subtitle={KIND_LABEL[t.kind]} />
          ))}
        </Group>
      )}

      {canAdd && (
        <Button size="lg" full icon="plus" onClick={onAdd}>
          Add Shift This Day
        </Button>
      )}
    </Sheet>
  )
}

// ---------- create / edit shift (managers) ----------
function ShiftEditor({
  shift,
  day,
  presetUser,
  weekShifts,
  timeOff,
  onClose,
  onSaved,
}: {
  shift?: Shift
  day: Date
  presetUser?: string
  weekShifts: Shift[]
  timeOff: TimeOff[]
  onClose: () => void
  onSaved: () => void
}) {
  const { me, users, positions, sections, myLocations, currentLocation, userName } = useData()
  const s0 = shift ? d(shift.starts_at)! : null
  const e0 = shift ? d(shift.ends_at)! : null
  const [f, setF] = useState({
    date: toDateInput(s0 || day),
    start: s0 ? toTimeInput(s0) : '20:00',
    end: e0 ? toTimeInput(e0) : '03:00',
    user: shift ? shift.user : presetUser || '',
    position: shift?.position || users.find((u) => u.id === presetUser)?.positions?.[0] || '',
    section: shift?.section || '',
    location: shift?.location || currentLocation?.id || myLocations[0]?.id || '',
    notes: shift?.notes || '',
    published: shift?.published ?? false,
  })
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))

  const start = fromInputs(f.date, f.start)
  let end = fromInputs(f.date, f.end)
  if (end <= start) end = new Date(end.getTime() + DAY)
  const overnight = !sameDay(start, end)

  const warnings: string[] = []
  if (f.user) {
    weekShifts
      .filter((o) => o.id !== shift?.id && o.user === f.user && d(o.starts_at)! < end && d(o.ends_at)! > start)
      .forEach((o) => warnings.push(`${userName(f.user)} already works ${fmtShift(o)}.`))
    timeOff.filter((t) => t.user === f.user && d(t.starts_at)! < end && d(t.ends_at)! > start).forEach(() => warnings.push(`${userName(f.user)} has approved time off.`))
  }

  const locked = !!shift && !isAdmin(me) && shift.published

  const save = async () => {
    setBusy(true)
    try {
      const body: Record<string, unknown> = {
        location: f.location,
        section: f.section,
        position: f.position,
        user: f.user,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        notes: f.notes,
      }
      if (isAdmin(me)) body.published = f.published
      if (shift) await pb.collection('shifts').update(shift.id, body)
      else await pb.collection('shifts').create(body)
      toast(shift ? 'Shift updated' : 'Shift added')
      onSaved()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!shift || !(await ask({ title: 'Delete this shift?', message: shift.published && shift.user ? "They'll get a notification that it was cancelled." : undefined, confirm: 'Delete', destructive: true }))) return
    setBusy(true)
    try {
      await pb.collection('shifts').delete(shift.id)
      toast('Shift deleted')
      onSaved()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const people = [{ value: '', label: 'Open Shift' }].concat(
    users.filter((u) => u.active && (worksAt(u, f.location) || u.id === f.user)).map((u) => ({ value: u.id, label: u.name || u.email })),
  )

  return (
    <Sheet title={shift ? 'Edit Shift' : 'New Shift'} onClose={onClose} onDone={save} doneLabel={shift ? 'Save' : 'Add'} doneDisabled={locked} busy={busy}>
      {locked && (
        <Banner tone="orange" icon="info">
          This shift is published. Only the owner or an admin can change it.
        </Banner>
      )}
      <Group footer={`${fmtHours(hoursBetween(start, end))}${overnight ? ' · ends the next day' : ''}`}>
        <InputRow label="Date" type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
        <InputRow label="Starts" type="time" value={f.start} onChange={(e) => set('start', e.target.value)} />
        <InputRow label="Ends" type="time" value={f.end} onChange={(e) => set('end', e.target.value)} />
      </Group>
      <Group footer={f.user ? undefined : 'An open shift is posted for anyone on the team to pick up.'}>
        <SelectRow
          label="Who"
          value={f.user}
          options={people}
          onChange={(v) => {
            const u = users.find((x) => x.id === v)
            setF((x) => ({ ...x, user: v, position: x.position || u?.positions?.[0] || '' }))
          }}
        />
        <SelectRow
          label="Position"
          value={f.position}
          onChange={(v) => set('position', v)}
          options={[{ value: '', label: 'None' }].concat(positions.filter((p) => p.active || p.id === f.position).map((p) => ({ value: p.id, label: p.name })))}
        />
        <SelectRow
          label="Section"
          value={f.section}
          onChange={(v) => set('section', v)}
          options={[{ value: '', label: 'None' }].concat(sections.filter((s) => s.location === f.location).map((s) => ({ value: s.id, label: s.name })))}
        />
        {myLocations.length > 1 && (
          <SelectRow label="Location" value={f.location} onChange={(v) => setF((x) => ({ ...x, location: v, section: '' }))} options={myLocations.map((l) => ({ value: l.id, label: l.name }))} />
        )}
      </Group>
      <Group>
        <InputRow placeholder="Notes (optional)" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
      </Group>
      {warnings.map((w) => (
        <Banner key={w} tone="orange">
          {w}
        </Banner>
      ))}
      {isAdmin(me) ? (
        <Group footer="Published shifts are visible to the team, and the person gets a notification.">
          <SwitchRow label="Published" checked={f.published} onChange={(v) => set('published', v)} />
        </Group>
      ) : (
        <p className="px-4 text-[13px] text-ios-label2">You're creating a draft. The owner or an admin publishes it.</p>
      )}
      {shift && !locked && (
        <Group>
          <Row title="Delete Shift" tone="destructive" center onClick={remove} />
        </Group>
      )}
    </Sheet>
  )
}

// ---------- ask for a change to my shift ----------
const CHANGE_OPTIONS: { v: 'cover' | 'swap' | 'drop'; t: string; s: string; icon: IconName; bg: string }[] = [
  { v: 'cover', t: 'Get it covered', s: 'Someone else works it for you', icon: 'person', bg: '#007aff' },
  { v: 'swap', t: 'Swap shifts', s: "Trade with someone else's shift", icon: 'swap', bg: '#5856d6' },
  { v: 'drop', t: 'Drop it', s: 'It becomes an open shift', icon: 'hand', bg: '#ff9500' },
]

function ChangeSheet({ shift, onClose, onDone }: { shift: Shift; onClose: () => void; onDone: () => void }) {
  const { me, users, userName, position } = useData()
  const [type, setType] = useState<'cover' | 'swap' | 'drop'>('cover')
  const [target, setTarget] = useState('')
  const [targetShift, setTargetShift] = useState('')
  const [note, setNote] = useState('')
  const [options, setOptions] = useState<Shift[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (type !== 'swap' || options) return
    const now = new Date()
    pb.collection('shifts')
      .getFullList<Shift>({
        filter: pb.filter('published = true && user != "" && user != {:me} && starts_at > {:now} && starts_at < {:max}', { me: me.id, now, max: addDays(now, 21) }),
        sort: 'starts_at',
      })
      .then(setOptions)
      .catch(() => setOptions([]))
  }, [type, options, me.id])

  const submit = async () => {
    setBusy(true)
    try {
      await api('/api/ch/requests', { type, shift: shift.id, target_user: type === 'cover' ? target : '', target_shift: type === 'swap' ? targetShift : '', note })
      toast(type === 'drop' ? 'Sent to the owner' : 'Request sent')
      onDone()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Change Shift" onClose={onClose} onDone={submit} doneLabel="Send" doneDisabled={type === 'swap' && !targetShift} busy={busy}>
      <Group>
        <Row
          leading={<span className="h-10 w-[5px] shrink-0 rounded-full" style={{ background: position(shift.position)?.color || '#8e8e93' }} />}
          title={<span className="font-semibold">{fmtShift(shift)}</span>}
          subtitle={position(shift.position)?.name}
        />
      </Group>
      <Group header="What do you need?">
        {CHANGE_OPTIONS.map((o) => (
          <Row key={o.v} icon={o.icon} iconBg={o.bg} title={o.t} subtitle={o.s} check={type === o.v} onClick={() => setType(o.v)} />
        ))}
      </Group>
      {type === 'cover' && (
        <Group footer={target ? 'They get a notification to accept.' : 'Everyone on the team gets a notification.'}>
          <SelectRow
            label="Ask"
            value={target}
            onChange={setTarget}
            options={[{ value: '', label: 'Anyone' }].concat(users.filter((u) => u.active && u.id !== me.id && worksAt(u, shift.location)).map((u) => ({ value: u.id, label: u.name || u.email })))}
          />
        </Group>
      )}
      {type === 'swap' && (
        <Group footer="Shifts from the next 3 weeks.">
          {!options ? (
            <Spinner />
          ) : options.length === 0 ? (
            <Row title={<span className="text-ios-label2">No shifts to swap with</span>} />
          ) : (
            <SelectRow
              label="Swap for"
              value={targetShift}
              onChange={setTargetShift}
              options={[{ value: '', label: 'Choose a shift' }].concat(options.map((o) => ({ value: o.id, label: `${userName(o.user)} · ${fmtShift(o)}` })))}
            />
          )}
        </Group>
      )}
      <Group footer="The owner always gives final approval. Until then, the shift is still yours.">
        <InputRow placeholder="Add a note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      </Group>
      <Button size="lg" full busy={busy} disabled={type === 'swap' && !targetShift} onClick={submit}>
        Send Request
      </Button>
    </Sheet>
  )
}

function PickupSheet({ shift, onClose, onDone }: { shift: Shift; onClose: () => void; onDone: () => void }) {
  const { position, section } = useData()
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      await api('/api/ch/requests', { type: 'pickup', shift: shift.id })
      toast('Requested. The owner will approve it.')
      onDone()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet title="Open Shift" onClose={onClose}>
      <div className="flex flex-col items-center text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-ios-blue/12 text-ios-blue">
          <Icon name="calendar" size={30} />
        </span>
        <h3 className="mt-3 text-[20px] font-bold">{fmtShift(shift)}</h3>
        <p className="mt-1 text-[15px] text-ios-label2">{[position(shift.position)?.name, section(shift.section)?.name].filter(Boolean).join(' · ') || 'Open shift'}</p>
      </div>
      <Button size="lg" full busy={busy} onClick={submit}>
        I Want This Shift
      </Button>
      <p className="px-4 text-center text-[13px] text-ios-label2">The owner will approve it.</p>
    </Sheet>
  )
}
