import { useCallback, useEffect, useMemo, useState } from 'react'
import { pb, api, errMsg, isAdmin, isMgr, type Shift, type ShiftRequest, type TimeOff } from '../lib/pb'
import {
  addDays,
  d,
  DAY,
  fmtDayLong,
  fmtHours,
  fmtRange,
  fmtShift,
  fromInputs,
  hoursBetween,
  sameDay,
  startOfDay,
  startOfWeek,
  toDateInput,
  toTimeInput,
  weekdayLetter,
} from '../lib/dates'
import { useData } from '../store'
import { LocationPicker, TopActions, WeekBar } from '../chrome'
import type { User } from '../lib/pb'
import { Banner, Button, Group, HeaderButton, InputRow, Page, Pill, Row, Segmented, SelectRow, Sheet, Spinner, SwitchRow, toast } from '../ui'
import { Icon, type IconName } from '../icons'

// Owners and admins work everywhere; people with no locations yet are treated the same.
function worksAt(u: User, locId: string) {
  return !locId || u.access === 'owner' || u.access === 'admin' || !u.locations?.length || u.locations.includes(locId)
}

const KIND_LABEL: Record<string, string> = { vacation: 'Vacation', sick: 'Sick', personal: 'Personal', unpaid: 'Unpaid' }

