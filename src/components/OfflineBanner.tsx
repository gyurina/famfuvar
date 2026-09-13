import { useEffect, useState } from 'react'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { flushSyncQueue, pendingSyncCount } from '../lib/sync'
import { copy } from '../copy'

export function OfflineBanner() {
  const online  = useOnlineStatus()
  const [justBack, setJustBack] = useState(false)
  const [pending, setPending]   = useState(0)

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
      justifyContent: 'center', gap: 8, minHeight: 24,
      background: online ? '#14532d' : '#78350f',
      color: online ? '#4ade80' : '#fbbf24',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    }}>
      {online ? (
        copy.offline.back
      ) : (
        <>
          {copy.offline.banner}
          {pending > 0 && (
            <span style={{ fontSize: 11, opacity: 0.8 }}>
              {copy.offline.pending(pending)}
            </span>
          )}
        </>
      )}
    </div>
  )
}
