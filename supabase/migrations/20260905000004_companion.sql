-- companion_id mező hozzáadása a transport_leg táblához
-- Ez teszi lehetővé a "Papi vezet, Mami kísér" típusú páros hozzárendelést.

alter table transport_leg
  add column if not exists companion_id uuid references person(id);

comment on column transport_leg.companion_id
  is 'Opcionális kísérő (nem vezet, de az autóban ül)';
