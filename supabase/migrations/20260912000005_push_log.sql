-- Push kézbesítés mérése: push_log + push_log_receipt

create table push_log (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references household(id) on delete cascade,
  sent_by       uuid references person(id) on delete set null,
  title         text not null,
  body          text not null,
  sent_at       timestamptz not null default now(),
  target_count  int not null default 0,
  sent_count    int not null default 0,
  failed_count  int not null default 0
);

create table push_log_receipt (
  id          uuid primary key default gen_random_uuid(),
  log_id      uuid not null references push_log(id) on delete cascade,
  person_id   uuid references person(id) on delete set null,
  event       text not null check (event in ('delivered', 'clicked', 'dismissed')),
  received_at timestamptz not null default now(),
  user_agent  text
);

create index push_log_household_idx on push_log (household_id, sent_at desc);
create index push_log_receipt_log_idx on push_log_receipt (log_id, event);

alter table push_log enable row level security;
alter table push_log_receipt enable row level security;

-- Háztartás tagjai olvashatják a push_log-ot
create policy "household members can read push_log"
  on push_log for select
  using (
    household_id in (
      select household_id from person where auth_user_id = auth.uid()
    )
  );

-- Háztartás tagjai küldhetnek push-t (insert)
create policy "household members can insert push_log"
  on push_log for insert
  with check (
    household_id in (
      select household_id from person where auth_user_id = auth.uid()
    )
  );

-- Receiptek olvasása: háztartás tagjai
create policy "household members can read receipts"
  on push_log_receipt for select
  using (
    log_id in (
      select id from push_log where household_id in (
        select household_id from person where auth_user_id = auth.uid()
      )
    )
  );

-- Receipt beírás: service_role (Edge Function) + anon (SW callback)
create policy "service role can insert receipts"
  on push_log_receipt for insert
  with check (true);
