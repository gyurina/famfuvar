import type { LegDirection } from '../types'

interface DirectionBadgeProps {
  direction: LegDirection
  size?: number
}

/**
 * F1 – Irány-badge: vizuálisan jól látható → / ← ikon szállítási irányhoz.
 * dropoff (odavisz) → jobbra nyíl, zöld
 * pickup  (elhozás) ← balra nyíl, kék
 */
export default function DirectionBadge({ direction, size = 14 }: DirectionBadgeProps) {
  const isDropoff = direction === 'dropoff'
  return (
    <span
      title={isDropoff ? 'Odavisz →' : '← Elhozás'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size + 6,
        height: size + 6,
        borderRadius: 4,
        fontSize: size,
        fontWeight: 700,
        lineHeight: 1,
        background: isDropoff ? 'rgba(34,197,94,0.15)' : 'rgba(59,130,246,0.15)',
        color: isDropoff ? '#16a34a' : '#2563eb',
        flexShrink: 0,
      }}
    >
      {isDropoff ? '→' : '←'}
    </span>
  )
}
