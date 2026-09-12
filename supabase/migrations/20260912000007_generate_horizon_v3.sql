-- generate_horizon v3: group_id support
-- Ha a sablonhoz group_id van rendelve, minden csoporttagnak külön occurrence + leg keletkezik.
-- Ha person_id van (egyéni), marad a korábbi viselkedés.
-- Az occurrence unique index v6-ban (template_id, person_id, on_date)-re változott.

drop function if exists generate_horizon(uuid, int);

create function generate_horizon(
  p_household_id uuid,
  p_days_ahead   int default 14
)
returns int language plpgsql security definer as $$
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
