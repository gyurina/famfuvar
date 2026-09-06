// supabase/functions/notify-driver/index.ts
// Sofőr-hozzárendelés push értesítés küldése Web Push (VAPID) protokollal.
//
// Szükséges Supabase secrets (supabase secrets set):
//   VAPID_PUBLIC_KEY=<generated>
//   VAPID_PRIVATE_KEY=<generated>
//   VAPID_SUBJECT=mailto:admin@example.com
//
// VAPID kulcsgenerálás (egyszer, helyi gépen):
//   npx web-push generate-vapid-keys
//   → másold a VITE_VAPID_PUBLIC_KEY értéket az .env.local-ba is

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Egyszerű VAPID-alapú push küldés Deno Web Crypto API-val
async function importVapidKey(privateKeyB64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(privateKeyB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
  return crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey', 'deriveBits'])
}

async function buildVapidAuthHeader(
  endpoint: string,
  vapidPublicKey: string,
  vapidPrivateKeyB64: string,
  subject: string,
): Promise<string> {
  const url = new URL(endpoint)
  const audience = `${url.protocol}//${url.host}`
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600

  const header  = btoa(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const payload = btoa(JSON.stringify({ aud: audience, exp, sub: subject })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const data    = `${header}.${payload}`

  // Import private key as PKCS8 for signing
  const pkcs8Raw = Uint8Array.from(atob(vapidPrivateKeyB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
  const signingKey = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8Raw,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    signingKey,
    new TextEncoder().encode(data),
  )

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const jwt = `${data}.${sigB64}`

  return `vapid t=${jwt},k=${vapidPublicKey}`
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let legId: string
  try {
    const body = await req.json()
    legId = body.leg_id
    if (!legId) throw new Error('missing leg_id')
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 400 })
  }

  const supabaseUrl  = Deno.env.get('SUPABASE_URL')!
  const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const vapidPub     = Deno.env.get('VAPID_PUBLIC_KEY')!
  const vapidPriv    = Deno.env.get('VAPID_PRIVATE_KEY')!
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'

  if (!vapidPub || !vapidPriv) {
    return new Response(JSON.stringify({ error: 'VAPID keys not configured' }), { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // Leg + occurrence lekérése
  const { data: leg, error: legErr } = await supabase
    .from('transport_leg')
    .select('*, occurrence!inner(title, on_date, starts_at, ends_at)')
    .eq('id', legId)
    .single()

  if (legErr || !leg) {
    return new Response(JSON.stringify({ error: legErr?.message ?? 'leg not found' }), { status: 404 })
  }

  if (!leg.driver_id) {
    return new Response(JSON.stringify({ skipped: 'no driver assigned' }), { status: 200 })
  }

  // Sofőr auth_user_id-jának lekérése
  const { data: person, error: personErr } = await supabase
    .from('person')
    .select('auth_user_id, display_name')
    .eq('id', leg.driver_id)
    .single()

  if (personErr || !person?.auth_user_id) {
    return new Response(JSON.stringify({ skipped: 'no auth user' }), { status: 200 })
  }

  // Push feliratkozások lekérése
  const { data: subs } = await supabase
    .from('push_subscription')
    .select('endpoint, p256dh, auth')
    .eq('user_id', person.auth_user_id)

  if (!subs?.length) {
    return new Response(JSON.stringify({ skipped: 'no push subscriptions' }), { status: 200 })
  }

  // Értesítés szövege
  const occ       = leg.occurrence as { title: string; on_date: string; starts_at: string }
  const direction = leg.direction === 'dropoff' ? 'Elvitel' : 'Hazahozatal'
  const dateStr   = occ.on_date
  const timeStr   = occ.starts_at?.slice(0, 5) ?? '?'

  const payload = JSON.stringify({
    title: `🚗 Fuvar: ${occ.title}`,
    body:  `${direction} · ${dateStr} ${timeStr}`,
    url:   '/fuvartabla',
  })

  // Küldés minden feliratkozásra
  const results = await Promise.allSettled(
    subs.map(async (sub) => {
      const authHeader = await buildVapidAuthHeader(sub.endpoint, vapidPub, vapidPriv, vapidSubject)
      const res = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/octet-stream',
          'Content-Length': String(new TextEncoder().encode(payload).length),
          'TTL':            '86400',
          'Authorization':  authHeader,
        },
        body: payload,
      })
      if (!res.ok) throw new Error(`push failed: ${res.status}`)
    })
  )

  const sent   = results.filter(r => r.status === 'fulfilled').length
  const failed = results.filter(r => r.status === 'rejected').length
  console.log(`notify-driver: ${sent} sent, ${failed} failed`)

  return new Response(JSON.stringify({ sent, failed }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
