import { Avatar, type DriverBlock } from './Avatar'
import { Icon } from './Icon'
import { copy } from '../copy'
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
  /** assign = szülő (teljes arcsor), claim = nagyszülő (egy gomb), read = mindenki más */
  mode: 'assign' | 'claim' | 'read'
  claimLabel?: string
  onClaim?: () => void
}

function toAvatarBlock(b: Block): DriverBlock {
  if (b.kind === 'calendar') return { kind: 'calendar', label: b.at ?? copy.rides.calendar }
  if (b.kind === 'break') return { kind: 'absence', label: b.at ?? copy.rides.absence }
  return { kind: 'ride', label: b.at ?? copy.rides.conflict }
}

const blockLabel = (b: Block) =>
  b.kind === 'ride' ? (b.at ?? copy.rides.conflict) : b.kind === 'calendar' ? copy.rides.calendar : copy.rides.absence

export function DriverRow({
  drivers, driverId, companions = [], selfTransport = false,
  size = 46, blocks = {}, onPick, onSelf, selfLabel = copy.status.self, mode,
  claimLabel = copy.rides.claim, onClaim,
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
          <button
            key={d.id}
            type="button"
            onClick={mode === 'assign' ? () => onPick(d.id) : undefined}
            style={{
              flex: '1 0 0', minWidth: size, display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0,
              cursor: mode === 'assign' ? 'pointer' : 'default',
              opacity: block && !active ? 0.45 : 1,
            }}
          >
            <Avatar
              person={d}
              size={size}
              block={block ? toAvatarBlock(block) : undefined}
            />
            <span style={{
              fontSize: 12, textAlign: 'center',
              color: active || isCompanion ? 'var(--color-accent-ink)' : block ? 'var(--color-muted)' : 'var(--color-text-2)',
              fontWeight: active ? 600 : 500,
            }}>
              {block && !active ? blockLabel(block) : d.display_name}
            </span>
          </button>
        )
      })}
      {onSelf && (
        <button
          type="button"
          onClick={onSelf}
          style={{
            flex: '1 0 0', minWidth: size, display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0,
            cursor: 'pointer',
          }}
        >
          <Avatar variant="self" size={size} />
          <span style={{ fontSize: 12, color: selfTransport ? 'var(--color-accent-ink)' : 'var(--color-muted)', fontWeight: selfTransport ? 600 : 500 }}>{selfLabel}</span>
        </button>
      )}
    </div>
  )
}
