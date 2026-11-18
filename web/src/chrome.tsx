// Pieces of app chrome shared by several screens.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { addDays, fmtWeek, startOfWeek } from './lib/dates'
import { detectPlatform, getPosition, readPosition, setLocationHelp, type Platform, type PosResult } from './lib/geo'
import { useData } from './store'
import { Avatar, Button, Group, HeaderButton, Row, Sheet, toast } from './ui'
import { Icon } from './icons'

// Bell + avatar in the top-right corner of every main screen.
export function TopActions({ children }: { children?: ReactNode }) {
  const { me, unread } = useData()
  return (
    <>
      {children}
      <HeaderButton href="#/notifications" icon="bell" label="Notifications" badge={unread} />
      <a href="#/account" aria-label="Account" className="ml-1 active:opacity-50">
        <Avatar name={me.name || me.email} size={32} />
      </a>
    </>
  )
}

// "‹  Nov 16 – 22  ›" week switcher.
export function WeekBar({ week, onChange }: { week: Date; onChange: (d: Date) => void }) {
  const thisWeek = startOfWeek(new Date()).getTime() === week.getTime()
  return (
    <div className="flex items-center justify-between">
      <button type="button" aria-label="Previous week" onClick={() => onChange(addDays(week, -7))} className="flex h-11 w-11 items-center justify-center rounded-full text-ios-blue active:bg-ios-fill">
        <Icon name="chevron-left" size={24} stroke={2.4} />
      </button>
      <div className="text-center">
        <div className="text-[17px] font-semibold">{fmtWeek(week)}</div>
        {thisWeek ? (
          <div className="text-[13px] text-ios-label2">This Week</div>
        ) : (
          <button type="button" onClick={() => onChange(startOfWeek(new Date()))} className="text-[13px] font-medium text-ios-blue">
            Go to This Week
          </button>
        )}
      </div>
      <button type="button" aria-label="Next week" onClick={() => onChange(addDays(week, 7))} className="flex h-11 w-11 items-center justify-center rounded-full text-ios-blue active:bg-ios-fill">
        <Icon name="chevron-right" size={24} stroke={2.4} />
      </button>
    </div>
  )
}

export function isStandalone() {
  return (navigator as unknown as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches
}
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)

// Step-by-step help to put the app on the Home Screen.
export function InstallSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Add to Home Screen" onClose={onClose} onDone={onClose}>
      <div className="flex flex-col items-center text-center">
        <img src="./icon.svg" alt="" className="h-20 w-20 rounded-[18px] shadow-md" />
        <p className="mt-3 text-[15px] text-ios-label2">Open Crewdeck like any other app, with one tap from your Home Screen.</p>
      </div>
      <Group header="iPhone (Safari)">
        <Row leading={<Step n={1} />} title={<>Tap <b>Share</b> <Icon name="share" size={18} className="inline text-ios-blue" /> at the bottom of Safari</>} />
        <Row leading={<Step n={2} />} title={<>Scroll down and tap <b>Add to Home Screen</b></>} />
        <Row leading={<Step n={3} />} title={<>Tap <b>Add</b></>} />
      </Group>
      <Group header="Android (Chrome)">
        <Row leading={<Step n={1} />} title={<>Tap the <b>⋮</b> menu</>} />
        <Row leading={<Step n={2} />} title={<>Tap <b>Install app</b> or <b>Add to Home screen</b></>} />
      </Group>
      <Group footer="When it asks to use your location, tap Allow. We only check it when you clock in or out.">
        <Row icon="pin" iconBg="#34c759" title="Allow location" />
      </Group>
    </Sheet>
  )
}

function Step({ n }: { n: number }) {
  return <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ios-blue text-[15px] font-semibold text-white">{n}</span>
}

