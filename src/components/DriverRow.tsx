import { useRef, useState, type KeyboardEvent } from 'react'
import { Avatar, type DriverBlock } from './Avatar'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { copy } from '../copy'
import type { Person } from '../types'

export type { DriverBlock }

export interface DriverRowProps {
  /** A háztartás sofőrjei, rögzített sorrendben. */
  drivers: Person[]
  driverId: string | null
  companionIds: string[]
  selfTransport: boolean
  guestName?: string | null
  /** Akadályok sofőrönként. Kulcs: person.id */
  blocks: Record<string, DriverBlock>
  mode: 'assign' | 'claim' | 'read'
  size?: 46 | 52
  householdNames?: string[]
  allowSelf?: boolean
  onPickDriver: (id: string) => void
  onPickCompanion: (id: string) => void
  onPickSelf: () => void
  onPickGuest?: (name: string) => void
  onClaim?: () => void
}

const GUEST_ID = '__guest__'

export function DriverRow({
  drivers,
  driverId,
  companionIds,
  selfTransport,
  guestName = null,
  blocks,
  mode,
  size = 46,
  householdNames = [],
  allowSelf = true,
  onPickDriver,
  onPickCompanion,
  onPickSelf,
  onPickGuest,
  onClaim,
}: DriverRowProps) {
  const [pendingBlockId, setPendingBlockId] = useState<string | null>(null)
  const [guestOpen, setGuestOpen] = useState(false)
  const [guestDraft, setGuestDraft] = useState(guestName ?? '')
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const guestOn = !!guestName && !driverId && !selfTransport

  if (mode === 'claim') {
    return (
      <button type="button" className="driver-row-claim" onClick={onClaim}>
        <Icon name="hand-waving" weight="fill" size={19} />
        {copy.rides.claim}
      </button>
    )
  }

  if (mode === 'read') {
    if (selfTransport) {
      return (
        <div className="driver-row driver-row--read">
          <Avatar variant="self" size={34} />
          <span className="driver-row-read-name">{copy.status.selfGoesHome}</span>
        </div>
      )
    }
    if (guestOn && guestName) {
      return (
        <div className="driver-row driver-row--read">
          <Avatar variant="guest" size={34} />
          <span className="driver-row-read-name">{guestName}</span>
        </div>
      )
    }
    const driver = drivers.find(d => d.id === driverId) ?? null
    if (!driver) return null
    return (
      <div className="driver-row driver-row--read">
        <Avatar person={driver} size={34} householdNames={householdNames} />
        <span className="driver-row-read-name">{driver.display_name}</span>
      </div>
    )
  }

  const ids = [
    ...drivers.map(d => d.id),
    ...(onPickGuest ? [GUEST_ID] : []),
  ]
  const slots = ids.length
  const scroll = slots > 5

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
    if (selfTransport || guestOn) {
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

  function openGuest() {
    setPendingBlockId(null)
    if (guestOn) {
      onPickGuest?.('')
      return
    }
    setGuestDraft(guestName ?? '')
    setGuestOpen(true)
  }

  function saveGuest() {
    const name = guestDraft.trim()
    if (!name || !onPickGuest) return
    onPickGuest(name)
    setGuestOpen(false)
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
          const isDriver = driverId === d.id && !selfTransport && !guestOn
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
        {onPickGuest && (
          <button
            ref={el => { itemRefs.current[GUEST_ID] = el }}
            type="button"
            role="radio"
            aria-checked={guestOn}
            aria-label={copy.a11y.guestDriver}
            className={`driver-row-item${guestOn ? ' is-driver' : ''}`}
            onClick={openGuest}
          >
            <Avatar variant="guest" size={size} mark={guestOn ? 'driver' : undefined} />
            <span className="driver-row-label">{guestOn && guestName ? guestName : copy.rides.guest}</span>
          </button>
        )}
      </div>
      {scroll && <div className="driver-row-fade" aria-hidden="true" />}
      {allowSelf && (
        <button
          type="button"
          className={`driver-row-self-strip${selfTransport ? ' is-on' : ''}`}
          aria-pressed={selfTransport}
          aria-label={copy.a11y.selfGoes}
          onClick={() => { setPendingBlockId(null); onPickSelf() }}
        >
          <Avatar variant="self" size={34} mark={selfTransport ? 'driver' : undefined} />
          <span>{copy.rides.selfTransport}</span>
        </button>
      )}
      {guestOpen && (
        <Sheet
          title={copy.rides.guestTitle}
          subtitle={copy.rides.guestHint}
          onClose={() => setGuestOpen(false)}
          padded
          primary={{
            label: copy.rides.guestSave,
            disabled: !guestDraft.trim(),
            onClick: saveGuest,
          }}
          secondary={{ label: copy.common.cancel, onClick: () => setGuestOpen(false) }}
        >
          <label className="driver-guest-label" htmlFor="guest-driver-name">{copy.rides.guestPlaceholder}</label>
          <input
            id="guest-driver-name"
            className="driver-guest-input"
            value={guestDraft}
            autoFocus
            onChange={e => setGuestDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveGuest() }}
            placeholder={copy.rides.guestPlaceholder}
          />
        </Sheet>
      )}
    </div>
  )
}
