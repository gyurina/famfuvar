/**
 * Dexie (IndexedDB) — offline-first lokális gyorsítótár.
 * A Supabase Realtime frissíti szinkronban.
 */
import Dexie, { type EntityTable } from 'dexie'
import type {
  Occurrence, TransportLeg, Person, Location,
  ScheduleTemplate, TravelGroup, TravelGroupMember,
  DriverAvailability, TravelTime, ExternalCalendar, ExternalEvent
} from '../types'

class FamCalDB extends Dexie {
  occurrences!:       EntityTable<Occurrence,       'id'>
  transport_legs!:    EntityTable<TransportLeg,     'id'>
  persons!:           EntityTable<Person,           'id'>
  locations!:         EntityTable<Location,         'id'>
  templates!:         EntityTable<ScheduleTemplate, 'id'>
  travel_groups!:     EntityTable<TravelGroup,      'id'>
  group_members!:     EntityTable<TravelGroupMember,'group_id'>
  availabilities!:    EntityTable<DriverAvailability,'id'>
  travel_times!:      EntityTable<TravelTime,       'from_location'>
  ext_calendars!:     EntityTable<ExternalCalendar, 'id'>
  ext_events!:        EntityTable<ExternalEvent,    'id'>

  constructor() {
    super('famcal')
    this.version(1).stores({
      occurrences:    'id, household_id, on_date, person_id, template_id',
      transport_legs: 'id, household_id, occurrence_id, direction, driver_id, depart_at',
      persons:        'id, household_id, auth_user_id, role',
      locations:      'id, household_id',
      templates:      'id, household_id, person_id, weekday',
      travel_groups:  'id, household_id',
      group_members:  '[group_id+person_id], group_id, person_id',
      availabilities: 'id, household_id, person_id, weekday',
      travel_times:   '[from_location+to_location], household_id',
      ext_calendars:  'id, household_id, person_id',
      ext_events:     'id, calendar_id, starts_at',
    })
  }
}

export const db = new FamCalDB()
