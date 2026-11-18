// Crewdeck service worker: makes the app installable and shows push notifications. Caches nothing.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})

// A notification from the server: { title, body, url: "#/requests", tag, badge: unread count }
self.addEventListener('push', (e) => {
  let d = {}
  try {
    d = e.data ? e.data.json() : {}
  } catch {
    d = { body: e.data ? e.data.text() : '' }
  }
  const shown = self.registration.showNotification(d.title || 'Crewdeck', {
    body: d.body || '',
    icon: './icon-192.png',
    tag: d.tag || undefined,
    data: { url: d.url || '#/today' },
  })
  const nav = self.navigator
  const badge =
    typeof d.badge === 'number' && nav && 'setAppBadge' in nav
      ? (d.badge > 0 ? nav.setAppBadge(d.badge) : nav.clearAppBadge()).catch(() => {})
      : Promise.resolve()
  e.waitUntil(Promise.all([shown, badge]))
})

// Tapping a notification opens Crewdeck on the right screen (or brings the open app forward).
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const hash = (e.notification.data && e.notification.data.url) || '#/today'
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const win = wins.find((c) => c.url.startsWith(self.registration.scope))
      if (win) {
        await win.focus()
        win.postMessage({ type: 'crewdeck-open', hash })
        return
      }
      await self.clients.openWindow(new URL(hash, self.registration.scope).href)
    })(),
  )
})
