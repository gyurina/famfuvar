-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  Családi fuvarszervező — teljes séma                            ║
-- ╚══════════════════════════════════════════════════════════════════╝

create extension if not exists pgcrypto;

-- ── Alaptáblák ───────────────────────────────────────────────────────────────

create table household (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  google_calendar_id  text,
  created_at          timestamptz not null default now()
);

create type person_role as enum ('parent', 'grandparent', 'child');

create table person (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references household(id) on delete cascade,
  auth_user_id  uuid unique references auth.users(id),
  display_name  text not null,
  role          person_role not null,
  can_drive     boolean not null default false,
  color         text not null default '#7F77DD'
);

create table location (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references household(id) on delete cascade,
  name          text not null,
  address       text,
  is_home       boolean not null default false
);

create table travel_group (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references household(id) on delete cascade,
  name          text not null,
  is_default    boolean not null default true
);

create table travel_group_member (
  group_id   uuid not null references travel_group(id) on delete cascade,
  person_id  uuid not null references person(id) on delete cascade,
  primary key (group_id, person_id)
);

-- Kézzel feltöltött utazási idő
create table travel_time (
  household_id   uuid not null references household(id) on delete cascade,
  from_location  uuid not null references location(id) on delete cascade,
  to_location    uuid not null references location(id) on delete cascade,
  minutes        int  not null check (minutes >= 0),
  primary key (from_location, to_location)
);

create table schedule_template (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references household(id) on delete cascade,
  person_id      uuid not null references person(id) on delete cascade,
  title          text not null,
  weekday        smallint not null check (weekday between 1 and 7),
  starts_at      time not null,
  ends_at        time not null,
  location_id    uuid not null references location(id),
  needs_dropoff  boolean not null default true,
  needs_pickup   boolean not null default true,
  valid_from     date not null default current_date,
  valid_to       date,
  check (ends_at > starts_at)
);

create table driver_availability (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references household(id) on delete cascade,
  person_id     uuid not null references person(id) on delete cascade,
  weekday       smallint not null check (weekday between 1 and 7),
  from_time     time not null,
  to_time       time not null,
  check (to_time > from_time)
);

create type occurrence_status as enum ('planned', 'cancelled', 'moved');

create table occurrence (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references household(id) on delete cascade,
  template_id   uuid references schedule_template(id) on delete set null,
  person_id     uuid not null references person(id),
  title         text not null,
  on_date       date not null,
  starts_at     time not null,
  ends_at       time not null,
  location_id   uuid not null references location(id),
  status        occurrence_status not null default 'planned',
  note          text,
  updated_by    uuid references person(id),
  updated_at    timestamptz not null default now()
);

create unique index occurrence_template_date_uq
  on occurrence (template_id, on_date) where template_id is not null;
create index occurrence_date_idx on occurrence (household_id, on_date);

create type leg_direction as enum ('dropoff', 'pickup');

create table transport_leg (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references household(id) on delete cascade,
  occurrence_id  uuid not null references occurrence(id) on delete cascade,
  direction      leg_direction not null,
  driver_id      uuid references person(id),
  group_id       uuid references travel_group(id),
  depart_at      timestamptz not null,
  arrive_at      timestamptz not null,
  from_location  uuid references location(id),
  to_location    uuid references location(id),
  note           text,
  unique (occurrence_id, direction)
);

create index leg_driver_idx on transport_leg (driver_id, depart_at);

create type calendar_visibility as enum ('full', 'busy_only');

create table external_calendar (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references household(id) on delete cascade,
  person_id           uuid references person(id) on delete cascade,
  source              text not null check (source in ('google', 'ics')),
  google_calendar_id  text,
  ics_url             text,
  display_name        text not null,
  color               text not null default '#888780',
  visibility          calendar_visibility not null default 'full',
  affects_driving     boolean not null default true,
  sync_token          text,
  last_synced_at      timestamptz,
  is_active           boolean not null default true,
  check ((source = 'google' and google_calendar_id is not null)
      or (source = 'ics'    and ics_url is not null))
);

-- Gyorsítótár: gördülő ablak -7 .. +42 nap
create table external_event (
  id               uuid primary key default gen_random_uuid(),
  calendar_id      uuid not null references external_calendar(id) on delete cascade,
  source_event_id  text not null,
  title            text,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  all_day          boolean not null default false,
  location_text    text,
  unique (calendar_id, source_event_id)
);

create index external_event_time_idx on external_event (calendar_id, starts_at);

-- A kliens nem fér hozzá — csak service role
create table google_sync (
  entity_type      text not null check (entity_type in ('occurrence', 'transport_leg')),
  entity_id        uuid not null,
  google_event_id  text not null,
  content_hash     text not null,
  synced_at        timestamptz not null default now(),
  last_error       text,
  primary key (entity_type, entity_id)
);
