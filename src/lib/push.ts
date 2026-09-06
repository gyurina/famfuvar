// src/lib/push.ts
// Web Push feliratkozás kezelése — Supabase push_subscription táblával szinkronban.

import { supabase } from './supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const buf = new ArrayBuffer(raw.length)
  const arr = new Uint8Array(buf)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

/** Elérhető-e a push a böngészőben? */
export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window
}

/** Jelenleg fel van-e iratkozva? */
export async function isPushSubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false
  const reg = await navigator.serviceWorker.ready
  return !!(await reg.pushManager.getSubscription())
}

/**
 * Feliratkozás push értesítésre.
 * @param householdId — a háztartás ID-ja (Supabase-be mentéshez)
 * @returns true ha sikeres, false ha nem támogatott vagy elutasítva
 */
export async function subscribeToPush(householdId: string): Promise<boolean> {
  if (!isPushSupported()) {
    console.warn('Push not supported')
    return false
  }
  if (!VAPID_PUBLIC_KEY) {
    console.warn('VITE_VAPID_PUBLIC_KEY nincs beállítva')
    return false
  }

  const reg = await navigator.serviceWorker.ready

  // Ha már fel van iratkozva, csak szinkronizáljuk a DB-vel
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
      })
    } catch (e) {
      console.error('PushManager.subscribe error:', e)
      return false
    }
  }

  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  const { error } = await supabase.from('push_subscription').upsert({
    household_id: householdId,
    endpoint:     json.endpoint,
    p256dh:       json.keys.p256dh,
    auth:         json.keys.auth,
  }, { onConflict: 'user_id,endpoint' })

  if (error) {
    console.error('push_subscription upsert error:', error)
    return false
  }
  return true
}

/** Leiratkozás és a DB-ből törlés. */
export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  const { endpoint } = sub.toJSON() as { endpoint: string }
  await sub.unsubscribe()
  await supabase.from('push_subscription').delete().eq('endpoint', endpoint)
}
