import { useCallback, useEffect, useMemo, useState } from 'react'
import { pb, errMsg, isAdmin, isMgr, type PayRate, type Timecard } from '../lib/pb'
import { addDays, d, fmtDay, fmtHours, fmtTime, fmtWeek, hoursBetween, startOfWeek, toLocalInput } from '../lib/dates'
import { GEO_LABEL, GEO_TONE } from '../lib/geo'
import { useData } from '../store'
import { LocationPicker, TopActions, WeekBar } from '../chrome'
import { Avatar, Banner, Card, Empty, Group, HeaderButton, InputRow, Page, Pill, Row, SelectRow, Sheet, Spinner, toast } from '../ui'

const worked = (c: Timecard) => Math.max(0, hoursBetween(c.clock_in, c.clock_out || null) - (c.break_min || 0) / 60)

export default function Hours() {
  const { me, userName, currentLocation, myLocations } = useData()
  const locId = myLocations.length > 1 ? currentLocation?.id || '' : ''
  const [week, setWeek] = useState(() => startOfWeek(new Date()))
  const [cards, setCards] = useState<Timecard[] | null>(null)
  const [rates, setRates] = useState<Map<string, number>>(new Map())
  const [edit, setEdit] = useState<Timecard | 'new' | null>(null)
  const [onlyFlagged, setOnlyFlagged] = useState(false)

  const load = useCallback(async () => {
    const list = await pb.collection('timecards').getFullList<Timecard>({
      filter: pb.filter('clock_in >= {:f} && clock_in < {:t}', { f: week, t: addDays(week, 7) }),
      sort: 'clock_in',
    })
    setCards(list)
    if (isAdmin(me)) {
      const r = await pb.collection('pay_rates').getFullList<PayRate>().catch(() => [])
      setRates(new Map(r.map((x) => [x.user, x.hourly])))
    }
  }, [week, me])

  useEffect(() => {
    setCards(null)
    load().catch((e) => toast(errMsg(e), 'error'))
  }, [load])

  const ot = currentLocation?.ot_weekly_hours || 40
  const groups = useMemo(() => {
    const m = new Map<string, Timecard[]>()
    ;(cards || []).filter((c) => (!locId || c.location === locId) && (!onlyFlagged || (c.flagged && !c.approved))).forEach((c) => m.set(c.user, [...(m.get(c.user) || []), c]))
    return [...m.entries()].sort((a, b) => userName(a[0]).localeCompare(userName(b[0])))
  }, [cards, onlyFlagged, userName, locId])
  const flaggedCount = (cards || []).filter((c) => c.flagged && !c.approved).length
  const myTotal = (cards || []).filter((c) => c.user === me.id).reduce((a, c) => a + worked(c), 0)

  const exportCsv = () => {
    const rows = [['Employee', 'Date', 'In', 'Out', 'Break (min)', 'Hours', 'Location check', 'Distance (m)', 'Needs review', 'Approved', 'Edited', 'Reason', 'Notes']]
    ;(cards || []).forEach((c) =>
      rows.push([
        userName(c.user),
        fmtDay(c.clock_in),
        fmtTime(c.clock_in),
        c.clock_out ? fmtTime(c.clock_out) : '',
        String(c.break_min || 0),
        worked(c).toFixed(2),
        GEO_LABEL[c.in_geo] || '',
        c.in_dist ? String(c.in_dist) : '',
        c.flagged ? 'yes' : 'no',
        c.approved ? 'yes' : 'no',
        c.edited ? 'yes' : 'no',
        c.reason || '',
        c.notes || '',
      ]),
    )
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `hours_${week.toISOString().slice(0, 10)}.csv`
    a.click()
  }

  return (
    <Page
      title="Hours"
      actions={
        <TopActions>
          {isMgr(me) && (
            <>
              <HeaderButton icon="download" label="Export CSV" onClick={exportCsv} />
              <HeaderButton icon="plus" label="Add entry" onClick={() => setEdit('new')} />
            </>
          )}
        </TopActions>
      }
    >
      <LocationPicker />
      <WeekBar week={week} onChange={setWeek} />

      {!isMgr(me) && cards && (
        <Card className="py-6 text-center">
          <div className="text-[15px] font-semibold text-ios-label2">Hours Worked · {fmtWeek(week)}</div>
          <div className="tabular mt-1 text-[48px] font-bold leading-none tracking-tight">{fmtHours(myTotal)}</div>
          {myTotal > ot && <div className="mt-2 text-[15px] font-semibold text-ios-orange">Includes {fmtHours(myTotal - ot)} of overtime</div>}
        </Card>
      )}

      {isMgr(me) && flaggedCount > 0 && (
        <Banner tone="orange" onClick={() => setOnlyFlagged(!onlyFlagged)}>
          <b>
            {flaggedCount} clock-in{flaggedCount === 1 ? '' : 's'} to review
          </b>{' '}
          — away from work, no GPS or forgot to clock out. {onlyFlagged ? 'Tap to show everything.' : 'Tap to show only these.'}
        </Banner>
      )}

      {!cards ? (
        <Spinner />
      ) : groups.length === 0 ? (
        <Empty icon="doc" title="No hours this week" text={isMgr(me) ? 'Clock-ins will show up here.' : 'Your clock-ins will show up here.'} />
      ) : (
        groups.map(([uid, list]) => {
          const total = list.reduce((a, c) => a + worked(c), 0)
          const rate = rates.get(uid)
          return (
            <Group
              key={uid}
              header={isMgr(me) ? userName(uid) : 'My Clock-Ins'}
              headerRight={
                <span className={total > ot ? 'font-semibold text-ios-orange' : ''}>
                  {fmtHours(total)}
                  {total > ot ? ` · ${fmtHours(total - ot)} OT` : ''}
                  {rate ? ` · ≈ $${(total * rate).toFixed(0)}` : ''}
                </span>
              }
            >
              {list.map((c) => (
                <Row
                  key={c.id}
                  onClick={isMgr(me) ? () => setEdit(c) : undefined}
                  chevron={isMgr(me)}
                  leading={isMgr(me) ? <Avatar name={userName(c.user)} size={34} /> : undefined}
                  title={
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{fmtDay(c.clock_in)}</span>
                      <span className="tabular text-[15px] font-semibold">{fmtHours(worked(c))}</span>
                    </span>
                  }
                  subtitle={
                    <span className="block">
                      <span className="tabular">
                        {fmtTime(c.clock_in)} – {c.clock_out ? fmtTime(c.clock_out) : <span className="font-semibold text-ios-green">now</span>}
                      </span>
                      {c.break_min > 0 && ` · ${c.break_min} min break`}
                      <span className="mt-1 flex flex-wrap gap-1">
                        <Pill tone={GEO_TONE[c.in_geo] || 'gray'}>
                          {GEO_LABEL[c.in_geo] || '—'}
                          {c.in_dist ? ` · ${c.in_dist} m` : ''}
                        </Pill>
                        {c.flagged && !c.approved && <Pill tone="orange">Needs review</Pill>}
                        {c.flagged && c.approved && <Pill tone="green">Reviewed</Pill>}
                        {c.edited && <Pill tone="purple">Edited</Pill>}
                      </span>
                      {c.reason && <span className="mt-1 block italic">“{c.reason}”</span>}
                    </span>
                  }
                />
              ))}
            </Group>
          )
        })
      )}

      {edit && (
        <EntrySheet
          card={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null)
            load()
          }}
        />
      )}
    </Page>
  )
}

