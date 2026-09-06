// supabase/functions/google-oauth-callback/index.ts
// Google OAuth2 callback: code → token csere, tárolás Supabase-be.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GOOGLE_CLIENT_ID      = Deno.env.get('GOOGLE_CLIENT_ID')!
const GOOGLE_CLIENT_SECRET  = Deno.env.get('GOOGLE_CLIENT_SECRET')!
const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APP_URL               = Deno.env.get('APP_URL') ?? 'https://famcal.vercel.app'

Deno.serve(async (req) => {
  const url  = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  const fail = (reason: string) =>
    Response.redirect(`${APP_URL}/beallitasok?google=error&reason=${encodeURIComponent(reason)}`, 302)

  if (!code || !state) return fail('missing_params')

  let personId: string, householdId: string
  try {
    ;({ personId, householdId } = JSON.parse(atob(state)))
  } catch {
    return fail('bad_state')
  }

  const redirectUri = `${SUPABASE_URL}/functions/v1/google-oauth-callback`

  // 1. Code → token csere
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
    }),
  })
  const tokens = await tokenRes.json()
  if (!tokens.access_token) {
    console.error('[google-oauth-callback] token error:', tokens)
    return fail('token_exchange_failed')
  }

  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString()
  const supabase  = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // 2. Google Calendar primary info lekérése
  const calRes  = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const calInfo = await calRes.json()
  const googleCalId = calInfo.id ?? 'primary'

  // 3. OAuth token mentés
  const { error: tokErr } = await supabase.from('google_oauth_token').upsert({
    person_id:     personId,
    household_id:  householdId,
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token ?? '',
    expires_at:    expiresAt,
    scope:         tokens.scope ?? 'https://www.googleapis.com/auth/calendar',
    updated_at:    new Date().toISOString(),
  }, { onConflict: 'person_id' })
  if (tokErr) { console.error('[google-oauth-callback] token upsert:', tokErr); return fail('db_error') }

  // 4. external_calendar upsert (partial index on person_id + google_calendar_id where source='google')
  const { data: existingCal } = await supabase
    .from('external_calendar')
    .select('id')
    .eq('person_id', personId)
    .eq('source', 'google')
    .maybeSingle()

  if (existingCal) {
    await supabase.from('external_calendar').update({
      google_calendar_id: googleCalId,
      display_name:       calInfo.summary ?? 'Google Calendar',
      is_active:          true,
    }).eq('id', existingCal.id)
  } else {
    await supabase.from('external_calendar').insert({
      household_id:       householdId,
      person_id:          personId,
      source:             'google',
      google_calendar_id: googleCalId,
      display_name:       calInfo.summary ?? 'Google Calendar',
      color:              '#4285f4',
      affects_driving:    true,
      is_active:          true,
    })
  }

  return Response.redirect(`${APP_URL}/beallitasok?google=connected`, 302)
})
