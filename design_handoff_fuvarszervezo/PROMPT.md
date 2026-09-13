# Prompt a fejlesztő agentnek

Az alábbi blokkot másold be egészében a Claude Code (vagy más kódoló agent) első üzenetébe,
miután a `design_handoff_fuvarszervezo/` mappát bemásoltad a repó gyökerébe.

---

```
Egy meglévő React 19 + Vite + TypeScript + Supabase PWA-t (Családi Fuvarszervező)
kell átalakítanod egy elkészült design-specifikáció alapján.

## 1. Olvasd el ELŐSZÖR, ebben a sorrendben

A specifikáció három HTML dokumentum a repó gyökerében lévő
`design_handoff_fuvarszervezo/` mappában. Ezek DESIGN REFERENCIÁK, nem
production kód — HTML-ben készült prototípusok, amik a szándékolt megjelenést
és viselkedést mutatják. NE másold belőlük a markupot. A feladat az, hogy a
bennük leírt felületet a repó saját React + TypeScript környezetében,
a meglévő minták szerint újraépítsd.

  1. design_handoff_fuvarszervezo/3-kepernyo-specifikacio.html   ← A FŐ DOKUMENTUM
     11 szakasz: nevezéktan, komponenskönyvtár TS interfészekkel, role-jelölés,
     navigáció, a négy képernyő szerepenként, sheetek, push-szövegek,
     üres állapotok, és a végén fájlonkénti teendőlista + elfogadási kritériumok.

  2. design_handoff_fuvarszervezo/2-implementacios-terv.html
     Elvek, információs architektúra, design tokenek mért kontrasztarányokkal,
     szállítási sorrend.

  3. design_handoff_fuvarszervezo/1-design-review.html
     Miért kell változtatni: a mai állapot kritikája, 10 rangsorolt hibával.
     Kontextus, nem teendő.

  Ha a három dokumentum bármiben ütközik, a 3-kepernyo-specifikacio.html
  az érvényes. Ezt a dokumentum maga is kimondja a záró szakaszában.

A HTML fájlokat olvasd be teljes egészében (Read tool). Sok inline stílus van
bennük — a számok (px, hex, font-weight) a specifikáció részei, azokat vedd
komolyan. A `<div style="...">` blokkokban lévő telefonkeretek a képernyők
1:1 méretű rajzai 390px szélességen.

## 2. Amit tudni kell a kódbázisról

  src/screens/     Ma.tsx, Fuvartabla.tsx, Het.tsx, Esemeny.tsx, Sablon.tsx,
                   Beallitasok.tsx, Login.tsx
  src/components/  Header.tsx, BottomNav.tsx, DirectionBadge.tsx,
                   BreakModal.tsx, QuickLogModal.tsx, OccurrenceOverrideModal.tsx,
                   PushInbox.tsx
  src/hooks/       useRole.ts, useHousehold.ts
  src/lib/         supabase.ts, auth.tsx, db.ts (Dexie), sync.ts,
                   occurrences.ts, googleCalendar.ts, push.ts
  src/index.css    a mai design system (:root tokenek + komponens-osztályok)
  src/types/       index.ts
  supabase/        migrations/, functions/, seed.sql

Az adatmodell NEM változik. Nincs új tábla. A Supabase-lekérdezések, a Dexie
cache és az offline queue érintetlen marad. Két apró migráció kell, ezeket a
specifikáció 11. szakasza sorolja fel.

## 3. Kötelező szabályok

  a) NEVEZÉKTAN. A specifikáció 1. szakasza egy háromhasábos szótár:
     magyar UI-szó ↔ angol kód-azonosító ↔ adatbázis-név. Ez kötelező érvényű.
     - Kód, komponensnevek, propok, state-ek: ANGOL.
     - Minden felhasználónak látható szöveg: MAGYAR, és kizárólag egyetlen
       fájlból, `src/copy.ts`-ből. Magyar string-literál nem lehet .tsx-ben.
     - A "Tiltott szavak a felületen" lista (szintén 1. szakasz) betartandó:
       nincs "láb", "gazdátlan", "Körút", "Átszállítás", "Sablon",
       "occurrence", "Hatókör", "Maga megy", ISO-dátum, se számnév
       gyereknevek helyett.
     - Irányok: "Viszi" (outbound) / "Begyűjti" (inbound).
     - Több gyerek egy autóban mindig gyereknevekkel:
       "Judit begyűjti Simit és Jankát" — soha nem "mindkettőt".

  b) KOMPONENSEK. A 2. szakasz 11 komponenst ír le (C1–C11), mindegyikhez
     TypeScript interfésszel. Ezek a teljes felület építőkockái.
     Képernyő-specifikus kártya, gomb vagy stílusdefiníció NEM keletkezhet:
     a `src/screens/` alatt nincs styling. Ha valami kell, ami nincs a
     C1–C11 listán, az vagy meglévő komponens új propja, vagy új komponens.

  c) SZEREPEK. Négy szerep (parent, grandparent, babysitter, child), és a
     különbség VIZUÁLIS is, nem csak működési — saját tinta-szín, ikon és
     műveletsáv szerepenként (3. szakasz, `ROLE_THEME`). Tiltott műveletet
     soha nem jelenítünk meg szürkén: ami nem az övé, az nincs ott.
     - Nagyszülő: mindent lát, másra nem oszthat, magára vállalhat
       ("Vállalom"), sajátját visszaadhatja. NINCS Fuvarok tabja.
     - Bébiszitter: csak a rá vonatkozó fuvarokat és programokat látja.
       NINCS Fuvarok tabja.
     - A tabokat egyetlen `TABS` tömb adja, a szerep szűri (4. szakasz).

  d) AKADÁLYMENTESSÉG. Minden szöveg legalább 4.5:1 kontraszton (nagy szöveg
     3:1), minden kattintható elem legalább 44×44px, `:focus-visible` 2px
     accent gyűrű, `prefers-reduced-motion` esetén nincs animáció.

## 4. Munkamenet

A 11. szakasz négy kört határoz meg, mindegyik önmagában szállítható, és
mindegyikhez tartozik egy elfogadási kritérium-lista:

  1. ALAP        tokenek, ikonok (Phosphor), copy.ts, Avatar, Pill, format.ts
  2. A DÖNTÉS    DriverRow + RideCard + GroupedRideCard, useAssignDriver
  3. SZERKEZET   négy tab, Rides.tsx, More.tsx, Week.tsx átírás, RLS
  4. CSISZOLÁS   sheetek, toast, push-szövegek, generálás triggerre

Egy körön belül dolgozz, ne ugorj előre. Minden kör végén menj végig a
saját elfogadási kritérium-listáján, és mondd meg, melyik pont teljesül.

## 5. Amit ELŐSZÖR ellenőrizz a kódban

A specifikáció három ponton feltételezésre épül. Nézd meg, és ha nem
egyezik, jelezd, mielőtt kódot írsz:

  1. `transport_leg.direction` értékkészlete — a spec 'outbound' | 'inbound'-ot
     feltételez a mai `LegDirection` típus alapján.
  2. Létezik-e `companion2_id`, vagy csak egy kísérő van.
  3. A `trip` tábla használatban van-e éles adaton, vagy üres.

## 6. Első feladat

Ne írj még kódot. Először:
  - olvasd be a három design-dokumentumot,
  - olvasd be a fenti kódbázis-fájlokat,
  - ellenőrizd az 5. pont három feltételezését,
  - és írj egy tömör tervet az 1. körre (ALAP): pontosan mely fájlok
    keletkeznek, mely fájlok módosulnak, és mi a sorrend.

Utána megbeszéljük, és onnan haladunk körönként.
```

---

## Ha a fejlesztő agent nem lát HTML-t

Néhány agent nem olvas jól nagy HTML-t. Ilyenkor cseréld az 1. pontot erre:

```
A specifikáció egyetlen Markdown fájlban: design_handoff_fuvarszervezo/SPEC.md
```

…és kérj tőlem egy Markdown-exportot a három dokumentumból — a képernyőrajzok
helyett szöveges elemtáblázatokkal.
