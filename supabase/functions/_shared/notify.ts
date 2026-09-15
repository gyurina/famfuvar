/** Közös push-kézbesítés: előbb inbox, aztán Web Push. A cselekvő soha nem címzett. */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendWithRetry } from './pushSend.ts'
import { buildVapidHeader, encryptWebPush } from './webPush.ts'

export type PushKind = 'assign' | 'claim' | 'release' | 'custom' | 'time' | 'cancel'

export interface DeliverOpts {
  supabase: SupabaseClient
  householdId: string
  kind: PushKind
  actorId: string | null
  recipientPersonIds: string[]
  title: string
  body: string
  entity?: string | null
  entityId?: string | null
  sentBy?: string | null
}

export async function deliverHouseholdPush(opts: DeliverOpts): Promise<{
  sent: number
  failed: number
  errors: string[]
  log_id: string | null
  skipped?: string
}> {
  const recipients = [...new Set(opts.recipientPersonIds.filter(id => id && id !== opts.actorId))]
  if (recipients.length === 0) {
    return { sent: 0, failed: 0, errors: [], log_id: null, skipped: 'no recipients' }
  }

  const { data: persons } = await opts.supabase
    .from('person')
    .select('id, auth_user_id')
    .in('id', recipients)
    .not('auth_user_id', 'is', null)
  const userIds = [...new Set((persons ?? []).map(p => p.auth_user_id).filter((id): id is string => !!id))]
  const personIdsWithAuth = (persons ?? []).map(p => p.id)

  const { data: logRow } = await opts.supabase
    .from('push_log')
    .insert({
      household_id: opts.householdId,
      sent_by: opts.sentBy ?? opts.actorId,
      actor_id: opts.actorId,
      kind: opts.kind,
      entity: opts.entity ?? null,
      entity_id: opts.entityId ?? null,
      title: opts.title,
      body: opts.body,
      target_count: personIdsWithAuth.length,
    })
    .select('id')
    .single()
  const logId = logRow?.id ?? null

  if (logId && personIdsWithAuth.length) {
    await opts.supabase.from('push_recipient').insert(
      personIdsWithAuth.map(person_id => ({ log_id: logId, person_id })),
    )
  }

  if (userIds.length === 0) {
    return { sent: 0, failed: 0, errors: [], log_id: logId, skipped: 'no auth users' }
  }

  const { data: subs } = await opts.supabase
    .from('push_subscription')
    .select('endpoint, p256dh, auth')
    .in('user_id', userIds)
  if (!subs?.length) {
    return { sent: 0, failed: 0, errors: [], log_id: logId, skipped: 'no push subscriptions' }
  }

  const vapidPub = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
  const vapidPriv = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!vapidPub || !vapidPriv) {
    return { sent: 0, failed: subs.length, errors: ['VAPID keys not configured'], log_id: logId }
  }

  const notifPayload = JSON.stringify({
    title: opts.title,
    body: opts.body,
    url: logId ? `/uzenetek?m=${logId}` : '/uzenetek',
    log_id: logId,
    supabase_url: supabaseUrl,
    apikey: anonKey,
  })

  const results = await Promise.allSettled(
    subs.map(async (sub) => {
      const authHeader = await buildVapidHeader(sub.endpoint, vapidPub, vapidPriv, vapidSubject)
      const encBody = await encryptWebPush(notifPayload, sub.p256dh, sub.auth)
      const res = await sendWithRetry(sub.endpoint, encBody, {
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(encBody.length),
        TTL: '86400',
        Authorization: authHeader,
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        if (res.status === 410 || res.status === 404) {
          await opts.supabase.from('push_subscription').delete().eq('endpoint', sub.endpoint)
        }
        throw new Error(`HTTP ${res.status}: ${txt}`)
      }
    }),
  )

  const sent = results.filter(r => r.status === 'fulfilled').length
  const failed = results.filter(r => r.status === 'rejected').length
  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map(r => r.reason?.message ?? String(r.reason))
  if (logId) {
    await opts.supabase.from('push_log').update({ sent_count: sent, failed_count: failed }).eq('id', logId)
  }
  return { sent, failed, errors, log_id: logId }
}
