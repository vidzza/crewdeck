import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { pb, api, errMsg, inviteUrl, canManage, isOwner, ACCESS_LABEL, type Access, type PayRate, type User } from '../lib/pb'
import { useData } from '../store'
import { Avatar, Banner, Button, Dot, Group, HeaderButton, InputRow, Page, Pill, Row, Segmented, SelectRow, Sheet, Spinner, SwitchRow, toast, type Tone } from '../ui'
import { Icon } from '../icons'

export const ACCESS_HELP: Record<Access, string> = {
  owner: 'Does everything. The only one who approves shift changes and open-shift pickups, and who manages admins.',
  admin: "Publishes schedules, approves time off and hours, sees pay and Insights, manages managers and employees. Doesn't approve shift changes.",
  manager: "Builds draft schedules and fixes hours at their locations. Doesn't publish or approve anything.",
  employee: 'Clocks in and out, sees the schedule, asks for shift changes and time off.',
}
const ACCESS_TONE: Record<Access, Tone> = { owner: 'purple', admin: 'blue', manager: 'teal', employee: 'gray' }

function randomPassword() {
  const b = new Uint8Array(18)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('')
}

export default function Team() {
  const { me, users, positions, locations, locationName, reload } = useData()
  const [edit, setEdit] = useState<User | 'new' | null>(null)
  const [invite, setInvite] = useState<User | null>(null)
  const [show, setShow] = useState<'active' | 'inactive'>('active')
  const list = users.filter((u) => (show === 'active' ? u.active : !u.active))
  const pending = users.filter((u) => u.active && !u.joined_at)
  const multi = locations.length > 1

  return (
    <Page title="Team" back={{ label: 'Settings', href: '#/settings' }} actions={<HeaderButton icon="plus" label="Add person" onClick={() => setEdit('new')} />}>
      <Button size="lg" full icon="plus" onClick={() => setEdit('new')}>
        Add Person
      </Button>
      {pending.length > 0 && show === 'active' && (
        <Banner tone="blue" icon="send">
          <b>
            {pending.length} {pending.length === 1 ? "person hasn't" : "people haven't"} joined yet.
          </b>{' '}
          Tap them to send their invite link.
        </Banner>
      )}
      <Segmented
        value={show}
        onChange={setShow}
        options={[
          { value: 'active', label: `Team (${users.filter((u) => u.active).length})` },
          { value: 'inactive', label: 'Deactivated' },
        ]}
      />
      <Group>
        {list.length === 0 && <Row title={<span className="text-ios-label2">Nobody here</span>} />}
        {list.map((u) => (
          <Row
            key={u.id}
            onClick={() => setEdit(u)}
            chevron
            leading={<Avatar name={u.name || u.email} size={40} />}
            title={
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate">{u.name || u.email || u.phone}</span>
                {u.access !== 'employee' && <Pill tone={ACCESS_TONE[u.access]}>{ACCESS_LABEL[u.access]}</Pill>}
                {u.active && !u.joined_at && <Pill tone="orange">Invite pending</Pill>}
              </span>
            }
            subtitle={
              <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                {u.positions?.map((p) => {
                  const pos = positions.find((x) => x.id === p)
                  return pos ? (
                    <span key={p} className="inline-flex items-center gap-1.5">
                      <Dot color={pos.color} size={8} />
                      {pos.name}
                    </span>
                  ) : null
                })}
                {multi && (u.access === 'owner' || u.access === 'admin' ? <span>All locations</span> : u.locations?.map((l) => <span key={l}>📍 {locationName(l)}</span>))}
                {!u.positions?.length && !multi && <span>No positions yet</span>}
              </span>
            }
          />
        ))}
      </Group>
      {edit && (
        <PersonSheet
          user={edit === 'new' ? null : edit}
          canOwner={isOwner(me)}
          onClose={() => setEdit(null)}
          onInvite={(u) => {
            setEdit(null)
            setInvite(u)
          }}
          onSaved={async (created) => {
            setEdit(null)
            await reload()
            if (created) setInvite(created)
          }}
        />
      )}
      {invite && <InviteSheet user={invite} onClose={() => setInvite(null)} />}
    </Page>
  )
}

