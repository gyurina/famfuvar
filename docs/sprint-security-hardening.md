# Sprint — Biztonsági megszilárdítás

_Supabase linter alapján azonosított hibák javítása és Vite bundle optimalizálás_

---

## Háttér

A Supabase beépített biztonsági lintere öt ERROR-t, nyolc WARNING-ot és egy INFO-t jelzett.
A vizsgálat alapján ezek egy része véletlen hiba, egy része szándékos döntés rossz megvalósítással —
az alábbi terv minden éles kockázatot megszüntet funkcionális törés nélkül.

---

## 1. Nézetek → SECURITY INVOKER

**Érintett objektumok:** `leg_occupies`, `driver_conflict`, `driver_busy_conflict`

**Probléma:** A postgres szuperfelhasználó által owned view a mögöttes táblák
(`transport_leg`, `travel_group_member`, `external_calendar`, `external_event`) RLS-ét
megkerüli. Bármely szerepkör, amely eléri a nézetet, az összes háztartás adatát látja.

**Vizsgálati megállapítás:** Véletlen — a nézetek `SECURITY DEFINER`-ként nem lettek
expliciten létrehozva, de a Postgres szuperuser-ownership ezt implicit eredményezi.
A React app és az Edge Functionök egyáltalán nem hívják ezeket; kizárólag a migrációban vannak definiálva.

**Javítás:** DROP → CREATE WITH (security_invoker = true) a helyes sorrendben
(először a `driver_conflict` és `driver_busy_conflict`, amelyek `leg_occupies`-ra épülnek,
majd maga a `leg_occupies`). A nézetek belső lekérdezési logikája változatlan marad;
a különbség annyi, hogy a lekérdező user saját RLS-kontextusában futnak.

**Törési kockázat:** Nulla.

---

## 2. `google_oauth_token` → RLS engedélyezés

**Probléma:** A tábla RLS nélkül PostgREST-en keresztül elérhető, és érzékeny mezőket
tartalmaz (`access_token`, `refresh_token`).

**Vizsgálati megállapítás:** Félszándékos — a migrációs komment „service_role only"-t
jelez, de a tábla nincs levéve az API-ról. A `google_sync` táblánál a helyes minta
(RLS be, nulla policy) már alkalmazva van; itt ez hiányzott.

**Javítás:** `ALTER TABLE google_oauth_token ENABLE ROW LEVEL SECURITY;`
Nulla policy = authenticated és anon nem fér hozzá; service_role (Edge Functionök)
változatlanul bypass-ol. Közvetlen kliens-hozzáférés sehol nincs a React kódban —
minden művelet az Edge Functionökön keresztül zajlik service_role kulccsal.

**Törési kockázat:** Nulla.

---

## 3. `generate_horizon` — anon revoke + háztartás-ellenőrzés

**Probléma:** Az anon szerepkör meghívhatja a függvényt tetszőleges `household_id`-vel,
és SECURITY DEFINER jogon adatot írhat be.

**Vizsgálati megállapítás:** Véletlen. A React app (Sablon képernyő) authenticated
userként hívja, mindig a saját householdId-jével. Az Edge Function service_role kulccsal
hívja. Egyik sem igényli az anon hozzáférést.

**Javítás — két lépés:**

1. `REVOKE EXECUTE ON FUNCTION generate_horizon(uuid, int) FROM anon;`

2. Háztartás-ellenőrzés a függvény elejére, csak authenticated hívókra:
   ```sql
   IF auth.role() = 'authenticated' THEN
     IF NOT EXISTS (
       SELECT 1 FROM person
       WHERE household_id = p_household_id AND auth_user_id = auth.uid()
     ) THEN
       RAISE EXCEPTION 'Unauthorized: not a member of this household';
     END IF;
   END IF;
   ```
   Service_role esetén `auth.role()` értéke `'service_role'` → az ellenőrzés ki van kerülve.
   A `search_path` rögzítése szintén ide kerül (lásd 7. pont).

**Törési kockázat:** Nulla — a meglévő hívók mindkét esetben átmennek az ellenőrzésen.

---

## 4. `current_household()` — anon EXECUTE visszavonás

**Probléma:** Anon hívhatja, de `auth.uid()` NULL → mindig NULL-t ad vissza. Felesleges expozíció.

**Vizsgálati megállapítás:** Véletlen. Az RLS policy-k `authenticated` kontextusban
értékelik; az anon revoke csak a közvetlen RPC-hívást zárja le. A React app nem indít
anon lekérdezést (`useHousehold` csak bejelentkezett user esetén fut).

**Javítás:** `REVOKE EXECUTE ON FUNCTION current_household() FROM anon;`

**Törési kockázat:** Nulla.

---

## 5. `delete_google_oauth_token` — anon EXECUTE visszavonás

**Probléma:** Anon hívhatja, bár a belső check mindig 'Unauthorized'-ot dob
(`auth.uid()` NULL esetén soha nem egyezik `person.auth_user_id`-vel).

