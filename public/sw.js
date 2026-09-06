// Família Fuvar — Service Worker
// Push értesítések + offline shell cache

const CACHE = 'fuvar-v1'
const SHELL = ['/', '/index.html', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

// Network-first fetch (shell fallback)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  if (event.request.url.includes('/rest/v1/') || event.request.url.includes('/auth/')) return
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  )
})

// ── Push értesítés ──────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data?.json() ?? {} } catch { data = { title: 'Fuvar értesítés' } }

  const title   = data.title   ?? 'Fuvar értesítés'
  const options = {
    body:    data.body    ?? '',
    icon:    '/pwa-192x192.png',
    badge:   '/pwa-192x192.png',
    vibrate: [200, 100, 200],
    data:    { url: data.url ?? '/fuvartabla' },
    actions: [{ action: 'open', title: 'Megnyitás' }],
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// ── Értesítésre kattintás ───────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/fuvartabla'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) { w.navigate?.(url); return w.focus() }
      }
      return clients.openWindow(url)
    })
  )
})
