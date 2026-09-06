// supabase/functions/google-oauth-start/index.ts
// Google OAuth2 flow indítása — átirányít a Google consent screen-re.

const GOOGLE_CLIENT_ID  = Deno.env.get('GOOGLE_CLIENT_ID')!
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
    })
  }

  const url        = new URL(req.url)
  const personId   = url.searchParams.get('person_id')   ?? ''
  const householdId = url.searchParams.get('household_id') ?? ''

  if (!personId || !householdId) {
    return new Response('Hiányzó paraméter: person_id, household_id', { status: 400 })
  }

  const redirectUri = `${SUPABASE_URL}/functions/v1/google-oauth-callback`
  const state       = btoa(JSON.stringify({ personId, householdId }))

  const params = new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/calendar',
    access_type:   'offline',
    prompt:        'consent',   // mindig refresh_token-t kérünk
    state,
  })

  return Response.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    302,
  )
})
