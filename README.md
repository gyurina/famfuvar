# Családi Fuvarszervező PWA

React 19 + Vite + TypeScript alapú progresszív webalkalmazás, Supabase backenddel.

## Technológiai stack

- **React 19** + Vite + TypeScript
- **Supabase** — adatbázis (Postgres), auth, RLS
- **Dexie** — IndexedDB offline cache
- **React Router DOM** — 5 oldal (Ma, Fuvartábla, Hét, Sablon, Beállítások)
- **PWA** — telepíthető mobilra/asztalra

---

## Helyi fejlesztés

### Előfeltételek

- Node.js 18+ (`node -v`)
- npm 9+ (`npm -v`)

### Telepítés és indítás

```bash
# Függőségek telepítése
npm install

# Fejlesztői szerver indítása (http://localhost:5173)
npm run dev

# Produkciós build
npm run build

# Build előnézete (http://localhost:4173)
npm run preview
```

### Környezeti változók

Hozz létre egy `.env.local` fájlt a projekt gyökerében:

```env
VITE_SUPABASE_URL=https://<projektid>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-kulcs>
```

Az értékeket a [Supabase Dashboard](https://supabase.com/dashboard) → Project Settings → API oldalon találod.

> ⚠️ A `.env.local` fájlt **soha ne commitold** git-be — az `.gitignore` már tartalmazza.

---

## Ingyenes hosztolás

Az alkalmazás frontendhez **statikus hosztolás** kell (a backend a Supabase). Az alábbi platformok mindegyike ingyenes személyes használatra.

---

### ✅ 1. Vercel (ajánlott)

**Miért?** Automatikus deploy GitHub-ról, PWA-barát, SPA routing natívan támogatott, 0 konfiguráció.

1. Hozz létre fiókot: [vercel.com](https://vercel.com) (GitHub-fiókkal belép)
2. „Add New Project" → importáld a `famcal` repót
3. **Build beállítások** (automatikusan felismeri, de ellenőrizd):
   - Framework: `Vite`
   - Build Command: `npm run build`
   - Output Directory: `dist`
4. **Environment Variables** — add hozzá:
   - `VITE_SUPABASE_URL` = a te Supabase URL-ed
   - `VITE_SUPABASE_ANON_KEY` = a te anon kulcsod
5. „Deploy" → kész, kapsz egy `*.vercel.app` URL-t

**Limitek (ingyenes tier):**
- 100 GB sávszélesség/hó
- Korlátlan deploy
- Egyéni domain is köthető hozzá

---

### 2. Netlify

1. Fiók: [netlify.com](https://netlify.com)
2. „Add new site" → „Import an existing project" → GitHub
3. **Build settings:**
   - Build command: `npm run build`
   - Publish directory: `dist`
4. **Environment variables** → add hozzá a Supabase értékeket
5. Deploy

> **SPA routing:** Hozz létre egy `public/_redirects` fájlt ezzel a tartalommal:
> ```
> /*    /index.html    200
> ```

---

### 3. Cloudflare Pages

1. Fiók: [pages.cloudflare.com](https://pages.cloudflare.com)
2. „Create a project" → GitHub
3. Build command: `npm run build`, output: `dist`
4. Environment variables → Supabase értékek
5. Deploy

> **SPA routing:** Hozz létre egy `public/_redirects` fájlt (ugyanaz mint Netlify-nál).

---

## Supabase beállítás (új telepítésnél)

Ha valaki nulláról állítja fel a projektet:

1. Hozz létre egy új projektet a [Supabase Dashboardon](https://supabase.com/dashboard)
2. Futtasd le a migrációkat sorban:
   ```
   supabase/migrations/20260905000001_initial_schema.sql
   supabase/migrations/20260905000002_rls_and_views.sql
   supabase/migrations/20260905000003_generate_horizon.sql
   ```
3. Futtasd a seed scriptet a household, személyek, helyszínek és sablonok feltöltéséhez
4. Kösd össze az auth user UUID-okat a `person` táblával
5. Futtasd a `generate_horizon()` függvényt az első 14 nap occurrence-jeinek generálásához

---

## PWA telepítés (mobilra)

Az alkalmazás telepíthető okostelefonra böngészőből:

- **Android (Chrome):** „Hozzáadás a kezdőképernyőhöz" a böngésző menüjéből
- **iOS (Safari):** Megosztás ikon → „Hozzáadás a főképernyőhöz"
- **Asztali Chrome/Edge:** Telepítés ikon az URL-sávban