function EntrySheet({ card, onClose, onSaved }: { card: Timecard | null; onClose: () => void; onSaved: () => void }) {
  const { me, users, currentLocation, userName } = useData()
  const [f, setF] = useState({
    user: card?.user || '',
    clock_in: toLocalInput(card?.clock_in || null),
    clock_out: toLocalInput(card?.clock_out || null),
    break_min: String(card?.break_min || 0),
    notes: card?.notes || '',
  })
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const ci = d(f.clock_in)
    const co = f.clock_out ? d(f.clock_out) : null
    if (!card && !f.user) return toast('Choose who this is for.', 'error')
    if (!ci) return toast('Add the clock-in time.', 'error')
    if (co && co <= ci) return toast('Clock-out must be after clock-in.', 'error')
    setBusy(true)
    try {
      const body: Record<string, unknown> = {
        clock_in: new Date(f.clock_in).toISOString(),
        clock_out: f.clock_out ? new Date(f.clock_out).toISOString() : '',
        break_min: Number(f.break_min) || 0,
        notes: f.notes,
      }
      if (card) await pb.collection('timecards').update(card.id, body)
      else
        await pb.collection('timecards').create({
          ...body,
          user: f.user,
          location: currentLocation?.id || '',
          approved: isAdmin(me),
          flagged: !isAdmin(me),
          flag_reason: isAdmin(me) ? '' : 'Added by a manager',
        })
      toast('Saved')
      onSaved()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const approve = async () => {
    if (!card) return
    setBusy(true)
    try {
      await pb.collection('timecards').update(card.id, { approved: true })
      toast('Approved')
      onSaved()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!card || !confirm("Delete this entry? This can't be undone.")) return
    setBusy(true)
    try {
      await pb.collection('timecards').delete(card.id)
      toast('Deleted')
      onSaved()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={card ? userName(card.user) : 'New Entry'} onClose={onClose} onDone={save} doneLabel="Save" busy={busy}>
      {card && isAdmin(me) && card.flagged && !card.approved && (
        <Group footer={card.flag_reason || undefined}>
          <Row icon="check" iconBg="#34c759" title="Approve This Clock-In" tone="link" onClick={approve} />
        </Group>
      )}
      {!card && (
        <Group>
          <SelectRow
            label="Who"
            value={f.user}
            onChange={(v) => setF({ ...f, user: v })}
            options={[{ value: '', label: 'Choose' }].concat(users.filter((u) => u.active).map((u) => ({ value: u.id, label: u.name || u.email })))}
          />
        </Group>
      )}
      <Group footer="Leave Clock Out empty if they're still working.">
        <InputRow label="Clock In" type="datetime-local" value={f.clock_in} onChange={(e) => setF({ ...f, clock_in: e.target.value })} />
        <InputRow label="Clock Out" type="datetime-local" value={f.clock_out} onChange={(e) => setF({ ...f, clock_out: e.target.value })} />
        <InputRow label="Break" type="number" inputMode="numeric" min={0} suffix="min" value={f.break_min} onChange={(e) => setF({ ...f, break_min: e.target.value })} />
      </Group>
      <Group footer="Every change is marked as Edited and saved in the history log.">
        <InputRow placeholder="Note (e.g. forgot to clock out)" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Group>
      {card && (card.flag_reason || card.reason || card.in_geo) && (
        <Group header="Clock-In Check">
          <Row title="Location" value={`${GEO_LABEL[card.in_geo] || '—'}${card.in_dist ? ` · ${card.in_dist} m` : ''}`} />
          {card.flag_reason && <Row title="Flag" subtitle={card.flag_reason} />}
          {card.reason && <Row title="Their reason" subtitle={`“${card.reason}”`} />}
        </Group>
      )}
      {card && isAdmin(me) && (
        <Group>
          <Row title="Delete Entry" tone="destructive" center onClick={remove} />
        </Group>
      )}
    </Sheet>
  )
}
