import { Avatar } from './Avatar'
import { DriverRow, type DriverBlock } from './DriverRow'
import { Icon } from './Icon'
import { copy } from '../copy'
import { accusative, childList, formatDuration, groupTitle, type RideDirection } from '../lib/format'
import { driverMode } from '../lib/rideUi'
import type { Person, Trip } from '../types'

export interface RideStop {
  rideId: string
  time: string
  child: Person
  place: string
  direction: RideDirection
}

export interface GroupedRideCardProps {
  trip: Trip | { id: string }
  stops: RideStop[]
  state: 'assigned' | 'open'
  driverId: string | null
  companionIds: string[]
  blocks: Record<string, DriverBlock>
  drivers: Person[]
  canAssign: boolean
  canClaim: boolean
  canRelease?: boolean
  householdNames?: string[]
  durationMins?: number | null
  viewerId?: string | null
  onAssign: (driverId: string) => void
  onCompanion: (id: string) => void
  onRelease: () => void
  onClaim?: () => void
  onSplit: () => void
  onOpenMenu: () => void
}

export function GroupedRideCard({
  stops,
  state,
  driverId,
  companionIds,
  blocks,
  drivers,
  canAssign,
  canClaim,
  canRelease = false,
  householdNames = [],
  durationMins = null,
  viewerId = null,
  onAssign,
  onCompanion,
  onRelease,
  onClaim,
  onSplit,
  onOpenMenu,
}: GroupedRideCardProps) {
  const driver = drivers.find(d => d.id === driverId) ?? null
  const companion = drivers.find(d => d.id === companionIds[0]) ?? null
  const first = stops[0]
  const last = stops[stops.length - 1]
  const title = groupTitle(stops, driver)
  const openTitle = groupTitle(stops, null)
  const mode = driverMode({
    canAssignOthers: canAssign,
    canSelfAssign: canClaim,
    isOpen: state === 'open',
  })
  const showRow = mode === 'assign' && (state === 'open')
  const showClaim = mode === 'claim' && state === 'open'
  const isOwn = !!viewerId && (driverId === viewerId || companionIds.includes(viewerId))
  const showCantTake = !canAssign && canRelease && isOwn
  const who = childList(stops.map(s => accusative(s.child)))
  const assignedTitle = driver
    ? (stops.every(s => s.direction === 'inbound')
      ? copy.sentence.groupAssignedInbound(driver.display_name, who)
      : copy.sentence.groupAssignedOutbound(driver.display_name, who))
    : title

  const modifier = state === 'open' && (canAssign || canClaim)
    ? (showClaim ? 'claim' : 'open')
    : 'default'

  const meta = [
    copy.rides.oneCar,
    durationMins != null ? formatDuration(durationMins) : null,
  ].filter(Boolean).join(' · ')

  function handlePickDriver(id: string) {
    if (driverId === id) {
      onRelease()
      return
    }
    onAssign(id)
  }

  return (
    <article className={`ride-card grouped-ride-card ride-card--${modifier}`}>
      <div className="ride-card-head">
        <div className="ride-card-head-main">
          <div className="ride-card-title-row">
            <Icon
              name="users-three"
              size={16}
              weight="fill"
              color={state === 'open' ? 'var(--color-danger)' : 'var(--color-accent-ink)'}
            />
            <span className="ride-card-title">{state === 'open' ? openTitle : assignedTitle}</span>
          </div>
          <div className="ride-card-sub">{meta}</div>
        </div>
        {first && (
          <div className="ride-card-time-col">
            <span className="ride-card-time">{first.time}</span>
            {last && last !== first && (
              <span className="ride-card-time-2">{last.time}</span>
            )}
          </div>
        )}
      </div>

      <ol className={`grouped-stops${state === 'open' ? ' is-open' : ''}`}>
        {stops.map(stop => (
          <li key={stop.rideId} className="grouped-stop">
            <span className="grouped-stop-dot" style={{ background: stop.child.color }} />
            <span className="grouped-stop-time">{stop.time}</span>
            <span className="grouped-stop-label">
              {stop.child.display_name} · {stop.place}
            </span>
          </li>
        ))}
      </ol>

      <div className={`ride-card-strip${state === 'open' ? ' is-open' : ''}`}>
        {showClaim && (
          <>
            <div className="ride-card-pick-label ride-card-pick-label--ok">{copy.rides.nobodyTook}</div>
            <DriverRow
              drivers={drivers}
              driverId={driverId}
              companionIds={companionIds}
              selfTransport={false}
              blocks={blocks}
              mode="claim"
              onPickDriver={handlePickDriver}
              onPickCompanion={onCompanion}
              onPickSelf={() => {}}
              onClaim={onClaim}
            />
          </>
        )}

        {showRow && (
          <>
            <div className="ride-card-pick-label">{copy.rides.whoDrives}</div>
            <DriverRow
              drivers={drivers}
              driverId={driverId}
              companionIds={companionIds}
              selfTransport={false}
              blocks={blocks}
              mode="assign"
              householdNames={householdNames}
              onPickDriver={handlePickDriver}
              onPickCompanion={onCompanion}
              onPickSelf={() => {}}
            />
            <button type="button" className="grouped-split" onClick={onSplit}>
              <Icon name="arrows-split" size={15} />
              <span>{copy.rides.split}</span>
              <Icon name="caret-right" size={13} />
            </button>
          </>
        )}

        {state === 'assigned' && driver && (
          <>
            <div className="ride-card-assigned">
              <div className="grouped-avatars">
                <Avatar person={driver} size={34} householdNames={householdNames} />
                {companion && (
                  <Avatar person={companion} size={34} householdNames={householdNames} />
                )}
              </div>
              <div className="ride-card-assigned-text">
                <div className="ride-card-assigned-title">{assignedTitle}</div>
                {companion && (
                  <div className="ride-card-assigned-sub">
                    {copy.sentence.companionGoes(companion.display_name)}
                  </div>
                )}
              </div>
              {canAssign && (
                <button type="button" className="ride-card-menu" onClick={onOpenMenu} aria-label={copy.a11y.moreActions}>
                  <Icon name="dots-three" size={20} />
                </button>
              )}
              {!canAssign && showCantTake && (
                <button type="button" className="ride-card-swap is-muted" onClick={onRelease}>
                  {copy.rides.cantTake}
                </button>
              )}
            </div>
            {canAssign && (
              <button type="button" className="grouped-split" onClick={onSplit}>
                <Icon name="arrows-split" size={15} />
                <span>{copy.rides.split}</span>
                <Icon name="caret-right" size={13} />
              </button>
            )}
          </>
        )}
      </div>
    </article>
  )
}
