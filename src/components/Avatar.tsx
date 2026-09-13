import type { DriverBlock, Person } from '../types'
import { Icon } from './Icon'

export type AvatarSize = 26 | 34 | 46 | 52

export type { DriverBlock }

interface AvatarProps {
  person?: Pick<Person, 'display_name' | 'color'> | null
  size: AvatarSize
  /** Ütköző kezdőbetűkhöz: a háztartás többi neve. */
  householdNames?: string[]
  block?: DriverBlock
  variant?: 'person' | 'self'
  /** Sofőr-gyűrű / kísérő-gyűrű a DriverRow-ban. */
  mark?: 'driver' | 'companion'
}

function monogram(name: string, householdNames: string[]): string {
  const first = name.charAt(0)
  const clash = householdNames.some(n => n !== name && n.charAt(0) === first)
  return clash ? name.slice(0, 2) : first
}

function badgeIcon(kind: DriverBlock['kind']) {
  if (kind === 'calendar') return 'calendar-x' as const
  if (kind === 'absence') return 'bed' as const
  return 'warning' as const
}

function badgeBg(kind: DriverBlock['kind']) {
  if (kind === 'calendar') return 'var(--color-warn)'
  if (kind === 'absence') return 'var(--color-muted)'
  return 'var(--color-danger)'
}

export function Avatar({
  person,
  size,
  householdNames = [],
  block,
  variant = 'person',
  mark,
}: AvatarProps) {
  const showBadge = !!block && (size === 46 || size === 52) && mark !== 'driver' && mark !== 'companion'

  if (variant === 'self') {
    return (
      <span className={`avatar self size-${size}${mark ? ` mark-${mark}` : ''}`}>
        <Icon name="person-simple-walk" size={size >= 46 ? 20 : 17} />
      </span>
    )
  }

  const name = person?.display_name ?? ''
  const markClass = mark ? ` mark-${mark}` : ''
  return (
    <span
      className={`avatar size-${size}${markClass}`}
      style={{ background: person?.color ?? 'var(--color-muted)' }}
    >
      {mark === 'driver'
        ? <Icon name="steering-wheel" size={size >= 52 ? 21 : size >= 46 ? 19 : 15} weight="fill" color="#fff" />
        : monogram(name, householdNames)}
      {showBadge && block && (
        <span className="avatar-badge" style={{ background: badgeBg(block.kind) }}>
          <Icon
            name={badgeIcon(block.kind)}
            size={size === 52 ? 9 : 8}
            weight="fill"
            color={block.kind === 'ride' ? '#fff' : '#0b1220'}
          />
        </span>
      )}
    </span>
  )
}
