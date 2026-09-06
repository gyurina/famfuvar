import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { db } from '../lib/db'
import { useAuth } from '../lib/auth'
import type { Person, Location, TravelGroup, TravelGroupMember, TravelTime, DriverAvailability } from '../types'

export function useHousehold() {
  const { person } = useAuth()
  const [persons, setPersons] = useState<Person[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [groups, setGroups] = useState<TravelGroup[]>([])
  const [groupMembers, setGroupMembers] = useState<TravelGroupMember[]>([])
  const [travelTimes, setTravelTimes] = useState<TravelTime[]>([])
  const [availabilities, setAvailabilities] = useState<DriverAvailability[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!person) return
    const hid = person.household_id

    // 1. Azonnal lokális cache-ből (offline-first megjelenítés)
    Promise.all([
      db.persons.where('household_id').equals(hid).toArray(),
      db.locations.where('household_id').equals(hid).toArray(),
      db.travel_groups.where('household_id').equals(hid).toArray(),
      db.availabilities.where('household_id').equals(hid).toArray(),
      db.travel_times.where('household_id').equals(hid).toArray(),
    ]).then(([ps, ls, gs, avs, tts]) => {
      if (ps.length)  setPersons(ps)
      if (ls.length)  setLocations(ls)
      if (gs.length)  setGroups(gs)
      if (avs.length) setAvailabilities(avs)
      if (tts.length) setTravelTimes(tts)
    })

    // 2. Hálózatból frissítés (ha elérhető)
    async function load() {
      try {
        const [p, l, g, gm, tt, da] = await Promise.all([
          supabase.from('person').select('*').eq('household_id', hid),
          supabase.from('location').select('*').eq('household_id', hid),
          supabase.from('travel_group').select('*').eq('household_id', hid),
          supabase.from('travel_group_member').select('*'),
          supabase.from('travel_time').select('*').eq('household_id', hid),
          supabase.from('driver_availability').select('*').eq('household_id', hid),
        ])
        if (p.error || l.error) {
          // Hálózati hiba — maradunk a cache-nél, loaded=true jelzi hogy kész
          setLoaded(true)
          return
        }
        const ps = p.data ?? []; setPersons(ps);  await db.persons.bulkPut(ps)
        const ls = l.data ?? []; setLocations(ls); await db.locations.bulkPut(ls)
        const gs = g.data ?? []; setGroups(gs);    await db.travel_groups.bulkPut(gs)
        const avs = da.data ?? []; setAvailabilities(avs); await db.availabilities.bulkPut(avs)
        const tts = tt.data ?? []; setTravelTimes(tts);    await db.travel_times.bulkPut(tts)
        setGroupMembers(gm.data ?? [])
      } catch {
        // offline vagy egyéb hiba — cache megmarad
      } finally {
        setLoaded(true)
      }
    }

    load()
  }, [person?.household_id])

  const drivers = persons.filter(p => p.can_drive)
  const children = persons.filter(p => p.role === 'child')
  const home = locations.find(l => l.is_home) ?? null

  function personById(id: string | null) {
    return id ? persons.find(p => p.id === id) ?? null : null
  }
  function locationById(id: string | null) {
    return id ? locations.find(l => l.id === id) ?? null : null
  }

  return {
    persons, drivers, children, locations, home,
    groups, groupMembers, travelTimes, availabilities,
    loaded, personById, locationById,
    householdId: person?.household_id ?? null,
  }
}
