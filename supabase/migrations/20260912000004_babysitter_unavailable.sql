-- Phase 4: babysitter role + unavailable_block table

-- Add babysitter to person_role enum
do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'babysitter'
    and enumtypid = (select oid from pg_type where typname = 'person_role')
  ) then
    alter type person_role add value 'babysitter';
  end if;
end$$;

-- Unavailable blocks: when a person is NOT available (inverse logic)
create table if not exists unavailable_block (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references household(id) on delete cascade,
  person_id     uuid not null references person(id)    on delete cascade,
  weekday       smallint not null check (weekday between 0 and 6), -- 0=Mon..6=Sun
  from_time     time not null,
  to_time       time not null,
  label         text,
  created_at    timestamptz default now()
);

create index if not exists unavailable_block_household
  on unavailable_block(household_id, person_id, weekday);

alter table unavailable_block enable row level security;

create policy "household members see unavailable blocks"
  on unavailable_block for all
  using (
    household_id in (
      select household_id from person where auth_user_id = auth.uid()
    )
  );
