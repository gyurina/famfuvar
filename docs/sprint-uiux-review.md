# Sprint — UI/UX átfogó átvizsgálat és optimalizálás

_Funkciók stabilitása, vizuális konzisztencia és kis kijelzős megfelelőség_

---

## Célok

1. Minden képernyőn ellenőrzött, kiszámítható layout 320–430px szélességen
2. Ikonok és szövegek nem csúsznak egymásra, nem lógnak ki, nem csonkulnak
3. Érintési célterületek megfelelnek a minimumnak (≥44px)
4. Konzisztens térközök, betűméretek és komponens-viselkedések az egész appban
5. Olvashatóság és kontrasztarány javítása ahol szükséges

---

## Azonosított problémák képernyőnként

### BottomNav — globális

**Probléma 1 — Hosszú feliratok, szűk hely:**
5 tab, egyenként `flex: 1` (20% a képernyőszélességből).
360px-es képernyőn ez tab-onként 72px, 320px-esen 64px.
A „Fuvartábla" (9 karakter) és „Események" (9 karakter) felirat 10px-es betűmérettel
ezeken a szélességeken csonkulhat vagy átfolyhat.

**Megoldás:** `white-space: nowrap` + `overflow: hidden` + `text-overflow: ellipsis`
a `.nav-item` label span-jára, vagy a két hosszú felirat rövidítése:
„Fuvar" és „Esem." / „Esem…" — de ez tartalmi döntés (lásd: megbeszélés).
Alternatíva: az aktív tab label-je látható, a többi rejtett (icon-only inaktív state).

**Probléma 2 — Érintési célterület:**
`.nav-item` padding: `6px 4px` → a ténylegesen kattintható terület ≈34px magas.
Az Apple HIG és Material minimuma 44px.

**Megoldás:** A 56px nav-magasságon belül a teljes belső területet érinthetővé tenni
(`padding-top` növelése + `align-items: center` a nav-ban).

**Probléma 3 — Font méret:**
`font-size: 10px` a nav feliratokon — ez a WCAG 2.1 minimum alatt van olvashatóság szempontjából.

**Megoldás:** Emelni `11px`-re; a szűkebb kijelzőkön `clamp(10px, 2.5vw, 11px)`.

---

### Ma képernyő

**Probléma — Timeline ikon és szöveg ütközés:**
A `.timeline` 48px bal paddinggal dolgozik; a `.timeline-node` (22×22px kör) `left: 10px`-nél ül.
Ha a szöveg blokk széles és a node pozicionálása nem abszolút stabil, kis kijelzőn
átfedhetnek a csomópont-jelzők és a mellettük lévő szövegek.

**Megoldás:** Ellenőrizni a `position: relative` / `absolute` párosítást a timeline-item és a node között;
biztosítani hogy a `padding-left: 48px` mindig érvényesül a content wrapper-en.

**Probléma 2 — Fuvar kártya gombsor:**
A driver badge (`flex-shrink: 0`) és az egyéb akciógombok egy sorban vannak.
Rövid képernyőszélességen a badge overflow-olhat a kártyán kívülre.

**Megoldás:** `flex-wrap: wrap` a badge-sort tartalmazó flex-containerre,
vagy `min-width: 0` + `overflow: hidden` a szöveg-részre.

---

### Fuvartábla képernyő

**Probléma 1 — Sofőr picker grid:**
`.picker-grid` 2-oszlopos, 8px gap-pel. 320px-esen az oszlopok ≈148px szélesek —
a badge-ek (avatar + név + ikon) ezen a szélességen összeszorulhatnak.

**Megoldás:** `grid-template-columns: repeat(auto-fill, minmax(140px, 1fr))` —
így kis kijelzőn egyoszlopos lesz, nagyobban marad kétoszlopos.

