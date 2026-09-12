-- F7: "Később megadni" helyszín flag
-- Ha egy location.is_tbd = true, a hozzá kapcsolt transport_leg-en
-- figyelmeztetést kell megjeleníteni, hogy pontos cím még hiányzik.

alter table location
  add column if not exists is_tbd boolean not null default false;

comment on column location.is_tbd is
  'Ha true, ez egy "Később megadni" placeholder helyszín — a fuvarnál figyelmeztetés jelenik meg.';
