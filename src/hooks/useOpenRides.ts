import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { db } from '../lib/db'
import { useHousehold } from './useHousehold'
import { useOnlineStatus } from './useOnlineStatus'
import type { Occurrence, TransportLeg } from '../types'
import { isRideOpen } from '../lib/rideUi'

export type OpenRide = TransportLeg & { occurrence: Occurrence }

export function useOpenRides(from: string, to: string) {
  const { householdId } = useHousehold()
  const online = useOnlineStatus()
  const [legs, setLegs] = useState<OpenRide[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!householdId) return
    let cancelled = false
    setLoading(true)

    async function load() {
      if (!online) {
        const cached = await db.transport_legs
          .where('depart_at').between(from, to, true, true)
          .filter(l => l.household_id === householdId)
          .toArray()
        if (!cancelled) {
          setLegs(cached as OpenRide[])
          setLoading(false)
        }
        return
      }

      const { data } = await supabase.from('transport_leg')
        .select('*, occurrence!inner(*)')
        .eq('household_id', householdId)
        .gte('depart_at', from)
        .lte('depart_at', to)
        .order('depart_at')

      if (cancelled) return
      const rows = (data as OpenRide[]) ?? []
      setLegs(rows)
      db.transport_legs.bulkPut(rows).catch(() => {})
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [householdId, from, to, online])

  useEffect(() => {
    if (!householdId) return
    const channel = supabase
      .channel(`open-rides-${householdId}`)
      .on('postgres_changes' as const, {
        event: 'UPDATE',
        schema: 'public',
        table: 'transport_leg',
        filter: `household_id=eq.${householdId}`,
      }, (payload: { new: Record<string, unknown> }) => {
        const updated = payload.new as unknown as TransportLeg
        setLegs(prev => prev.map(l => l.id === updated.id ? { ...l, ...updated } : l))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [householdId])

  const openLegs = useMemo(
    () => legs.filter(l => isRideOpen(l)),
    [legs],
  )

  const countByDate = useMemo(() => {
    const map: Record<string, number> = {}
    for (const l of openLegs) {
      const day = l.depart_at.slice(0, 10)
      map[day] = (map[day] ?? 0) + 1
    }
    return map
  }, [openLegs])

  return {
    openLegs,
    countByDate,
    nextOpen: openLegs[0] ?? null,
    total: openLegs.length,
    loading,
  }
}
