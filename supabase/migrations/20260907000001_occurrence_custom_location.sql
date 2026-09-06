-- F5: egyszeri cím (custom_location_text) az occurrence-en
-- Ha ki van töltve, ez jelenik meg a helyszín neve helyett.

alter table occurrence
  add column if not exists custom_location_text text default null;

comment on column occurrence.custom_location_text is
  'Egyszeri cím szöveg, felülírja a location.name megjelenítését (F5)';