function PersonSheet({
  user,
  canOwner,
  onClose,
  onSaved,
  onInvite,
}: {
  user: User | null
  canOwner: boolean
  onClose: () => void
  onSaved: (created?: User) => void
  onInvite: (u: User) => void
}) {
  const { me, positions, locations, currentLocation } = useData()
  const [f, setF] = useState({
    name: user?.name || '',
    email: user?.email || '',
    phone: user?.phone || '',
    access: (user?.access || 'employee') as Access,
    positions: user?.positions || [],
    locations: user?.locations?.length ? user.locations : currentLocation ? [currentLocation.id] : [],
    active: user?.active ?? true,
    hourly: '',
  })
  const [rate, setRate] = useState<PayRate | null>(null)
  const [busy, setBusy] = useState(false)
  const multi = locations.length > 1
  const allLocations = f.access === 'owner' || f.access === 'admin'

  useEffect(() => {
    if (!user) return
    pb.collection('pay_rates')
      .getFirstListItem<PayRate>(pb.filter('user = {:u}', { u: user.id }))
      .then((r) => {
        setRate(r)
        setF((x) => ({ ...x, hourly: r.hourly ? String(r.hourly) : '' }))
      })
      .catch(() => {})
  }, [user])

  const isSelf = user?.id === me.id
  // Owner > Admin > Manager > Employee. Admins can't edit admins or the owner,
  // and only the owner changes someone's own access, positions or pay.
  const locked = !!user && !isSelf && !canManage(me, user)
  const selfOnly = isSelf && !canOwner

  const save = async () => {
    if (!f.name.trim()) return toast('Add their name.', 'error')
    if (!f.phone.trim() && !f.email.trim()) return toast('Add a phone number or an email so they can sign in.', 'error')
    if (multi && !allLocations && f.locations.length === 0) return toast('Pick at least one location where they work.', 'error')
    if (isSelf && canOwner && (!f.active || f.access !== user?.access) && !confirm("You're changing your own access. Are you sure?")) return
    setBusy(true)
    try {
      const body: Record<string, unknown> = {
        name: f.name.trim(),
        email: f.email.trim().toLowerCase(),
        phone: f.phone.trim(),
        access: f.access,
        positions: f.positions,
        locations: allLocations ? locations.map((l) => l.id) : f.locations,
        active: f.active,
      }
      let saved: User
      if (user && selfOnly) {
        await pb.collection('users').update<User>(user.id, { name: body.name, email: body.email, phone: body.phone })
        toast('Saved')
        return onSaved()
      }
      if (user) saved = await pb.collection('users').update<User>(user.id, body)
      else {
        const pw = randomPassword()
        saved = await pb.collection('users').create<User>({ ...body, password: pw, passwordConfirm: pw, emailVisibility: false })
      }
      const hourly = Number(f.hourly)
      if (f.hourly !== '' && !isNaN(hourly)) {
        if (rate) await pb.collection('pay_rates').update(rate.id, { hourly })
        else await pb.collection('pay_rates').create({ user: saved.id, hourly })
      }
      toast(user ? 'Saved' : `${f.name.trim().split(' ')[0]} added`)
      onSaved(user ? undefined : saved)
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const toggle = (k: 'positions' | 'locations', id: string) =>
    setF((x) => ({ ...x, [k]: x[k].includes(id) ? x[k].filter((p) => p !== id) : [...x[k], id] }))
  const levels = (['employee', 'manager', 'admin', 'owner'] as Access[]).filter((a) => canOwner || a === 'employee' || a === 'manager')

  return (
    <Sheet title={user ? user.name || 'Edit Person' : 'Add Person'} onClose={onClose} onDone={save} doneLabel={user ? 'Save' : 'Add'} doneDisabled={locked} busy={busy}>
      {locked && (
        <Banner tone="orange" icon="info">
          Only the owner can edit {user?.access === 'owner' ? 'the owner' : 'admins'}.
        </Banner>
      )}
      {selfOnly && (
        <Banner tone="blue" icon="info">
          You can change your name, phone and email. The owner changes your access level, positions and pay.
        </Banner>
      )}
      <Group footer={user ? undefined : "No password needed. After you add them, you'll get a link to send them so they can join."}>
        <InputRow label="Name" placeholder="Full name" autoFocus={!user} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <InputRow label="Phone" type="tel" placeholder="Mobile number" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <InputRow label="Email" type="email" autoCapitalize="none" placeholder="Optional" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </Group>
      {locked || selfOnly ? (
        <Group header="Permissions" footer={ACCESS_HELP[f.access]}>
          <Row title="Access Level" value={ACCESS_LABEL[f.access]} />
          <Row
            title="Positions"
            value={
              positions
                .filter((p) => f.positions.includes(p.id))
                .map((p) => p.name)
                .join(', ') || 'None'
            }
          />
        </Group>
      ) : (
        <>
        <Group header="Positions" footer="What they can work.">
          {positions
            .filter((p) => p.active || f.positions.includes(p.id))
            .map((p) => (
              <Row key={p.id} leading={<Dot color={p.color} size={12} />} title={p.name} check={f.positions.includes(p.id)} onClick={() => toggle('positions', p.id)} />
            ))}
        </Group>
        {multi && !allLocations && (
          <Group header="Works At" footer="They only see schedules and clock in at these locations.">
            {locations.map((l) => (
              <Row key={l.id} icon="pin" iconBg="#ff3b30" title={l.name} check={f.locations.includes(l.id)} onClick={() => toggle('locations', l.id)} />
            ))}
          </Group>
        )}
        <Group header="Permissions" footer={ACCESS_HELP[f.access] + (multi && allLocations ? ' Works at all locations.' : '')}>
          <SelectRow label="Access Level" value={f.access} onChange={(v) => setF({ ...f, access: v as Access })} options={levels.map((a) => ({ value: a, label: ACCESS_LABEL[a] }))} />
        </Group>
        <Group header="Pay" footer="Optional. Only the owner and admins can see this.">
          <InputRow label="Hourly Rate" type="number" inputMode="decimal" min={0} step="0.01" placeholder="$0.00" value={f.hourly} onChange={(e) => setF({ ...f, hourly: e.target.value })} />
        </Group>
        </>
      )}
      {user && user.active && !locked && !isSelf && (
        <Group footer={user.joined_at ? 'Use this if they forgot their password. The link lets them choose a new one.' : "They haven't joined yet. Send them their link."}>
          <Row icon="send" iconBg="#007aff" title={user.joined_at ? 'Send New Sign-In Link' : 'Send Invite Link'} tone="link" onClick={() => onInvite(user)} />
        </Group>
      )}
      {user && !isSelf && !locked && (
        <Group footer="Deactivated people can't sign in. Their history stays.">
          <SwitchRow label="Active" checked={f.active} onChange={(v) => setF({ ...f, active: v })} />
        </Group>
      )}
    </Sheet>
  )
}

// Link (+ QR code) that lets someone join, or choose a new password.
function InviteSheet({ user, onClose }: { user: User; onClose: () => void }) {
  const { company } = useData()
  const [url, setUrl] = useState('')
  const [qr, setQr] = useState('')
  const [err, setErr] = useState('')
  const first = (user.name || '').split(' ')[0] || 'there'
  const joined = !!user.joined_at

  useEffect(() => {
    api<{ token: string }>('/api/ch/invites', { user: user.id })
      .then(async (r) => {
        const u = inviteUrl(r.token)
        setUrl(u)
        setQr(await QRCode.toString(u, { type: 'svg', margin: 1, width: 220, color: { dark: '#000000', light: '#ffffff' } }))
      })
      .catch((e) => setErr(errMsg(e)))
  }, [user.id])

  const message = joined
    ? `Hi ${first}! Here's a link to choose a new password for ${company?.name || 'Crewdeck'}: ${url}`
    : `Hi ${first}! Join ${company?.name || 'our team'} on Crewdeck to see your schedule and clock in: ${url}`

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: joined ? 'New sign-in link' : `Join ${company?.name || 'the team'}`, text: message })
        return
      } catch {
        return // cancelled
      }
    }
    copy()
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message)
      toast('Copied. Paste it in a message to them.')
    } catch {
      prompt('Copy this message:', message)
    }
  }
  const phoneDigits = user.phone.replace(/[^\d+]/g, '')

  return (
    <Sheet title={joined ? 'Sign-In Link' : 'Invite'} onClose={onClose} onDone={onClose} doneLabel="Done">
      <div className="flex flex-col items-center text-center">
        <Avatar name={user.name || user.email} size={64} />
        <h3 className="mt-3 text-[22px] font-bold">{joined ? `New sign-in link for ${first}` : `Invite ${first}`}</h3>
        <p className="mt-1 text-[15px] text-ios-label2">
          {joined ? 'They open it and choose a new password.' : 'They open the link, choose a password and they’re in. No app store needed.'}
        </p>
      </div>
      {err ? (
        <Banner tone="red">{err}</Banner>
      ) : !url ? (
        <Spinner />
      ) : (
        <>
          <Button size="lg" full icon="share" onClick={share}>
            Send Link
          </Button>
          <Group>
            {phoneDigits && <Row icon="send" iconBg="#34c759" title="Send as Text Message" tone="link" href={`sms:${phoneDigits}?&body=${encodeURIComponent(message)}`} />}
            {user.email && (
              <Row
                icon="send"
                iconBg="#007aff"
                title="Send by Email"
                tone="link"
                href={`mailto:${user.email}?subject=${encodeURIComponent(joined ? 'Your new sign-in link' : `Join ${company?.name || 'the team'} on Crewdeck`)}&body=${encodeURIComponent(message)}`}
              />
            )}
            <Row icon="copy" iconBg="#8e8e93" title="Copy Link" tone="link" onClick={copy} />
          </Group>
          <Group header="Or scan with their phone camera" footer="The link works once and expires in 14 days. Sending a new one cancels the old one.">
            <div className="flex justify-center p-5">
              <div className="h-[220px] w-[220px]" dangerouslySetInnerHTML={{ __html: qr }} />
            </div>
          </Group>
        </>
      )}
      <p className="flex items-center justify-center gap-1.5 text-[13px] text-ios-label2">
        <Icon name="info" size={14} />
        {user.phone ? `They'll sign in with ${user.phone}${user.email ? ` or ${user.email}` : ''}.` : `They'll sign in with ${user.email}.`}
      </p>
    </Sheet>
  )
}

