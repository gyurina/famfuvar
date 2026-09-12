// supabase/functions/push-receipt/index.ts
// Service Worker callback: delivered / clicked esemény naplózása push_log_receipt-be

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS })

  let logId: string, event: string, userAgent: string | null, personId: string | null
  try {
    const payload = await req.json()
    logId      = payload.log_id
    event      = payload.event      // 'delivered' | 'clicked' | 'dismissed'
    userAgent  = payload.user_agent ?? null
    personId   = payload.person_id ?? null
    if (!logId || !['delivered', 'clicked', 'dismissed'].includes(event)) {
      throw new Error('log_id and valid event required')
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 400, headers: JSON_CORS })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase    = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // Opcionálisan: JWT-ből kinyerjük az auth_user_id-t → person_id
  if (!personId) {
    const authHeader = req.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      const { data: { user } } = await supabase.auth.getUser(token)
      if (user) {
        const { data: p } = await supabase
          .from('person')
          .select('id')
          .eq('auth_user_id', user.id)
          .maybeSingle()
        personId = p?.id ?? null
      }
    }
  }

  const { error } = await supabase.from('push_log_receipt').insert({
    log_id:     logId,
    person_id:  personId,
    event,
    user_agent: userAgent,
  })

  if (error) {
    console.error('push-receipt insert error:', error.message)
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_CORS })
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_CORS })
})
