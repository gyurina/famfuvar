-- Occurrence eltérítés: jelöli, ha egy sablon-occurrence manuálisan lett módosítva
alter table occurrence
  add column if not exists is_override boolean not null default false;

comment on column occurrence.is_override is
  'true ha ez az occurrence a sablon-generált értéktől eltér (manuális módosítás)';
