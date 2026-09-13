# Handoff: Családi Fuvarszervező — teljes felület-újratervezés

## Mi ez

Egy meglévő React 19 + Vite + TypeScript + Supabase PWA (családi fuvarszervező
alkalmazás) felületének újratervezése: információs architektúra, nevezéktan,
komponensrendszer és a négy képernyő teljes specifikációja, szerepenként.

## A fájlokról

A mappában lévő HTML-ek **design referenciák** — HTML-ben készült prototípusok,
amik a szándékolt megjelenést és viselkedést mutatják. **Nem production kód.**
A feladat az, hogy a bennük leírt felületet a célkódbázis saját React +
TypeScript környezetében, a meglévő mintái szerint újraépítsd — nem az, hogy a
markupot átmásold.

A telefonkeretek 1:1 méretarányban, 390px szélességen készültek. A bennük lévő
px-, hex- és font-weight-értékek a specifikáció részei.

## Fidelity

**Hi-fi.** Végleges színek, tipográfia, térközök, ikonok és állapotok.
A komponensekhez TypeScript interfészek tartoznak. A felületet pixelpontosan
kell újraépíteni, a dokumentumban megadott tokenekkel.

## Fájlok

| Fájl | Tartalom | Mikor kell |
|---|---|---|
| `PROMPT.md` | **Ezzel indítsd.** Bemásolható prompt a fejlesztő agentnek. | Először |
| `3-kepernyo-specifikacio.html` | **A fő dokumentum.** 11 szakasz: nevezéktan, komponenskönyvtár TS interfészekkel, role-jelölés, navigáció, négy képernyő szerepenként, sheetek, push-szövegek, üres állapotok, fájlonkénti teendőlista, elfogadási kritériumok. | Végig |
| `2-implementacios-terv.html` | Elvek, információs architektúra, design tokenek mért kontrasztarányokkal, szállítási sorrend. | Tervezéskor |
| `1-design-review.html` | A mai állapot kritikája, 10 rangsorolt hibával. Kontextus, nem teendő. | Egyszer, az elején |
| `support.js` | A HTML-ek megjelenítéséhez kell. Nem része a specifikációnak. | — |

**Ütközés esetén a `3-kepernyo-specifikacio.html` az érvényes.**

## Hogyan nyisd meg

A három HTML fájl böngészőben közvetlenül megnyitható, ha a `support.js`
mellettük van. Nagyíts/pásztázz szabadon — a dokumentumok vásznas elrendezésűek.

## A lényeg egy bekezdésben

A mai app naptárnak épült, ami mellékesen sofőrt is nyilvántart. A család
viszont egyetlen okból nyitja meg: **valaminek nincs sofőrje, és el kell dönteni,
ki viszi.** A redesign ezt teszi a rendszer közepére — a kiosztás egy koppintás
öt arc közül, nem panel és két lépés —, és négy tabra egyszerűsíti az ötöt.

## Nevezéktan (kivonat — a teljes az 1. szakaszban)

| UI (magyar) | Kód (angol) | Adatbázis |
|---|---|---|
| Fuvar | `ride` | `transport_leg` |
| Viszi | `direction: 'outbound'` | `direction` |
| Begyűjti | `direction: 'inbound'` | `direction` |
| Begyűjti Simit és Jankát | `groupedRide` | `trip` |
| Nincs sofőr | `isOpen` | `driver_id is null` |
| Önállóan megy | `selfTransport` | `self_transport` |
| Program | `event` | `occurrence` |
| Órarend | `schedule` | `schedule_template` |
| Vállalom | `claim()` | `driver_id = self` |

Kód angolul, UI magyarul, minden szöveg `src/copy.ts`-ből.

## Szerepek

| | Mindent lát | Beoszt másnak | Vállalhat magának | Szerkeszt | Tabok |
|---|---|---|---|---|---|
| Szülő | ✓ | ✓ | ✓ | ✓ | 4 |
| Nagyszülő | ✓ | — | ✓ | — | 3 |
| Bébiszitter | csak sajátját | — | — | — | 3 |
| Gyerek | ✓ | — | — | — | 2 |

A szerep **vizuálisan** is megkülönböztetett: saját tinta-szín, ikon és
műveletsáv (3. szakasz, `ROLE_THEME`). Tiltott műveletet soha nem jelenítünk
meg szürkén.

## Design tokenek

Színek, típusskála, térköz, sugár, érintési méret és mozgás: a
`2-implementacios-terv.html` 4. szakaszában, mért kontrasztarányokkal.
A kritikus változás: `--color-muted` `#5a7a96` → `#7d99ae` (4.23:1 → 6.4:1).

Ikonok: **Phosphor** (`@phosphor-icons/react`), `regular` és `fill` súly.
A mai emoji-készlet teljesen kivezetendő.

## Adatmodell

**Nem változik.** Nincs új tábla. Két apró migráció kell (`person.name_acc`,
`transport_leg.released_by/_at`), plusz egy trigger a generálás automatizálására
és egy RLS-szűkítés a nagyszülőre — mind a 11. szakaszban.

## Szállítási sorrend

1. **Alap** — tokenek, ikonok, `copy.ts`, Avatar, Pill, `format.ts`
2. **A döntés** — DriverRow + RideCard + GroupedRideCard, `useAssignDriver`
3. **Szerkezet** — négy tab, `Rides.tsx`, `More.tsx`, `Week.tsx` átírás, RLS
4. **Csiszolás** — sheetek, toast, push-szövegek, generálás triggerre

Mindegyik kör önmagában szállítható, és saját elfogadási kritérium-listája van
a 11. szakaszban.

## Ellenőrizendő a kódban induláskor

1. `transport_leg.direction` értékkészlete — a spec `'outbound' | 'inbound'`-ot feltételez.
2. Létezik-e `companion2_id`, vagy csak egy kísérő van.
3. A `trip` tábla használatban van-e éles adaton.

## Assetek

Nincs kép- vagy médiaasset. Az ikonok a Phosphor csomagból jönnek, az avatárok
monogramok a `person.color` értékkel — nincs fotó.
