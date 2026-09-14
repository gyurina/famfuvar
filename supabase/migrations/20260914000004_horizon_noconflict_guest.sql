-- 1) generate_horizon ne ON CONFLICT-re támaszkodjon — a production unique index
--    még (template_id, on_date) lehet, ezért a (template_id, person_id, on_date)
--    specifikáció hibát dob: "no unique or exclusion constraint matching ON CONFLICT".
-- 2) guest_name: egyedi sofőr törzsadat nélkül.
-- 3) unique index a csoportos sablonokhoz (ha még a régi van kint).

alter table transport_leg add column if not exists guest_name text;

do $$
begin
  drop index if exists occurrence_template_date_uq;
  create unique index occurrence_template_date_uq
    on occurrence (template_id, person_id, on_date)
    where template_id is not null;
exception when others then
  raise notice 'occurrence unique index skip: %', sqlerrm;
end $$;

create or replace function generate_horizon(
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
  v_today       date;
begin
  if auth.role() = 'authenticated' then
    if not exists (
      select 1 from person
      where household_id = p_household_id
        and auth_user_id = auth.uid()
    ) then
      raise exception 'Unauthorized: not a member of this household';
    end if;
  end if;

  v_today    := (timezone('Europe/Budapest', now()))::date;
  v_date     := v_today;
  v_end_date := v_today + p_days_ahead;

  while v_date <= v_end_date loop
    for r_template in
      select st.*
      from schedule_template st
      where st.household_id = p_household_id
        and st.weekday = extract(isodow from v_date)
        and st.valid_from <= v_date
        and (st.valid_to is null or st.valid_to >= v_date)
    loop
      if r_template.group_id is not null then
        select array_agg(person_id) into v_persons
        from travel_group_member
        where group_id = r_template.group_id;
        if v_persons is null then
          continue;
        end if;
      else
        v_persons := array[r_template.person_id];
      end if;

      foreach v_person_id in array v_persons loop
        v_occ_id := null;
        v_is_override := false;

        select id, coalesce(is_override, false)
          into v_occ_id, v_is_override
        from occurrence
        where template_id = r_template.id
          and on_date = v_date
          and person_id is not distinct from v_person_id
        limit 1;

        if v_occ_id is null then
          begin
            insert into occurrence (
              household_id, template_id, person_id, title,
              on_date, starts_at, ends_at, location_id, status
            )
            values (
              p_household_id, r_template.id, v_person_id, r_template.title,
              v_date, r_template.starts_at, r_template.ends_at,
              r_template.location_id, 'planned'
            )
            returning id into v_occ_id;
            v_count := v_count + 1;
            v_is_override := false;
          exception when unique_violation then
            select id, coalesce(is_override, false)
              into v_occ_id, v_is_override
            from occurrence
            where template_id = r_template.id
              and on_date = v_date
            limit 1;
          end;
        end if;

        if v_occ_id is null then
          continue;
        end if;

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

      end loop;
    end loop;
    v_date := v_date + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function generate_horizon(uuid, int) from anon;
grant execute on function generate_horizon(uuid, int) to authenticated;

create or replace function public.trg_template_generate_horizon()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid;
begin
  hid := coalesce(NEW.household_id, OLD.household_id);
  perform generate_horizon(hid, 30);
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists schedule_template_generate_horizon on public.schedule_template;

create trigger schedule_template_generate_horizon
  after insert or update or delete on public.schedule_template
  for each row execute function public.trg_template_generate_horizon();
