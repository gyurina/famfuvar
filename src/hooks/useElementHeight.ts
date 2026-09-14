import { useLayoutEffect, useState, type RefObject } from 'react'

/** A ragadós napcím `top` értéke: a fölötte maradó fejléc magassága. */
export function useElementHeight(ref: RefObject<HTMLElement | null>) {
  const [height, setHeight] = useState(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setHeight(Math.round(el.getBoundingClientRect().height))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return height
}
