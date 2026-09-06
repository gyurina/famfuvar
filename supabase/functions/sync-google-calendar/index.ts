// supabase/functions/sync-google-calendar/index.ts
// Kétirányú Google Calendar szinkron:
//   PUSH: famcal transport_leg (hozzárendelt) → Google Calendar event
//   PULL: Google Calendar events → external_event (ütközésjelzéshez)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GOOGLE_CLIENT_ID     = Deno.env.get('GOOGLE_CLIENT_ID')!
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ── Token kezelés ─────────────────────────────────────────────────────────────

async function getValidToken(
  personId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: string,
): Promise<string> {
  // Ha még legalább 5 percig érvényes, visszaadjuk
  if (new Date(expiresAt).getTime() - Date.now() > 5 * 60 * 1000) return accessToken

  // Token refresh
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`)

  const newExpiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString()
  await supabase.from('google_oauth_token').update({
    access_token: data.access_token,
    expires_at:   newExpiresAt,
    updated_at:   new Date().toISOString(),
  }).eq('person_id', personId)

  return data.access_token
}

// ── Google API wrappers ───────────────────────────────────────────────────────

async function gcalRequest(
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
}

// ── Content hash ──────────────────────────────────────────────────────────────

function legHash(leg: Record<string, unknown>): string {
  return JSON.stringify({
    driverId:    leg.driver_id,
    departAt:    leg.depart_at,
    arriveAt:    leg.arrive_at,
    status:      (leg.occurrence as Record<string, unknown>)?.status,
  })
}

// ── Event helpers ─────────────────────────────────────────────────────────────

function legToGcalEvent(leg: Record<string, unknown>): Record<string, unknown> {
  const occ        = leg.occurrence  as Record<string, unknown>
  const person     = leg.person_name as string ?? 'utas'
  const fromLoc    = leg.from_name   as string ?? ''
  const toLoc      = leg.to_name     as string ?? ''
  const dir        = leg.direction === 'pickup' ? 'Felvétel' : 'Leadás'
  const cancelled  = occ?.status === 'cancelled'

  return {
    summary:     cancelled
      ? `❌ [LEMONDVA] 🚗 ${dir}: ${person}`
      : `🚗 ${dir}: ${person}`,
    description: `${fromLoc} → ${toLoc}\nUtas: ${person}`,
    start:       { dateTime: leg.depart_at as string },
    end:         { dateTime: (leg.arrive_at ?? leg.depart_at) as string },
    status:      cancelled ? 'cancelled' : 'confirmed',
    colorId:     '1',  // kék
  }
}

// ── PUSH: famcal → Google ─────────────────────────────────────────────────────

async function pushLegs(
  personId: string,
  calendarId: string,
  token: string,
): Promise<void> {
  const now       = new Date()
  const timeMin   = new Date(now.getTime() - 24 * 3600 * 1000).toISOString()
  const timeMax   = new Date(now.getTime() + 14 * 24 * 3600 * 1000).toISOString()

  // Lekérjük a hozzárendelt lábakat occurrence + helyszín adatokkal
  const { data: legs, error } = await supabase
    .from('transport_leg')
    .select(`
      id, direction, driver_id, depart_at, arrive_at,
      occurrence!inner(id, title, status, person_id),
      from_loc:from_location(name),
      to_loc:to_location(name),
      utas:occurrence!inner(person:person_id(display_name))
    `)
    .eq('driver_id', personId)
    .gte('depart_at', timeMin)
    .lte('depart_at', timeMax)

  if (error || !legs) { console.error('[push] legs query:', error); return }

  // google_sync meglévő bejegyzések
  const legIds = legs.map((l: Record<string, unknown>) => l.id)
  const { data: synced } = await supabase
    .from('google_sync')
    .select('entity_id, google_event_id, content_hash')
    .eq('entity_type', 'transport_leg')
    .in('entity_id', legIds)

  const syncMap = new Map<string, { google_event_id: string; content_hash: string }>(
    (synced ?? []).map((s: Record<string, unknown>) => [
      s.entity_id as string,
      { google_event_id: s.google_event_id as string, content_hash: s.content_hash as string },
    ]),
  )

  for (const rawLeg of legs) {
    const leg = rawLeg as Record<string, unknown>
    // Flatten helper fields
    const flatLeg = {
      ...leg,
      from_name:   (leg.from_loc as Record<string, unknown>)?.name ?? '',
      to_name:     (leg.to_loc  as Record<string, unknown>)?.name ?? '',
      person_name: ((leg.utas as Record<string, unknown>)?.person as Record<string, unknown>)?.display_name ?? '',
    }

    const hash   = legHash(flatLeg)
    const event  = legToGcalEvent(flatLeg)
    const synced = syncMap.get(leg.id as string)

    try {
      if (!synced) {
        // Új esemény létrehozása
        const res  = await gcalRequest('POST', `/calendars/${encodeURIComponent(calendarId)}/events`, token, event)
        const data = await res.json()
        if (data.id) {
          await supabase.from('google_sync').insert({
            entity_type:    'transport_leg',
            entity_id:      leg.id,
            google_event_id: data.id,
            content_hash:   hash,
          })
        }
      } else if (synced.content_hash !== hash) {
        // Meglévő esemény frissítése
        await gcalRequest(
          'PATCH',
          `/calendars/${encodeURIComponent(calendarId)}/events/${synced.google_event_id}`,
          token,
          event,
        )
        await supabase.from('google_sync').update({ content_hash: hash, synced_at: new Date().toISOString() })
          .eq('entity_type', 'transport_leg').eq('entity_id', leg.id as string)
      }
    } catch (e) {
      console.error(`[push] leg ${leg.id}:`, e)
      await supabase.from('google_sync').update({ last_error: String(e) })
        .eq('entity_type', 'transport_leg').eq('entity_id', leg.id as string)
    }
  }
}

// ── PULL: Google → famcal ─────────────────────────────────────────────────────

async function pullEvents(
  calId: string,      // external_calendar.id
  googleCalId: string,
  syncToken: string | null,
  token: string,
): Promise<string | null> {
  const now     = new Date()
  const timeMin = new Date(now.getTime() - 7  * 24 * 3600 * 1000).toISOString()
  const timeMax = new Date(now.getTime() + 42 * 24 * 3600 * 1000).toISOString()

  let pageToken: string | undefined
  let newSyncToken: string | null = null

  // Növekményes szinkron ha van syncToken, különben teljes
  const baseParams = syncToken
    ? new URLSearchParams({ syncToken })
    : new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', maxResults: '500' })

  try {
    do {
      const params = new URLSearchParams(baseParams)
      if (pageToken) params.set('pageToken', pageToken)

      const res  = await gcalRequest('GET', `/calendars/${encodeURIComponent(googleCalId)}/events?${params}`, token)
      const data = await res.json()

      // 410 Gone → syncToken érvénytelen, teljes szinkron
      if (res.status === 410) {
        return pullEvents(calId, googleCalId, null, token)
      }

      const items = (data.items ?? []) as Array<Record<string, unknown>>
      const toUpsert = items
        .filter(ev => ev.status !== 'cancelled' && (ev.start || ev.dateTime))
        .map(ev => ({
          calendar_id:     calId,
          source_event_id: ev.id as string,
          title:           (ev.summary ?? null) as string | null,
          starts_at:       ((ev.start as Record<string, unknown>)?.dateTime
                         ?? (ev.start as Record<string, unknown>)?.date) as string,
          ends_at:         ((ev.end as Record<string, unknown>)?.dateTime
                         ?? (ev.end as Record<string, unknown>)?.date) as string,
          all_day:         !(ev.start as Record<string, unknown>)?.dateTime,
          location_text:   (ev.location ?? null) as string | null,
        }))

      const toDelete = items
        .filter(ev => ev.status === 'cancelled')
        .map(ev => ev.id as string)

      if (toUpsert.length) {
        await supabase.from('external_event')
          .upsert(toUpsert, { onConflict: 'calendar_id,source_event_id' })
      }
      if (toDelete.length) {
        await supabase.from('external_event')
          .delete()
          .eq('calendar_id', calId)
          .in('source_event_id', toDelete)
      }

      pageToken    = data.nextPageToken
      newSyncToken = data.nextSyncToken ?? newSyncToken
    } while (pageToken)
  } catch (e) {
    console.error('[pull]', e)
  }

  return newSyncToken
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
    })
  }

  // body: opcionális { person_id } — ha nincs, az összes token szinkronizálódik
  const body       = req.headers.get('content-type')?.includes('json') ? await req.json() : {}
  const filterPid  = body?.person_id ?? null

  const { data: tokens, error: tokErr } = await supabase
    .from('google_oauth_token')
    .select('person_id, household_id, access_token, refresh_token, expires_at')
    .match(filterPid ? { person_id: filterPid } : {})

  if (tokErr || !tokens?.length) {
    return new Response(JSON.stringify({ ok: true, synced: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const results: Array<{ person_id: string; ok: boolean; error?: string }> = []

  for (const tok of tokens) {
    const pid = tok.person_id as string
    try {
      const accessToken = await getValidToken(pid, tok.access_token, tok.refresh_token, tok.expires_at)

      // external_calendar keresése
      const { data: cal } = await supabase
        .from('external_calendar')
        .select('id, google_calendar_id, sync_token')
        .eq('person_id', pid)
        .eq('source', 'google')
        .eq('is_active', true)
        .maybeSingle()

      if (!cal) { results.push({ person_id: pid, ok: false, error: 'no_calendar' }); continue }

      // PUSH
      await pushLegs(pid, cal.google_calendar_id, accessToken)

      // PULL
      const newSyncToken = await pullEvents(cal.id, cal.google_calendar_id, cal.sync_token, accessToken)

      // Frissítjük a sync_token-t és last_synced_at-t
      await supabase.from('external_calendar').update({
        sync_token:    newSyncToken,
        last_synced_at: new Date().toISOString(),
      }).eq('id', cal.id)

      results.push({ person_id: pid, ok: true })
    } catch (e) {
      console.error(`[sync] person ${pid}:`, e)
      results.push({ person_id: pid, ok: false, error: String(e) })
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
})
