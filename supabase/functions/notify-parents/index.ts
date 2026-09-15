// Vállalás és visszaadás → a háztartás szülőinek. A cselekvő nem kap értesítést.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { claimedByDriver, releasedByDriver, timeHm } from '../_shared/messages.ts'
import { deliverHouseholdPush } from '../_shared/notify.ts'

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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

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

  const { data: parents } = await supabase
    .from('person')
    .select('id')
    .eq('household_id', leg.household_id)
    .eq('role', 'parent')

  const result = await deliverHouseholdPush({
    supabase,
    householdId: leg.household_id,
    kind,
    actorId,
    recipientPersonIds: (parents ?? []).map(p => p.id),
    title: msg.title,
    body: msg.body,
    entity: 'transport_leg',
    entityId: legId,
  })
  return new Response(JSON.stringify(result), { status: 200, headers: JSON_CORS })
})
