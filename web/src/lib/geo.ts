export interface Pos {
  lat: number
  lng: number
  acc: number
}

export interface PosResult {
  pos: Pos | null
  error: string | null
}

// A single reading when clocking in/out (nobody is tracked).
export function getPosition(timeout = 15000): Promise<PosResult> {
  return new Promise((resolve) => {
    // Browsers only share location with secure (https) pages; they don't even ask on plain http.
    if (!window.isSecureContext)
      return resolve({ pos: null, error: 'Location only works on a secure (https://) link. The real app on your domain will ask for permission.' })
    if (!('geolocation' in navigator)) return resolve({ pos: null, error: 'Location is not available on this device.' })
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ pos: { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }, error: null }),
      (err) => {
        const msg =
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was denied. Turn it on in your browser settings to clock in.'
            : err.code === err.TIMEOUT
              ? 'GPS took too long. Try again, ideally near a window or door.'
              : "Couldn't read your location."
        resolve({ pos: null, error: msg })
      },
      { enableHighAccuracy: true, timeout, maximumAge: 0 },
    )
  })
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
