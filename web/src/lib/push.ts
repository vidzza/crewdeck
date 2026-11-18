// Push notifications on this phone or computer (the server side is backend/server/push.go).
import { pb } from './pb'

// on: this device gets notifications · off: not yet turned on · blocked: the person said no (settings needed)
// needs-install: iPhone/iPad in a Safari tab, where web notifications only work from the Home Screen app
// unsupported: this browser can't do it at all
export type PushStatus = 'on' | 'off' | 'blocked' | 'needs-install' | 'unsupported'

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
const standalone = () => (navigator as unknown as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches

export const pushSupported = () => window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

async function registration(): Promise<ServiceWorkerRegistration> {
  if (!(await navigator.serviceWorker.getRegistration())) await navigator.serviceWorker.register('./sw.js')
  return navigator.serviceWorker.ready
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) ?? null
}

export async function pushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return isIOS() && !standalone() ? 'needs-install' : 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  if (Notification.permission !== 'granted') return 'off'
  return (await currentSubscription()) ? 'on' : 'off'
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4))
  const out = new Uint8Array(new ArrayBuffer(s.length))
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

function sameKey(sub: PushSubscription, key: Uint8Array) {
  const k = sub.options.applicationServerKey
  if (!k) return false
  const a = new Uint8Array(k)
  return a.length === key.length && a.every((v, i) => v === key[i])
}

// Subscribes this device (if needed) and tells the server it belongs to whoever is signed in.
async function subscribe() {
  const reg = await registration()
  const { key } = await pb.send<{ key: string }>('/api/ch/push/key', { method: 'GET' })
  const bytes = keyBytes(key)
  let sub = await reg.pushManager.getSubscription()
  if (sub && !sameKey(sub, bytes)) {
    await sub.unsubscribe()
    sub = null
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes })
  await pb.send('/api/ch/push/subscribe', { method: 'POST', body: sub.toJSON() })
}

// Call straight from a tap: the browser only shows its "Allow notifications?" question after one.
export async function enablePush(): Promise<PushStatus> {
  if (!pushSupported()) return pushStatus()
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return perm === 'denied' ? 'blocked' : 'off'
  await subscribe()
  return 'on'
}

export async function disablePush() {
  const sub = await currentSubscription()
  if (!sub) return
  await pb.send('/api/ch/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {})
  await sub.unsubscribe().catch(() => {})
}

export async function sendTestPush(): Promise<{ sent: number; failed: number }> {
  return pb.send('/api/ch/push/test', { method: 'POST' })
}

// On app start: if this device already allowed notifications, keep the server in sync
// (a renewed subscription, or a different person signed in on this device).
export async function syncPush() {
  try {
    if (pushSupported() && Notification.permission === 'granted' && pb.authStore.isValid) await subscribe()
  } catch {
    /* try again next time the app opens */
  }
}

// The number on the Home Screen icon (iPhone app, Android, desktop apps).
export function syncBadge(unread: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
  try {
    ;(unread > 0 ? nav.setAppBadge?.(unread) : nav.clearAppBadge?.())?.catch(() => {})
  } catch {
    /* not supported */
  }
}
