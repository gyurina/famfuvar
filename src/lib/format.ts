import { format, isSameMonth } from 'date-fns'
import { hu } from 'date-fns/locale'
import { copy } from '../copy'
import type { LegDirection, Person } from '../types'

export type RideDirection = 'outbound' | 'inbound'

/** Az egyetlen mapping: DB dropoff/pickup ↔ UI outbound/inbound. */
export function toRideDirection(d: LegDirection): RideDirection {
  return d === 'dropoff' ? 'outbound' : 'inbound'
}

export function directionWord(d: LegDirection): string {
  return toRideDirection(d) === 'outbound' ? copy.direction.viszi : copy.direction.begyujti
}

export function accusative(person: Pick<Person, 'name_acc' | 'display_name'>): string {
  return person.name_acc || person.display_name
}

export function childList(namesAcc: string[]): string {
  const unique = [...new Set(namesAcc)]
  if (unique.length === 0) return ''
  if (unique.length === 1) return unique[0]
  return unique.slice(0, -1).join(', ') + ' ' + copy.and + ' ' + unique.at(-1)
}

export interface GroupStop {
  direction: RideDirection
  child: Pick<Person, 'name_acc' | 'display_name'>
}

export function groupTitle(
  stops: GroupStop[],
  driver: { display_name: string } | null,
): string {
  const allInbound = stops.every(s => s.direction === 'inbound')
  const who = childList(stops.map(s => accusative(s.child)))
  if (driver) {
    return allInbound
      ? copy.sentence.groupAssignedInbound(driver.display_name, who)
      : copy.sentence.groupAssignedOutbound(driver.display_name, who)
  }
  return allInbound
    ? copy.sentence.groupOpenInbound(who)
    : copy.sentence.groupOpenOutbound(who)
}

/** „hétfő, szeptember 14.” — Ma fejléc, kisbetűs napnév. */
export function formatDayLong(date: Date | string): string {
  const d = asDate(date)
  return format(d, 'EEEE, MMMM d.', { locale: hu })
}

/** „Hétfő, szeptember 14.” — napcím a Héten. */
export function formatDayTitle(date: Date | string): string {
  const s = formatDayLong(date)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** „szept. 14 – 20.” */
export function formatWeekRange(from: Date | string, to: Date | string): string {
  const a = asDate(from)
  const b = asDate(to)
  if (isSameMonth(a, b)) {
    return `${format(a, 'MMM d', { locale: hu })} – ${format(b, 'd.')}`
  }
  return `${format(a, 'MMM d.', { locale: hu })} – ${format(b, 'MMM d.', { locale: hu })}`
}

/** „szept. 15., kedd” */
export function formatShortDate(date: Date | string): string {
  return format(asDate(date), 'MMM d., EEEE', { locale: hu })
}

/** „szept. 17.” — toast, szünet végéig */
export function formatShortMonthDay(date: Date | string): string {
  return format(asDate(date), 'MMM d.', { locale: hu })
}

/** ISO hét napja: 1 = hétfő … 7 = vasárnap */
export function isoWeekday(date: Date | string): number {
  const js = asDate(date).getDay()
  return js === 0 ? 7 : js
}

export function weekdayOn(date: Date | string): string {
  return copy.weekday.on[isoWeekday(date) - 1]
}

export function weekdayLong(date: Date | string): string {
  return copy.weekday.long[isoWeekday(date) - 1]
}

export function joinNames(names: string[]): string {
  const unique = [...new Set(names.filter(Boolean))]
  if (unique.length === 0) return ''
  if (unique.length === 1) return unique[0]
  return unique.slice(0, -1).join(', ') + ' ' + copy.and + ' ' + unique.at(-1)
}

/** „szeptember 14.” */
export function formatMonthDay(date: Date | string): string {
  return format(asDate(date), 'MMMM d.', { locale: hu })
}

/** „hétfő” */
export function formatWeekday(date: Date | string): string {
  return format(asDate(date), 'EEEE', { locale: hu })
}

/** „szept. 15. 17:30” */
export function formatDateTime(date: Date | string): string {
  const d = asDate(date)
  return `${format(d, 'MMM d.', { locale: hu })} ${format(d, 'HH:mm')}`
}

/** „17:30” */
export function formatTime(date: Date | string): string {
  return format(asDate(date), 'HH:mm')
}

/** „15 perc” / „1 ó 10 p” */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return copy.common.minutes(minutes)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (m === 0) return `${h} ó`
  return `${h} ó ${m} p`
}

/** ISO dátum lekérdezéshez / input value-hoz — soha ne jelenjen meg a felületen. */
export function toIsoDate(date: Date | string): string {
  return format(asDate(date), 'yyyy-MM-dd')
}

function asDate(date: Date | string): Date {
  return date instanceof Date ? date : new Date(date.includes('T') ? date : date + 'T12:00:00')
}
