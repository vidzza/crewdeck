import { useState } from 'react'
import { pb, errMsg, ACCESS_LABEL } from '../lib/pb'
import { useData } from '../store'
import { InstallSheet, NotificationsGroup } from '../chrome'
import { disablePush } from '../lib/push'
import { ask, Avatar, Dot, Group, InputRow, Page, Row, Sheet, toast } from '../ui'

export default function Account() {
  const { me, positions } = useData()
  const [install, setInstall] = useState(false)
  const [pw, setPw] = useState(false)
  const [info, setInfo] = useState(false)
  const myPositions = positions.filter((p) => me.positions?.includes(p.id))

  return (
    <Page title="Account" back={{ label: 'Back' }}>
      <div className="flex flex-col items-center pt-2 text-center">
        <Avatar name={me.name || me.email} size={88} />
        <h2 className="mt-3 text-[24px] font-bold">{me.name || me.email}</h2>
        <p className="text-[15px] text-ios-label2">
          {[ACCESS_LABEL[me.access], me.phone || me.email].filter(Boolean).join(' · ')}
        </p>
      </div>
      {myPositions.length > 0 && (
        <Group header="My Positions">
          {myPositions.map((p) => (
            <Row key={p.id} leading={<Dot color={p.color} size={12} />} title={p.name} />
          ))}
        </Group>
      )}
      <NotificationsGroup />
      <Group>
        <Row icon="share" iconBg="#34c759" title="Add to Home Screen" chevron onClick={() => setInstall(true)} />
        <Row icon="person" iconBg="#007aff" title="Name & Phone" chevron onClick={() => setInfo(true)} />
        <Row icon="pencil" iconBg="#8e8e93" title="Change Password" chevron onClick={() => setPw(true)} />
      </Group>
      <Group>
        <Row
          title="Sign Out"
          tone="destructive"
          center
          onClick={async () => {
            if (await ask({ title: 'Sign out of Crewdeck?', confirm: 'Sign Out', destructive: true })) {
              // This phone stops getting this person's notifications.
              await disablePush()
              pb.authStore.clear()
              location.hash = '#/today'
            }
          }}
        />
      </Group>
      {install && <InstallSheet onClose={() => setInstall(false)} />}
      {pw && <PasswordSheet onClose={() => setPw(false)} />}
      {info && <InfoSheet onClose={() => setInfo(false)} />}
    </Page>
  )
}

function PasswordSheet({ onClose }: { onClose: () => void }) {
  const { me } = useData()
  const [f, setF] = useState({ old: '', next: '' })
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (f.next.length < 8) return toast('The new password needs at least 8 characters.', 'error')
    setBusy(true)
    try {
      await pb.collection('users').update(me.id, { oldPassword: f.old, password: f.next, passwordConfirm: f.next })
      // Changing the password signs out other sessions; sign back in here (email or phone).
      await pb.collection('users').authWithPassword(me.email || me.phone_login, f.next)
      toast('Password changed')
      onClose()
    } catch (e) {
      toast(errMsg(e).includes('oldPassword') ? 'Your current password is wrong.' : errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet title="Change Password" onClose={onClose} onDone={save} doneLabel="Save" doneDisabled={!f.old || !f.next} busy={busy}>
      <Group footer="At least 8 characters.">
        <InputRow type="password" placeholder="Current password" autoComplete="current-password" value={f.old} onChange={(e) => setF({ ...f, old: e.target.value })} />
        <InputRow type="password" placeholder="New password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
      </Group>
    </Sheet>
  )
}

// Your own name and phone. The phone is also how you sign in. Only the owner changes emails.
function InfoSheet({ onClose }: { onClose: () => void }) {
  const { me, reload } = useData()
  const [f, setF] = useState({ name: me.name || '', phone: me.phone || '' })
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!f.name.trim()) return toast('Add your name.', 'error')
    if (!f.phone.trim() && !me.email) return toast('Keep a phone number so you can sign in.', 'error')
    setBusy(true)
    try {
      await pb.collection('users').update(me.id, { name: f.name.trim(), phone: f.phone.trim() })
      await pb.collection('users').authRefresh()
      await reload()
      toast('Saved')
      onClose()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet title="Name & Phone" onClose={onClose} onDone={save} doneLabel="Save" busy={busy}>
      <Group footer={f.phone.trim() ? 'You can sign in with this phone number.' : undefined}>
        <InputRow label="Name" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <InputRow label="Phone" type="tel" autoComplete="tel" placeholder="Mobile number" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      </Group>
      {me.email && (
        <Group footer="To change your email, ask the owner.">
          <Row title="Email" value={me.email} />
        </Group>
      )}
    </Sheet>
  )
}
