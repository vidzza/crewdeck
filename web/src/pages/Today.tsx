import { useCallback, useEffect, useState } from 'react'
import { pb, api, errMsg, isAdmin, isMgr, isNotFound, type Shift, type Timecard } from '../lib/pb'
import { d, fmtDay, fmtDayLong, fmtHours, fmtRange, fmtTime, hoursBetween } from '../lib/dates'
import { getPosition, GEO_LABEL, GEO_TONE, type Pos } from '../lib/geo'
import { useData } from '../store'
import { InstallSheet, isIOS, isStandalone, LocationPicker, NotifyCard, TopActions } from '../chrome'
import { Avatar, Button, Card, Group, Page, Pill, Row, Sheet, TextRow, toast } from '../ui'
import { Icon } from '../icons'

interface ClockRes {
  ok: boolean
  needReason?: boolean
  geo: string
  dist: number | null
  radius: number | null
  place: string | null
  hours?: number
}

function getHideTip() {
  try {
    return localStorage.getItem('hideInstallTip') === '1'
  } catch {
    return false
  }
}

export default function Today() {
  const { me, userName, position, section } = useData()
  const [card, setCard] = useState<Timecard | null | undefined>(undefined)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [reasonFor, setReasonFor] = useState<{ res: ClockRes; pos: Pos | null } | null>(null)
  const [install, setInstall] = useState(false)
  const [hideTip, setHideTip] = useState(getHideTip)
  const [, tick] = useState(0)

  const load = useCallback(async () => {
    try {
      setCard(await pb.collection('timecards').getFirstListItem<Timecard>(pb.filter('user = {:u} && clock_out = ""', { u: me.id })))
    } catch (e) {
      if (isNotFound(e)) setCard(null)
    }
    const r = await pb
      .collection('shifts')
      .getList<Shift>(1, 5, { filter: pb.filter('user = {:u} && published = true && ends_at >= {:now}', { u: me.id, now: new Date() }), sort: 'starts_at' })
      .catch(() => null)
    if (r) setShifts(r.items)
  }, [me.id])

  useEffect(() => {
    load()
    const t = setInterval(() => tick((x) => x + 1), 20000)
    return () => clearInterval(t)
  }, [load])

  const clock = async (kind: 'in' | 'out', reason?: string, knownPos?: Pos | null) => {
    setBusy(kind)
    try {
      let pos = knownPos ?? null
      if (knownPos === undefined) {
        const g = await getPosition()
        pos = g.pos
        if (!pos && g.error) toast(g.error, 'info')
      }
      const res = await api<ClockRes>(`/api/ch/clock/${kind}`, { ...(pos || {}), reason })
      if (res.needReason) {
        setReasonFor({ res, pos })
        return
      }
      setReasonFor(null)
      toast(kind === 'in' ? "You're clocked in" : `Clocked out · ${fmtHours(res.hours || 0)} worked`)
      await load()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const toggleBreak = async () => {
    setBusy('break')
    try {
      const r = await api<{ onBreak: boolean }>('/api/ch/clock/break')
      toast(r.onBreak ? 'Enjoy your break' : 'Welcome back')
      await load()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const dismissTip = () => {
    setHideTip(true)
    try {
      localStorage.setItem('hideInstallTip', '1')
    } catch {
      /* ignore */
    }
  }

  const now = new Date()
  const onBreak = !!card?.break_started_at
  const worked = card ? hoursBetween(card.clock_in, null) - (card.break_min || 0) / 60 : 0
  const next = shifts[0]
  const firstName = (me.name || '').split(' ')[0]

  return (
    <Page title={firstName ? `Hi, ${firstName}` : 'Today'} eyebrow={fmtDayLong(now)} actions={<TopActions />}>
      {isAdmin(me) && <SetupChecklist />}

      <NotifyCard />

      {!isStandalone() && !hideTip && (
        <Card className="flex items-center gap-3">
          <img src="./icon.svg" alt="" className="h-11 w-11 rounded-[10px]" />
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setInstall(true)}>
            <div className="text-[15px] font-semibold">Add Crewdeck to your Home Screen{isIOS() ? ' to get notifications' : ''}</div>
            <div className="text-[13px] text-ios-blue">Show me how</div>
          </button>
          <button type="button" aria-label="Dismiss" onClick={dismissTip} className="flex h-8 w-8 items-center justify-center rounded-full bg-ios-fill text-ios-label2">
            <Icon name="xmark" size={14} stroke={2.6} />
          </button>
        </Card>
      )}

      {/* Clock card */}
      <Card className="px-5 py-7 text-center">
        {card === undefined ? (
          <div className="h-[220px]" />
        ) : card ? (
          <>
            <div className={`flex items-center justify-center gap-2 text-[15px] font-semibold ${onBreak ? 'text-ios-orange' : 'text-ios-green'}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${onBreak ? 'bg-ios-orange' : 'animate-pulse bg-ios-green'}`} />
              {onBreak ? 'On Break' : 'Clocked In'}
            </div>
            <div className="tabular mt-2 text-[54px] font-bold leading-none tracking-tight">{fmtHours(Math.max(0, worked))}</div>
            <div className="mt-2 text-[15px] text-ios-label2">since {fmtTime(card.clock_in)}</div>
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              <Pill tone={GEO_TONE[card.in_geo] || 'gray'}>
                {GEO_LABEL[card.in_geo] || '—'}
                {card.in_dist ? ` · ${card.in_dist} m` : ''}
              </Pill>
              {card.break_min > 0 && <Pill>{card.break_min} min break</Pill>}
              {card.flagged && <Pill tone="orange">Needs review</Pill>}
            </div>
            <div className="mt-7 grid grid-cols-2 gap-3">
              <Button variant="gray" size="lg" icon="cup" busy={busy === 'break'} disabled={!!busy} onClick={toggleBreak}>
                {onBreak ? 'End Break' : 'Break'}
              </Button>
              <Button variant="red" size="lg" busy={busy === 'out'} disabled={!!busy} onClick={() => clock('out')}>
                Clock Out
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="text-[15px] font-semibold text-ios-label2">Not Clocked In</div>
            <div className="tabular mt-2 text-[54px] font-bold leading-none tracking-tight">{fmtTime(now)}</div>
            <div className="mt-2 text-[15px] text-ios-label2">
              {next ? (
                <>
                  Next shift: {d(next.starts_at)! <= now ? 'now' : `${fmtDay(next.starts_at)}, ${fmtTime(next.starts_at)}`}
                </>
              ) : (
                'No upcoming shifts'
              )}
            </div>
            <Button variant="green" size="xl" full className="mt-7" busy={busy === 'in'} disabled={!!busy} onClick={() => clock('in')}>
              Clock In
            </Button>
            <p className="mt-3 text-[13px] text-ios-label2">We check your location once to confirm you're at work.</p>
          </>
        )}
      </Card>

      <Group header="Upcoming Shifts" headerRight={<a href="#/schedule" className="text-ios-blue normal-case">See All</a>}>
        {shifts.length === 0 ? (
          <Row title={<span className="text-ios-label2">No upcoming shifts</span>} />
        ) : (
          shifts.map((s) => (
            <Row
              key={s.id}
              leading={<span className="h-9 w-[5px] shrink-0 rounded-full" style={{ background: position(s.position)?.color || '#8e8e93' }} />}
              title={
                <span className="font-semibold">
                  {fmtDay(s.starts_at)} · {fmtRange(s.starts_at, s.ends_at)}
                </span>
              }
              subtitle={[position(s.position)?.name, section(s.section)?.name, s.notes].filter(Boolean).join(' · ') || undefined}
              accessory={d(s.starts_at)! <= now ? <Pill tone="green">Now</Pill> : undefined}
            />
          ))
        )}
      </Group>

      {isMgr(me) && <ManagerPanel userName={userName} />}

      {reasonFor && (
        <ReasonSheet
          res={reasonFor.res}
          busy={busy === 'in'}
          onClose={() => setReasonFor(null)}
          onRetry={() => {
            setReasonFor(null)
            clock('in')
          }}
          onSubmit={(reason) => clock('in', reason, reasonFor.pos)}
        />
      )}
      {install && <InstallSheet onClose={() => setInstall(false)} />}
    </Page>
  )
}

function ReasonSheet({ res, busy, onClose, onRetry, onSubmit }: { res: ClockRes; busy: boolean; onClose: () => void; onRetry: () => void; onSubmit: (r: string) => void }) {
  const [reason, setReason] = useState('')
  const outside = res.geo === 'outside'
  return (
    <Sheet title="Clock In" onClose={onClose}>
      <div className="flex flex-col items-center text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-ios-orange/15 text-ios-orange">
          <Icon name="pin" size={32} />
        </span>
        <h3 className="mt-3 text-[20px] font-bold">{outside ? `You're not at ${res.place || 'work'}` : "We can't find your location"}</h3>
        <p className="mt-1 text-[15px] text-ios-label2">
          {outside
            ? `You seem to be ${res.dist} m away.`
            : res.geo === 'low_accuracy'
              ? 'Your GPS signal is too weak right now.'
              : !window.isSecureContext
                ? 'Location only works on a secure (https://) link.'
                : 'Location is off or unavailable on this phone.'}
        </p>
      </div>
      <Button variant="tinted" size="lg" full icon="location" onClick={onRetry}>
        Try Again
      </Button>
      <Group header="Or clock in anyway" footer="Tell us why. The owner or an admin will review it.">
        <TextRow value={reason} onChange={setReason} placeholder="e.g. Picking up supplies for work" rows={2} />
      </Group>
      <Button variant="green" size="lg" full busy={busy} disabled={reason.trim().length < 3} onClick={() => onSubmit(reason.trim())}>
        Clock In Anyway
      </Button>
    </Sheet>
  )
}

function ManagerPanel({ userName }: { userName: (id: string) => string }) {
  const { me, myLocations, currentLocation } = useData()
  const multi = myLocations.length > 1
  const [open, setOpen] = useState<Timecard[]>([])
  const [counts, setCounts] = useState({ requests: 0, timeoff: 0, flagged: 0 })

  useEffect(() => {
    const load = async () => {
      const [o, rq, to, fl] = await Promise.all([
        pb.collection('timecards').getFullList<Timecard>({ filter: 'clock_out = ""', sort: 'clock_in' }),
        pb.collection('shift_requests').getList(1, 1, { filter: 'status = "pending_admin"' }),
        pb.collection('time_off').getList(1, 1, { filter: 'status = "pending"' }),
        pb.collection('timecards').getList(1, 1, { filter: 'flagged = true && approved = false' }),
      ])
      setOpen(o.filter((c) => !multi || !currentLocation || c.location === currentLocation.id))
      setCounts({ requests: rq.totalItems, timeoff: to.totalItems, flagged: fl.totalItems })
    }
    load().catch(() => {})
    const t = setInterval(() => load().catch(() => {}), 60000)
    return () => clearInterval(t)
  }, [multi, currentLocation])

  const badge = (n: number) => (n ? <span className="rounded-full bg-ios-red px-2 py-[1px] text-[15px] font-semibold text-white">{n}</span> : <span className="text-ios-label2">0</span>)

  return (
    <>
      <Group header="Needs Your Attention">
        {isAdmin(me) && <Row icon="swap" iconBg="#007aff" title="Shift changes to approve" accessory={badge(counts.requests)} chevron href="#/requests" />}
        {isAdmin(me) && <Row icon="sun" iconBg="#ff9500" title="Time off to approve" accessory={badge(counts.timeoff)} chevron href="#/timeoff" />}
        <Row icon="alert" iconBg="#ff3b30" title="Clock-ins to review" accessory={badge(counts.flagged)} chevron href="#/hours" />
      </Group>
      <LocationPicker />
      <Group header={`Working Now${multi && currentLocation ? ` at ${currentLocation.name}` : ''} · ${open.length}`}>
        {open.length === 0 ? (
          <Row title={<span className="text-ios-label2">Nobody is clocked in</span>} />
        ) : (
          open.map((c) => (
            <Row
              key={c.id}
              leading={<Avatar name={userName(c.user)} size={36} />}
              title={userName(c.user)}
              subtitle={`Since ${fmtTime(c.clock_in)} · ${fmtHours(hoursBetween(c.clock_in, null))}${c.break_started_at ? ' · on break' : ''}`}
              accessory={<Pill tone={GEO_TONE[c.in_geo] || 'gray'}>{GEO_LABEL[c.in_geo] || '—'}</Pill>}
            />
          ))
        )}
      </Group>
    </>
  )
}

// ---------- "Get set up" checklist for owners and admins (like Homebase's quick start) ----------
const HIDE_SETUP = 'crewdeck-hide-setup'
function SetupChecklist() {
  const { me, users, locations } = useData()
  const [counts, setCounts] = useState<{ shifts: number; published: number } | null>(null)
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDE_SETUP) === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    Promise.all([pb.collection('shifts').getList(1, 1), pb.collection('shifts').getList(1, 1, { filter: 'published = true' })])
      .then(([a, b]) => setCounts({ shifts: a.totalItems, published: b.totalItems }))
      .catch(() => {})
  }, [])
  if (hidden || !counts) return null
  const others = users.filter((u) => u.id !== me.id && u.active)
  const steps = [
    { done: true, title: 'Create your company', href: '#/settings' },
    {
      done: locations.length > 0 && locations.every((l) => l.active === false || l.lat || l.lng),
      title: 'Set your time clock spot',
      sub: 'Stand at work and save the spot',
      href: locations.length === 1 ? `#/settings/locations/${locations[0].id}` : '#/settings/locations',
    },
    { done: others.length > 0, title: 'Add your team', sub: 'Name and phone is enough', href: '#/settings/team' },
    { done: others.some((u) => !!u.joined_at), title: 'Invite them to the app', sub: 'Send each person their link', href: '#/settings/team' },
    { done: counts.shifts > 0, title: 'Build your first schedule', href: '#/schedule' },
    { done: counts.published > 0, title: 'Publish it', sub: 'Everyone on it gets notified', href: '#/schedule' },
  ]
  const done = steps.filter((x) => x.done).length
  if (done === steps.length) return null
  const hide = () => {
    setHidden(true)
    try {
      localStorage.setItem(HIDE_SETUP, '1')
    } catch {
      /* ignore */
    }
  }
  return (
    <section>
      <div className="mb-1.5 flex items-end justify-between px-4">
        <h2 className="text-[13px] uppercase tracking-wide text-ios-label2">
          Get Set Up · {done} of {steps.length}
        </h2>
        <button type="button" onClick={hide} className="text-[13px] text-ios-blue">
          Hide
        </button>
      </div>
      <div className="overflow-hidden rounded-xl bg-white">
        <div className="h-1 bg-ios-gray5">
          <div className="h-1 bg-ios-green transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
        {steps.map((x) => (
          <Row
            key={x.title}
            href={x.done ? undefined : x.href}
            chevron={!x.done}
            leading={
              <span className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full ${x.done ? 'bg-ios-green text-white' : 'border-2 border-ios-gray3'}`}>
                {x.done && <Icon name="check" size={15} stroke={3} />}
              </span>
            }
            title={<span className={x.done ? 'text-ios-label2 line-through' : 'font-medium'}>{x.title}</span>}
            subtitle={!x.done ? x.sub : undefined}
          />
        ))}
      </div>
    </section>
  )
}

