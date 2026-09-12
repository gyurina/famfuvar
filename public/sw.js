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


// ── Push kézbesítés mérés helper ────────────────────────────────────────
// supabase_url a push payloadból jön (notify-custom injektálja)
let _supabaseUrl = ''

async function reportPushReceipt(logId, eventType, supabaseUrl) {
  if (!logId) return
  const url = supabaseUrl || _supabaseUrl
  if (!url) return
  try {
    await fetch(`${url}/functions/v1/push-receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_id: logId, event: eventType, user_agent: self.navigator?.userAgent }),
    })
  } catch (_) { /* best-effort */ }
}

// ── Push értesítés ──────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data?.json() ?? {} } catch { data = { title: 'Fuvar értesítés' } }

  const title       = data.title       ?? 'Fuvar értesítés'
  const logId       = data.log_id      ?? null
  const supabaseUrl = data.supabase_url ?? ''
  if (supabaseUrl) _supabaseUrl = supabaseUrl  // megjegyezzük a következő click-hez
  const options = {
    body:    data.body    ?? '',
    icon:    '/pwa-192x192.png',
    badge:   '/pwa-192x192.png',
    vibrate: [200, 100, 200],
    data:    { url: data.url ?? '/?inbox=1', log_id: logId, supabase_url: supabaseUrl },
    actions: [{ action: 'open', title: 'Megnyitás' }],
  }

  event.waitUntil(
    self.registration.showNotification(title, options).then(() => {
      return reportPushReceipt(logId, 'delivered', supabaseUrl)
    })
  )
})

// ── Értesítésre kattintás ───────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/?inbox=1'

  const logId       = event.notification.data?.log_id       ?? null
  const supabaseUrl = event.notification.data?.supabase_url ?? ''
  event.waitUntil(
    Promise.all([
      reportPushReceipt(logId, 'clicked', supabaseUrl),
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
        for (const w of wins) {
          if ('focus' in w) { w.navigate?.(url); return w.focus() }
        }
        return clients.openWindow(url)
      }),
    ])
  )
})
