-- Körút-összevonás: trips tábla + trip_id a transport_leg-en
-- Több transport_leg összevonható egyetlen "trip" alá,
-- így egyszerre rendelhetők hozzá egy sofőrhöz.

create table trips (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references household(id) on delete cascade,
  created_at   timestamptz not null default now()
);

alter table transport_leg
  add column trip_id uuid references trips(id) on delete set null;

create index on transport_leg(trip_id);

-- RLS
alter table trips enable row level security;

create policy "household members can manage trips"
  on trips for all
  using (
    household_id in (
      select household_id from person where auth_user_id = auth.uid()
    )
  )
  with check (
    household_id in (
      select household_id from person where auth_user_id = auth.uid()
    )
  );
