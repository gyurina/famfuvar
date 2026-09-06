// supabase/functions/generate-horizon/index.ts
// Napi horizon generálás — minden háztartásra meghívja a generate_horizon() DB-függvényt.
// Hívható manuálisan HTTP POST-tal, vagy pg_cron ütemezi hajnalban.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DAYS_AHEAD = 14

Deno.serve(async (req: Request) => {
  // Csak POST és a Supabase belső cron hívása engedélyezett
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl  = Deno.env.get('SUPABASE_URL')!
  const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  // Opcionális: egy konkrét household_id a POST body-ban (manuális futtatáshoz)
  let targetHouseholdId: string | null = null
  try {
    const body = await req.json().catch(() => ({}))
    if (body?.household_id) targetHouseholdId = body.household_id
  } catch {
    // body nélküli hívás is OK
  }

  // Összes household lekérése (vagy csak a megadott)
  const householdsQuery = targetHouseholdId
    ? supabase.from('household').select('id').eq('id', targetHouseholdId)
    : supabase.from('household').select('id')

  const { data: households, error: hErr } = await householdsQuery
  if (hErr) {
    console.error('household fetch error:', hErr)
    return new Response(JSON.stringify({ error: hErr.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const results: { household_id: string; ok: boolean; error?: string }[] = []

  for (const hh of households ?? []) {
    const { error } = await supabase.rpc('generate_horizon', {
      p_household_id: hh.id,
      p_days_ahead:   DAYS_AHEAD,
    })
    if (error) {
      console.error(`generate_horizon(${hh.id}) error:`, error.message)
      results.push({ household_id: hh.id, ok: false, error: error.message })
    } else {
      results.push({ household_id: hh.id, ok: true })
    }
  }

  const allOk = results.every(r => r.ok)
  console.log('generate-horizon done:', results)

  return new Response(JSON.stringify({ results }), {
    status: allOk ? 200 : 207,
    headers: { 'Content-Type': 'application/json' },
  })
})
