-- 1.1: admin-flag, változásnapló, címzett inbox, háztartás-beállítások

-- ── person.is_admin ──────────────────────────────────────────────────────────
alter table person add column if not exists is_admin boolean not null default false;

update person p
set is_admin = true
from (
  select distinct on (household_id) id
  from person
  where role = 'parent'
  order by household_id, id
) first_parent
where p.id = first_parent.id;

alter table person drop constraint if exists person_admin_is_parent;
alter table person add constraint person_admin_is_parent
  check (not is_admin or role = 'parent');

create or replace function current_person_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin from person where auth_user_id = auth.uid() limit 1),
    false
  );
$$;

revoke all on function current_person_is_admin() from public, anon;
grant execute on function current_person_is_admin() to authenticated;

create or replace function protect_person_admin_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.is_admin is not distinct from OLD.is_admin then
    return NEW;
  end if;
  if auth.role() = 'service_role' then
    return NEW;
  end if;
  if not current_person_is_admin() then
    raise exception 'Only a household admin can change the admin flag';
  end if;
  if NEW.is_admin and NEW.role is distinct from 'parent' then
    raise exception 'Only a parent can be admin';
  end if;
  if OLD.is_admin and not NEW.is_admin then
    if (select count(*) from person where household_id = OLD.household_id and is_admin) <= 1 then
      raise exception 'Cannot remove the last admin';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists person_protect_admin on person;
create trigger person_protect_admin
  before update on person
  for each row execute function protect_person_admin_flag();

-- ── household.settings ───────────────────────────────────────────────────────
alter table household add column if not exists settings jsonb not null default '{}'::jsonb;

create or replace function protect_household_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.settings is not distinct from OLD.settings then
    return NEW;
  end if;
  if auth.role() = 'service_role' then
    return NEW;
  end if;
  if not current_person_is_admin() then
    raise exception 'Only a household admin can change settings';
  end if;
  return NEW;
end;
$$;

drop trigger if exists household_protect_settings on household;
create trigger household_protect_settings
  before update on household
  for each row execute function protect_household_settings();

-- ── audit_event ──────────────────────────────────────────────────────────────
create table if not exists audit_event (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references household(id) on delete cascade,
  actor_id      uuid references person(id) on delete set null,
  source        text not null default 'user' check (source in ('user', 'system')),
  entity        text not null check (entity in ('occurrence', 'transport_leg')),
  entity_id     uuid not null,
  action        text not null check (action in ('insert', 'update', 'delete')),
  before        jsonb,
  after         jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists audit_event_household_idx
  on audit_event (household_id, created_at desc);

alter table audit_event enable row level security;

drop policy if exists audit_event_select_admin on audit_event;
create policy audit_event_select_admin on audit_event
  for select
  using (household_id = current_household() and current_person_is_admin());

create or replace function audit_snapshot_occurrence(r occurrence)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'title', r.title,
    'status', r.status,
    'on_date', r.on_date,
    'starts_at', r.starts_at,
    'ends_at', r.ends_at,
    'location_id', r.location_id,
    'location_name', (select name from location where id = r.location_id),
    'person_id', r.person_id,
    'person_name', (select display_name from person where id = r.person_id),
    'note', r.note,
    'custom_location_text', r.custom_location_text
  ));
$$;

create or replace function audit_snapshot_leg(r transport_leg)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'direction', r.direction,
    'driver_id', r.driver_id,
    'driver_name', (select display_name from person where id = r.driver_id),
    'guest_name', r.guest_name,
    'self_transport', r.self_transport,
    'companion_id', r.companion_id,
    'companion_name', (select display_name from person where id = r.companion_id),
    'companion2_id', r.companion2_id,
    'companion2_name', (select display_name from person where id = r.companion2_id),
    'depart_at', r.depart_at,
    'note', r.note
  ));
$$;

create or replace function audit_write_occurrence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_source text;
  v_hid uuid;
