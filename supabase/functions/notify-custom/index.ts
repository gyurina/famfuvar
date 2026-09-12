// supabase/functions/notify-driver/index.ts
// RFC 8291 Web Push + VAPID (JWK kulcsimport)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' }

// ── Segédfüggvények ────────────────────────────────────────────────────────

function b64uDecode(s: string): Uint8Array {
  // Elfogad base64url és sima base64 formátumot is
  const base64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '==='.slice((base64.length + 3) % 4)
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0))
}

function b64uEncode(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0))
  let off = 0; for (const a of arrs) { out.set(a, off); off += a.length }
  return out
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data))
}

// ── VAPID JWT (JWK kulcsimport — nincs PKCS#8 burkolás) ───────────────────

async function buildVapidHeader(
  endpoint: string,
  vapidPubB64u: string,  // base64url uncompressed P-256 public key (65 bájt)
  vapidPrivB64u: string, // base64url raw P-256 private scalar (32 bájt)
  subject: string,
): Promise<string> {
  const enc = new TextEncoder()
  const url = new URL(endpoint)
  const aud = `${url.protocol}//${url.host}`
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600

  const toB64u = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  const hdr  = toB64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const pld  = toB64u(JSON.stringify({ aud, exp, sub: subject }))
  const data = `${hdr}.${pld}`

  // Publikus kulcs x,y koordinátái az uncompressed pontból (0x04 || x || y)
  const pubRaw = b64uDecode(vapidPubB64u)
  if (pubRaw[0] !== 0x04 || pubRaw.length !== 65) {
    throw new Error(`invalid VAPID public key length ${pubRaw.length}, first byte 0x${pubRaw[0].toString(16)}`)
  }
  const x = b64uEncode(pubRaw.slice(1, 33))
  const y = b64uEncode(pubRaw.slice(33, 65))

  const sigKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: vapidPrivB64u, x, y, key_ops: ['sign'] },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )

  const sig    = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, sigKey, enc.encode(data)))
  const sigB64 = toB64u(String.fromCharCode(...sig))
  return `vapid t=${data}.${sigB64},k=${vapidPubB64u}`
}

// ── RFC 8291 Web Push titkosítás ──────────────────────────────────────────

async function encryptWebPush(
  payload: string,
  p256dhB64: string,
  authB64: string,
): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const uaPub      = b64uDecode(p256dhB64)
  const authSecret = b64uDecode(authB64)

  // Ellenőrzés: a p256dh 65 bájt kell legyen (uncompressed point)
  if (uaPub.length !== 65) throw new Error(`p256dh length ${uaPub.length}, expected 65`)
  if (authSecret.length !== 16) throw new Error(`auth length ${authSecret.length}, expected 16`)

  const senderKP = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const asPub    = new Uint8Array(await crypto.subtle.exportKey('raw', senderKP.publicKey))

  const uaKey      = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, senderKP.privateKey, 256))

  const prkKey  = await hmac(authSecret, ecdhSecret)
  const keyInfo = concat(enc.encode('WebPush: info\x00'), uaPub, asPub)
  const ikm     = await hmac(prkKey, concat(keyInfo, new Uint8Array([1])))

  const salt  = crypto.getRandomValues(new Uint8Array(16))
  const prk   = await hmac(salt, ikm)
  const cek   = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\x00'), new Uint8Array([1])))).slice(0, 16)
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\x00'),      new Uint8Array([1])))).slice(0, 12)

  const plaintext  = concat(enc.encode(payload), new Uint8Array([2]))
  const cekKey     = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, plaintext))

  // aes128gcm header: salt(16) + rs(4 BE) + idlen(1) + sender_pub(65)
  const header = new Uint8Array(86)
  header.set(salt)
  new DataView(header.buffer).setUint32(16, 4096, false)
  header[20] = 65
  header.set(asPub, 21)

  return concat(header, ciphertext)
}

