import { useEffect, useState, type FormEvent } from 'react'
import { pb, errMsg, type User } from '../lib/pb'
import { Banner, Button, Group, InputRow, Spinner, toast } from '../ui'
import { Icon } from '../icons'

interface Invite {
  ok: boolean
  reason?: string
  company: string
  name?: string
  email?: string
  phone?: string
  joined?: boolean
  invitedBy?: string
}

export const WELCOME_KEY = 'crewdeck-welcome'

// Opened from an invite link: #/join/<token>. Works for first-time joining and for "forgot my password".
export default function Join({ token }: { token: string }) {
  const [inv, setInv] = useState<Invite | null>(null)
  const [f, setF] = useState({ name: '', email: '', password: '' })
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    pb.send<Invite>(`/api/ch/invites/${encodeURIComponent(token)}`, {})
      .then((r) => {
        setInv(r)
        setF((x) => ({ ...x, name: r.name || '', email: r.email || '' }))
      })
      .catch(() => setInv({ ok: false, reason: 'offline', company: '' }))
  }, [token])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (f.password.length < 8) return toast('Your password needs at least 8 characters.', 'error')
    setBusy(true)
    try {
      const r = await pb.send<{ token: string; record: User }>(`/api/ch/invites/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        body: { name: f.name.trim(), email: f.email.trim(), password: f.password },
      })
      pb.authStore.save(r.token, r.record as never)
      if (!inv?.joined) {
        try {
          localStorage.setItem(WELCOME_KEY, '1')
        } catch {
          /* ignore */
        }
      }
      location.hash = '#/today'
      if (inv?.joined) toast('New password saved')
    } catch (err) {
      toast(errMsg(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!inv) return <Spinner />

  if (!inv.ok)
    return (
      <div className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-6 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-ios-orange/15 text-ios-orange">
          <Icon name="alert" size={32} />
        </span>
        <h1 className="mt-4 text-[24px] font-bold">{inv.reason === 'offline' ? "Can't Connect" : 'This link has expired'}</h1>
        <p className="mt-2 text-[17px] text-ios-label2">
          {inv.reason === 'offline'
            ? 'Check your internet connection and open the link again.'
            : `Ask your manager${inv.company ? ` at ${inv.company}` : ''} to send you a new link. Each link works once.`}
        </p>
        <a href="#/today" className="mt-8 text-[17px] text-ios-blue">
          Go to Sign In
        </a>
      </div>
    )

  const first = (inv.name || '').split(' ')[0]
  const reset = !!inv.joined
  // Someone else is signed in on this phone (e.g. the owner testing the link): say so before switching.
  const current = pb.authStore.isValid ? (pb.authStore.record as { name?: string } | null) : null
  const otherAccount = current?.name && current.name !== inv.name ? current.name : ''
  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col items-center px-5 pb-12" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 48px)' }}>
      <img src="./icon.svg" alt="" className="h-20 w-20 rounded-[18px] shadow-[0_8px_24px_rgba(0,98,224,0.25)]" />
      <h1 className="mt-5 text-center text-[28px] font-bold leading-tight tracking-tight">{reset ? 'Choose a New Password' : `Join ${inv.company || 'your team'}`}</h1>
      <p className="mt-2 text-center text-[17px] text-ios-label2">
        {reset
          ? `Hi ${first}! Pick a new password to get back in.`
          : `Hi ${first}! ${inv.invitedBy ? `${inv.invitedBy} invited you` : 'You were invited'} to see your schedule, clock in and swap shifts here.`}
      </p>
      <form onSubmit={submit} className="mt-8 w-full space-y-6">
        {otherAccount && (
          <Banner tone="orange" icon="info">
            This phone is signed in as <b>{otherAccount}</b>. {reset ? 'Saving' : 'Joining'} signs {otherAccount.split(' ')[0]} out here. This link is for {first}'s phone.
          </Banner>
        )}
        {!reset && (
          <Group header="Your Name">
            <InputRow placeholder="Full name" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          </Group>
        )}
        {!reset && !inv.email && (
          <Group header="Email (optional)" footer={inv.phone ? `You'll sign in with your phone, ${inv.phone}. Add an email if you'd also like to use it.` : undefined}>
            <InputRow type="email" placeholder="you@email.com" autoComplete="email" autoCapitalize="none" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Group>
        )}
        <Group
          header={reset ? 'New Password' : 'Create a Password'}
          footer={`At least 8 characters. You'll sign in with your ${[inv.phone && 'phone number', (inv.email || f.email) && 'email'].filter(Boolean).join(' or ') || 'email'} and this password.`}
        >
          <div className="ios-row relative flex min-h-[44px] items-center gap-3 px-4">
            <input
              type={show ? 'text' : 'password'}
              placeholder="Password"
              autoComplete="new-password"
              autoFocus={reset}
              value={f.password}
              onChange={(e) => setF({ ...f, password: e.target.value })}
              className="min-w-0 flex-1 bg-transparent py-[11px] text-[17px] outline-none placeholder:text-ios-label3"
            />
            <button type="button" onClick={() => setShow(!show)} className="text-[15px] text-ios-blue">
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
        </Group>
        <Button type="submit" size="lg" full busy={busy} disabled={f.password.length < 8 || (!reset && !f.name.trim())}>
          {reset ? 'Save and Sign In' : 'Join'}
        </Button>
      </form>
    </div>
  )
}