// ---------- who can do what (Settings → Access Levels) ----------
const EVERYONE: Access[] = ['owner', 'admin', 'manager', 'employee']
const CAN: { t: string; who: Access[]; note?: string }[] = [
  { t: 'Approve shift swaps, covers and drops', who: ['owner'] },
  { t: 'Approve open-shift pickups', who: ['owner'] },
  { t: 'Make, edit or deactivate admins', who: ['owner'] },
  { t: 'Set pay for admins', who: ['owner'] },
  { t: 'Publish schedules and change published shifts', who: ['owner', 'admin'] },
  { t: 'Approve time off', who: ['owner', 'admin'] },
  { t: 'Approve clock-ins and hours', who: ['owner', 'admin'] },
  { t: 'See pay, labor cost and Insights', who: ['owner', 'admin'] },
  { t: 'Add and edit managers and employees', who: ['owner', 'admin'] },
  { t: 'Locations, positions and settings', who: ['owner', 'admin'] },
  { t: 'Build draft schedules', who: ['owner', 'admin', 'manager'], note: 'Managers: at their locations' },
  { t: 'Fix hours', who: ['owner', 'admin', 'manager'], note: 'Managers: at their locations' },
  { t: 'See the team schedule', who: EVERYONE, note: 'At the locations where they work' },
  { t: 'Clock in, ask for shift changes and time off', who: EVERYONE },
]
function whoText(who: Access[]) {
  if (who.length === 4) return 'Everyone'
  if (who.length === 1) return 'Owner only'
  if (who.length === 2) return 'Owner and admins'
  return 'Owner, admins and managers'
}

export function AccessLevelsPage() {
  const { users } = useData()
  const count = (a: Access) => users.filter((u) => u.active && u.access === a).length
  return (
    <Page title="Access Levels" back={{ label: 'Settings', href: '#/settings' }}>
      <Group header="From most to least" footer="Change someone's level in Team. Admins can only give the Manager or Employee level.">
        {EVERYONE.map((a) => (
          <Row key={a}>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <Pill tone={ACCESS_TONE[a]}>{ACCESS_LABEL[a]}</Pill>
                <span className="text-[15px] text-ios-label2">
                  {count(a)} {count(a) === 1 ? 'person' : 'people'}
                </span>
              </span>
              <span className="mt-1.5 block text-[15px] leading-snug text-ios-label2">{ACCESS_HELP[a]}</span>
            </span>
          </Row>
        ))}
      </Group>
      <Group header="Who Can Do What">
        {CAN.map((c) => (
          <Row
            key={c.t}
            title={c.t}
            subtitle={
              <>
                <span className={c.who.length === 1 ? 'font-semibold text-ios-purple' : ''}>{whoText(c.who)}</span>
                {c.note ? ` · ${c.note}` : ''}
              </>
            }
          />
        ))}
      </Group>
    </Page>
  )
}
