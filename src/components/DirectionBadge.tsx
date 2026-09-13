import type { LegDirection } from '../types'
import { directionWord } from '../lib/format'

interface DirectionBadgeProps {
  direction: LegDirection
  size?: number
}

export default function DirectionBadge({ direction }: DirectionBadgeProps) {
  return (
    <span
      title={directionWord(direction)}
      style={{
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--color-text-2)',
        flexShrink: 0,
      }}
    >
      {directionWord(direction)}
    </span>
  )
}
