export interface Pos {
  lat: number
  lng: number
  acc: number
}

export type GeoCode = 'denied' | 'timeout' | 'unavailable' | 'insecure' | 'unsupported'

export interface PosResult {
  pos: Pos | null
  error: string | null
  code?: GeoCode
}

// One raw reading, no help shown.
export function readPosition(timeout = 15000): Promise<PosResult> {
  return new Promise((resolve) => {
    // Browsers only share location with secure (https) pages; they don't even ask on plain http.
    if (!window.isSecureContext)
      return resolve({ pos: null, code: 'insecure', error: 'Location only works on a secure (https://) link. The real app on your domain will ask for permission.' })
    if (!('geolocation' in navigator)) return resolve({ pos: null, code: 'unsupported', error: 'Location is not available on this device.' })
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ pos: { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }, error: null }),
      (err) =>
        resolve(
          err.code === err.PERMISSION_DENIED
            ? { pos: null, code: 'denied', error: 'Location is turned off for this browser.' }
            : err.code === err.TIMEOUT
              ? { pos: null, code: 'timeout', error: 'GPS took too long. Try again, ideally near a window or door.' }
              : { pos: null, code: 'unavailable', error: "Couldn't read your location. Check that Location Services is on." },
        ),
      { enableHighAccuracy: true, timeout, maximumAge: 0 },
    )
  })
}

// When the browser blocks location, the app opens step-by-step help for the person's phone
// (LocationHelp in chrome.tsx). It resolves with a position if "Try Again" works, or with
// { pos: null, error: null } if they close it, so callers don't show a second message.
type HelpHandler = (timeout: number) => Promise<PosResult>
let helpHandler: HelpHandler | null = null
export function setLocationHelp(h: HelpHandler | null) {
  helpHandler = h
}

// A single reading when clocking in/out (nobody is tracked).
export async function getPosition(timeout = 15000): Promise<PosResult> {
  const r = await readPosition(timeout)
  if (r.code === 'denied' && helpHandler) return helpHandler(timeout)
  return r
}

export type Platform = 'inapp-ios' | 'inapp-android' | 'ios-safari' | 'ios-chrome' | 'ios-other' | 'android' | 'mac-safari' | 'mac-chrome' | 'other'

export function detectPlatform(): Platform {
  const ua = navigator.userAgent
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches
  // Browsers built into other apps (Instagram, Facebook, TikTok…) usually block location.
  const inApp =
    /FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|musical_ly|BytedanceWebview|LinkedInApp|Twitter|; wv\)/i.test(ua) ||
    (ios && !standalone && !/Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua))
  if (inApp) return ios ? 'inapp-ios' : 'inapp-android'
  if (ios) return /CriOS/.test(ua) ? 'ios-chrome' : /FxiOS|EdgiOS|OPiOS/.test(ua) ? 'ios-other' : 'ios-safari'
  if (/Android/.test(ua)) return 'android'
  if (/Macintosh/.test(ua)) return /Chrome\/|Chromium|Edg\//.test(ua) ? 'mac-chrome' : 'mac-safari'
  return 'other'
}

export const GEO_LABEL: Record<string, string> = {
  inside: 'Inside',
  uncertain: 'At the edge',
  outside: 'Outside',
  low_accuracy: 'Weak GPS',
  no_gps: 'No GPS',
  not_configured: 'GPS not set up',
  manual: 'Manual',
}

export const GEO_TONE: Record<string, 'green' | 'orange' | 'red' | 'gray'> = {
  inside: 'green',
  uncertain: 'orange',
  outside: 'red',
  low_accuracy: 'red',
  no_gps: 'red',
  not_configured: 'gray',
  manual: 'gray',
}
