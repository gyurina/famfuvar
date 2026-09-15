// Família Fuvar — Service Worker
// Push értesítések + offline shell cache

const SW_VERSION = '1.1.0'
const CACHE = 'fuvar-v1.1.0'
const SHELL = ['/', '/index.html', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  console.log(`[SW] v${SW_VERSION} aktív`)
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
// supabase_url + apikey a push payloadból jön (notify-custom / notify-driver)
let _supabaseUrl = ''
let _apikey = ''

async function reportPushReceipt(logId, eventType, supabaseUrl, apikey) {
  if (!logId) return
  const url = supabaseUrl || _supabaseUrl
  if (!url) {
    console.error('[SW] push-receipt skipped: no supabase_url')
    return
  }
  const key = apikey || _apikey
  try {
    const headers = { 'Content-Type': 'application/json' }
    if (key) {
      headers.apikey = key
      headers.Authorization = `Bearer ${key}`
    }
    const res = await fetch(`${url}/functions/v1/push-receipt`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ log_id: logId, event: eventType, user_agent: self.navigator?.userAgent }),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      console.error('[SW] push-receipt HTTP', res.status, txt)
    }
  } catch (e) {
    console.error('[SW] push-receipt fetch failed:', e)
  }
}

// ── Push értesítés ──────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data?.json() ?? {} } catch { data = { title: 'Fuvar értesítés' } }

  const title       = data.title       ?? 'Fuvar értesítés'
  const logId       = data.log_id      ?? null
  const supabaseUrl = data.supabase_url ?? ''
  const apikey      = data.apikey      ?? ''
  if (supabaseUrl) _supabaseUrl = supabaseUrl
  if (apikey) _apikey = apikey
  const options = {
    body:    data.body    ?? '',
    icon:    '/pwa-192x192.png',
    badge:   '/pwa-192x192.png',
    vibrate: [200, 100, 200],
    data:    { url: data.url ?? '/uzenetek', log_id: logId, supabase_url: supabaseUrl, apikey },
    actions: [{ action: 'open', title: 'Megnyitás' }],
  }

  event.waitUntil(
    self.registration.showNotification(title, options).then(() => {
      return reportPushReceipt(logId, 'delivered', supabaseUrl, apikey)
    })
  )
})

// ── Értesítésre kattintás ───────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/uzenetek'

  const logId       = event.notification.data?.log_id       ?? null
  const supabaseUrl = event.notification.data?.supabase_url ?? ''
  const apikey      = event.notification.data?.apikey      ?? ''
  event.waitUntil(
    Promise.all([
      reportPushReceipt(logId, 'clicked', supabaseUrl, apikey),
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
        for (const w of wins) {
          if ('focus' in w) { w.navigate?.(url); return w.focus() }
        }
        return clients.openWindow(url)
      }),
    ])
  )
})
