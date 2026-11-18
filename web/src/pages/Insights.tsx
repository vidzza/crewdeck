// Insights (owner/admin): hours, labor cost, overtime and attendance for a week.
// Also the Today summary card and Settings → API Access (read-only keys).
import { useCallback, useEffect, useState } from 'react'
import { pb, errMsg } from '../lib/pb'
import { addDays, fmtDay, fmtTime, startOfWeek, weekdayShort } from '../lib/dates'
import { useData } from '../store'
import { LocationPicker, WeekBar } from '../chrome'
import { Avatar, Button, Card, Dot, Group, InputRow, Page, Pill, Row, Segmented, Sheet, Spinner, toast } from '../ui'
import { Icon, type IconName } from '../icons'

interface Totals {
  scheduledHours: number
  workedHours: number
  overtimeHours: number
  scheduledCost: number
  laborCost: number
  shifts: number
  openShifts: number
  openShiftHours: number
  clockIns: number
  clockedInNow: number
  late: number
  noShows: number
  outside: number
  needsReview: number
  autoClockOuts: number
}
interface PersonRow {
  id: string
  name: string | null
  scheduledHours: number
  workedHours: number
  overtimeHours: number
  cost: number
  hourly: number
  shifts: number
  late: number
  noShows: number
}
interface GroupRow {
  id: string | null
  name: string
  color: string | null
  scheduledHours: number
  workedHours: number
}
export interface InsightsData {
  overtimeAfterHours: number
  hasPayRates: boolean
  totals: Totals
  byDay: { date: string; scheduledHours: number; workedHours: number }[]
  byPerson: PersonRow[]
  byPosition: GroupRow[]
  late: { user: string; name: string; shift_start: string; clock_in: string; minutes_late: number }[]
  noShows: { user: string; name: string; starts_at: string; ends_at: string; location: string }[]
  requests: { total: number; pending: number; approved: number; rejected: number }
  timeOff: { pending: number; approved: number; approvedDays: number }
  team: { active: number; notJoined: number }
}

// Validated pair (CVD-safe, not a warning color): scheduled = teal, worked = blue.
const C_SCHEDULED = '#30b0c7'
const C_WORKED = '#007aff'

const ymd = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
const hrs = (h: number) => (h >= 100 ? Math.round(h).toLocaleString() : (Math.round(h * 10) / 10).toString()) + 'h'
const money = (n: number) => '$' + (n >= 1000 ? Math.round(n).toLocaleString() : n.toFixed(2).replace(/\.00$/, ''))

function useInsights(week: Date) {
  const { currentLocation } = useData()
  const locId = currentLocation?.id || ''
  const [data, setData] = useState<InsightsData | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setError('')
    try {
      const query: Record<string, string> = { from: ymd(week), to: ymd(addDays(week, 7)) }
      if (locId) query.location = locId
      setData(await pb.send<InsightsData>('/api/ch/insights', { method: 'GET', query }))
    } catch (e) {
      setError(errMsg(e))
    }
  }, [week, locId])
  useEffect(() => {
    setData(null)
    load()
  }, [load])
  return { data, error, reload: load }
}

// ---------- Insights page ----------
export default function Insights() {
  const [week, setWeek] = useState(() => startOfWeek(new Date()))
  const { data, error } = useInsights(week)
  return (
    <Page title="Insights" back={{ label: 'Back' }}>
      <WeekBar week={week} onChange={setWeek} />
      <LocationPicker />
      {error ? (
        <p className="px-4 text-center text-[15px] text-ios-red">{error}</p>
      ) : !data ? (
        <Spinner />
      ) : (
        <InsightsBody data={data} />
      )}
    </Page>
  )
}

function Stat({ label, value, sub, icon, alert, href }: { label: string; value: string; sub?: string; icon: IconName; alert?: boolean; href?: string }) {
  const inner = (
    <>
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-ios-label2">
        <Icon name={alert ? 'alert' : icon} size={15} stroke={2.2} className={alert ? 'text-ios-orange' : 'text-ios-label2'} />
        {label}
      </div>
      <div className="tabular mt-1 text-[26px] font-semibold leading-tight tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-[13px] text-ios-label2">{sub}</div>}
    </>
  )
  const cls = 'block rounded-xl bg-white px-4 py-3 text-left'
  return href ? (
    <a href={href} className={`${cls} active:bg-ios-gray5`}>
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
  )
}

