-- Google OAuth token tárolás (service_role only, nincs RLS)
create table google_oauth_token (
  person_id     uuid primary key references person(id) on delete cascade,
  household_id  uuid not null references household(id) on delete cascade,
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,
  scope         text not null default 'https://www.googleapis.com/auth/calendar',
  updated_at    timestamptz not null default now()
);

-- Unique constraint: egy személy egy Google Calendar-t csatlakoztathat
create unique index uniq_ext_cal_person_google
  on external_calendar (person_id, google_calendar_id)
  where source = 'google' and person_id is not null;

-- RLS: a kliens az external_calendar táblát olvashatja (saját háztartáson belül)
alter table external_calendar enable row level security;

create policy "household members can view ext calendars"
  on external_calendar for select
  using (
    household_id in (
      select household_id from person where auth_user_id = auth.uid()
    )
  );

-- external_event: household members read (calendar join-on keresztül)
alter table external_event enable row level security;

create policy "household members can view ext events"
  on external_event for select
  using (
    calendar_id in (
      select ec.id from external_calendar ec
      join person p on p.household_id = ec.household_id
      where p.auth_user_id = auth.uid()
    )
  );

-- RPC: saját Google OAuth token törlése (kliens hívhatja, de csak a saját adatát törli)
create or replace function delete_google_oauth_token(p_person_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_auth_user uuid := auth.uid();
begin
  -- Csak akkor töröl, ha a person valóban az aktuális felhasználóé
  if not exists (
    select 1 from person
    where id = p_person_id and auth_user_id = v_auth_user
  ) then
    raise exception 'Unauthorized';
  end if;
  delete from google_oauth_token where person_id = p_person_id;
end;
$$;
