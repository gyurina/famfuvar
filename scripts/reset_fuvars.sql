-- ============================================================
-- reset_fuvars.sql
-- Törli az összes fuvart, sablont és kapcsolódó adatot.
-- MEGTART: household, person, location, travel_group,
--          travel_group_member, travel_time, driver_availability
-- ============================================================

begin;

-- 1. Google sync log (occurrence / transport_leg-re mutat)
delete from google_sync;

-- 2. Transport leg-ek (occurrence-re mutat)
delete from transport_leg;

-- 3. Occurrence-ök (template-re mutat)
delete from occurrence;

-- 4. Sablonok
delete from schedule_template;

-- 5. Külső naptár cache (opcionális — csak az esemény-gyorsítótár)
delete from external_event;

commit;

-- Ellenőrzés
select 'google_sync'          as tabla, count(*) as sorok from google_sync
union all
select 'transport_leg',       count(*) from transport_leg
union all
select 'occurrence',          count(*) from occurrence
union all
select 'schedule_template',   count(*) from schedule_template
union all
select 'external_event',      count(*) from external_event
union all
select '--- MEGTARTVA ---',   null
union all
select 'household',           count(*) from household
union all
select 'person',              count(*) from person
union all
select 'location',            count(*) from location
union all
select 'travel_time',         count(*) from travel_time
union all
select 'driver_availability', count(*) from driver_availability;
