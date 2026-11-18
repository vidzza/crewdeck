import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ClientResponseError } from 'pocketbase'
import { pb, api, errMsg, isAdmin, isMgr, isOwner, type ShiftRequest, type TimeOff, type TimeOffKind } from '../lib/pb'
import { addDays, d, fmtDay, fmtShift, fromInputs, toDateInput } from '../lib/dates'
import { useData } from '../store'
import { TopActions } from '../chrome'
import { askText, ask, Button, Card, Empty, Group, InputRow, Page, Pill, Row, Segmented, SectionTitle, SelectRow, Sheet, Spinner, toast, type Tone } from '../ui'

const TYPE: Record<string, string> = { cover: 'Cover', swap: 'Swap', drop: 'Drop Shift', pickup: 'Pick Up Open Shift' }
const REQ_STATUS: Record<string, { t: string; tone: Tone }> = {
  pending_peer: { t: 'Waiting for coworker', tone: 'blue' },
  pending_admin: { t: 'Waiting for the owner', tone: 'orange' },
  approved: { t: 'Approved', tone: 'green' },
  rejected: { t: 'Declined by the owner', tone: 'red' },
  declined: { t: "Coworker can't", tone: 'red' },
  cancelled: { t: 'Cancelled', tone: 'gray' },
}
const KIND: Record<TimeOffKind, string> = { vacation: 'Vacation', sick: 'Sick', personal: 'Personal', unpaid: 'Unpaid' }
const OFF_STATUS: Record<string, { t: string; tone: Tone }> = {
  pending: { t: 'Waiting for approval', tone: 'orange' },
  approved: { t: 'Approved', tone: 'green' },
  rejected: { t: 'Declined', tone: 'red' },
  cancelled: { t: 'Cancelled', tone: 'gray' },
}

export default function Requests() {
  const [tab, setTab] = useState<'shifts' | 'timeoff'>(() => (location.hash.startsWith('#/timeoff') ? 'timeoff' : 'shifts'))
  return (
    <Page title="Requests" actions={<TopActions />}>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'shifts', label: 'Shift Changes' },
          { value: 'timeoff', label: 'Time Off' },
        ]}
      />
      {tab === 'shifts' ? <ShiftChanges /> : <TimeOffList />}
    </Page>
  )
}

