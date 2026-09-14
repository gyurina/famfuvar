import { copy } from '../copy'
import { accusative, toRideDirection } from './format'
import type { LegDirection, Person } from '../types'

export function rideWriteToast(opts: {
  driver: Person | null
  child: Person | null
  direction: LegDirection
  self: boolean
  guest?: string | null
}): string {
  const childAcc = opts.child ? accusative(opts.child) : copy.common.unknown
  if (opts.self) return copy.toast.self(childAcc)
  if (opts.guest) return copy.toast.guest(opts.guest, childAcc)
  if (!opts.driver) return copy.toast.released(childAcc)
  return toRideDirection(opts.direction) === 'inbound'
    ? copy.sentence.begyujti(opts.driver.display_name, childAcc)
    : copy.sentence.viszi(opts.driver.display_name, childAcc)
}
