// src/hooks/useOnlineStatus.ts
// navigator.onLine + online/offline events alapú detektálás.

import { useEffect, useState } from 'react'

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    function onOnline()  { setOnline(true)  }
    function onOffline() { setOnline(false) }
    window.addEventListener('online',  onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online',  onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  return online
}
