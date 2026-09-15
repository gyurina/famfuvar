import { copy } from '../copy'
import { formatDateTime, formatShortDate } from './format'
import type { AuditEvent } from '../types'

const SKIP_KEYS = new Set([
  'location_id',
  'person_id',
  'driver_id',
  'companion_id',
  'companion2_id',
])

export function naploHeadline(ev: Pick<AuditEvent, 'entity' | 'action'>): string {
  return `${copy.naplo.entity[ev.entity]} ${copy.naplo.action[ev.action]}`
}

function fieldLabel(key: string): string | null {
  if (SKIP_KEYS.has(key)) return null
  const labels = copy.naplo.field as Record<string, string>
  return labels[key] ?? null
}

function clock(value: string): string {
  if (value.includes('T')) return formatDateTime(value)
  return value.slice(0, 5)
}

export function formatNaploValue(key: string, value: unknown): string {
  if (value == null || value === '') return copy.common.dash
  if (key === 'self_transport') return value === true ? copy.status.self : copy.common.dash
  if (key === 'direction') {
    return value === 'pickup' ? copy.direction.begyujti : copy.direction.viszi
  }
  if (key === 'status') {
    if (value === 'cancelled') return copy.status.cancelled
    if (value === 'moved') return copy.naplo.moved
    return copy.naplo.planned
  }
  if (typeof value !== 'string') return String(value)
  if (key === 'on_date') return formatShortDate(value)
  if (key === 'starts_at' || key === 'ends_at' || key === 'depart_at') return clock(value)
  return value
}

export interface NaploChange {
  key: string
  label: string
  from: string
  to: string
  kind: 'changed' | 'added' | 'removed'
  text: string
}

export function naploChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): NaploChange[] {
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ])
  const out: NaploChange[] = []
  for (const key of keys) {
    const label = fieldLabel(key)
    if (!label) continue
    const a = before?.[key]
    const b = after?.[key]
    if (a === b || (a == null && b == null)) continue
    const from = formatNaploValue(key, a)
    const to = formatNaploValue(key, b)
    if (from === to) continue
    if (a == null || a === '') {
      out.push({ key, label, from, to, kind: 'added', text: copy.naplo.added(label, to) })
    } else if (b == null || b === '') {
      out.push({ key, label, from, to, kind: 'removed', text: copy.naplo.removed(label, from) })
    } else {
      out.push({ key, label, from, to, kind: 'changed', text: copy.naplo.changed(label, from, to) })
    }
  }
  return out
}
