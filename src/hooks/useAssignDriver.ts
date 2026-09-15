import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { db } from '../lib/db'
import { queueAssignDriver } from '../lib/sync'
import { useOnlineStatus } from './useOnlineStatus'
import { useAuth } from '../lib/auth'
import { GUEST_NOTE_PREFIX } from '../lib/rideUi'
import type { TransportLeg } from '../types'

export type AssignmentPatch = {
  id: string
  driver_id: string | null
  companion_id: string | null
  companion2_id: string | null
  self_transport: boolean
  guest_name: string | null
  note?: string | null
}

function isMissingGuestColumn(message: string | undefined) {
  return !!message && /guest_name/i.test(message)
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
    guestName: string | null,
    notify: boolean,
  ) {
    const patch: AssignmentPatch = {
      id: legId,
      driver_id: driverId,
      companion_id: companionId,
      companion2_id: companion2Id,
      self_transport: selfTransport,
      guest_name: guestName,
    }
    onUpdated?.(patch)
    let prevNote: string | null = null
    try {
      const cached = await db.transport_legs.get(legId)
      if (cached) {
        prevNote = cached.note
        await db.transport_legs.put({ ...cached, ...patch })
      }
    } catch { /* cache optional */ }

    const payload = {
      leg_id: legId,
      driver_id: driverId,
      companion_id: companionId,
      companion2_id: companion2Id,
      self_transport: selfTransport,
      guest_name: guestName,
    }

    if (!online) {
      await queueAssignDriver(payload)
      return
    }

    const core = {
      driver_id: driverId,
      companion_id: companionId,
      companion2_id: companion2Id,
      self_transport: selfTransport,
      guest_name: guestName,
    }

    let { data, error } = await supabase.from('transport_leg')
      .update(core)
      .eq('id', legId)
      .select('*, occurrence(*)')
      .maybeSingle()

    if (error && isMissingGuestColumn(error.message)) {
      const nextNote = guestName
        ? `${GUEST_NOTE_PREFIX}${guestName}`
        : (prevNote?.toLowerCase().startsWith(GUEST_NOTE_PREFIX) ? null : prevNote)
      const fallback = {
        driver_id: driverId,
        companion_id: companionId,
        companion2_id: companion2Id,
        self_transport: selfTransport,
        note: nextNote,
      }
      const retry = await supabase.from('transport_leg')
        .update(fallback)
        .eq('id', legId)
        .select('*, occurrence(*)')
        .maybeSingle()
      data = retry.data
      error = retry.error
      if (!error) {
        patch.note = nextNote
        patch.guest_name = guestName
        onUpdated?.(patch)
      }
    }

    if (error) {
      await queueAssignDriver(payload)
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
        guest_name: data.guest_name ?? guestName,
        note: data.note,
      })
    }

    if (notify && !selfTransport) {
      const actorId = person?.id ?? null
      if (driverId && actorId && driverId !== actorId) {
        supabase.functions.invoke('notify-driver', { body: { leg_id: legId, actor_id: actorId } })
          .catch(e => console.warn('notify-driver:', e))
      } else if (!guestName) {
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
    guestName: string | null = null,
  ) {
    setAssigningLegId(legId)
    try {
      await writeOne(
        legId,
        driverId,
        companionIds[0] ?? null,
        companionIds[1] ?? null,
        selfTransport,
        guestName,
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
    guestName: string | null = null,
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
          guestName,
          i === 0,
        )
      }
    } finally {
      setAssigningLegId(null)
    }
  }

  async function release(legId: string) {
    await assign(legId, null, [], false, null)
  }

  async function claim(legId: string, selfPersonId: string) {
    await assign(legId, selfPersonId, [], false, null)
  }

  return { assign, assignMany, release, claim, assigningLegId, online }
}