begin
  v_actor := current_person_id();
  v_source := case when v_actor is null then 'system' else 'user' end;
  if TG_OP = 'INSERT' then
    if NEW.template_id is not null then
      return NEW;
    end if;
    insert into audit_event (household_id, actor_id, source, entity, entity_id, action, before, after)
    values (NEW.household_id, v_actor, v_source, 'occurrence', NEW.id, 'insert', null, audit_snapshot_occurrence(NEW));
    return NEW;
  elsif TG_OP = 'UPDATE' then
    if OLD.status is not distinct from NEW.status
       and OLD.on_date is not distinct from NEW.on_date
       and OLD.starts_at is not distinct from NEW.starts_at
       and OLD.ends_at is not distinct from NEW.ends_at
       and OLD.location_id is not distinct from NEW.location_id
       and OLD.custom_location_text is not distinct from NEW.custom_location_text
       and OLD.note is not distinct from NEW.note
       and OLD.title is not distinct from NEW.title
    then
      return NEW;
    end if;
    insert into audit_event (household_id, actor_id, source, entity, entity_id, action, before, after)
    values (NEW.household_id, v_actor, v_source, 'occurrence', NEW.id, 'update',
            audit_snapshot_occurrence(OLD), audit_snapshot_occurrence(NEW));
    return NEW;
  else
    v_hid := OLD.household_id;
    insert into audit_event (household_id, actor_id, source, entity, entity_id, action, before, after)
    values (v_hid, v_actor, v_source, 'occurrence', OLD.id, 'delete',
            audit_snapshot_occurrence(OLD), null);
    return OLD;
  end if;
end;
$$;

create or replace function audit_write_leg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_source text;
begin
  v_actor := current_person_id();
  v_source := case when v_actor is null then 'system' else 'user' end;
  if TG_OP = 'UPDATE' then
    if OLD.driver_id is not distinct from NEW.driver_id
       and OLD.guest_name is not distinct from NEW.guest_name
       and OLD.self_transport is not distinct from NEW.self_transport
       and OLD.companion_id is not distinct from NEW.companion_id
       and OLD.companion2_id is not distinct from NEW.companion2_id
       and OLD.depart_at is not distinct from NEW.depart_at
       and OLD.note is not distinct from NEW.note
    then
      return NEW;
    end if;
    insert into audit_event (household_id, actor_id, source, entity, entity_id, action, before, after)
    values (NEW.household_id, v_actor, v_source, 'transport_leg', NEW.id, 'update',
            audit_snapshot_leg(OLD), audit_snapshot_leg(NEW));
    return NEW;
  end if;
  return NEW;
end;
$$;

drop trigger if exists occurrence_audit on occurrence;
create trigger occurrence_audit
  after insert or update or delete on occurrence
  for each row execute function audit_write_occurrence();

drop trigger if exists transport_leg_audit on transport_leg;
create trigger transport_leg_audit
  after update on transport_leg
  for each row execute function audit_write_leg();

-- ── push_log + push_recipient ────────────────────────────────────────────────
alter table push_log add column if not exists kind text;
alter table push_log add column if not exists actor_id uuid references person(id) on delete set null;
alter table push_log add column if not exists entity text;
alter table push_log add column if not exists entity_id uuid;

create table if not exists push_recipient (
  log_id     uuid not null references push_log(id) on delete cascade,
  person_id  uuid not null references person(id) on delete cascade,
  read_at    timestamptz,
  primary key (log_id, person_id)
);

create index if not exists push_recipient_person_unread_idx
  on push_recipient (person_id)
  where read_at is null;

alter table push_recipient enable row level security;

drop policy if exists "household members can read push_log" on push_log;
create policy push_log_select on push_log
  for select
  using (
    household_id = current_household()
    and (
      current_person_is_admin()
      or exists (
        select 1 from push_recipient r
        where r.log_id = push_log.id and r.person_id = current_person_id()
      )
    )
  );

drop policy if exists push_recipient_select on push_recipient;
create policy push_recipient_select on push_recipient
  for select
  using (
    person_id = current_person_id()
    or current_person_is_admin()
  );

drop policy if exists push_recipient_update_own on push_recipient;
create policy push_recipient_update_own on push_recipient
  for update
  using (person_id = current_person_id())
  with check (person_id = current_person_id());

grant select on audit_event to authenticated;
grant select, update on push_recipient to authenticated;
