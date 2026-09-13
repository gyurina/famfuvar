-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  Biztonsági megszilárdítás (sprint-security-hardening)          ║
-- ║  Supabase linter alapján azonosított hibák javítása             ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ── 1. google_oauth_token → RLS engedélyezés ─────────────────────────────────
-- service_role bypass-ol, authenticated+anon nem fér hozzá (nulla policy = deny)
alter table google_oauth_token enable row level security;

-- ── 2. Nézetek → SECURITY INVOKER ────────────────────────────────────────────
-- A szuperuser-ownership implicit SECURITY DEFINER viselkedést eredményez,
-- ami megkerüli a mögöttes táblák RLS-ét. DROP → CREATE WITH security_invoker.
-- Sorrend: először a függő nézetek, aztán leg_occupies.

drop view if exists driver_conflict;
drop view if exists driver_busy_conflict;
drop view if exists leg_occupies;

create view leg_occupies
  with (security_invoker = true)
as
select
  l.id        as leg_id,
  l.driver_id as person_id,
  l.depart_at, l.arrive_at,
  l.from_location, l.to_location,
  true        as is_driver
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

create view driver_conflict
  with (security_invoker = true)
as
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

create view driver_busy_conflict
  with (security_invoker = true)
as
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

-- ── 3. generate_horizon — anon revoke + háztartás-ellenőrzés + search_path ───
-- CREATE OR REPLACE megtartja a meglévő logikát; csak a fejléc és az eleje változik.

drop function if exists generate_horizon(uuid, int);

create function generate_horizon(
  p_household_id uuid,
  p_days_ahead   int default 14
)
returns int language plpgsql security definer
set search_path = public
as $$
declare
  r_template    record;
  v_date        date;
  v_end_date    date;
  v_occ_id      uuid;
  v_travel_min  int;
  v_count       int := 0;
  v_is_override boolean;
  v_person_id   uuid;
  v_persons     uuid[];
