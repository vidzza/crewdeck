import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { pb, api, errMsg, signInIdentity, API_URL } from '../lib/pb'
import { getPosition } from '../lib/geo'
import { Button, Group, InputRow, Row, Spinner, toast } from '../ui'
import { Icon } from '../icons'

interface Status {
  needsSetup: boolean
  needsCode: boolean
  company: string
}

export default function Login() {
  const [status, setStatus] = useState<Status | null>(null)
  const [offline, setOffline] = useState(false)

  const check = () => {
    setOffline(false)
    setStatus(null)
    pb.send<Status>('/api/ch/status', {})
      .then(setStatus)
      .catch(() => setOffline(true))
  }
  useEffect(check, [])

  if (offline)
    return (
      <Centered>
        <Icon name="alert" size={40} stroke={1.6} className="text-ios-orange" />
        <p className="mt-3 text-[17px] font-semibold">Can't Connect</p>
        <p className="mt-1 text-[15px] text-ios-label2">Check your internet connection. If it keeps happening, tell your manager.</p>
        <Button variant="tinted" className="mt-6" onClick={check}>
          Try Again
        </Button>
        <p className="mt-6 break-all text-[12px] text-ios-label3">{API_URL}</p>
      </Centered>
    )
  if (!status) return <Spinner />
  if (status.needsSetup) return <SetupWizard needsCode={status.needsCode} />
  return <LoginForm company={status.company} />
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-6 text-center" style={{ paddingBottom: 80 }}>
      {children}
    </div>
  )
}

function AppIcon({ size = 88 }: { size?: number }) {
  return <img src="./icon.svg" alt="" style={{ width: size, height: size }} className="rounded-[22%] shadow-[0_8px_24px_rgba(0,98,224,0.25)]" />
}

// ---------- sign in ----------
function LoginForm({ company }: { company: string }) {
  const [id, setId] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [help, setHelp] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await pb.collection('users').authWithPassword(signInIdentity(id), password)
    } catch (err) {
      toast(errMsg(err).includes('authenticate') ? "That didn't work. Check your email or phone and password." : errMsg(err), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col items-center px-5 pb-12" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 56px)' }}>
      <AppIcon />
      <h1 className="mt-5 text-center text-[28px] font-bold tracking-tight">{company || 'Crewdeck'}</h1>
      <p className="mt-1 text-center text-[17px] text-ios-label2">Sign in to see your schedule and clock in.</p>
      <form onSubmit={submit} className="mt-8 w-full space-y-6">
        <Group>
          <InputRow placeholder="Email or phone number" autoComplete="username" autoCapitalize="none" autoCorrect="off" value={id} onChange={(e) => setId(e.target.value)} required />
          <InputRow type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Group>
        <Button type="submit" size="lg" full busy={busy} disabled={!id || !password}>
          Sign In
        </Button>
        <button type="button" onClick={() => setHelp(!help)} className="mx-auto block text-[15px] text-ios-blue">
          Forgot password or new here?
        </button>
        {help && (
          <p className="rounded-2xl bg-white p-4 text-center text-[15px] text-ios-label2">
            Ask your manager to send you a sign-in link. Open it on your phone and choose a new password.
          </p>
        )}
      </form>
    </div>
  )
}

