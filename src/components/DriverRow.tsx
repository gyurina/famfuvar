import { Avatar, type AvatarBadge } from './Avatar'
import { Icon } from './Icon'
import type { Person } from '../types'

export type Block = { kind: 'ride' | 'calendar' | 'break'; at?: string }

interface DriverRowProps {
  drivers: Person[]
  driverId: string | null
  companions?: string[]
  selfTransport?: boolean
  size?: 46 | 52
  blocks?: Record<string, Block>
  onPick: (id: string) => void
  onSelf?: () => void
  selfLabel?: string
  /** assign = szülő (teljes arcsor), claim = nagyszülő (egy „Vállalom" gomb), read = mindenki más */
  mode: 'assign' | 'claim' | 'read'
  claimLabel?: string
  onClaim?: () => void
}

const blockBadge: Record<Block['kind'], AvatarBadge> = { ride: 'ride', calendar: 'calendar', break: 'break' }
const blockLabel = (b: Block) =>
  b.kind === 'ride' ? (b.at ?? 'Ütközés') : b.kind === 'calendar' ? 'Naptár' : 'Szünet'

export function DriverRow({
  drivers, driverId, companions = [], selfTransport = false,
  size = 46, blocks = {}, onPick, onSelf, selfLabel = 'Önállóan', mode, claimLabel = 'Vállalom', onClaim,
}: DriverRowProps) {
  if (mode === 'claim') {
    return (
      <button
        onClick={onClaim}
        style={{
          width: '100%', height: 46, borderRadius: 100, border: '1px solid rgba(45,216,138,.35)',
          background: 'rgba(45,216,138,.12)', color: 'var(--color-ok)',
          fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 8, cursor: 'pointer',
        }}
      >
        <Icon name="hand-waving" weight="fill" size={17} />
        {claimLabel}
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {drivers.map(d => {
        const block  = blocks[d.id]
        const active = driverId === d.id
        const isCompanion = companions.includes(d.id)
        return (
          <div key={d.id} style={{ flex: '1 0 0', minWidth: size, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <Avatar
              person={d}
              size={size}
              active={active || isCompanion}
              badge={block ? blockBadge[block.kind] : null}
              dimmed={!!block && !active}
              onClick={mode === 'assign' ? () => onPick(d.id) : undefined}
              label={d.display_name}
            />
            <span style={{
              fontSize: 12, textAlign: 'center',
              color: active ? 'var(--color-accent-ink)' : block ? 'var(--color-muted)' : 'var(--color-text-2)',
              fontWeight: active ? 600 : 500,
            }}>
              {block && !active ? blockLabel(block) : d.display_name}
            </span>
          </div>
        )
      })}
      {onSelf && (
        <div style={{ flex: '1 0 0', minWidth: size, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <Avatar self size={size} onClick={onSelf} />
          <span style={{ fontSize: 12, color: selfTransport ? 'var(--color-accent-ink)' : 'var(--color-muted)', fontWeight: selfTransport ? 600 : 500 }}>{selfLabel}</span>
        </div>
      )}
    </div>
  )
}
