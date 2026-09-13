import type { DriverBlock, LegDirection, Occurrence, Person, PersonRole, TransportLeg, TravelTime } from '../types'
import { copy } from '../copy'
import { accusative, formatTime, toRideDirection } from './format'

export type RideState = 'assigned' | 'open' | 'self' | 'cancelled'

export type RideRow = TransportLeg & {
  occurrence?: Occurrence | null
}

export interface EventSummary {
  title: string
  locationName?: string | null
}

const ROLE_RANK: Record<PersonRole, number> = {
  parent: 0,
  grandparent: 1,
  babysitter: 2,
  child: 3,
}

export function rideState(leg: RideRow): RideState {
  if (leg.occurrence?.status === 'cancelled') return 'cancelled'
  if (leg.self_transport) return 'self'
  if (leg.driver_id) return 'assigned'
  return 'open'
}

export function companionIdsOf(leg: RideRow): string[] {
  return [leg.companion_id, leg.companion2_id].filter((id): id is string => !!id)
}

export function sortDrivers(persons: Person[]): Person[] {
  return persons
    .filter(p => p.can_drive)
    .slice()
    .sort((a, b) => {
      const d = ROLE_RANK[a.role] - ROLE_RANK[b.role]
      if (d !== 0) return d
      return a.display_name.localeCompare(b.display_name, 'hu')
    })
}

export function rideDurationMins(leg: Pick<RideRow, 'depart_at' | 'arrive_at'>): number | null {
  if (!leg.arrive_at || !leg.depart_at) return null
  const mins = Math.round((new Date(leg.arrive_at).getTime() - new Date(leg.depart_at).getTime()) / 60000)
  return mins > 0 ? mins : null
}

export function overlaps(
  aStart: string,
  aEnd: string | null | undefined,
  bStart: string,
  bEnd: string | null | undefined,
): boolean {
  const as = new Date(aStart).getTime()
  const ae = aEnd ? new Date(aEnd).getTime() : as + 30 * 60 * 1000
  const bs = new Date(bStart).getTime()
  const be = bEnd ? new Date(bEnd).getTime() : bs + 30 * 60 * 1000
  return as < be && ae > bs
}

export function blocksForRide(
  ride: RideRow,
  allLegs: RideRow[],
  drivers: Person[],
  extEvents: Array<{ person_id?: string | null; starts_at: string; ends_at: string }>,
  interval?: { start: string; end: string | null },
): Record<string, DriverBlock> {
  const start = interval?.start ?? ride.depart_at
  const end = interval?.end ?? ride.arrive_at
  const skip = new Set(
    interval
      ? allLegs.filter(l => l.trip_id && l.trip_id === ride.trip_id).map(l => l.id)
      : [ride.id],
  )
  const blocks: Record<string, DriverBlock> = {}
  for (const d of drivers) {
    const conflict = allLegs.find(l =>
      !skip.has(l.id) &&
      l.driver_id === d.id &&
      l.occurrence?.status !== 'cancelled' &&
      overlaps(l.depart_at, l.arrive_at, start, end),
    )
    if (conflict) {
      blocks[d.id] = { kind: 'ride', label: formatTime(conflict.depart_at) }
      continue
    }
    const cal = extEvents.find(e =>
      e.person_id === d.id && overlaps(e.starts_at, e.ends_at, start, end),
    )
    if (cal) {
      blocks[d.id] = { kind: 'calendar', label: copy.rides.calendar }
    }
  }
  return blocks
}

export function findMergeHint(
  ride: RideRow,
  allLegs: RideRow[],
  travelTimes: TravelTime[],
  personById: (id: string | null) => Person | null,
): { rideId: string; text: string } | undefined {
  if (ride.trip_id || ride.self_transport) return undefined
  if (ride.occurrence?.status === 'cancelled') return undefined
  const windowMs = 30 * 60 * 1000
  const t = new Date(ride.depart_at).getTime()
  const day = ride.depart_at.slice(0, 10)
  const candidates = allLegs.filter(other =>
    other.id !== ride.id &&
    !other.trip_id &&
    !other.self_transport &&
    other.direction === ride.direction &&
    other.occurrence?.status !== 'cancelled' &&
    other.depart_at.startsWith(day) &&
    Math.abs(new Date(other.depart_at).getTime() - t) <= windowMs,
  )
  for (const other of candidates) {
    if (!travelFits(ride, other, travelTimes)) continue
    const child = personById(other.occurrence?.person_id ?? null)
    if (!child) continue
    const who = accusative(child)
    const time = formatTime(other.depart_at)
    const inbound = toRideDirection(other.direction) === 'inbound'
    return {
      rideId: other.id,
      text: inbound
        ? copy.rides.mergeSuggestInbound(who, time)
        : copy.rides.mergeSuggestOutbound(who, time),
    }
  }
  return undefined
}

function travelFits(a: RideRow, b: RideRow, travelTimes: TravelTime[]): boolean {
  const earlier = a.depart_at <= b.depart_at ? a : b
  const later = earlier === a ? b : a
  const gap = (
    new Date(later.depart_at).getTime() -
    new Date(earlier.arrive_at || earlier.depart_at).getTime()
  ) / 60000
  const from = earlier.to_location
  const to = later.from_location
  if (!from || !to) return gap >= 0
  if (from === to) return gap >= 0
  const tt = travelTimes.find(t => t.from_location === from && t.to_location === to)
  if (!tt) return gap >= 0
  return tt.minutes <= gap + 5
}

export function nextCompanions(current: string[], id: string): string[] {
  if (current.includes(id)) return current.filter(c => c !== id)
  return [...current, id].slice(-2)
}

export function assignedSentence(driverName: string, direction: LegDirection): string {
  return toRideDirection(direction) === 'inbound'
    ? copy.sentence.driverCollects(driverName)
    : copy.sentence.driverTakes(driverName)
}

export function rideSubtitle(
  direction: LegDirection,
  fromHome: boolean,
  fromName: string | null,
  durationMins: number | null,
): string {
  const parts: string[] = [toRideDirection(direction) === 'outbound' ? copy.direction.viszi : copy.direction.begyujti]
  if (toRideDirection(direction) === 'outbound' && fromHome) parts.push(copy.place.fromHome)
  else if (toRideDirection(direction) === 'outbound' && fromName) parts.push(fromName)
  if (durationMins != null) parts.push(copy.common.minutes(durationMins))
  return parts.join(' · ')
}

export function driverMode(opts: {
  canAssignOthers: boolean
  canSelfAssign: boolean
  isOpen: boolean
}): 'assign' | 'claim' | 'read' {
  if (opts.canAssignOthers) return 'assign'
  if (opts.canSelfAssign && opts.isOpen) return 'claim'
  return 'read'
}
