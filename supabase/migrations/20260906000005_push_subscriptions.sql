-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  push_subscription — Web Push feliratkozások tárolása           ║
-- ╚══════════════════════════════════════════════════════════════════╝

create table if not exists push_subscription (
  id           uuid        primary key default gen_random_uuid(),
  household_id uuid        not null references household(id) on delete cascade,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  endpoint     text        not null,
  p256dh       text        not null,
  auth         text        not null,
  created_at   timestamptz not null default now(),
  unique (user_id, endpoint)
);

-- RLS
alter table push_subscription enable row level security;

-- Mindenki csak a saját feliratkozásait kezelheti
create policy "push_sub_own" on push_subscription
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- A user_id automatikusan az auth.uid() legyen INSERT-nél
create or replace function set_push_sub_user_id()
returns trigger language plpgsql security definer as $$
begin
  NEW.user_id := auth.uid();
  return NEW;
end;
$$;

drop trigger if exists push_sub_set_user on push_subscription;
create trigger push_sub_set_user
  before insert on push_subscription
  for each row execute function set_push_sub_user_id();
