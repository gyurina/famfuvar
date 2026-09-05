-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  RLS policy-k + nézetek                                         ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ── Helper függvény ───────────────────────────────────────────────────────────
create or replace function current_household()
returns uuid language sql stable security definer
set search_path = public as $$
  select household_id from person where auth_user_id = auth.uid() limit 1;
$$;

-- ── household tábla külön kezelve (nincs household_id mezeje, az id az elsődleges kulcs) ──
alter table household enable row level security;
create policy household_rw on household for all
  using      (id = current_household())
  with check (id = current_household());

-- ── RLS minden household_id-s táblán ─────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'person','location','travel_group','travel_time',
    'schedule_template','driver_availability','occurrence',
    'transport_leg','external_calendar'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I_rw on %I for all
       using (household_id = current_household())
       with check (household_id = current_household())',
      t, t
    );
  end loop;
end;
$$;

-- travel_group_member — a szülőtáblán keresztül
alter table travel_group_member enable row level security;
create policy travel_group_member_rw on travel_group_member for all
  using (exists (
    select 1 from travel_group g
    where g.id = group_id and g.household_id = current_household()
  ))
  with check (exists (
    select 1 from travel_group g
    where g.id = group_id and g.household_id = current_household()
  ));

-- google_sync — csak service role (üres policy = senki nem fér hozzá anon-nal)
alter table google_sync enable row level security;

-- ── Nézetek ───────────────────────────────────────────────────────────────────

-- Minden személy, akit egy fuvar lefoglal (sofőr + csoport tagok)
create view leg_occupies as
select
  l.id       as leg_id,
  l.driver_id as person_id,
  l.depart_at, l.arrive_at,
  l.from_location, l.to_location,
  true       as is_driver
from transport_leg l
where l.driver_id is not null
union all
select
  l.id,
  m.person_id,
  l.depart_at, l.arrive_at,
  l.from_location, l.to_location,
  false
from transport_leg l
join travel_group_member m on m.group_id = l.group_id
where l.group_id is not null
  and m.person_id is distinct from l.driver_id;

-- Fuvar–fuvar ütközés: ugyanaz a személy, nem fér bele az átállási idő
create view driver_conflict as
select
  a.leg_id  as leg_a,
  b.leg_id  as leg_b,
  a.person_id,
  a.depart_at
from leg_occupies a
join leg_occupies b
     on  a.person_id = b.person_id
     and a.leg_id < b.leg_id
     and a.depart_at::date = b.depart_at::date
left join travel_time t
     on  t.from_location = a.to_location
     and t.to_location   = b.from_location
where b.depart_at < a.arrive_at + make_interval(mins => coalesce(t.minutes, 0));

-- Naptár-ütközés: behúzott naptár foglalja el a sofőrt
create view driver_busy_conflict as
select
  o.leg_id,
  o.person_id,
  e.title,
  e.starts_at,
  e.ends_at
from leg_occupies o
join external_calendar c
     on  c.person_id = o.person_id
     and c.affects_driving and c.is_active
join external_event e
     on  e.calendar_id = c.id
     and tstzrange(e.starts_at, e.ends_at) && tstzrange(o.depart_at, o.arrive_at);
