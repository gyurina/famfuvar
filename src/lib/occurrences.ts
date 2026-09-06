/**
 * Occurrence eltérítés (override) — service függvények
 *
 * cancelOccurrence  – lemondja az adott alkalmat (status = 'cancelled')
 * updateOccurrence  – módosítja az adott alkalmat (idő / helyszín / megjegyzés)
 * closeTemplateAndCreateNew – réteg 3: sablon lezárása + új sablon jövőre
 */
import { supabase } from './supabase'
import type { ScheduleTemplate } from '../types'

// ── Aktuális bejelentkezett person_id lekérése ───────────────────────────────
async function currentPersonId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('person')
    .select('id')
    .eq('auth_user_id', user.id)
    .single()
  return data?.id ?? null
}

// ── Lemondás ─────────────────────────────────────────────────────────────────
export async function cancelOccurrence(occurrenceId: string): Promise<void> {
  const personId = await currentPersonId()

  // 1. Státusz váltás
  const { error: occErr } = await supabase
    .from('occurrence')
    .update({
      status:     'cancelled',
      is_override: true,
      updated_by: personId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', occurrenceId)

  if (occErr) throw occErr

  // 2. Transport leg-ek törlése (sofőr-hozzárendelések is elvesznek)
  const { error: legErr } = await supabase
    .from('transport_leg')
    .delete()
    .eq('occurrence_id', occurrenceId)

  if (legErr) throw legErr
}

// ── Időpont / helyszín módosítás (csak ez az alkalom) ────────────────────────
export interface OccurrenceOverridePatch {
  starts_at?:  string   // 'HH:mm'
  ends_at?:    string
  location_id?: string
  note?:       string
}

export async function updateOccurrence(
  occurrenceId: string,
  patch: OccurrenceOverridePatch,
): Promise<void> {
  const personId = await currentPersonId()

  // Jelenlegi occurrence lekérése (kell a leg-regeneráláshoz)
  const { data: occ, error: occFetchErr } = await supabase
    .from('occurrence')
    .select('*')
    .eq('id', occurrenceId)
    .single()
  if (occFetchErr || !occ) throw occFetchErr ?? new Error('Occurrence nem található')

  const { error } = await supabase
    .from('occurrence')
    .update({
      ...patch,
      is_override: true,
      updated_by:  personId,
      updated_at:  new Date().toISOString(),
    })
    .eq('id', occurrenceId)

  if (error) throw error

  // Transport leg-ek újragenerálása, ha időpont változott
  if (patch.starts_at || patch.ends_at || patch.location_id) {
    await regenerateLegs(occ, patch)
  }
}

// ── Leg regenerálás ──────────────────────────────────────────────────────────
async function regenerateLegs(
  occ: Record<string, unknown>,
  patch: OccurrenceOverridePatch,
): Promise<void> {
  const occurrenceId = occ.id as string
  const householdId  = occ.household_id as string
  const locationId   = (patch.location_id ?? occ.location_id) as string
  const startsAt     = (patch.starts_at   ?? occ.starts_at)   as string   // 'HH:mm' vagy 'HH:mm:ss'
  const endsAt       = (patch.ends_at     ?? occ.ends_at)     as string
  const onDate       = occ.on_date as string   // 'YYYY-MM-DD'

  // Lekérjük a meglévő leg-eket (sofőr + csoport megőrzéséhez)
  const { data: existingLegs } = await supabase
    .from('transport_leg')
    .select('*')
    .eq('occurrence_id', occurrenceId)

  // Otthoni helyszín azonosítása
  const { data: homeLoc } = await supabase
    .from('location')
    .select('id')
    .eq('household_id', householdId)
    .eq('is_home', true)
    .single()

  if (!homeLoc) {
    // Ha nincs otthoni helyszín, csak töröljük a leg-eket
    await supabase.from('transport_leg').delete().eq('occurrence_id', occurrenceId)
    return
  }

  // Utazási idők lekérése (oda + vissza)
  const { data: times } = await supabase
    .from('travel_time')
    .select('from_location, to_location, minutes')
    .eq('household_id', householdId)
    .in('from_location', [homeLoc.id, locationId])
    .in('to_location',   [homeLoc.id, locationId])

  function travelMin(from: string, to: string): number {
    return times?.find(t => t.from_location === from && t.to_location === to)?.minutes ?? 15
  }

  // Időpont segédfüggvény: 'YYYY-MM-DD' + 'HH:mm[:ss]' → Date (Budapest helyi)
  function localDt(dateStr: string, timeStr: string): Date {
    const t = timeStr.slice(0, 5)  // 'HH:mm'
    return new Date(`${dateStr}T${t}:00+02:00`)
  }

  const arrivalDropoff  = localDt(onDate, startsAt)
  const departPickup    = localDt(onDate, endsAt)
  const travelToMin     = travelMin(homeLoc.id, locationId)
  const travelBackMin   = travelMin(locationId, homeLoc.id)
  const departDropoff   = new Date(arrivalDropoff.getTime() - travelToMin * 60_000)
  const arrivalPickup   = new Date(departPickup.getTime() + travelBackMin * 60_000)

  // Meglévő adatok megőrzése (sofőr, utas csoport)
  const prevDropoff = existingLegs?.find(l => l.direction === 'dropoff')
  const prevPickup  = existingLegs?.find(l => l.direction === 'pickup')

  // Töröljük a régieket
  await supabase.from('transport_leg').delete().eq('occurrence_id', occurrenceId)

  // Újra létrehozzuk frissített időkkel, megőrzött sofőrrel
  const newLegs = []
  if (prevDropoff !== undefined) {
    newLegs.push({
      household_id:  householdId,
      occurrence_id: occurrenceId,
      direction:     'dropoff',
      driver_id:     prevDropoff?.driver_id ?? null,
      group_id:      prevDropoff?.group_id  ?? null,
      depart_at:     departDropoff.toISOString(),
      arrive_at:     arrivalDropoff.toISOString(),
      from_location: homeLoc.id,
      to_location:   locationId,
    })
  }
  if (prevPickup !== undefined) {
    newLegs.push({
      household_id:  householdId,
      occurrence_id: occurrenceId,
      direction:     'pickup',
      driver_id:     prevPickup?.driver_id ?? null,
      group_id:      prevPickup?.group_id  ?? null,
      depart_at:     departPickup.toISOString(),
      arrive_at:     arrivalPickup.toISOString(),
      from_location: locationId,
      to_location:   homeLoc.id,
    })
  }

  if (newLegs.length > 0) {
    const { error } = await supabase.from('transport_leg').insert(newLegs)
    if (error) throw error
  }
}

// ── Sablon szintű módosítás (ezt és minden jövőbeli alkalmat) ─────────────────
export async function closeTemplateAndCreateNew(
  templateId: string,
  fromDate: string,          // 'YYYY-MM-DD' — az első érintett nap
  patch: Partial<Pick<ScheduleTemplate,
    'starts_at' | 'ends_at' | 'location_id' | 'needs_dropoff' | 'needs_pickup' | 'title'
  >>,
): Promise<void> {
  // 1. Régi sablon lezárása
  const { data: oldTemplate, error: fetchErr } = await supabase
    .from('schedule_template')
    .select('*')
    .eq('id', templateId)
    .single()

  if (fetchErr || !oldTemplate) throw fetchErr ?? new Error('Sablon nem található')

  const closingDate = new Date(fromDate)
  closingDate.setDate(closingDate.getDate() - 1)
  const validTo = closingDate.toISOString().slice(0, 10)

  const { error: closeErr } = await supabase
    .from('schedule_template')
    .update({ valid_to: validTo })
    .eq('id', templateId)

  if (closeErr) throw closeErr

  // 2. Új sablon a módosított adatokkal
  const { error: insertErr } = await supabase
    .from('schedule_template')
    .insert({
      household_id:  oldTemplate.household_id,
      person_id:     oldTemplate.person_id,
      title:         patch.title         ?? oldTemplate.title,
      weekday:       oldTemplate.weekday,
      starts_at:     patch.starts_at     ?? oldTemplate.starts_at,
      ends_at:       patch.ends_at       ?? oldTemplate.ends_at,
      location_id:   patch.location_id   ?? oldTemplate.location_id,
      needs_dropoff: patch.needs_dropoff ?? oldTemplate.needs_dropoff,
      needs_pickup:  patch.needs_pickup  ?? oldTemplate.needs_pickup,
      valid_from:    fromDate,
      valid_to:      null,
    })

  if (insertErr) throw insertErr

  // 3. Jövőbeli, már generált, érintetlen occurrenceök törlése
  //    (generate_horizon majd az új sablonból újragenerálja őket)
  const { error: delErr } = await supabase
    .from('occurrence')
    .delete()
    .eq('template_id', templateId)
    .gte('on_date', fromDate)
    .eq('status', 'planned')
    .eq('is_override', false)

  if (delErr) throw delErr
}
