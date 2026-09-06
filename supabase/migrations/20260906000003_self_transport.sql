-- Önálló közlekedés jelölés transport_leg-en
alter table transport_leg
  add column if not exists self_transport boolean not null default false;