function InsightsBody({ data }: { data: InsightsData }) {
  const t = data.totals
  const issues = t.late + t.noShows
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Labor cost"
          icon="tag"
          value={data.hasPayRates ? money(t.laborCost) : '—'}
          sub={data.hasPayRates ? `${money(t.scheduledCost)} scheduled` : 'Add hourly rates in Team'}
          href={data.hasPayRates ? undefined : '#/settings/team'}
        />
        <Stat label="Hours worked" icon="clock" value={hrs(t.workedHours)} sub={`${hrs(t.scheduledHours)} scheduled`} />
        <Stat label="Overtime" icon="sun" value={hrs(t.overtimeHours)} sub={`After ${data.overtimeAfterHours}h a week`} alert={t.overtimeHours > 0} />
        <Stat label="Late clock-ins" icon="clock" value={String(t.late)} sub="5+ minutes late" alert={t.late > 0} />
        <Stat label="No-shows" icon="person" value={String(t.noShows)} sub="Shift with no clock-in" alert={t.noShows > 0} />
        <Stat label="Needs review" icon="doc" value={String(t.needsReview)} sub="Clock-ins to check" alert={t.needsReview > 0} href="#/hours" />
      </div>

      <HoursByDay days={data.byDay} />

      <Group header="Attendance" footer={issues ? undefined : 'Everyone clocked in on time for their shifts.'}>
        {issues === 0 ? (
          <Row icon="check" iconBg="#34c759" title="No late clock-ins or no-shows" />
        ) : (
          <>
            {data.noShows.slice(0, 20).map((n, i) => (
              <Row key={'n' + i} leading={<Avatar name={n.name || '?'} size={32} />} title={n.name} subtitle={`${fmtDay(n.starts_at)}, ${fmtTime(n.starts_at)} · ${n.location}`} accessory={<Pill tone="red">No-show</Pill>} />
            ))}
            {data.late.slice(0, 20).map((l, i) => (
              <Row key={'l' + i} leading={<Avatar name={l.name || '?'} size={32} />} title={l.name} subtitle={`${fmtDay(l.shift_start)} · shift ${fmtTime(l.shift_start)}, in at ${fmtTime(l.clock_in)}`} accessory={<Pill tone="orange">{l.minutes_late} min late</Pill>} />
            ))}
          </>
        )}
      </Group>

      <Group
        header="Team"
        footer={data.hasPayRates ? `Cost uses each person's hourly rate; overtime (after ${data.overtimeAfterHours}h a week) counts at 1.5×.` : 'Add hourly rates in Team to see labor cost.'}
      >
        {data.byPerson.length === 0 ? (
          <Row title={<span className="text-ios-label2">No shifts or clock-ins this week</span>} />
        ) : (
          data.byPerson.map((p) => (
            <Row
              key={p.id}
              leading={<Avatar name={p.name || '?'} size={32} />}
              title={p.name}
              subtitle={[`${hrs(p.workedHours)} of ${hrs(p.scheduledHours)}`, p.overtimeHours ? `${hrs(p.overtimeHours)} overtime` : '', p.late ? `${p.late} late` : '', p.noShows ? `${p.noShows} no-show` : '']
                .filter(Boolean)
                .join(' · ')}
              value={data.hasPayRates && p.hourly ? money(p.cost) : undefined}
            />
          ))
        )}
      </Group>

      {data.byPosition.length > 0 && (
        <Group header="By Position" footer="Hours worked of hours scheduled.">
          {data.byPosition.map((g) => (
            <Row key={g.id || 'none'} leading={<Dot color={g.color || '#8e8e93'} size={12} />} title={g.name} value={`${hrs(g.workedHours)} / ${hrs(g.scheduledHours)}`} />
          ))}
        </Group>
      )}

      <Group header="Requests and Time Off">
        <Row icon="swap" iconBg="#5856d6" title="Shift changes" value={data.requests.pending ? `${data.requests.pending} waiting` : `${data.requests.total}`} href="#/requests" chevron />
        <Row icon="sun" iconBg="#ff9500" title="Time off" value={`${data.timeOff.approvedDays} days off${data.timeOff.pending ? ` · ${data.timeOff.pending} waiting` : ''}`} href="#/timeoff" chevron />
        {data.totals.openShifts > 0 && <Row icon="calendar" iconBg="#30b0c7" title="Open shifts" value={`${data.totals.openShifts} · ${hrs(data.totals.openShiftHours)}`} href="#/schedule" chevron />}
        {data.team.notJoined > 0 && <Row icon="people" iconBg="#007aff" title="Haven't joined yet" value={data.team.notJoined} href="#/settings/team" chevron />}
      </Group>
    </>
  )
}