// ---------- first-time setup: company → first location → owner ----------
function SetupWizard({ needsCode }: { needsCode: boolean }) {
  const [step, setStep] = useState(0)
  const [f, setF] = useState({ company: '', locName: '', address: '', lat: 0, lng: 0, acc: 0, name: '', email: '', phone: '', password: '', code: '' })
  const [busy, setBusy] = useState(false)
  const [gps, setGps] = useState<'idle' | 'asking' | 'ok' | 'no'>('idle')
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const total = 3

  const useHere = async () => {
    setGps('asking')
    const g = await getPosition(20000)
    if (g.pos) {
      setF((x) => ({ ...x, lat: g.pos!.lat, lng: g.pos!.lng, acc: g.pos!.acc }))
      setGps('ok')
    } else {
      setGps('no')
      if (g.error) toast(g.error, 'info')
    }
  }

  const finish = async (e: FormEvent) => {
    e.preventDefault()
    if (f.password.length < 8) return toast('Your password needs at least 8 characters.', 'error')
    setBusy(true)
    try {
      await api('/api/ch/setup', {
        company: f.company.trim(),
        location: { name: f.locName.trim() || f.company.trim(), address: f.address.trim(), lat: f.lat, lng: f.lng },
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        name: f.name.trim(),
        email: f.email.trim().toLowerCase(),
        phone: f.phone.trim(),
        password: f.password,
        code: f.code,
      })
      await pb.collection('users').authWithPassword(f.email.trim().toLowerCase(), f.password)
      location.hash = '#/today'
      toast(`Welcome to Crewdeck, ${f.name.trim().split(' ')[0]}!`)
    } catch (err) {
      toast(errMsg(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (step === 0)
    return (
      <Centered>
        <AppIcon size={96} />
        <h1 className="mt-6 text-[32px] font-bold tracking-tight">Welcome to Crewdeck</h1>
        <p className="mt-2 text-[17px] text-ios-label2">Schedules, time clock and shift swaps for your whole team, in one simple app.</p>
        <div className="mt-8 w-full space-y-4 text-left">
          {(
            [
              ['calendar', 'Build and share schedules', 'Your team sees their shifts on their phone.'],
              ['clock', 'Clock in from any phone', 'Location is checked so people are where they should be.'],
              ['swap', 'Swaps you approve', 'People trade shifts; you always have the final say.'],
            ] as const
          ).map(([icon, t, s]) => (
            <div key={t} className="flex gap-3">
              <Icon name={icon} size={28} className="mt-0.5 text-ios-blue" />
              <div>
                <div className="text-[17px] font-semibold">{t}</div>
                <div className="text-[15px] text-ios-label2">{s}</div>
              </div>
            </div>
          ))}
        </div>
        <Button size="lg" full className="mt-10" onClick={() => setStep(1)}>
          Set Up My Company
        </Button>
        <p className="mt-3 text-[13px] text-ios-label2">Takes about 2 minutes.</p>
      </Centered>
    )

  return (
    <div className="mx-auto min-h-screen max-w-sm px-5 pb-12" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}>
      <div className="flex h-11 items-center justify-between">
        <button type="button" onClick={() => setStep(step - 1)} className="flex items-center text-[17px] text-ios-blue active:opacity-40">
          <Icon name="chevron-left" size={26} stroke={2.4} />
          Back
        </button>
        <span className="text-[13px] font-medium text-ios-label2">
          Step {step} of {total}
        </span>
      </div>
      <div className="mt-2 flex gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${i < step ? 'bg-ios-blue' : 'bg-ios-gray5'}`} />
        ))}
      </div>

      {step === 1 && (
        <form
          className="mt-8 space-y-6"
          onSubmit={(e) => {
            e.preventDefault()
            if (f.company.trim()) setStep(2)
          }}
        >
          <StepTitle icon="building" title="What's your company called?" text="This is the name your team will see." />
          <Group footer="You can change it later in Settings.">
            <InputRow placeholder="Company name" autoFocus value={f.company} onChange={set('company')} />
          </Group>
          <Button type="submit" size="lg" full disabled={!f.company.trim()}>
            Continue
          </Button>
        </form>
      )}

      {step === 2 && (
        <form
          className="mt-8 space-y-6"
          onSubmit={(e) => {
            e.preventDefault()
            setStep(3)
          }}
        >
          <StepTitle icon="pin" title="Add your first location" text="Where your team works. You can add more locations later." />
          <Group>
            <InputRow placeholder="Location name (e.g. Downtown)" value={f.locName} onChange={set('locName')} />
            <InputRow placeholder="Address (optional)" value={f.address} onChange={set('address')} />
          </Group>
          <Group
            header="Time clock spot"
            footer={
              gps === 'ok'
                ? `Saved (±${f.acc} m). Your team can only clock in near this spot.`
                : "Are you there right now? Save this spot so your team can only clock in nearby. If you're not, skip it and set it later."
            }
          >
            <Row
              icon={gps === 'ok' ? 'check' : 'location'}
              iconBg={gps === 'ok' ? '#34c759' : '#007aff'}
              title={gps === 'ok' ? 'Spot Saved' : gps === 'asking' ? 'Finding you…' : "I'm Here — Use My Location"}
              tone={gps === 'ok' ? 'success' : 'link'}
              onClick={gps === 'asking' ? undefined : useHere}
            />
          </Group>
          <Button type="submit" size="lg" full>
            Continue
          </Button>
        </form>
      )}

      {step === 3 && (
        <form className="mt-8 space-y-6" onSubmit={finish}>
          <StepTitle icon="person" title="Create your account" text={`You'll be the owner of ${f.company.trim() || 'your company'}.`} />
          <Group footer="You'll sign in with your email or phone number and this password.">
            <InputRow placeholder="Your name" autoComplete="name" value={f.name} onChange={set('name')} required />
            <InputRow type="email" placeholder="Email" autoComplete="email" autoCapitalize="none" value={f.email} onChange={set('email')} required />
            <InputRow type="tel" placeholder="Mobile number (optional)" autoComplete="tel" value={f.phone} onChange={set('phone')} />
            <InputRow type="password" placeholder="Password (8+ characters)" autoComplete="new-password" minLength={8} value={f.password} onChange={set('password')} required />
          </Group>
          {needsCode && (
            <Group footer="The code set on the server for this installation.">
              <InputRow placeholder="Setup code" autoCapitalize="none" value={f.code} onChange={set('code')} required />
            </Group>
          )}
          <Button type="submit" size="lg" full busy={busy} disabled={!f.name.trim() || !f.email.trim() || f.password.length < 8}>
            Create Company
          </Button>
        </form>
      )}
    </div>
  )
}

function StepTitle({ icon, title, text }: { icon: 'building' | 'pin' | 'person'; title: string; text: string }) {
  return (
    <div className="text-center">
      <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-ios-blue/12 text-ios-blue">
        <Icon name={icon} size={30} />
      </span>
      <h1 className="mt-4 text-[28px] font-bold leading-tight tracking-tight">{title}</h1>
      <p className="mt-2 text-[17px] text-ios-label2">{text}</p>
    </div>
  )
}
