// src/hooks/useAssignDriver.ts
// Egy fuvarláb sofőr-hozzárendelése — optimista írás, offline sorbaállás,
// notify-driver hívás. A Fuvartabla.tsx-ben már meglévő doAssign logika
// kiemelve, hogy a Ma képernyő (és később más képernyők) is használhassák.

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { db } from '../lib/db'
import { queueAssignDriver } from '../lib/sync'
import { useOnlineStatus } from './useOnlineStatus'
import type { TransportLeg } from '../types'

export function useAssignDriver(onUpdated?: (leg: TransportLeg) => void) {
  const online = useOnlineStatus()
  const [assigningLegId, setAssigningLegId] = useState<string | null>(null)

  async function assign(
    legId: string,
    driverId: string | null,
    companionId: string | null = null,
    companion2Id: string | null = null,
    selfTransport = false,
  ) {
    setAssigningLegId(legId)
    try {
      if (!online) {
        await queueAssignDriver({
          leg_id: legId, driver_id: driverId,
          companion_id: companionId, companion2_id: companion2Id,
          self_transport: selfTransport,
        })
        return
      }
      const { data } = await supabase.from('transport_leg')
        .update({
          driver_id: driverId, companion_id: companionId,
          companion2_id: companion2Id, self_transport: selfTransport,
        })
        .eq('id', legId).select('*, occurrence!inner(*)').single()

      if (data) {
        db.transport_legs.put(data as unknown as TransportLeg).catch(() => {})
        onUpdated?.(data as unknown as TransportLeg)
      }
      if (driverId && !selfTransport) {
        supabase.functions.invoke('notify-driver', { body: { leg_id: legId } })
          .catch(e => console.warn('notify-driver:', e))
      }
    } finally {
      setAssigningLegId(null)
    }
  }

  /** Visszavonás — ugyanarra a sofőrre koppintva. */
  async function release(legId: string) {
    await assign(legId, null, null, null, false)
  }

  /** Nagyszülő / szülő „Vállalom" — saját magát sofőrré teszi. */
  async function claim(legId: string, selfPersonId: string) {
    await assign(legId, selfPersonId, null, null, false)
  }

  return { assign, release, claim, assigningLegId, online }
}
