import { useRef, useState, type KeyboardEvent } from 'react'
import { Avatar, type DriverBlock } from './Avatar'
import { Icon } from './Icon'
import { copy } from '../copy'
import type { Person } from '../types'

export type { DriverBlock }

export interface DriverRowProps {
  /** A háztartás sofőrjei, rögzített sorrendben. */
  drivers: Person[]
  driverId: string | null
  companionIds: string[]
  selfTransport: boolean
  /** Akadályok sofőrönként. Kulcs: person.id */
  blocks: Record<string, DriverBlock>
  mode: 'assign' | 'claim' | 'read'
  size?: 46 | 52
  householdNames?: string[]
  onPickDriver: (id: string) => void
  onPickCompanion: (id: string) => void
  onPickSelf: () => void
  onClaim?: () => void
}

const SELF_ID = '__self__'

export function DriverRow({
  drivers,
  driverId,
  companionIds,
  selfTransport,
  blocks,
  mode,
  size = 46,
  householdNames = [],
  onPickDriver,
  onPickCompanion,
  onPickSelf,
  onClaim,
}: DriverRowProps) {
  const [pendingBlockId, setPendingBlockId] = useState<string | null>(null)
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  if (mode === 'claim') {
    return (
      <button type="button" className="driver-row-claim" onClick={onClaim}>
        <Icon name="hand-waving" weight="fill" size={19} />
        {copy.rides.claim}
      </button>
    )
  }

  if (mode === 'read') {
    const driver = drivers.find(d => d.id === driverId) ?? null
    if (selfTransport) {
      return (
        <div className="driver-row driver-row--read">
          <Avatar variant="self" size={34} />
          <span className="driver-row-read-name">{copy.status.selfGoesHome}</span>
        </div>
      )
    }
    if (!driver) return null
    return (
      <div className="driver-row driver-row--read">
        <Avatar person={driver} size={34} householdNames={householdNames} />
        <span className="driver-row-read-name">{driver.display_name}</span>
      </div>
    )
  }

  const slots = drivers.length + 1
  const scroll = slots > 5
  const ids = [...drivers.map(d => d.id), SELF_ID]

  function focusId(id: string) {
    itemRefs.current[id]?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const current = document.activeElement
    const currentId = ids.find(id => itemRefs.current[id] === current)
    if (!currentId) return
    e.preventDefault()
    const idx = ids.indexOf(currentId)
    const next = e.key === 'ArrowRight'
      ? ids[(idx + 1) % ids.length]
      : ids[(idx - 1 + ids.length) % ids.length]
    focusId(next)
  }

  function pickPerson(d: Person) {
    const block = blocks[d.id]
    if (block && pendingBlockId !== d.id) {
      setPendingBlockId(d.id)
      return
    }
    setPendingBlockId(null)
    if (selfTransport) {
      onPickDriver(d.id)
      return
    }
    if (driverId === d.id) {
      onPickDriver(d.id)
      return
    }
    if (!driverId) {
      onPickDriver(d.id)
      return
    }
    onPickCompanion(d.id)
  }

  return (
    <div className={`driver-row-wrap${scroll ? ' is-scroll' : ''}`}>
      <div
        className={`driver-row${scroll ? ' scroll' : ' fit'}`}
        role="radiogroup"
        aria-label={copy.a11y.drivers}
        onKeyDown={onKeyDown}
      >
        {drivers.map(d => {
          const block = blocks[d.id]
          const isDriver = driverId === d.id && !selfTransport
          const isCompanion = companionIds.includes(d.id)
          const isBlocked = !!block && !isDriver && !isCompanion
          const pending = pendingBlockId === d.id
          const label = pending
            ? copy.rides.confirmAnyway
            : isDriver
              ? copy.rides.driving
              : isCompanion
                ? copy.rides.with
                : isBlocked
                  ? block.label
                  : d.display_name
          const className = [
            'driver-row-item',
            isDriver ? 'is-driver' : '',
            isCompanion ? 'is-companion' : '',
            isBlocked ? 'is-blocked' : '',
            pending ? 'is-pending' : '',
          ].filter(Boolean).join(' ')
          return (
            <button
              key={d.id}
              ref={el => { itemRefs.current[d.id] = el }}
              type="button"
              role="radio"
              aria-checked={isDriver}
              aria-label={copy.a11y.driverTakes(d.display_name)}
              className={className}
              onClick={() => pickPerson(d)}
            >
              <Avatar
                person={d}
                size={size}
                householdNames={householdNames}
                block={isBlocked ? block : undefined}
                mark={isDriver ? 'driver' : isCompanion ? 'companion' : undefined}
              />
              <span className="driver-row-label">{label}</span>
            </button>
          )
        })}
        <button
          ref={el => { itemRefs.current[SELF_ID] = el }}
          type="button"
          role="radio"
          aria-checked={selfTransport}
          aria-label={copy.a11y.selfGoes}
          className={`driver-row-item${selfTransport ? ' is-driver' : ''}`}
          onClick={() => { setPendingBlockId(null); onPickSelf() }}
        >
          <Avatar variant="self" size={size} mark={selfTransport ? 'driver' : undefined} />
          <span className="driver-row-label">{copy.rides.selfTransport}</span>
        </button>
      </div>
      {scroll && <div className="driver-row-fade" aria-hidden="true" />}
    </div>
  )
}