**Vizsgálati megállapítás:** Véletlen — a belső védelem működik, de a nyitott expozíció
szükségtelen. A `disconnectGoogle()` frontend-funkció csak bejelentkezett user UI-akciójából hívható.

**Javítás:** `REVOKE EXECUTE ON FUNCTION delete_google_oauth_token(uuid) FROM anon;`
A `search_path` rögzítése szintén ide kerül (lásd 7. pont).

**Törési kockázat:** Nulla.

---

## 6. `set_push_sub_user_id()` — EXECUTE visszavonás

**Probléma:** Anon és authenticated RPC-n keresztül is hívhatná (bár trigger függvény
lévén az RPC hívás hibával zárulna).

**Vizsgálati megállapítás:** Véletlen. Trigger függvény — az EXECUTE jog nem szükséges
a trigger-végrehajtáshoz; a trigger mechanizmus közvetlenül hívja a függvényt.

**Javítás:**
```sql
REVOKE EXECUTE ON FUNCTION set_push_sub_user_id() FROM anon;
REVOKE EXECUTE ON FUNCTION set_push_sub_user_id() FROM authenticated;
```
A `search_path` rögzítése szintén ide kerül (lásd 7. pont).

**Törési kockázat:** Nulla.

---

## 7. `search_path` rögzítése — 3 függvény

**Probléma:** A `current_household()`-nál a `SET search_path = public` már megvolt,
a másik három SECURITY DEFINER függvénynél elfelejtve.

**Vizsgálati megállapítás:** Véletlen, konzisztencia-hiba. Mutable search_path
SECURITY DEFINER függvényeknél elméletileg schema-hijacking lehetőségét nyitja meg.

**Javítás:**
```sql
ALTER FUNCTION delete_google_oauth_token(uuid)  SET search_path = public;
ALTER FUNCTION set_push_sub_user_id()            SET search_path = public;
-- generate_horizon: CREATE OR REPLACE-szel írjuk újra (3. pont miatt),
-- ott a fejlécbe kerül bele
```

**Törési kockázat:** Nulla — csak metaadat-változás.

---

## 8. Leaked password protection — Dashboard beállítás

**Hol:** Supabase Dashboard → Authentication → Sign In / Up → Password →
„Protect against use of leaked passwords" → BE

**Probléma:** Kompromittált jelszavak ellen nincs védelem (HaveIBeenPwned.org ellenőrzés).

**Vizsgálati megállapítás:** Nem konfigurált — soha nem volt beállítva.

**Javítás:** Egy kapcsoló a dashboardon. Nem érinti a meglévő jelszavakat,
csak új jelszóbeállítás/módosítás esetén aktív.

**Törési kockázat:** Nulla.

---

## 9. Vite bundle splitting

**Probléma:** A `vite.config.ts` nem tartalmaz `build` szekciót — az összes dependency
(React, Supabase SDK, Dexie, date-fns) egyetlen chunk-ba kerül, meghaladva az 500KB-os
Vite alapértelmezett határt. PWA szempontból is hátrányos: a service worker nem tudja
a ritkán változó vendor kódot az app kódtól külön cache-elni.

**Vizsgálati megállapítás:** Nem konfigurált. A `chunkSizeWarningLimit` emelése csak
a figyelmeztetést nyomja el; a helyes megoldás `manualChunks` a rollup optionökben.

**Javítás — tervezett chunk-struktúra:**

| Chunk | Tartalom | Becsült méret |
|-------|----------|---------------|
| `vendor-react` | react, react-dom, react-router-dom | ~130 KB |
| `vendor-supabase` | @supabase/supabase-js | ~300 KB |
| `vendor-dexie` | dexie | ~60 KB |
| `vendor-datefns` | date-fns | ~80 KB |
| `index` | app kód (screens, components, lib) | kis méret |

`vite.config.ts`-be kerül a `build.rollupOptions.output.manualChunks` konfiguráció,
és a `chunkSizeWarningLimit` reális értékre (600) állítása.

**Törési kockázat:** Nulla — bundle splitting nem érinti az importokat, az app logikát
vagy a PWA manifeszt-et. A böngésző és a service worker automatikusan kezeli a több chunk-ot.

---

## Implementációs sorrend

| # | Feladat | Hol | Kockázat |
|---|---------|-----|----------|
| 1 | `google_oauth_token` RLS | új migráció | — |
| 2 | Nézetek SECURITY INVOKER | új migráció | — |
| 3 | `generate_horizon` revoke + check + search_path | új migráció | — |
| 4 | `current_household` anon revoke | új migráció | — |
| 5 | `delete_google_oauth_token` revoke + search_path | új migráció | — |
| 6 | `set_push_sub_user_id` revoke + search_path | új migráció | — |
| 7 | Leaked pw protection | Dashboard | — |
| 8 | Bundle splitting | `vite.config.ts` | — |

Az 1–6. pontok egyetlen migrációs fájlba kerülnek (`supabase/migrations/YYYYMMDDHHMMSS_security_hardening.sql`).
