-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  Napi generate_horizon ütemezés pg_cron-nal                     ║
-- ║                                                                  ║
-- ║  Előfeltétel: a Supabase dashboardon engedélyezni kell a        ║
-- ║  pg_cron extensiont:                                             ║
-- ║    Database → Extensions → pg_cron → Enable                     ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- Extension engedélyezése (ha még nincs)
create extension if not exists pg_cron;

-- Korábbi schedule törlése, ha újra futtatjuk a migrációt
select cron.unschedule('generate-horizon-daily')
where exists (
  select 1 from cron.job where jobname = 'generate-horizon-daily'
);

-- Ütemezés: minden nap 02:00 UTC-kor (= 04:00 Budapest nyáron, 03:00 télen)
-- A függvény minden aktív háztartásra lefut, 14 napra előre generál.
select cron.schedule(
  'generate-horizon-daily',
  '0 2 * * *',
  $$
    select generate_horizon(id, 14)
    from household;
  $$
);
