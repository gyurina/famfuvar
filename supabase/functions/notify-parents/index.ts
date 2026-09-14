// supabase/functions/notify-parents/index.ts
// Vállalás és visszaadás → a háztartás szülőinek.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendWithRetry } from '../_shared/pushSend.ts'
import { buildVapidHeader, encryptWebPush } from '../_shared/webPush.ts'
import { claimedByDriver, releasedByDriver, timeHm } from '../_shared/messages.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS })

  let legId: string
  let kind: 'claim' | 'release'
  let actorId: string | null = null
  let actorName = ''
  try {
    const body = await req.json()
    legId = body.leg_id
    kind = body.kind === 'release' ? 'release' : 'claim'
    actorId = body.actor_id ?? null
    actorName = body.actor_name ?? ''
    if (!legId) throw new Error('missing leg_id')
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

  const { data: leg, error: legErr } = await supabase
    .from('transport_leg')
    .select('*, occurrence!inner(title, on_date, starts_at, person_id)')
    .eq('id', legId)
    .single()

  if (legErr || !leg) {
    return new Response(JSON.stringify({ error: legErr?.message ?? 'leg not found' }), { status: 404, headers: JSON_CORS })
  }

  const occ = leg.occurrence as { title: string; on_date: string; starts_at: string; person_id: string | null }
  const { data: child } = occ.person_id
    ? await supabase.from('person').select('display_name, name_acc').eq('id', occ.person_id).single()
    : { data: null }
  const childName = child?.display_name ?? occ.title
  const childAcc = child?.name_acc || childName
  const time = timeHm(occ.starts_at)
  const driverName = actorName || 'Valaki'

  const msg = kind === 'release'
    ? releasedByDriver({ driver: driverName, child: childName, onDate: occ.on_date, time })
    : claimedByDriver({
      driver: driverName,
      childAcc,
      inbound: leg.direction === 'pickup',
      title: occ.title,
      onDate: occ.on_date,
      time,
    })

  let parentQuery = supabase
    .from('person')
    .select('id, auth_user_id')
    .eq('household_id', leg.household_id)
    .eq('role', 'parent')
    .not('auth_user_id', 'is', null)
  if (actorId) parentQuery = parentQuery.neq('id', actorId)

  const { data: parents } = await parentQuery
  const userIds = [...new Set((parents ?? []).map(p => p.auth_user_id).filter((id): id is string => !!id))]
  if (userIds.length === 0) {
    return new Response(JSON.stringify({ skipped: 'no parents' }), { status: 200, headers: JSON_CORS })
  }

  const { data: subs } = await supabase
    .from('push_subscription')
    .select('endpoint, p256dh, auth')
    .in('user_id', userIds)
  if (!subs?.length) {
    return new Response(JSON.stringify({ skipped: 'no push subscriptions' }), { status: 200, headers: JSON_CORS })
  }

  const { data: logRow } = await supabase
    .from('push_log')
    .insert({
      household_id: leg.household_id,
      title: msg.title,
      body: msg.body,
      target_count: subs.length,
    })
    .select('id')
    .single()
  const logId = logRow?.id ?? null

  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const notifPayload = JSON.stringify({
    title: msg.title,
    body: msg.body,
    url: `/fuvarok?ride=${legId}`,
    log_id: logId,
    supabase_url: supabaseUrl,
    apikey: anonKey,
  })

  const results = await Promise.allSettled(
    subs.map(async (sub) => {
      let stage = 'vapid'
      try {
        const authHeader = await buildVapidHeader(sub.endpoint, vapidPub, vapidPriv, vapidSubject)
        stage = 'encrypt'
        const encBody = await encryptWebPush(notifPayload, sub.p256dh, sub.auth)
        stage = 'fetch'
        const res = await sendWithRetry(sub.endpoint, encBody, {
          'Content-Encoding': 'aes128gcm',
          'Content-Type':     'application/octet-stream',
          'Content-Length':   String(encBody.length),
          'TTL':              '86400',
          'Authorization':    authHeader,
        })
        if (!res.ok) {
          const txt = await res.text().catch(() => '')
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
  if (logId) {
    await supabase.from('push_log').update({ sent_count: sent, failed_count: failed }).eq('id', logId)
  }
  console.log(`notify-parents: ${sent} sent, ${failed} failed`, errors)

  return new Response(JSON.stringify({ sent, failed, errors, log_id: logId }), { status: 200, headers: JSON_CORS })
})
