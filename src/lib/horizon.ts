import { supabase } from './supabase'
import { budapestIso } from './occurrences'
import { toIsoDate } from './format'
import type { ScheduleTemplate } from '../types'

/** Az órarendből létrehozza / szinkronizálja a következő 30 nap programjait és fuvarjait. */
export async function refreshHorizon(householdId: string): Promise<string | null> {
  const { error } = await supabase.rpc('generate_horizon', {
    p_household_id: householdId,
    p_days_ahead: 30,
  })
  return error?.message ?? null
}

/**
 * Már létező (pl. mai) programokra is ráteszi / levenni a viszi–begyűjti fuvarokat.
 * A generate_horizon önmagában eddig el tudta véteni a meglévő alkalmakat.
 */
export async function syncTemplateRides(
  template: Pick<ScheduleTemplate, 'id' | 'household_id' | 'needs_dropoff' | 'needs_pickup' | 'starts_at' | 'ends_at' | 'location_id'>,
): Promise<void> {
  const today = toIsoDate(new Date())
  const { data: occs, error: occErr } = await supabase
    .from('occurrence')
    .select('id, on_date, starts_at, ends_at, location_id, is_override, status')
    .eq('template_id', template.id)
    .gte('on_date', today)
    .eq('status', 'planned')
  if (occErr) throw occErr
  if (!occs?.length) return

  const { data: home } = await supabase
    .from('location')
    .select('id')
    .eq('household_id', template.household_id)
    .eq('is_home', true)
    .maybeSingle()
  const homeId = home?.id ?? null

  const ids = occs.map(o => o.id)
  const { data: legs } = await supabase
    .from('transport_leg')
    .select('id, occurrence_id, direction')
    .in('occurrence_id', ids)

  const byOcc = new Map<string, { dropoff: boolean; pickup: boolean }>()
  for (const id of ids) byOcc.set(id, { dropoff: false, pickup: false })
  for (const leg of legs ?? []) {
    const row = byOcc.get(leg.occurrence_id)
    if (!row) continue
    if (leg.direction === 'dropoff') row.dropoff = true
    if (leg.direction === 'pickup') row.pickup = true
  }

  const toInsert: Record<string, unknown>[] = []
  const toDeletePickup: string[] = []
  const toDeleteDropoff: string[] = []

  for (const occ of occs) {
    if (occ.is_override) continue
    const has = byOcc.get(occ.id) ?? { dropoff: false, pickup: false }
    const start = (occ.starts_at || template.starts_at).slice(0, 5)
    const end = (occ.ends_at || template.ends_at).slice(0, 5)
    const loc = occ.location_id || template.location_id

    if (template.needs_dropoff && !has.dropoff) {
      toInsert.push({
        household_id: template.household_id,
        occurrence_id: occ.id,
        direction: 'dropoff',
        driver_id: null,
        depart_at: budapestIso(occ.on_date, start),
        arrive_at: budapestIso(occ.on_date, start),
        from_location: homeId,
        to_location: loc,
      })
    }
    if (template.needs_pickup && !has.pickup) {
      toInsert.push({
        household_id: template.household_id,
        occurrence_id: occ.id,
        direction: 'pickup',
        driver_id: null,
        depart_at: budapestIso(occ.on_date, end),
        arrive_at: budapestIso(occ.on_date, end),
        from_location: loc,
        to_location: homeId,
      })
    }
    if (!template.needs_pickup && has.pickup) toDeletePickup.push(occ.id)
    if (!template.needs_dropoff && has.dropoff) toDeleteDropoff.push(occ.id)
  }

  if (toInsert.length) {
    const { error } = await supabase.from('transport_leg').insert(toInsert)
    if (error) throw error
  }
  if (toDeletePickup.length) {
    await supabase.from('transport_leg').delete().in('occurrence_id', toDeletePickup).eq('direction', 'pickup')
  }
  if (toDeleteDropoff.length) {
    await supabase.from('transport_leg').delete().in('occurrence_id', toDeleteDropoff).eq('direction', 'dropoff')
  }
}
