import type { DriverBlock, Person, PersonRole } from '../types'
import { Icon, type IconName } from './Icon'

export type AvatarSize = 26 | 34 | 46 | 52

export type { DriverBlock }

interface AvatarProps {
  person?: Pick<Person, 'display_name' | 'color' | 'role'> | null
  size: AvatarSize
  /** Ütköző kezdőbetűkhöz: a háztartás többi neve. */
  householdNames?: string[]
  block?: DriverBlock
  variant?: 'person' | 'self' | 'guest'
  /** Sofőr-gyűrű / kísérő-gyűrű a DriverRow-ban. */
  mark?: 'driver' | 'companion'
}

export function roleIcon(role: PersonRole | 'guest' | undefined): IconName {
  if (role === 'parent') return 'user'
  if (role === 'grandparent') return 'user-circle'
  if (role === 'babysitter') return 'baby'
  if (role === 'child') return 'smiley'
  if (role === 'guest') return 'user-plus'
  return 'user'
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

function glyphSize(size: AvatarSize) {
  if (size >= 52) return 22
  if (size >= 46) return 20
  if (size >= 34) return 17
  return 14
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
  const markClass = mark ? ` mark-${mark}` : ''

  if (variant === 'self') {
    return (
      <span className={`avatar self size-${size}${markClass}`}>
        <Icon name="person-simple-walk" size={glyphSize(size)} />
      </span>
    )
  }

  if (variant === 'guest') {
    return (
      <span className={`avatar guest size-${size}${markClass}`}>
        <Icon name="user-plus" size={glyphSize(size)} weight="fill" />
      </span>
    )
  }

  const name = person?.display_name ?? ''
  const icon = person?.role ? roleIcon(person.role) : null
  return (
    <span
      className={`avatar size-${size}${markClass}`}
      style={{ background: person?.color ?? 'var(--color-muted)' }}
    >
      {icon
        ? <Icon name={icon} size={glyphSize(size)} weight="fill" color="#fff" />
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
