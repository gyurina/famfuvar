// Időpont-változás és elmaradás → sofőr + szülők, a cselekvő nélkül.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { cancelledRide, timeChanged, timeHm } from '../_shared/messages.ts'
import { deliverHouseholdPush } from '../_shared/notify.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' }

type Kind = 'time' | 'cancel'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS })

  let occurrenceId: string
  let kind: Kind
  let actorId: string | null = null
  let oldTime = ''
  try {
    const body = await req.json()
    occurrenceId = body.occurrence_id
    kind = body.kind === 'cancel' ? 'cancel' : 'time'
    actorId = body.actor_id ?? null
    oldTime = body.old_time ?? ''
    if (!occurrenceId) throw new Error('missing occurrence_id')
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 400, headers: JSON_CORS })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const { data: occ, error: occErr } = await supabase
    .from('occurrence')
    .select('id, household_id, title, on_date, starts_at, person_id')
    .eq('id', occurrenceId)
    .single()
  if (occErr || !occ) {
    return new Response(JSON.stringify({ error: occErr?.message ?? 'occurrence not found' }), { status: 404, headers: JSON_CORS })
  }

  const { data: household } = await supabase
    .from('household')
    .select('settings')
    .eq('id', occ.household_id)
    .maybeSingle()
  const settings = (household?.settings ?? {}) as Record<string, unknown>
  if (kind === 'time' && settings.notify_on_time_change === false) {
    return new Response(JSON.stringify({ skipped: 'notify_on_time_change off' }), { status: 200, headers: JSON_CORS })
  }

  const { data: child } = occ.person_id
    ? await supabase.from('person').select('display_name').eq('id', occ.person_id).single()
    : { data: null }
  const childName = child?.display_name ?? occ.title
  const time = timeHm(occ.starts_at)
  const msg = kind === 'cancel'
    ? cancelledRide({ child: childName, title: occ.title, onDate: occ.on_date, time })
    : timeChanged({
      child: childName,
      title: occ.title,
      onDate: occ.on_date,
      oldTime: oldTime || time,
      newTime: time,
    })

  const recipientIds: string[] = []
  const { data: legs } = await supabase
    .from('transport_leg')
    .select('driver_id')
    .eq('occurrence_id', occ.id)
  for (const leg of legs ?? []) {
    if (leg.driver_id) recipientIds.push(leg.driver_id)
  }

  const notifyParents = kind === 'cancel' || settings.notify_other_parents_on_time_change !== false
  if (notifyParents) {
    const { data: parents } = await supabase
      .from('person')
      .select('id')
      .eq('household_id', occ.household_id)
      .eq('role', 'parent')
    for (const p of parents ?? []) recipientIds.push(p.id)
  }

  const result = await deliverHouseholdPush({
    supabase,
    householdId: occ.household_id,
    kind,
    actorId,
    recipientPersonIds: recipientIds,
    title: msg.title,
    body: msg.body,
    entity: 'occurrence',
    entityId: occ.id,
  })
  return new Response(JSON.stringify(result), { status: 200, headers: JSON_CORS })
})
