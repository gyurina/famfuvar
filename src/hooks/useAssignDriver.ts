import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { db } from '../lib/db'
import { queueAssignDriver } from '../lib/sync'
import { useOnlineStatus } from './useOnlineStatus'
import { useAuth } from '../lib/auth'
import type { TransportLeg } from '../types'

export type AssignmentPatch = {
  id: string
  driver_id: string | null
  companion_id: string | null
  companion2_id: string | null
  self_transport: boolean
}

export function useAssignDriver(onUpdated?: (patch: AssignmentPatch) => void) {
  const online = useOnlineStatus()
  const { person } = useAuth()
  const [assigningLegId, setAssigningLegId] = useState<string | null>(null)

  async function writeOne(
    legId: string,
    driverId: string | null,
    companionId: string | null,
    companion2Id: string | null,
    selfTransport: boolean,
    notify: boolean,
  ) {
    const patch: AssignmentPatch = {
      id: legId,
      driver_id: driverId,
      companion_id: companionId,
      companion2_id: companion2Id,
      self_transport: selfTransport,
    }
    onUpdated?.(patch)
    try {
      const cached = await db.transport_legs.get(legId)
      if (cached) await db.transport_legs.put({ ...cached, ...patch })
    } catch { /* cache optional */ }

    if (!online) {
      await queueAssignDriver({
        leg_id: legId,
        driver_id: driverId,
        companion_id: companionId,
        companion2_id: companion2Id,
        self_transport: selfTransport,
      })
      return
    }

    const { data, error } = await supabase.from('transport_leg')
      .update({
        driver_id: driverId,
        companion_id: companionId,
        companion2_id: companion2Id,
        self_transport: selfTransport,
      })
      .eq('id', legId)
      .select('*, occurrence(*)')
      .maybeSingle()

    if (error) {
      await queueAssignDriver({
        leg_id: legId,
        driver_id: driverId,
        companion_id: companionId,
        companion2_id: companion2Id,
        self_transport: selfTransport,
      })
      return
    }

    if (data) {
      db.transport_legs.put(data as unknown as TransportLeg).catch(() => {})
      onUpdated?.({
        id: data.id,
        driver_id: data.driver_id,
        companion_id: data.companion_id,
        companion2_id: data.companion2_id,
        self_transport: data.self_transport,
      })
    }

    if (notify && !selfTransport) {
      const actorId = person?.id ?? null
      if (driverId && actorId && driverId !== actorId) {
        supabase.functions.invoke('notify-driver', { body: { leg_id: legId } })
          .catch(e => console.warn('notify-driver:', e))
      } else {
        supabase.functions.invoke('notify-parents', {
          body: {
            leg_id: legId,
            kind: driverId ? 'claim' : 'release',
            actor_id: actorId,
            actor_name: person?.display_name ?? '',
          },
        }).catch(e => console.warn('notify-parents:', e))
      }
    }
  }

  async function assign(
    legId: string,
    driverId: string | null,
    companionIds: string[] = [],
    selfTransport = false,
  ) {
    setAssigningLegId(legId)
    try {
      await writeOne(
        legId,
        driverId,
        companionIds[0] ?? null,
        companionIds[1] ?? null,
        selfTransport,
        true,
      )
    } finally {
      setAssigningLegId(null)
    }
  }

  async function assignMany(
    legIds: string[],
    driverId: string | null,
    companionIds: string[] = [],
    selfTransport = false,
  ) {
    if (legIds.length === 0) return
    setAssigningLegId(legIds[0])
    try {
      for (let i = 0; i < legIds.length; i++) {
        await writeOne(
          legIds[i],
          driverId,
          companionIds[0] ?? null,
          companionIds[1] ?? null,
          selfTransport,
          i === 0,
        )
      }
    } finally {
      setAssigningLegId(null)
    }
  }

  async function release(legId: string) {
    await assign(legId, null, [], false)
  }

  async function claim(legId: string, selfPersonId: string) {
    await assign(legId, selfPersonId, [], false)
  }

  return { assign, assignMany, release, claim, assigningLegId, online }
}