// ---------- shift changes ----------
function ShiftChanges() {
  const { me, users, refreshUnread } = useData()
  const [list, setList] = useState<ShiftRequest[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await pb.collection('shift_requests').getList<ShiftRequest>(1, 150, { sort: '-created', expand: 'shift,target_shift' })
    setList(r.items)
  }, [])

  useEffect(() => {
    load().catch((e) => toast(errMsg(e), 'error'))
    pb.collection('shift_requests').subscribe('*', () => load().catch(() => {})).catch(() => {})
    return () => {
      pb.collection('shift_requests').unsubscribe('*').catch(() => {})
    }
  }, [load])

  const act = async (r: ShiftRequest, action: string, extra: Record<string, unknown> = {}) => {
    let note = ''
    if (action === 'reject') {
      const n = await askText({ title: 'Decline this change?', message: "They'll see your reason.", placeholder: 'Reason (optional)', confirm: 'Decline' })
      if (n === null) return
      note = n
    }
    if (action === 'cancel' && !(await ask({ title: 'Cancel this request?', confirm: 'Cancel Request', cancel: 'Keep It', destructive: true }))) return
    setBusy(r.id + action)
    try {
      await api(`/api/ch/requests/${r.id}/${action}`, { note, ...extra })
      toast(
        {
          accept: 'Accepted. Now the owner approves it.',
          decline: "Got it. We'll let them know.",
          cancel: 'Request cancelled',
          approve: 'Approved',
          reject: 'Declined',
        }[action] || 'Done',
      )
      await load()
      refreshUnread()
    } catch (e) {
      // 409 = conflict (overlap or time off). The owner decides whether to approve anyway.
      if (e instanceof ClientResponseError && e.status === 409 && action === 'approve') {
        const msg = (e.response as { message?: string }).message
        if (await ask({ title: 'Approve anyway?', message: msg, confirm: 'Approve' })) return act(r, 'approve', { force: true })
      } else toast(errMsg(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  if (!list) return <Spinner />

  const open = (r: ShiftRequest) => r.status === 'pending_peer' || r.status === 'pending_admin'
  // Only the owner approves shift changes. Admins and managers can see what's waiting.
  const toApprove = isOwner(me) ? list.filter((r) => r.status === 'pending_admin') : []
  const waitingOwner = !isOwner(me) && isMgr(me) ? list.filter((r) => r.status === 'pending_admin' && r.requester !== me.id) : []
  // Open covers: for people who work at that location (owners and admins work everywhere).
  const worksThere = (r: ShiftRequest) => {
    const loc = r.expand?.shift?.location
    const meNow = users.find((u) => u.id === me.id) || me
    return isAdmin(meNow) || !loc || !meNow.locations?.length || meNow.locations.includes(loc)
  }
  const forMe = list.filter(
    (r) => r.status === 'pending_peer' && r.requester !== me.id && (r.target_user === me.id || (r.type === 'cover' && !r.target_user && worksThere(r))),
  )
  const mine = list.filter((r) => r.requester === me.id && open(r))
  const others = isMgr(me) ? list.filter((r) => r.status === 'pending_peer' && r.requester !== me.id && !forMe.includes(r)) : []
  const history = list.filter((r) => !open(r)).slice(0, 30)
  const nothing = !toApprove.length && !waitingOwner.length && !forMe.length && !mine.length && !others.length

  const btn = (r: ShiftRequest, action: string, label: string, variant: 'tinted' | 'tinted-green' | 'tinted-red' | 'gray' | 'primary') => (
    <Button size="sm" variant={variant} busy={busy === r.id + action} disabled={!!busy} onClick={() => act(r, action)}>
      {label}
    </Button>
  )

  return (
    <>
      {nothing && (
        <Empty
          icon="swap"
          title="No open requests"
          text={
            <>
              To change one of your shifts, go to{' '}
              <a className="text-ios-blue" href="#/schedule">
                Schedule
              </a>{' '}
              and tap it.
            </>
          }
        />
      )}
      {toApprove.length > 0 && (
        <CardList title="Needs Your Approval">
          {toApprove.map((r) => (
            <ReqCard key={r.id} r={r}>
              {btn(r, 'approve', 'Approve', 'tinted-green')}
              {btn(r, 'reject', 'Decline', 'tinted-red')}
            </ReqCard>
          ))}
        </CardList>
      )}
      {waitingOwner.length > 0 && (
        <CardList title="Waiting for the Owner" footer="Only the owner approves shift changes and open-shift pickups.">
          {waitingOwner.map((r) => (
            <ReqCard key={r.id} r={r} />
          ))}
        </CardList>
      )}
      {forMe.length > 0 && (
        <CardList title="Asked of You">
          {forMe.map((r) => (
            <ReqCard key={r.id} r={r}>
              {btn(r, 'accept', r.type === 'swap' ? 'Accept Swap' : "I'll Cover It", 'primary')}
              {r.target_user === me.id && btn(r, 'decline', "Can't", 'gray')}
            </ReqCard>
          ))}
        </CardList>
      )}
      {mine.length > 0 && (
        <CardList title="My Requests">
          {mine.map((r) => (
            <ReqCard key={r.id} r={r}>
              {btn(r, 'cancel', 'Cancel Request', 'gray')}
            </ReqCard>
          ))}
        </CardList>
      )}
      {others.length > 0 && (
        <CardList title="Waiting on Coworkers">
          {others.map((r) => (
            <ReqCard key={r.id} r={r}>
              {isOwner(me) && btn(r, 'reject', 'Decline', 'tinted-red')}
            </ReqCard>
          ))}
        </CardList>
      )}
      {history.length > 0 && (
        <CardList title="History">
          {history.map((r) => (
            <ReqCard key={r.id} r={r} muted />
          ))}
        </CardList>
      )}
    </>
  )
}

function CardList({ title, footer, children }: { title: string; footer?: string; children: ReactNode }) {
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <div className="space-y-2.5">{children}</div>
      {footer && <p className="px-4 pt-2 text-[13px] text-ios-label2">{footer}</p>}
    </section>
  )
}

function ReqCard({ r, children, muted }: { r: ShiftRequest; children?: ReactNode; muted?: boolean }) {
  const { me, userName, position } = useData()
  const s = r.expand?.shift
  const ts = r.expand?.target_shift
  const st =
    r.status === 'pending_admin' && isOwner(me)
      ? { t: 'Waiting for you', tone: 'orange' as Tone }
      : r.status === 'pending_peer' && r.target_user === me.id
        ? { t: 'Waiting for you', tone: 'blue' as Tone }
        : r.status === 'declined' && r.target_user === me.id
          ? { t: 'You said no', tone: 'gray' as Tone }
          : REQ_STATUS[r.status]
  const name = (id: string) => (id === me.id ? 'You' : userName(id))
  let who = name(r.requester)
  if (r.type === 'cover') who += r.target_user ? ` → ${name(r.target_user)}` : ' → anyone'
  if (r.type === 'swap') who += ` ⇄ ${name(r.target_user)}`
  if (r.type === 'drop') who += ' → open shift'
  if (r.type === 'pickup') who += ' want' + (r.requester === me.id ? '' : 's') + ' it'
  return (
    <Card className={muted ? 'opacity-70' : ''}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[17px] font-semibold">{TYPE[r.type]}</div>
          <div className="text-[15px]">{who}</div>
        </div>
        <Pill tone={st.tone}>{st.t}</Pill>
      </div>
      {s && (
        <div className="mt-2 text-[15px] text-ios-label2">
          {fmtShift(s)}
          {position(s.position)?.name ? ` · ${position(s.position)?.name}` : ''}
        </div>
      )}
      {ts && <div className="text-[15px] text-ios-label2">for {fmtShift(ts)}</div>}
      {r.note && <div className="mt-2 text-[15px] italic text-ios-label2">“{r.note}”</div>}
      {r.decision_note && (
        <div className="mt-1 text-[15px] text-ios-label2">{r.decided_by ? `${name(r.decided_by)}: “${r.decision_note}”` : r.decision_note}</div>
      )}
      <div className="mt-2 text-[13px] text-ios-label3">
        {fmtDay(r.created)}
        {r.decided_by ? ` · ${r.status === 'approved' ? 'approved' : 'declined'} by ${r.decided_by === me.id ? 'you' : userName(r.decided_by)}` : ''}
      </div>
      {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
    </Card>
  )
}

// ---------- time off ----------
function TimeOffList() {
  const { me, userName, refreshUnread } = useData()
  const [list, setList] = useState<TimeOff[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)

  const load = useCallback(async () => {
    const r = await pb.collection('time_off').getList<TimeOff>(1, 200, { sort: '-starts_at' })
    setList(r.items)
  }, [])
  useEffect(() => {
    load().catch((e) => toast(errMsg(e), 'error'))
  }, [load])

  const act = async (t: TimeOff, action: 'approve' | 'reject' | 'cancel') => {
    let note = ''
    if (action === 'reject') {
      const n = await askText({ title: 'Decline this time off?', message: "They'll see your reason.", placeholder: 'Reason (optional)', confirm: 'Decline' })
      if (n === null) return
      note = n
    }
    if (action === 'cancel' && !(await ask({ title: 'Cancel this time off?', confirm: 'Cancel Time Off', cancel: 'Keep It', destructive: true }))) return
    setBusy(t.id + action)
    try {
      await api(`/api/ch/timeoff/${t.id}/${action}`, { note })
      toast({ approve: 'Approved', reject: 'Declined', cancel: 'Cancelled' }[action])
      await load()
      refreshUnread()
    } catch (err) {
      toast(errMsg(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  const now = new Date()
  // The owner approves admins' own time off; admins approve everyone else's.
  const pending = isAdmin(me) ? (list || []).filter((t) => t.status === 'pending' && (t.user !== me.id || isOwner(me))) : []
  const rest = (list || []).filter((t) => !pending.includes(t))

  const card = (t: TimeOff, actions?: ReactNode) => {
    const st = OFF_STATUS[t.status]
    const last = new Date(d(t.ends_at)!.getTime() - 1000)
    const same = fmtDay(t.starts_at) === fmtDay(last)
    return (
      <Card key={t.id}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[17px] font-semibold">{t.user === me.id ? KIND[t.kind] : userName(t.user)}</div>
            <div className="text-[15px] text-ios-label2">
              {fmtDay(t.starts_at)}
              {!same && ` – ${fmtDay(last)}`}
              {t.user !== me.id && ` · ${KIND[t.kind]}`}
            </div>
          </div>
          <Pill tone={st.tone}>{st.t}</Pill>
        </div>
        {t.note && <div className="mt-2 text-[15px] italic text-ios-label2">“{t.note}”</div>}
        {t.decision_note && (
          <div className="mt-1 text-[15px] text-ios-label2">
            {t.decided_by ? (t.decided_by === me.id ? 'You' : userName(t.decided_by)) : 'Note'}: “{t.decision_note}”
          </div>
        )}
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </Card>
    )
  }

  return (
    <>
      <Button size="lg" full icon="plus" onClick={() => setAsking(true)}>
        Request Time Off
      </Button>
      {!list ? (
        <Spinner />
      ) : (
        <>
          {pending.length > 0 && (
            <CardList title="Needs Your Approval">
              {pending.map((t) =>
                card(
                  t,
                  <>
                    <Button size="sm" variant="tinted-green" busy={busy === t.id + 'approve'} disabled={!!busy} onClick={() => act(t, 'approve')}>
                      Approve
                    </Button>
                    <Button size="sm" variant="tinted-red" busy={busy === t.id + 'reject'} disabled={!!busy} onClick={() => act(t, 'reject')}>
                      Decline
                    </Button>
                  </>,
                ),
              )}
            </CardList>
          )}
          {rest.length === 0 && pending.length === 0 ? (
            <Empty icon="sun" title="No time off yet" text="Need a day off? Tap Request Time Off." />
          ) : (
            rest.length > 0 && (
              <CardList title={isMgr(me) ? 'All Time Off' : 'My Time Off'}>
                {rest.map((t) =>
                  card(
                    t,
                    t.user === me.id && (t.status === 'pending' || (t.status === 'approved' && d(t.starts_at)! > now)) ? (
                      <Button size="sm" variant="gray" busy={busy === t.id + 'cancel'} onClick={() => act(t, 'cancel')}>
                        Cancel
                      </Button>
                    ) : undefined,
                  ),
                )}
              </CardList>
            )
          )}
        </>
      )}
      {asking && (
        <TimeOffSheet
          onClose={() => setAsking(false)}
          onDone={() => {
            setAsking(false)
            load()
          }}
        />
      )}
    </>
  )
}

function TimeOffSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { me, users } = useData()
  const today = toDateInput(new Date())
  const [f, setF] = useState({ from: today, to: today, kind: 'personal' as TimeOffKind, note: '', user: me.id })
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const s = fromInputs(f.from, '00:00')
    const e = addDays(fromInputs(f.to, '00:00'), 1)
    if (e <= s) return toast('The last day must be on or after the first day.', 'error')
    setBusy(true)
    try {
      const r = await api<{ shiftsInRange: number }>('/api/ch/timeoff', { starts_at: s.toISOString(), ends_at: e.toISOString(), kind: f.kind, note: f.note, user: f.user })
      toast(r.shiftsInRange ? `Sent. You have ${r.shiftsInRange} shift(s) on those days.` : 'Sent to the owner/admin', r.shiftsInRange ? 'info' : 'ok')
      onDone()
    } catch (err) {
      toast(errMsg(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Time Off" onClose={onClose} onDone={submit} doneLabel="Send" busy={busy}>
      {isAdmin(me) && (
        <Group>
          <SelectRow
            label="For"
            value={f.user}
            onChange={(v) => setF({ ...f, user: v })}
            options={users.filter((u) => u.active).map((u) => ({ value: u.id, label: u.id === me.id ? 'Me' : u.name || u.email }))}
          />
        </Group>
      )}
      <Group>
        <InputRow label="First Day" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, to: e.target.value > f.to ? e.target.value : f.to })} />
        <InputRow label="Last Day" type="date" min={f.from} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <SelectRow label="Type" value={f.kind} onChange={(v) => setF({ ...f, kind: v as TimeOffKind })} options={Object.entries(KIND).map(([value, label]) => ({ value, label }))} />
      </Group>
      <Group footer="The owner or an admin will approve it. You'll get a notification.">
        <InputRow placeholder="Add a note (optional)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </Group>
      <Button size="lg" full busy={busy} onClick={submit}>
        Send Request
      </Button>
    </Sheet>
  )
}
