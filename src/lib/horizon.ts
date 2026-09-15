import { supabase } from './supabase'
import { budapestIso } from './occurrences'
import { isoWeekday, toIsoDate } from './format'
import { parseHouseholdSettings } from '../types'
import type { ScheduleTemplate } from '../types'

async function horizonDays(householdId: string): Promise<number> {
  const { data } = await supabase.from('household').select('settings').eq('id', householdId).maybeSingle()
  return parseHouseholdSettings(data?.settings).horizon_days
}

function addCalendarDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}

/** Az órarendből létrehozza / szinkronizálja a következő 30 nap programjait és fuvarjait. */
export async function refreshHorizon(householdId: string): Promise<string | null> {
  const daysAhead = await horizonDays(householdId)
  const { error } = await supabase.rpc('generate_horizon', {
    p_household_id: householdId,
    p_days_ahead: daysAhead,
  })
  if (!error) return null
  console.warn('generate_horizon', error.message)
  try {
    await generateHorizonClient(householdId, daysAhead)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : error.message
  }
}

/**
 * RPC nélkül is kitölti a hiányzó alkalmakat — akkor fut, ha a szerver
 * ON CONFLICT hibára fut (a unique index még a régi).
 */
async function generateHorizonClient(householdId: string, daysAhead: number): Promise<void> {
  const today = toIsoDate(new Date())
  const end = addCalendarDays(today, daysAhead)

  const { data: templates, error: tplErr } = await supabase
    .from('schedule_template')
    .select('*')
    .eq('household_id', householdId)
  if (tplErr) throw tplErr
  if (!templates?.length) return

  const { data: members } = await supabase
    .from('travel_group_member')
    .select('group_id, person_id')
  const byGroup = new Map<string, string[]>()
  for (const m of members ?? []) {
    if (!m.person_id) continue
    const arr = byGroup.get(m.group_id) ?? []
    arr.push(m.person_id)
    byGroup.set(m.group_id, arr)
  }

  const { data: existing, error: occErr } = await supabase
    .from('occurrence')
    .select('id, template_id, person_id, on_date')
    .eq('household_id', householdId)
    .gte('on_date', today)
    .lte('on_date', end)
    .not('template_id', 'is', null)
  if (occErr) throw occErr

  const havePerson = new Set(
    (existing ?? []).map(o => `${o.template_id}|${o.person_id}|${o.on_date}`),
  )

  const toInsert: Record<string, unknown>[] = []
  for (let i = 0; i <= daysAhead; i++) {
    const onDate = addCalendarDays(today, i)
    const weekday = isoWeekday(onDate)
    for (const t of templates as ScheduleTemplate[]) {
      if (t.weekday !== weekday) continue
      if (t.valid_from > onDate) continue
      if (t.valid_to && t.valid_to < onDate) continue
      const pids = t.group_id
        ? (byGroup.get(t.group_id) ?? [])
        : (t.person_id ? [t.person_id] : [])
      for (const pid of pids) {
        const personKey = `${t.id}|${pid}|${onDate}`
        if (havePerson.has(personKey)) continue
        toInsert.push({
          household_id: householdId,
          template_id: t.id,
          person_id: pid,
          title: t.title,
          on_date: onDate,
          starts_at: t.starts_at,
          ends_at: t.ends_at,
          location_id: t.location_id,
          status: 'planned',
        })
        havePerson.add(personKey)
      }
    }
  }

  const chunk = 40
  for (let i = 0; i < toInsert.length; i += chunk) {
    const slice = toInsert.slice(i, i + chunk)
    const { error } = await supabase.from('occurrence').insert(slice)
    if (!error) continue
    for (const row of slice) {
      const { error: oneErr } = await supabase.from('occurrence').insert(row)
      if (oneErr && oneErr.code !== '23505') throw oneErr
    }
  }

  for (const t of templates as ScheduleTemplate[]) {
    await syncTemplateRides(t)
  }
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