begin
  -- Háztartás-ellenőrzés: authenticated user csak saját háztartását érheti el
  if auth.role() = 'authenticated' then
    if not exists (
      select 1 from person
      where household_id = p_household_id
        and auth_user_id = auth.uid()
    ) then
      raise exception 'Unauthorized: not a member of this household';
    end if;
  end if;

  v_date     := current_date;
  v_end_date := current_date + p_days_ahead;

  while v_date <= v_end_date loop
    for r_template in
      select st.*
      from schedule_template st
      where st.household_id = p_household_id
        and st.weekday = extract(isodow from v_date)
        and st.valid_from <= v_date
        and (st.valid_to is null or st.valid_to >= v_date)
    loop
      -- Gyűjtsük össze az érintett személyeket
      if r_template.group_id is not null then
        select array_agg(person_id) into v_persons
        from travel_group_member
        where group_id = r_template.group_id;
        -- Ha a csoport üres, kihagyjuk
        if v_persons is null then
          continue;
        end if;
      else
        v_persons := array[r_template.person_id];
      end if;

      -- Minden érintett személyre generálunk occurrence + transport_leg sorokat
      foreach v_person_id in array v_persons loop

        -- occurrence: ha már van (kézzel módosítva), nem bántjuk
        insert into occurrence (
          household_id, template_id, person_id, title,
          on_date, starts_at, ends_at, location_id, status
        )
        values (
          p_household_id, r_template.id, v_person_id, r_template.title,
          v_date, r_template.starts_at, r_template.ends_at,
          r_template.location_id, 'planned'
        )
        on conflict (template_id, person_id, on_date) do nothing
        returning id into v_occ_id;

        if v_occ_id is not null then
          v_count := v_count + 1;
          v_is_override := false;
        else
          select id, is_override into v_occ_id, v_is_override
          from occurrence
          where template_id = r_template.id
            and person_id = v_person_id
            and on_date = v_date;
        end if;

        -- dropoff leg
        if r_template.needs_dropoff then
          select coalesce(
            (select t.minutes from travel_time t
             join location home on home.id = t.from_location
               and home.is_home and home.household_id = p_household_id
             where t.to_location = r_template.location_id),
            15
          ) into v_travel_min;

          if not v_is_override then
            insert into transport_leg (
              household_id, occurrence_id, direction,
              depart_at, arrive_at, to_location
            )
            values (
              p_household_id, v_occ_id, 'dropoff',
              (v_date + r_template.starts_at - make_interval(mins => v_travel_min))
                at time zone 'Europe/Budapest',
              (v_date + r_template.starts_at) at time zone 'Europe/Budapest',
              r_template.location_id
            )
            on conflict (occurrence_id, direction) do update
              set depart_at   = excluded.depart_at,
                  arrive_at   = excluded.arrive_at,
                  to_location = excluded.to_location;
          else
            insert into transport_leg (
              household_id, occurrence_id, direction,
              depart_at, arrive_at, to_location
            )
            values (
              p_household_id, v_occ_id, 'dropoff',
              (v_date + r_template.starts_at - make_interval(mins => v_travel_min))
                at time zone 'Europe/Budapest',
              (v_date + r_template.starts_at) at time zone 'Europe/Budapest',
              r_template.location_id
            )
            on conflict (occurrence_id, direction) do nothing;
          end if;
        else
          if not v_is_override then
            delete from transport_leg
            where occurrence_id = v_occ_id and direction = 'dropoff';
          end if;
        end if;

        -- pickup leg
        if r_template.needs_pickup then
          select coalesce(
            (select t.minutes from travel_time t
             join location home on home.id = t.to_location
               and home.is_home and home.household_id = p_household_id
             where t.from_location = r_template.location_id),
            15
          ) into v_travel_min;

          if not v_is_override then
            insert into transport_leg (
              household_id, occurrence_id, direction,
              depart_at, arrive_at, from_location
            )
            values (
              p_household_id, v_occ_id, 'pickup',
              (v_date + r_template.ends_at) at time zone 'Europe/Budapest',
              (v_date + r_template.ends_at + make_interval(mins => v_travel_min))
                at time zone 'Europe/Budapest',
              r_template.location_id
            )
            on conflict (occurrence_id, direction) do update
              set depart_at     = excluded.depart_at,
                  arrive_at     = excluded.arrive_at,
                  from_location = excluded.from_location;
          else
            insert into transport_leg (
              household_id, occurrence_id, direction,
              depart_at, arrive_at, from_location
            )
            values (
              p_household_id, v_occ_id, 'pickup',
              (v_date + r_template.ends_at) at time zone 'Europe/Budapest',
              (v_date + r_template.ends_at + make_interval(mins => v_travel_min))
                at time zone 'Europe/Budapest',
              r_template.location_id
            )
            on conflict (occurrence_id, direction) do nothing;
          end if;
        else
          if not v_is_override then
            delete from transport_leg
            where occurrence_id = v_occ_id and direction = 'pickup';
          end if;
        end if;

      end loop; -- foreach person
    end loop;   -- for template
    v_date := v_date + 1;
  end loop;     -- while date

  return v_count;
end;
$$;

revoke execute on function generate_horizon(uuid, int) from anon;

-- ── 4. current_household — anon EXECUTE visszavonás ──────────────────────────
revoke execute on function current_household() from anon;

-- ── 5. delete_google_oauth_token — anon revoke + search_path ─────────────────
revoke execute on function delete_google_oauth_token(uuid) from anon;
alter function delete_google_oauth_token(uuid) set search_path = public;

-- ── 6. set_push_sub_user_id — anon + authenticated revoke + search_path ──────
revoke execute on function set_push_sub_user_id() from anon;
revoke execute on function set_push_sub_user_id() from authenticated;
alter function set_push_sub_user_id() set search_path = public;
