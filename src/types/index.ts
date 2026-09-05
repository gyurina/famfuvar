// ── Enums ────────────────────────────────────────────────────────────────────
export type PersonRole = 'parent' | 'grandparent' | 'child'
export type OccurrenceStatus = 'planned' | 'cancelled' | 'moved'
export type LegDirection = 'dropoff' | 'pickup'
export type CalendarVisibility = 'full' | 'busy_only'

// ── Entities ─────────────────────────────────────────────────────────────────
export interface Household {
  id: string
  name: string
  google_calendar_id: string | null
  created_at: string
}

export interface Person {
  id: string
  household_id: string
  auth_user_id: string | null
  display_name: string
  role: PersonRole
  can_drive: boolean
  color: string
}

export interface Location {
  id: string
  household_id: string
  name: string
  address: string | null
  is_home: boolean
}

export interface TravelGroup {
  id: string
  household_id: string
  name: string
  is_default: boolean
}

export interface TravelGroupMember {
  group_id: string
  person_id: string
}

export interface TravelTime {
  household_id: string
  from_location: string
  to_location: string
  minutes: number
}

export interface ScheduleTemplate {
  id: string
  household_id: string
  person_id: string
  title: string
  weekday: number          // 1=Hétfő … 7=Vasárnap
  starts_at: string        // 'HH:mm:ss'
  ends_at: string
  location_id: string
  needs_dropoff: boolean
  needs_pickup: boolean
  valid_from: string       // date
  valid_to: string | null
}

export interface DriverAvailability {
  id: string
  household_id: string
  person_id: string
  weekday: number
  from_time: string
  to_time: string
}

export interface Occurrence {
  id: string
  household_id: string
  template_id: string | null
  person_id: string
  title: string
  on_date: string          // date
  starts_at: string
  ends_at: string
  location_id: string
  status: OccurrenceStatus
  note: string | null
  updated_by: string | null
  updated_at: string
}

export interface TransportLeg {
  id: string
  household_id: string
  occurrence_id: string
  direction: LegDirection
  driver_id: string | null
  group_id: string | null
  companion_id: string | null
  companion2_id: string | null
  depart_at: string        // timestamptz
  arrive_at: string
  from_location: string | null
  to_location: string | null
  note: string | null
}

export interface ExternalCalendar {
  id: string
  household_id: string
  person_id: string | null
  source: 'google' | 'ics'
  google_calendar_id: string | null
  ics_url: string | null
  display_name: string
  color: string
  visibility: CalendarVisibility
  affects_driving: boolean
  sync_token: string | null
  last_synced_at: string | null
  is_active: boolean
}

export interface ExternalEvent {
  id: string
  calendar_id: string
  source_event_id: string
  title: string | null
  starts_at: string
  ends_at: string
  all_day: boolean
  location_text: string | null
}

// ── Joined / view types ───────────────────────────────────────────────────────
export interface TransportLegWithDetails extends TransportLeg {
  occurrence: Occurrence
  driver: Person | null
  group: TravelGroup | null
  from_loc: Location | null
  to_loc: Location | null
}

export interface DriverConflict {
  leg_a: string
  leg_b: string
  person_id: string
  depart_at: string
}

export interface DriverBusyConflict {
  leg_id: string
  person_id: string
  title: string | null
  starts_at: string
  ends_at: string
}
