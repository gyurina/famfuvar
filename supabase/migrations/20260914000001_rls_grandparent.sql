-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  Nagyszülő: transport_leg UPDATE csak nyitott vagy saját fuvar  ║
-- ╚══════════════════════════════════════════════════════════════════╝

create or replace function current_person_id()
returns uuid language sql stable security definer
set search_path = public as $$
  select id from person where auth_user_id = auth.uid() limit 1;
$$;

create or replace function current_person_role()
returns text language sql stable security definer
set search_path = public as $$
  select role::text from person where auth_user_id = auth.uid() limit 1;
$$;

drop policy if exists transport_leg_rw on transport_leg;

create policy transport_leg_select on transport_leg
  for select
  using (household_id = current_household());

create policy transport_leg_insert on transport_leg
  for insert
  with check (household_id = current_household());

create policy transport_leg_delete on transport_leg
  for delete
  using (household_id = current_household());

create policy transport_leg_update_parent on transport_leg
  for update
  using (
    household_id = current_household()
    and current_person_role() = 'parent'
  )
  with check (household_id = current_household());

-- Nagyszülő (és felügyelet): csak nyitott fuvar, vagy a saját kiosztása
create policy transport_leg_update_claim on transport_leg
  for update
  using (
    household_id = current_household()
    and current_person_role() in ('grandparent', 'babysitter')
    and (driver_id is null or driver_id = current_person_id())
  )
  with check (
    household_id = current_household()
    and (driver_id is null or driver_id = current_person_id())
  );
