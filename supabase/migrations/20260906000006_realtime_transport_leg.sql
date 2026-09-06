-- Supabase Realtime engedélyezése a transport_leg táblán
-- Ez szükséges ahhoz, hogy a Fuvartábla élőben frissüljön
-- sofőr-hozzárendeléskor (postgres_changes UPDATE event).

alter publication supabase_realtime add table transport_leg;