// ── Fő handler — egyedi push üzenet ─────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS })

  let householdId: string, personIds: string[], title: string, body: string, sentBy: string | null
  try {
    const payload = await req.json()
    householdId = payload.household_id
    personIds   = payload.person_ids   // string[] or [] for all
    title       = payload.title
    body        = payload.body
    if (!householdId || !title) throw new Error('missing household_id or title')
    sentBy      = payload.sent_by ?? null
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 400, headers: JSON_CORS })
  }

  const supabaseUrl  = Deno.env.get('SUPABASE_URL')!
  const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const vapidPub     = Deno.env.get('VAPID_PUBLIC_KEY')!
  const vapidPriv    = Deno.env.get('VAPID_PRIVATE_KEY')!
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'

  if (!vapidPub || !vapidPriv) {
    return new Response(JSON.stringify({ error: 'VAPID keys not configured' }), { status: 500, headers: JSON_CORS })
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // Fetch auth_user_ids of target persons (or all in household)
  let personQuery = supabase
    .from('person')
    .select('auth_user_id')
    .eq('household_id', householdId)
    .not('auth_user_id', 'is', null)
  if (personIds?.length) {
    personQuery = personQuery.in('id', personIds)
  }
  const { data: persons, error: pErr } = await personQuery
  if (pErr || !persons?.length) {
    return new Response(JSON.stringify({ skipped: 'no persons found', error: pErr?.message }), { status: 200, headers: JSON_CORS })
  }

  const authUserIds = [...new Set(persons.map(p => p.auth_user_id as string))]

  const { data: subs } = await supabase
    .from('push_subscription').select('endpoint, p256dh, auth')
    .in('user_id', authUserIds)
  if (!subs?.length) {
    return new Response(JSON.stringify({ skipped: 'no push subscriptions' }), { status: 200, headers: JSON_CORS })
  }

  // ── push_log: küldési naplózás ──────────────────────────────────────────
  const { data: logRow } = await supabase
    .from('push_log')
    .insert({
      household_id: householdId,
      sent_by:      sentBy,
      title,
      body:         body ?? '',
      target_count: subs.length,
    })
    .select('id')
    .single()
  const logId = logRow?.id ?? null

  const notifPayload = JSON.stringify({ title, body: body ?? '', url: '/?inbox=1', log_id: logId, supabase_url: supabaseUrl })

  const results = await Promise.allSettled(
    subs.map(async (sub) => {
      let stage = 'vapid'
      try {
        const authHeader = await buildVapidHeader(sub.endpoint, vapidPub, vapidPriv, vapidSubject)
        stage = 'encrypt'
        const encBody = await encryptWebPush(notifPayload, sub.p256dh, sub.auth)
        stage = 'fetch'
        const res = await fetch(sub.endpoint, {
          method: 'POST',
          headers: {
            'Content-Encoding': 'aes128gcm',
            'Content-Type':     'application/octet-stream',
            'Content-Length':   String(encBody.length),
            'TTL':              '86400',
            'Authorization':    authHeader,
          },
          body: encBody,
        })
        if (!res.ok) {
          const txt = await res.text().catch(() => '')
          // 410 Gone / 404: az előfizetés lejárt → töröljük a DB-ből
          if (res.status === 410 || res.status === 404) {
            await supabase.from('push_subscription').delete().eq('endpoint', sub.endpoint)
          }
          throw new Error(`HTTP ${res.status}: ${txt}`)
        }
      } catch (e) {
        throw new Error(`[${stage}] ${(e as Error).message}`)
      }
    })
  )

  const sent   = results.filter(r => r.status === 'fulfilled').length
  const failed = results.filter(r => r.status === 'rejected').length
  const errors = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
                        .map(r => r.reason?.message ?? String(r.reason))
  // Update push_log counts
  if (logId) {
    await supabase.from('push_log').update({ sent_count: sent, failed_count: failed }).eq('id', logId)
  }
  console.log(`notify-custom: ${sent} sent, ${failed} failed`, errors)

  return new Response(JSON.stringify({ sent, failed, errors, log_id: logId }), { status: 200, headers: JSON_CORS })
})