// iOS-style pull-down to switch location. Only shows when someone works at more than one.
export function LocationPicker() {
  const { myLocations, currentLocation, setCurrentLocation } = useData()
  if (myLocations.length < 2 || !currentLocation) return null
  return (
    <label className="relative inline-flex max-w-full items-center gap-1.5 self-start rounded-full bg-white py-2 pl-3 pr-3.5 text-[15px] font-semibold text-ios-blue shadow-[0_1px_2px_rgba(0,0,0,0.06)] active:opacity-60">
      <Icon name="pin" size={16} />
      <span className="truncate">{currentLocation.name}</span>
      <Icon name="chevron-updown" size={14} stroke={2.4} />
      <select
        aria-label="Location"
        value={currentLocation.id}
        onChange={(e) => setCurrentLocation(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {myLocations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  )
}

// Shown once right after someone joins with an invite link.
export function WelcomeSheet({ onClose }: { onClose: () => void }) {
  const { company, me } = useData()
  const [loc, setLoc] = useState<'idle' | 'asking' | 'ok' | 'no'>('idle')
  const askLocation = async () => {
    setLoc('asking')
    const g = await getPosition(15000)
    setLoc(g.pos ? 'ok' : 'no')
  }
  return (
    <Sheet title="Welcome" onClose={onClose} onDone={onClose} doneLabel="Done">
      <div className="flex flex-col items-center text-center">
        <img src="./icon.svg" alt="" className="h-20 w-20 rounded-[18px] shadow-md" />
        <h3 className="mt-3 text-[24px] font-bold">You're in, {(me.name || '').split(' ')[0] || 'welcome'}!</h3>
        <p className="mt-1 text-[15px] text-ios-label2">
          This is where you'll see your shifts at {company?.name || 'work'}, clock in and out, and swap shifts. Two quick things:
        </p>
      </div>
      <Group header="1. Allow your location" footer="We only check it when you clock in or out, to confirm you're at work. We never track you.">
        <Row
          icon="pin"
          iconBg={loc === 'ok' ? '#34c759' : '#007aff'}
          title={loc === 'ok' ? 'Location allowed' : loc === 'no' ? "Location isn't allowed yet" : 'Allow Location'}
          subtitle={loc === 'no' ? 'Turn it on in your phone settings for this browser, then try again.' : undefined}
          tone={loc === 'ok' ? 'success' : 'link'}
          onClick={loc === 'ok' || loc === 'asking' ? undefined : askLocation}
        />
      </Group>
      <Group header="2. Add Crewdeck to your Home Screen" footer="So it opens like any other app.">
        <Row leading={<Step n={1} />} title={<>Tap <b>Share</b> <Icon name="share" size={18} className="inline text-ios-blue" /> (iPhone) or the <b>⋮</b> menu (Android)</>} />
        <Row leading={<Step n={2} />} title={<>Tap <b>Add to Home Screen</b></>} />
      </Group>
      <Button size="lg" full onClick={onClose}>
        Get Started
      </Button>
    </Sheet>
  )
}

// ---------- "Turn On Location" help ----------
// Opens by itself whenever the phone or browser blocks location (they don't even ask once it's blocked).
// Mounted once at the app root; getPosition() waits for it.
export function LocationHelp() {
  const [req, setReq] = useState<{ timeout: number; finish: (r: PosResult) => void } | null>(null)
  useEffect(() => {
    let pending: Promise<PosResult> | null = null
    let current: ((r: PosResult) => void) | null = null
    setLocationHelp((timeout) => {
      if (!pending)
        pending = new Promise<PosResult>((resolve) => {
          current = (r) => {
            pending = null
            current = null
            setReq(null)
            resolve(r)
          }
          setReq({ timeout, finish: current })
        })
      return pending
    })
    return () => {
      setLocationHelp(null)
      current?.({ pos: null, error: null, code: 'denied' })
    }
  }, [])
  if (!req) return null
  return <LocationHelpSheet timeout={req.timeout} onFinish={req.finish} />
}

const HELP: Record<Platform, { device: string; steps: ReactNode[]; footer?: ReactNode }> = {
  'ios-safari': {
    device: 'iPhone · Safari',
    steps: [
      <>
        Open the <b>Settings</b> app, then <b>Privacy &amp; Security</b> → <b>Location Services</b>
      </>,
      <>
        Make sure <b>Location Services</b> is on
      </>,
      <>
        Scroll down to <b>Safari Websites</b>, choose <b>While Using the App</b> and turn on <b>Precise Location</b>
      </>,
      <>
        Come back here and tap <b>Try Again</b>
      </>,
    ],
    footer: (
      <>
        Still not asking? In Settings, open <b>Apps → Safari → Location</b> and choose <b>Allow</b>.
      </>
    ),
  },
  'ios-chrome': {
    device: 'iPhone · Chrome',
    steps: [
      <>
        Open the <b>Settings</b> app, then <b>Privacy &amp; Security</b> → <b>Location Services</b>
      </>,
      <>
        Make sure <b>Location Services</b> is on
      </>,
      <>
        Scroll down to <b>Chrome</b>, choose <b>While Using the App</b> and turn on <b>Precise Location</b>
      </>,
      <>
        Come back here and tap <b>Try Again</b>
      </>,
    ],
  },
  'ios-other': {
    device: 'iPhone',
    steps: [
      <>
        Open the <b>Settings</b> app, then <b>Privacy &amp; Security</b> → <b>Location Services</b>
      </>,
      <>
        Make sure <b>Location Services</b> is on
      </>,
      <>
        Scroll down to the browser you're using, choose <b>While Using the App</b> and turn on <b>Precise Location</b>
      </>,
      <>
        Come back here and tap <b>Try Again</b>
      </>,
    ],
  },
  android: {
    device: 'Android',
    steps: [
      <>
        Swipe down from the top of the screen and make sure <b>Location</b> is on
      </>,
      <>
        Tap the icon to the left of the web address, then <b>Permissions</b>, and turn on <b>Location</b>
      </>,
      <>
        Tap <b>Try Again</b>
      </>,
    ],
    footer: (
      <>
        Still not asking? Open the phone's <b>Settings → Apps → Chrome → Permissions → Location</b> and choose <b>Allow only while using the app</b>.
      </>
    ),
  },
  'mac-safari': {
    device: 'Mac · Safari',
    steps: [
      <>
        Open <b>System Settings → Privacy &amp; Security → Location Services</b> and turn on <b>Safari</b>
      </>,
      <>
        In Safari, open <b>Safari → Settings → Websites → Location</b> and set this site to <b>Allow</b>
      </>,
      <>
        Click <b>Try Again</b>
      </>,
    ],
  },
  'mac-chrome': {
    device: 'Mac · Chrome',
    steps: [
      <>
        Open <b>System Settings → Privacy &amp; Security → Location Services</b> and turn on <b>Google Chrome</b>
      </>,
      <>
        In Chrome, click the icon to the left of the web address and turn on <b>Location</b>
      </>,
      <>
        Click <b>Try Again</b>
      </>,
    ],
  },
  other: {
    device: 'This device',
    steps: [
      <>Make sure location is turned on for this device</>,
      <>
        In your browser, click the icon to the left of the web address and allow <b>Location</b> for this site
      </>,
      <>
        Click <b>Try Again</b>
      </>,
    ],
  },
  'inapp-ios': {
    device: 'Open it in Safari',
    steps: [
      <>
        Tap the <b>⋯</b> or <b>Share</b> button in this screen
      </>,
      <>
        Choose <b>Open in Safari</b>
      </>,
    ],
    footer: 'No such button? Copy the link and paste it into Safari.',
  },
  'inapp-android': {
    device: 'Open it in Chrome',
    steps: [
      <>
        Tap the <b>⋮</b> menu in this screen
      </>,
      <>
        Choose <b>Open in Chrome</b> (or <b>Open in browser</b>)
      </>,
    ],
    footer: 'No such option? Copy the link and paste it into Chrome.',
  },
}

function LocationHelpSheet({ timeout, onFinish }: { timeout: number; onFinish: (r: PosResult) => void }) {
  const platform = useMemo(detectPlatform, [])
  const help = HELP[platform]
  const inApp = platform.startsWith('inapp')
  const [busy, setBusy] = useState(false)
  const [stillOff, setStillOff] = useState<string | null>(null)
  const close = useCallback(() => onFinish({ pos: null, error: null, code: 'denied' }), [onFinish])

  const retry = async () => {
    setBusy(true)
    setStillOff(null)
    const r = await readPosition(timeout)
    setBusy(false)
    if (r.pos) return onFinish(r)
    setStillOff(r.code === 'denied' ? 'Location is still blocked. If you just changed the setting, reload this page and try again.' : r.error)
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast('Link copied')
    } catch {
      prompt('Copy this link:', window.location.href)
    }
  }

  return (
    <Sheet title="Location" onClose={close}>
      <div className="flex flex-col items-center text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-ios-blue/12 text-ios-blue">
          <Icon name="location" size={32} />
        </span>
        <h3 className="mt-3 text-[22px] font-bold">Turn On Location</h3>
        <p className="mt-1 text-[15px] text-ios-label2">
          {inApp
            ? "You opened Crewdeck inside another app, and it blocks location. Open it in your phone's browser instead."
            : "Your phone is blocking location for this browser, so it can't ask you. We only check it when you clock in or out, never in between."}
        </p>
      </div>
      <Group header={help.device} footer={help.footer}>
        {help.steps.map((s, i) => (
          <Row key={i} leading={<Step n={i + 1} />} title={<span className="text-[16px]">{s}</span>} />
        ))}
      </Group>
      {inApp ? (
        <Button size="lg" full icon="copy" onClick={copyLink}>
          Copy Link
        </Button>
      ) : (
        <div className="space-y-3">
          <Button size="lg" full icon="location" busy={busy} onClick={retry}>
            Try Again
          </Button>
          {stillOff && (
            <>
              <p className="px-4 text-center text-[15px] text-ios-red">{stillOff}</p>
              <Button variant="gray" size="lg" full onClick={() => window.location.reload()}>
                Reload Page
              </Button>
            </>
          )}
        </div>
      )}
    </Sheet>
  )
}
