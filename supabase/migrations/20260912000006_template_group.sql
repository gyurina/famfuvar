-- Sablon group_id support (Opció B)
-- 1. person_id legyen nullable — csoport-sablonnál nincs egyedi gyerek
alter table schedule_template alter column person_id drop not null;

-- person_id FK: cascade helyett set null (törölt gyerek ne töröljön sablont)
alter table schedule_template drop constraint schedule_template_person_id_fkey;
alter table schedule_template
  add constraint schedule_template_person_id_fkey
  foreign key (person_id) references person(id) on delete set null;

-- 2. group_id oszlop
alter table schedule_template
  add column group_id uuid references travel_group(id) on delete set null;

-- 3. Legalább az egyik kötelező
alter table schedule_template
  add constraint template_person_or_group
  check (person_id is not null or group_id is not null);

-- 4. Occurrence unique index: (template_id, on_date) → (template_id, person_id, on_date)
--    Csoportos sablonnál egy napra több occurrence keletkezik (tagonként 1-1)
drop index if exists occurrence_template_date_uq;
create unique index occurrence_template_date_uq
  on occurrence (template_id, person_id, on_date)
  where template_id is not null;