// Scheduled vs worked per day: columns ≤24px, 4px rounded tops, 2px gap; tap/hover a day for its numbers.
function HoursByDay({ days }: { days: InsightsData['byDay'] }) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [sel, setSel] = useState<number | null>(null)
  const max = Math.max(1, ...days.map((x) => Math.max(x.scheduledHours, x.workedHours)))
  const step = max <= 8 ? 2 : max <= 20 ? 5 : max <= 40 ? 10 : max <= 100 ? 25 : 50
  const top = Math.ceil(max / step) * step
  // Whole-number gridlines (0, 5, 10, 15…), at most 4 of them.
  const all = Array.from({ length: top / step + 1 }, (_, i) => i * step)
  const ticks = all.length > 4 ? all.filter((_, i) => (all.length - 1 - i) % 2 === 0) : all
  const label = (i: number) => {
    const dt = new Date(days[i].date + 'T12:00:00')
    return { short: weekdayShort(dt), long: fmtDay(dt) }
  }
  const focus = sel ?? null
  return (
    <section>
      <div className="mb-1.5 flex items-end justify-between px-4">
        <h3 className="text-[13px] font-normal uppercase tracking-wide text-ios-label2">Hours by Day</h3>
      </div>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-4 text-[13px] text-ios-label2" aria-label="Legend">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: C_SCHEDULED }} />
              Scheduled
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: C_WORKED }} />
              Worked
            </span>
          </div>
          <div className="w-[150px]">
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'chart', label: 'Chart' },
                { value: 'table', label: 'Table' },
              ]}
            />
          </div>
        </div>
        {view === 'chart' ? (
          <>
            <div className="mt-3 h-5 text-[13px] text-ios-label2" aria-live="polite">
              {focus !== null ? (
                <>
                  <span className="font-semibold text-black">{label(focus).long}</span> · {hrs(days[focus].scheduledHours)} scheduled · {hrs(days[focus].workedHours)} worked
                </>
              ) : (
                'Tap a day to see its hours'
              )}
            </div>
            <div className="relative mt-2 flex h-[150px] pl-7">
              {ticks.map((v) => (
                <div key={v} className="pointer-events-none absolute left-0 right-0 flex items-center" style={{ bottom: `${(v / top) * 100}%`, transform: 'translateY(50%)' }}>
                  <span className="tabular w-6 text-right text-[11px] text-ios-label3">{v}</span>
                  <span className="ml-1 h-px flex-1 bg-ios-gray5" />
                </div>
              ))}
              {days.map((x, i) => (
                <button
                  key={x.date}
                  type="button"
                  aria-label={`${label(i).long}: ${hrs(x.scheduledHours)} scheduled, ${hrs(x.workedHours)} worked`}
                  onClick={() => setSel(sel === i ? null : i)}
                  onMouseEnter={() => setSel(i)}
                  className={`relative z-10 flex h-full flex-1 items-end justify-center gap-[2px] rounded-md ${focus === i ? 'bg-ios-gray6' : ''}`}
                >
                  <span className="w-[40%] max-w-[24px] rounded-t-[4px]" style={{ height: `${(x.scheduledHours / top) * 100}%`, background: C_SCHEDULED, minHeight: x.scheduledHours ? 2 : 0 }} />
                  <span className="w-[40%] max-w-[24px] rounded-t-[4px]" style={{ height: `${(x.workedHours / top) * 100}%`, background: C_WORKED, minHeight: x.workedHours ? 2 : 0 }} />
                </button>
              ))}
            </div>
            <div className="mt-1.5 flex pl-7">
              {days.map((x, i) => (
                <span key={x.date} className={`flex-1 text-center text-[11px] ${focus === i ? 'font-semibold text-black' : 'text-ios-label2'}`}>
                  {label(i).short}
                </span>
              ))}
            </div>
          </>
        ) : (
          <table className="tabular mt-3 w-full text-[15px]">
            <thead>
              <tr className="text-left text-[13px] text-ios-label2">
                <th className="py-1 font-normal">Day</th>
                <th className="py-1 text-right font-normal">Scheduled</th>
                <th className="py-1 text-right font-normal">Worked</th>
              </tr>
            </thead>
            <tbody>
              {days.map((x, i) => (
                <tr key={x.date} className="border-t border-ios-sep">
                  <td className="py-2">{label(i).long}</td>
                  <td className="py-2 text-right">{hrs(x.scheduledHours)}</td>
                  <td className="py-2 text-right">{hrs(x.workedHours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </section>
  )
}

// ---------- Today: this week at a glance (owner/admin) ----------
export function InsightsCard() {
  const [week] = useState(() => startOfWeek(new Date()))
  const { data } = useInsights(week)
  if (!data) return null
  const t = data.totals
  const issues = t.late + t.noShows + t.needsReview
  return (
    <a href="#/insights" className="block rounded-2xl bg-white px-4 py-3.5 active:bg-ios-gray5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold uppercase tracking-wide text-ios-label2">This Week</span>
        <span className="flex items-center text-[15px] text-ios-blue">
          Insights <Icon name="chevron-right" size={16} stroke={2.6} />
        </span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <div>
          <div className="tabular text-[22px] font-semibold">{data.hasPayRates ? money(t.laborCost) : hrs(t.scheduledHours)}</div>
          <div className="text-[13px] text-ios-label2">{data.hasPayRates ? 'Labor cost' : 'Scheduled'}</div>
        </div>
        <div>
          <div className="tabular text-[22px] font-semibold">{hrs(t.workedHours)}</div>
          <div className="text-[13px] text-ios-label2">Worked</div>
        </div>
        <div>
          <div className="tabular flex items-center gap-1 text-[22px] font-semibold">
            {issues > 0 && <Icon name="alert" size={18} stroke={2.4} className="text-ios-orange" />}
            {issues}
          </div>
          <div className="text-[13px] text-ios-label2">To check</div>
        </div>
      </div>
    </a>
  )
}

// ---------- Settings → API Access ----------
interface ApiKey {
  id: string
  name: string
  prefix: string
  created: string
  created_by: string | null
  last_used_at: string | null
}

export function ApiAccessPage() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null)
  const [creating, setCreating] = useState(false)
  const load = useCallback(async () => {
    try {
      setKeys((await pb.send<{ items: ApiKey[] }>('/api/ch/api-keys', { method: 'GET' })).items)
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])
  const revoke = async (k: ApiKey) => {
    if (!confirm(`Revoke “${k.name}”? Anything using this key stops working right away.`)) return
    try {
      await pb.send(`/api/ch/api-keys/${k.id}`, { method: 'DELETE' })
      toast('Key revoked')
      load()
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }
  return (
    <Page title="API Access" back={{ label: 'Settings', href: '#/settings' }}>
      <p className="px-4 text-[15px] text-ios-label2">
        A key lets another tool, like Claude or your accountant's spreadsheet, read everything in Crewdeck: schedules, hours, pay and insights. Keys can only read; they can't change anything.
      </p>
      <Group header="Keys" footer="Tap a key to revoke it.">
        {keys === null ? (
          <Row title={<span className="text-ios-label2">Loading…</span>} />
        ) : (
          keys.map((k) => (
            <Row
              key={k.id}
              icon="key"
              iconBg="#8e8e93"
              title={k.name}
              subtitle={`${k.prefix}… · ${k.last_used_at ? `Last used ${fmtDay(k.last_used_at)}` : 'Never used'}`}
              tone={undefined}
              onClick={() => revoke(k)}
            />
          ))
        )}
        <Row icon="plus" iconBg="#007aff" title="Create API Key" tone="link" onClick={() => setCreating(true)} />
      </Group>
      {creating && (
        <CreateKeySheet
          onClose={() => {
            setCreating(false)
            load()
          }}
        />
      )}
    </Page>
  )
}

function CreateKeySheet({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState('')
  const create = async () => {
    if (!name.trim()) return toast('Give the key a name.', 'error')
    setBusy(true)
    try {
      setKey((await pb.send<{ key: string }>('/api/ch/api-keys', { method: 'POST', body: { name: name.trim() } })).key)
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(key)
      toast('Key copied')
    } catch {
      prompt('Copy this key:', key)
    }
  }
  if (key)
    return (
      <Sheet title="New API Key" onClose={onClose} onDone={onClose} doneLabel="Done">
        <div className="flex flex-col items-center text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-ios-green/15 text-ios-green">
            <Icon name="key" size={30} />
          </span>
          <h3 className="mt-3 text-[20px] font-bold">Copy your key now</h3>
          <p className="mt-1 text-[15px] text-ios-label2">For your security it's shown only this once. If you lose it, revoke it and create a new one.</p>
        </div>
        <Group>
          <div className="break-all px-4 py-3 font-mono text-[15px]">{key}</div>
        </Group>
        <Button size="lg" full icon="copy" onClick={copy}>
          Copy Key
        </Button>
      </Sheet>
    )
  return (
    <Sheet title="Create API Key" onClose={onClose} onDone={create} doneLabel="Create" doneDisabled={!name.trim()} busy={busy}>
      <Group footer="A name so you know where it's used, like “Claude” or “Accountant”.">
        <InputRow placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      </Group>
    </Sheet>
  )
}
