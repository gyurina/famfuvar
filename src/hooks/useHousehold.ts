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

    async function load() {
      const [p, l, g, gm, tt, da] = await Promise.all([
        supabase.from('person').select('*').eq('household_id', hid),
        supabase.from('location').select('*').eq('household_id', hid),
        supabase.from('travel_group').select('*').eq('household_id', hid),
        supabase.from('travel_group_member').select('*'),
        supabase.from('travel_time').select('*').eq('household_id', hid),
        supabase.from('driver_availability').select('*').eq('household_id', hid),
      ])
      const ps = p.data ?? []; setPersons(ps); await db.persons.bulkPut(ps)
      const ls = l.data ?? []; setLocations(ls); await db.locations.bulkPut(ls)
      const gs = g.data ?? []; setGroups(gs); await db.travel_groups.bulkPut(gs)
      setGroupMembers(gm.data ?? [])
      setTravelTimes(tt.data ?? [])
      setAvailabilities(da.data ?? [])
      setLoaded(true)
    }

    // Először lokálisból
    Promise.all([
      db.persons.where('household_id').equals(hid).toArray(),
      db.locations.where('household_id').equals(hid).toArray(),
    ]).then(([ps, ls]) => {
      if (ps.length) setPersons(ps)
      if (ls.length) setLocations(ls)
    })

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