export default function Schedule() {
  const { me, users, userName, position, section, currentLocation } = useData()
  const locId = currentLocation?.id || ''
  const [week, setWeek] = useState(() => startOfWeek(new Date()))
  const [dayIdx, setDayIdx] = useState(() => (new Date().getDay() + 6) % 7)
  const [mode, setMode] = useState<'mine' | 'team'>(isMgr(me) ? 'team' : 'mine')
  const [shifts, setShifts] = useState<Shift[] | null>(null)
  const [timeOff, setTimeOff] = useState<TimeOff[]>([])
  const [pending, setPending] = useState<Map<string, ShiftRequest>>(new Map())
  const [edit, setEdit] = useState<{ shift?: Shift; day: Date } | null>(null)
  const [change, setChange] = useState<Shift | null>(null)
  const [pickup, setPickup] = useState<Shift | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const f = week
    const t = addDays(week, 7)
    const [s, to, rq] = await Promise.all([
      pb.collection('shifts').getFullList<Shift>({ filter: pb.filter('starts_at >= {:f} && starts_at < {:t}', { f, t }), sort: 'starts_at' }),
      pb
        .collection('time_off')
        .getFullList<TimeOff>({ filter: pb.filter('status = "approved" && starts_at < {:t} && ends_at > {:f}', { f, t }) })
        .catch(() => []),
      pb
        .collection('shift_requests')
        .getFullList<ShiftRequest>({ filter: 'status = "pending_peer" || status = "pending_admin"' })
        .catch(() => []),
    ])
    setShifts(s)
    setTimeOff(to)
    const m = new Map<string, ShiftRequest>()
    rq.forEach((r) => {
      m.set(r.shift, r)
      if (r.target_shift) m.set(r.target_shift, r)
    })
    setPending(m)
  }, [week])

  useEffect(() => {
    setShifts(null)
    load().catch((e) => toast(errMsg(e), 'error'))
  }, [load])

  const now = new Date()
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week])
  const day = days[dayIdx]
  const here = (shifts || []).filter((s) => !locId || s.location === locId)
  const visible = here.filter((s) => mode === 'team' || s.user === me.id || !s.user)
  const staffHere = new Set(users.filter((u) => worksAt(u, locId)).map((u) => u.id))
  const dayShifts = visible.filter((s) => sameDay(d(s.starts_at)!, day))
  const dayOff = timeOff.filter((t) => staffHere.has(t.user) && d(t.starts_at)! < addDays(day, 1) && d(t.ends_at)! > day)
  const drafts = here.filter((s) => !s.published).length
  const canEdit = (s: Shift) => isAdmin(me) || (me.access === 'manager' && !s.published)

  const onShiftTap = (s: Shift) => {
    const future = d(s.starts_at)! > now
    if (canEdit(s)) return setEdit({ shift: s, day: startOfDay(d(s.starts_at)!) })
    if (!future || !s.published) return
    if (pending.has(s.id)) return toast('This shift already has a change waiting for approval.', 'info')
    if (s.user === me.id) return setChange(s)
    if (!s.user) return setPickup(s)
  }

  const copyWeek = async () => {
    if (!confirm("Copy last week's shifts into this week? They'll be added as drafts.")) return
    setBusy('copy')
    try {
      const r = await api<{ copied: number }>('/api/ch/schedule/copy', { from: addDays(week, -7).toISOString(), to: week.toISOString(), location: locId })
      toast(r.copied ? `Copied ${r.copied} shifts` : 'Last week had no shifts', r.copied ? 'ok' : 'info')
      await load()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const publish = async () => {
    if (!confirm(`Publish ${drafts} shift${drafts === 1 ? '' : 's'}? Everyone on the schedule gets notified.`)) return
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

  const totals = useMemo(() => {
    const m = new Map<string, number>()
    here.forEach((s) => s.user && m.set(s.user, (m.get(s.user) || 0) + hoursBetween(s.starts_at, s.ends_at)))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [here])
  const ot = currentLocation?.ot_weekly_hours || 40

  return (
    <Page
      title="Schedule"
      actions={<TopActions>{isMgr(me) && <HeaderButton icon="plus" label="Add shift" onClick={() => setEdit({ day: startOfDay(day) })} />}</TopActions>}
    >
      <div className="space-y-3">
        <LocationPicker />
        <WeekBar week={week} onChange={setWeek} />
        {/* Week strip, like Apple Calendar */}
        <div className="grid grid-cols-7 rounded-2xl bg-white px-1 py-2">
          {days.map((x, i) => {
            const isToday = sameDay(x, now)
            const sel = i === dayIdx
            const has = visible.some((s) => sameDay(d(s.starts_at)!, x))
            return (
              <button key={i} type="button" onClick={() => setDayIdx(i)} className="flex flex-col items-center gap-1 py-1" aria-label={fmtDayLong(x)}>
                <span className={`text-[11px] font-semibold ${isToday ? 'text-ios-red' : 'text-ios-label2'}`}>{weekdayLetter(x)}</span>
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-[19px] ${
                    sel ? (isToday ? 'bg-ios-red font-semibold text-white' : 'bg-black font-semibold text-white') : isToday ? 'font-semibold text-ios-red' : ''
                  }`}
                >
                  {x.getDate()}
                </span>
                <span className={`h-[5px] w-[5px] rounded-full ${has ? 'bg-ios-gray' : 'bg-transparent'}`} />
              </button>
            )
          })}
        </div>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'mine', label: 'My Shifts' },
            { value: 'team', label: 'Everyone' },
          ]}
        />
      </div>

      {isAdmin(me) && drafts > 0 && (
        <Banner tone="blue" icon="send" onClick={publish}>
          <b>
            {drafts} draft shift{drafts === 1 ? '' : 's'}
          </b>{' '}
          {drafts === 1 ? "isn't" : "aren't"} visible to the team yet. {busy === 'publish' ? 'Publishing…' : 'Tap to publish this week.'}
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
        <Group header={fmtDayLong(day)}>
          {dayOff.map((t) => (
            <Row key={t.id} icon="sun" iconBg="#ff9500" title={userName(t.user)} subtitle={`Time off · ${KIND_LABEL[t.kind]}`} />
          ))}
          {dayShifts.length === 0 && dayOff.length === 0 && <Row title={<span className="text-ios-label2">No shifts</span>} />}
          {dayShifts.map((s) => {
            const pos = position(s.position)
            const mine = s.user === me.id
            const future = d(s.starts_at)! > now
            return (
              <Row
                key={s.id}
                onClick={() => onShiftTap(s)}
                leading={<span className="h-10 w-[5px] shrink-0 rounded-full" style={{ background: pos?.color || '#8e8e93', opacity: s.published ? 1 : 0.4 }} />}
                title={<span className="tabular font-semibold">{fmtRange(s.starts_at, s.ends_at)}</span>}
                subtitle={
                  <>
                    <span className={!s.user ? 'font-semibold text-ios-blue' : mine ? 'font-semibold text-black' : ''}>{s.user ? (mine ? 'You' : userName(s.user)) : 'Open Shift'}</span>
                    {[pos?.name, section(s.section)?.name].filter(Boolean).map((x) => ` · ${x}`)}
                    {s.notes ? ` · ${s.notes}` : ''}
                  </>
                }
                accessory={
                  <span className="flex flex-col items-end gap-1">
                    {!s.published && <Pill>Draft</Pill>}
                    {pending.has(s.id) && <Pill tone="orange">Change pending</Pill>}
                    {!s.user && s.published && future && !isMgr(me) && <Pill tone="blue">Pick up</Pill>}
                  </span>
                }
                chevron={canEdit(s) || (s.published && future && (mine || !s.user) && !pending.has(s.id))}
              />
            )
          })}
        </Group>
      )}

      {isMgr(me) && (
        <Group>
          <Row icon="plus" iconBg="#007aff" title="Add Shift" tone="link" onClick={() => setEdit({ day: startOfDay(day) })} />
          <Row icon="copy" iconBg="#8e8e93" title={busy === 'copy' ? 'Copying…' : 'Copy Last Week'} tone="link" onClick={copyWeek} />
        </Group>
      )}

      {isMgr(me) && mode === 'team' && totals.length > 0 && (
        <Group header="Hours This Week" footer={`Overtime starts after ${ot} hours a week.`}>
          {totals.map(([uid, h]) => (
            <Row key={uid} title={userName(uid)} value={<span className={h > ot ? 'font-semibold text-ios-orange' : ''}>{fmtHours(h)}</span>} />
          ))}
        </Group>
      )}

      {!isMgr(me) && (
        <p className="px-4 text-center text-[13px] text-ios-label2">Tap one of your shifts to swap it, get it covered or drop it. The owner or an admin always gives final approval.</p>
      )}

      {edit && (
        <ShiftEditor
          shift={edit.shift}
          day={edit.day}
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
}

// ---------- create / edit shift (managers) ----------
function ShiftEditor({
  shift,
  day,
  weekShifts,
  timeOff,
  onClose,
  onSaved,
}: {
  shift?: Shift
  day: Date
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
    user: shift?.user || '',
    position: shift?.position || '',
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
    if (!shift || !confirm('Delete this shift?')) return
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
      toast(type === 'drop' ? 'Sent to the owner/admin' : 'Request sent')
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
      <Group footer="The owner or an admin always gives final approval. Until then, the shift is still yours.">
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
      toast('Requested. The owner/admin will approve it.')
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
      <p className="px-4 text-center text-[13px] text-ios-label2">The owner or an admin will approve it.</p>
    </Sheet>
  )
}
