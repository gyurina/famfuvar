// src/components/OfflineBanner.tsx
// Sárga banner offline módban + zöld visszaigazolás reconnect-kor.

import { useEffect, useState } from 'react'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { flushSyncQueue, pendingSyncCount } from '../lib/sync'

export function OfflineBanner() {
  const online  = useOnlineStatus()
  const [justBack, setJustBack] = useState(false)
  const [pending, setPending]   = useState(0)

  // Reconnect: flush queue + zöld visszaigazolás 3 mp-ig
  useEffect(() => {
    if (!online) {
      pendingSyncCount().then(setPending)
      return
    }
    flushSyncQueue().then(() => {
      setJustBack(true)
      setPending(0)
      const t = setTimeout(() => setJustBack(false), 3000)
      return () => clearTimeout(t)
    })
  }, [online])

  if (online && !justBack) return null

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      padding: '8px 16px', fontSize: 13, fontWeight: 500,
      textAlign: 'center', display: 'flex', alignItems: 'center',
      justifyContent: 'center', gap: 8,
      background: online ? '#14532d' : '#78350f',
      color: online ? '#4ade80' : '#fbbf24',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      transition: 'background 0.3s',
    }}>
      {online ? (
        <>✓ Újra online — szinkronizálva</>
      ) : (
        <>
          ⚠ Offline mód
          {pending > 0 && (
            <span style={{ fontSize: 11, opacity: 0.8 }}>
              ({pending} várakozó bejegyzés)
            </span>
          )}
        </>
      )}
    </div>
  )
}
