-- Órarend mentésekor (insert/update/delete) automatikusan újrageneráljuk
-- a következő 30 nap programjait. A „Generálj” gomb ezért eltűnik.
-- apply_break_period a lemondott programok fuvarjait is törli.

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

create or replace function apply_break_period(p_break_id uuid)
returns int language plpgsql security definer
set search_path = public
as $$
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

  delete from transport_leg
  using occurrence o
  where transport_leg.occurrence_id = o.id
    and o.household_id = v_bp.household_id
    and o.person_id    = v_bp.person_id
    and o.on_date between v_bp.date_from and v_bp.date_to
    and o.status = 'cancelled';

  return v_count;
end;
$$;
