import { useEffect, useState } from 'react'
import { toIsoDate } from '../lib/format'

/** A mai dátum; éjfél után újraszámol, hogy a Ma nézet átforduljon. */
export function useMidnightRefresh() {
  const [day, setDay] = useState(() => toIsoDate(new Date()))

  useEffect(() => {
    const now = new Date()
    const next = new Date(now)
    next.setHours(24, 0, 5, 0)
    const t = window.setTimeout(() => setDay(toIsoDate(new Date())), next.getTime() - now.getTime())
    return () => window.clearTimeout(t)
  }, [day])

  return day
}
