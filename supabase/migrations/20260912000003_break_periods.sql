-- F8: Szünet-időszakok és Betegség kezelése
-- break_period: egy gyerekhez/személyhez rendelt dátum-tartomány
-- ahol az összes occurrence automatikusan cancelled státuszba kerül.

create type break_reason as enum ('illness', 'vacation', 'other');

create table break_period (
  id            uuid        primary key default gen_random_uuid(),
  household_id  uuid        not null references household(id) on delete cascade,
  person_id     uuid        not null references person(id) on delete cascade,
  date_from     date        not null,
  date_to       date        not null,
  reason        break_reason not null default 'vacation',
  note          text,
  created_by    uuid        references person(id),
  created_at    timestamptz not null default now(),
  check (date_to >= date_from)
);

create index break_period_date_idx
  on break_period (household_id, date_from, date_to);

alter table break_period enable row level security;

create policy "break_period_household" on break_period
  for all using (
    household_id in (
      select household_id from person where auth_user_id = auth.uid()
    )
  )
  with check (
    household_id in (
      select household_id from person where auth_user_id = auth.uid()
    )
  );

-- Tárolt függvény: adott szünet-tartományban az összes érintett occurrence
-- 'cancelled' státuszra vált, a fuvarokban is frissíti (is_override = true).
create or replace function apply_break_period(p_break_id uuid)
returns int language plpgsql security definer as $$
declare
  v_bp   record;
  v_count int;
begin
  select * into v_bp from break_period where id = p_break_id;
  if not found then return 0; end if;

  update occurrence
  set status     = 'cancelled',
      is_override = true,
      updated_at  = now()
  where household_id = v_bp.household_id
    and person_id    = v_bp.person_id
    and on_date between v_bp.date_from and v_bp.date_to
    and status       <> 'cancelled';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Visszavonás: ha a szünetet töröljük, visszaállítja 'planned'-re
-- (csak azokat, amik kézzel nem lettek módosítva, azaz template-ből generáltak)
create or replace function revert_break_period(
  p_household_id uuid,
  p_person_id    uuid,
  p_date_from    date,
  p_date_to      date
)
returns int language plpgsql security definer as $$
declare v_count int;
begin
  update occurrence
  set status      = 'planned',
      is_override  = false,
      updated_at   = now()
  where household_id = p_household_id
    and person_id    = p_person_id
    and on_date between p_date_from and p_date_to
    and template_id  is not null   -- csak sablon-alapú alkalmak
    and status       = 'cancelled';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
