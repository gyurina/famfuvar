// src/lib/sync.ts
// Offline sync queue — sofőr-hozzárendelés offline sorbanállása és
// automatikus flush-olása reconnect-kor.

import { db } from './db'
import { supabase } from './supabase'

export type AssignDriverPayload = {
  leg_id:        string
  driver_id:     string | null
  companion_id:  string | null
  companion2_id: string | null
  self_transport: boolean
}

/** Offline módban sorba helyez egy sofőr-hozzárendelést. */
export async function queueAssignDriver(payload: AssignDriverPayload): Promise<void> {
  await db.sync_queue.add({
    action:     'ASSIGN_DRIVER',
    payload:    payload as unknown as Record<string, unknown>,
    created_at: Date.now(),
  })
}

/** Feldolgoz minden várakozó sync_queue tételt — hívd reconnect-kor. */
export async function flushSyncQueue(): Promise<void> {
  const items = await db.sync_queue.orderBy('created_at').toArray()
  if (!items.length) return
  console.log(`[sync] flushing ${items.length} queued action(s)`)

  for (const item of items) {
    try {
      if (item.action === 'ASSIGN_DRIVER') {
        const p = item.payload as unknown as AssignDriverPayload
        const { error } = await supabase.from('transport_leg')
          .update({
            driver_id:     p.driver_id,
            companion_id:  p.companion_id,
            companion2_id: p.companion2_id,
            self_transport: p.self_transport,
          })
          .eq('id', p.leg_id)
        if (error) throw error
      }
      await db.sync_queue.delete(item.id!)
      console.log(`[sync] flushed ${item.action} id=${item.id}`)
    } catch (e) {
      console.error(`[sync] failed ${item.action} id=${item.id}`, e)
      // Hibás tételt meghagyjuk — következő online-ban újra próbálja
    }
  }
}

/** Hány várakozó tétel van? */
export async function pendingSyncCount(): Promise<number> {
  return db.sync_queue.count()
}
