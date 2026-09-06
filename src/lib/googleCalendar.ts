// src/lib/googleCalendar.ts
// Google Calendar OAuth indítás + szinkron frontend helpers.

import { supabase } from './supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

/** Google Calendar csatlakoztatás megnyitása — átirányít a Google consent screen-re. */
export function startGoogleAuth(personId: string, householdId: string): void {
  const url = `${SUPABASE_URL}/functions/v1/google-oauth-start`
    + `?person_id=${encodeURIComponent(personId)}`
    + `&household_id=${encodeURIComponent(householdId)}`
  window.location.href = url
}

/** Manuális szinkron (fire-and-forget visszajelzéssel). */
export async function syncNow(personId?: string): Promise<boolean> {
  const { error } = await supabase.functions.invoke('sync-google-calendar', {
    body: personId ? { person_id: personId } : {},
  })
  return !error
}

/** Google Calendar lecsatlakoztatása — törli a tokent és a naptárakat. */
export async function disconnectGoogle(personId: string): Promise<void> {
  // Töröljük az external_calendar sorokat (cascade törli az external_event-eket is)
  await supabase.from('external_calendar')
    .delete()
    .eq('person_id', personId)
    .eq('source', 'google')

  // Token törlése service_role-on keresztül (RPC-vel, mert a kliens nem fér hozzá)
  await supabase.rpc('delete_google_oauth_token', { p_person_id: personId })
}

/** Lekéri az adott háztartás Google-naptárait (ki van csatlakoztatva). */
export async function fetchGoogleCalendars(
  householdId: string,
): Promise<Array<{ id: string; person_id: string; display_name: string; last_synced_at: string | null }>> {
  const { data } = await supabase
    .from('external_calendar')
    .select('id, person_id, display_name, last_synced_at')
    .eq('household_id', householdId)
    .eq('source', 'google')
    .eq('is_active', true)
  return (data ?? []) as Array<{ id: string; person_id: string; display_name: string; last_synced_at: string | null }>
}

/** Lekéri a megadott intervallumban az external_event-eket (ütközésjelzéshez). */
export async function fetchExternalEvents(
  calendarIds: string[],
  from: string,
  to: string,
): Promise<Array<{ calendar_id: string; starts_at: string; ends_at: string; title: string | null }>> {
  if (!calendarIds.length) return []
  const { data } = await supabase
    .from('external_event')
    .select('calendar_id, starts_at, ends_at, title')
    .in('calendar_id', calendarIds)
    .gte('starts_at', from)
    .lte('ends_at', to)
  return (data ?? []) as Array<{ calendar_id: string; starts_at: string; ends_at: string; title: string | null }>
}