**Probléma 2 — Heti navigáció sorban:**
A `week-nav-btn` (36×36px) + „Ma" gomb + dátumszöveg egy flex sorban ülnek.
Ha a dátumszöveg hosszú (pl. „2026. szeptember 8–14."), 360px-en átfolyhat.

**Megoldás:** A dátumszövegre `flex: 1; text-align: center; min-width: 0; overflow: hidden; text-overflow: ellipsis`,
vagy rövidebb dátumformátum kis kijelzőn (`szept. 8–14.`).

**Probléma 3 — ⋯ akciógomb mérete:**
Az `.icon-btn` 36×36px — az Apple minimumtól (44px) 8px-szel kisebb.
Ebből adódóan könnyű mellékattintani.

**Megoldás:** Növelni 40×40px-re, vagy ál-területet növelni `padding` + negatív `margin`-nal.

---

### Hét képernyő

**Probléma — Napfejléc zsúfoltság:**
A heti nézetben 7 nap fejléce (betűjel + szám) jelenik meg egymás mellett.
360px-esen ez naponta ~51px — a selected-state badge-ek (kerek háttér) egymásba érhetnek.

**Megoldás:** Az oszlopszélességet `minmax`-szal kezelni; a nap-fejléc elemeit
`flex-shrink: 0` helyett `flex: 1; min-width: 0` -ra állítani, és a badge-méreteket
`max-width`-szel korlátozni.

---

### Sablon képernyő

**Probléma — Heti csoportok tábla:**
A sablon sorok (idő + helyszín + kapcsolók) vízszintesen terülnek el.
320px-en a kapcsolók és az idők egymás fölé kerülhetnek, de a layout nem kezel
explicit small-screen törési pontot.

**Megoldás:** Kártyánként `flex-direction: column` kis szélességen (`@container` vagy media query),
és a módosítógombok (`⋯`) érintési területének növelése.

---

### Beállítások képernyő

**Probléma 1 — Inline szerkesztő sorok:**
Az útvonal-szerkesztőben (helyszín A → B, percek) egy sorban 3 elem van:
két helyszín-select és egy szám input. 360px-en ez ~108px elem-szélességet jelent selectenként —
szűkös, különösen ha a helyszínnames hosszúak.

**Megoldás:** `flex-wrap: wrap` + `min-width: 0` az input-triple sorokon;
alternatívan kétsorossá bontani (A → B felül, perc alul).

**Probléma 2 — + Új … gombok:**
Az „+ Új helyszín", „+ Új útvonal" stb. gombok `width: 100%` — ez jó.
De az input és a mentés/mégse gomb együttese kis kijelzőn összeszorulhat.

**Megoldás:** A gomb-párokat (`Mentés` + `Mégsem`) `gap: 8px; display: flex; flex-wrap: wrap`-pel kezelni.

---

### Közös / globális problémák

**Scroll offset a bottom nav alatt:**
A képernyők `padding-bottom` értéke nem egységes — egyes oldalakon `.pb-24` (6rem),
másokon `.pb-20` (5rem), néhol `pb-14` (3.5rem). A bottom nav 56px + safe area.
Ha a tartalom utolsó eleme éppen a nav mögé csúszik, nem scrollozható elő.

**Megoldás:** Egységes CSS custom property: `--nav-height: calc(56px + env(safe-area-inset-bottom, 0))`,
és minden képernyő-scrollozható tartalmán `padding-bottom: var(--nav-height)`.

**Modal/sheet z-index konflikuts kockázata:**
A header `z-index: 40`, a nav `z-index: 50`. Ha modal-ok `z-index: 50` alatt nyílnak,
a nav takarja őket alul. Audit szükséges.

**Megoldás:** Z-index rétegek explicit dokumentálása és egységesítése:
`--z-header: 40`, `--z-nav: 50`, `--z-modal: 60`, `--z-toast: 70`.

**Nincs `max-width` a tartalomra:**
Tableten vagy széles landscape módban a tartalom teljes szélességre nyúlik.
Tervezett mobilapp, de landscape iPhone esetén is előfordulhat 844px+ szélesség.

**Megoldás:** `max-width: 480px; margin-inline: auto` a `.screen-content` wrappereken
(vagy globálisan az `#app`-on).

---

## Feladatlista

| # | Terület | Feladat | Érintett fájlok |
|---|---------|---------|----------------|
| 1 | BottomNav | Hosszú feliratok kezelése (rövidítés vagy label-hide) | `BottomNav.tsx`, `index.css` |
| 2 | BottomNav | Érintési terület növelése 44px-re | `index.css` |
| 3 | BottomNav | Nav font `clamp(10px, 2.5vw, 11px)` | `index.css` |
| 4 | Globális | `--nav-height` custom property + egységes `pb-nav` | `index.css`, összes screen |
| 5 | Globális | Z-index rétegek custom property-kba | `index.css` |
| 6 | Globális | `max-width: 480px` content wrapper | `index.css` |
| 7 | Ma | Timeline-node és szöveg ütközés audit + fix | `index.css`, `Ma.tsx` |
| 8 | Ma | Driver badge flex-wrap a leg kártyákon | `index.css` |
| 9 | Fuvartábla | Picker grid `auto-fill` responsive | `index.css` |
| 10 | Fuvartábla | Dátum szöveg csonkítás / flex kezelés | `Fuvartabla.tsx`, `index.css` |
| 11 | Fuvartábla | `icon-btn` méret növelés 40px-re | `index.css` |
| 12 | Hét | Nap-fejléc badge ütközés vizsgálat + fix | `Het.tsx`, `index.css` |
| 13 | Sablon | Kis kijelzős kártyatörés | `Sablon.tsx`, `index.css` |
| 14 | Beállítások | Útvonal-szerkesztő input-triple wrap | `Beallitasok.tsx`, `index.css` |
| 15 | Beállítások | Gomb-párok wrap fix | `Beallitasok.tsx`, `index.css` |

---

## Implementációs sorrend javaslat

**1. kör — CSS-only változások (globális, nincs funkcionális kockázat):**
4 → 5 → 6 → 2 → 3 → 11

**2. kör — Komponens-szintű layout javítások:**
1 → 8 → 9 → 10 → 14 → 15

**3. kör — Képernyőspecifikus audit és fix:**
7 → 12 → 13

**Tesztelési minimum:** Chrome DevTools Device Toolbar-ban
iPhone SE (375×667), Galaxy A01 (360×800), és iPhone 12 Pro (390×844) kijelzőkön
minden képernyő landscape + portrait módban.
