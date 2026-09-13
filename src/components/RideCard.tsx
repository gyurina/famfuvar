import { useState } from 'react'
import { Avatar } from './Avatar'
import { DriverRow, type DriverBlock } from './DriverRow'
import { Icon } from './Icon'
import { Pill } from './Pill'
import { copy } from '../copy'
import { formatTime } from '../lib/format'
import {
  assignedSentence,
  companionIdsOf,
  driverMode,
  rideDurationMins,
  rideSubtitle,
  type EventSummary,
  type RideRow,
} from '../lib/rideUi'
import type { Person } from '../types'

export interface RideCardProps {
  ride: RideRow
  event: EventSummary
  child: Person
  state: 'assigned' | 'open' | 'self' | 'cancelled'
  pairedRide?: RideRow | null
  mergeHint?: { rideId: string; text: string }
  canAssign: boolean
  canClaim: boolean
  canEdit: boolean
  canRelease?: boolean
  drivers: Person[]
  blocks: Record<string, DriverBlock>
  householdNames?: string[]
  viewerId?: string | null
  fromHome?: boolean
  fromName?: string | null
  onAssign: (driverId: string) => void
  onCompanion: (id: string) => void
  onSelf: () => void
  onRelease: () => void
  onClaim?: () => void
  onMerge: (rideId: string) => void
  onOpenMenu: () => void
}

export function RideCard({
  ride,
  event,
  child,
  state,
  pairedRide = null,
  mergeHint,
  canAssign,
  canClaim,
  canEdit,
  canRelease = false,
  drivers,
  blocks,
  householdNames = [],
  viewerId = null,
  fromHome = false,
  fromName = null,
  onAssign,
  onCompanion,
  onSelf,
  onRelease,
  onClaim,
  onMerge,
  onOpenMenu,
}: RideCardProps) {
  const [editing, setEditing] = useState(false)
  const driver = drivers.find(d => d.id === ride.driver_id) ?? null
  const companions = companionIdsOf(ride)
  const duration = rideDurationMins(ride)
  const subtitle = rideSubtitle(ride.direction, fromHome, fromName ?? null, duration)
  const mode = driverMode({
    canAssignOthers: canAssign,
    canSelfAssign: canClaim,
    isOpen: state === 'open',
  })
  const showRow = mode === 'assign' && (state === 'open' || editing)
  const showClaim = mode === 'claim' && state === 'open'
  const isOwn = !!viewerId && (ride.driver_id === viewerId || companions.includes(viewerId) || ride.self_transport)
  const showCantTake = !canAssign && canRelease && (state === 'assigned' || state === 'self') && isOwn
  const pairedSameDriver = pairedRide
    && ride.driver_id
    && pairedRide.driver_id === ride.driver_id
    && !ride.self_transport

  const title = `${child.display_name} · ${event.title}`
  const modifier =
    state === 'cancelled' ? 'cancelled'
    : showClaim ? 'claim'
    : state === 'open' && canAssign ? 'open'
    : 'default'

  function handlePickDriver(id: string) {
    if (ride.driver_id === id && !ride.self_transport) {
      onRelease()
      setEditing(false)
      return
    }
    onAssign(id)
    setEditing(false)
  }

  return (
    <article className={`ride-card ride-card--${modifier}`}>
      <div className="ride-card-head">
        <div className="ride-card-head-main">
          <div className="ride-card-title-row">
            <span className="ride-card-dot" style={{ background: child.color, opacity: state === 'cancelled' ? 0.6 : 1 }} />
            <span className={`ride-card-title${state === 'cancelled' ? ' is-cancelled' : ''}`}>{title}</span>
          </div>
          {state === 'cancelled' ? (
            <div className="ride-card-sub ride-card-sub--warn">
              <Icon name="prohibit" size={14} weight="fill" />
              {ride.occurrence?.note
                ? copy.status.cancelledWithReason(ride.occurrence.note)
                : copy.status.cancelled}
            </div>
          ) : (
            <div className="ride-card-sub">{subtitle}</div>
          )}
        </div>
        <div className="ride-card-time-col">
          <span className={`ride-card-time${state === 'cancelled' ? ' is-cancelled' : ''}`}>
            {formatTime(ride.depart_at)}
          </span>
          {canEdit && state !== 'cancelled' && (
            <button type="button" className="ride-card-menu" onClick={onOpenMenu} aria-label={copy.a11y.moreActions}>
              <Icon name="dots-three" size={20} />
            </button>
          )}
        </div>
      </div>

      {mergeHint && state !== 'cancelled' && canAssign && (
        <button
          type="button"
          className="ride-card-merge"
          onClick={() => onMerge(mergeHint.rideId)}
        >
          <Pill tone="warn">{mergeHint.text}</Pill>
        </button>
      )}

      {state !== 'cancelled' && (showRow || showClaim || state === 'assigned' || state === 'self') && (
        <div className={`ride-card-strip${state === 'open' || showClaim ? ' is-open' : ''}`}>
          {showClaim && (
            <>
              <div className="ride-card-pick-label ride-card-pick-label--ok">{copy.rides.nobodyTook}</div>
              <DriverRow
                drivers={drivers}
                driverId={ride.driver_id}
                companionIds={companions}
                selfTransport={ride.self_transport}
                blocks={blocks}
                mode="claim"
                onPickDriver={handlePickDriver}
                onPickCompanion={onCompanion}
                onPickSelf={onSelf}
                onClaim={onClaim}
              />
            </>
          )}

          {showRow && (
            <>
              <div className="ride-card-pick-label">{copy.rides.whoDrives}</div>
              <DriverRow
                drivers={drivers}
                driverId={ride.driver_id}
                companionIds={companions}
                selfTransport={ride.self_transport}
                blocks={blocks}
                mode="assign"
                householdNames={householdNames}
                onPickDriver={handlePickDriver}
                onPickCompanion={onCompanion}
                onPickSelf={onSelf}
              />
            </>
          )}

          {!showRow && !showClaim && state === 'assigned' && driver && (
            <div className="ride-card-assigned">
              <Avatar person={driver} size={34} householdNames={householdNames} />
              <div className="ride-card-assigned-text">
                <div className="ride-card-assigned-title">{assignedSentence(driver.display_name, ride.direction)}</div>
                {pairedSameDriver && pairedRide && (
                  <div className="ride-card-assigned-sub">{copy.rides.alsoCollects(formatTime(pairedRide.depart_at))}</div>
                )}
                {companions[0] && !pairedSameDriver && (
                  <div className="ride-card-assigned-sub">
                    {copy.sentence.companionGoes(
                      drivers.find(d => d.id === companions[0])?.display_name ?? '',
                    )}
                  </div>
                )}
              </div>
              {canAssign && (
                <button type="button" className="ride-card-swap" onClick={() => setEditing(true)}>
                  {copy.rides.swap}
                </button>
              )}
              {showCantTake && (
                <button type="button" className="ride-card-swap is-muted" onClick={onRelease}>
                  {copy.rides.cantTake}
                </button>
              )}
            </div>
          )}

          {!showRow && !showClaim && state === 'self' && (
            <div className="ride-card-assigned">
              <Avatar variant="self" size={34} />
              <div className="ride-card-assigned-text">
                <div className="ride-card-assigned-title">{copy.status.selfGoesHome}</div>
              </div>
              {canAssign && (
                <button type="button" className="ride-card-swap" onClick={() => setEditing(true)}>
                  {copy.rides.swap}
                </button>
              )}
              {showCantTake && (
                <button type="button" className="ride-card-swap is-muted" onClick={onRelease}>
                  {copy.rides.cantTake}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  )
}
