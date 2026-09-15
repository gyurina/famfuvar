// Egyedi üzenet a háztartás tagjainak. A küldő nem kap értesítést.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
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

  let householdId: string
  let personIds: string[]
  let title: string
  let body: string
  let sentBy: string | null
  try {
    const payload = await req.json()
    householdId = payload.household_id
    personIds = payload.person_ids
    title = payload.title
    body = payload.body
    if (!householdId || !title) throw new Error('missing household_id or title')
    sentBy = payload.sent_by ?? null
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 400, headers: JSON_CORS })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  let personQuery = supabase
    .from('person')
    .select('id')
    .eq('household_id', householdId)
  if (personIds?.length) personQuery = personQuery.in('id', personIds)
  const { data: persons, error: pErr } = await personQuery
  if (pErr || !persons?.length) {
    return new Response(JSON.stringify({ skipped: 'no persons found', error: pErr?.message }), { status: 200, headers: JSON_CORS })
  }

  const result = await deliverHouseholdPush({
    supabase,
    householdId,
    kind: 'custom',
    actorId: sentBy,
    recipientPersonIds: persons.map(p => p.id),
    title,
    body: body ?? '',
    sentBy,
  })
  return new Response(JSON.stringify(result), { status: 200, headers: JSON_CORS })
})
