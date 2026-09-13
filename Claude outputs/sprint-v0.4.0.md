# 🚀 famcal v0.4.0 — Sprint terv

> **Szabály:** minden sprint végén `npm run version:minor` → commit → `git push origin main`

---

## Vizsgálati megállapítások (előző sprint vége)

### A) Sablon.tsx — Ismétlődő programok
**Állapot: ✅ alapvetően kész, de hiányos a csoportos kezelés**

A Sablon képernyő teljes CRUD-dal rendelkezik:
- Új sablon hozzáadása (person, cím, nap, idő, helyszín, odavitel/visszahozás, érvényesség)
- Szerkesztés, törlés (inline megerősítéssel)
- „▶ Generálj" gomb: `generate_horizon()` RPC → 30 nap occurrence + transport_leg sorok

**Hiányosság:** a `schedule_template` tábla csak `person_id`-t tárol (egyetlen gyerek). Ha két gyereket ugyanoda viszünk, két külön sablonsort kell létrehozni. Nincs `group_id` a sablonban → a generált `transport_leg` sorok sosem kapcsolódnak össze.

---

### B) TravelGroup / Rendszeres összevonások
**Állapot: ❌ DB megvan, UI nincs**

Meglevő infra a DB-ben:
- `travel_group (id, household_id, name, is_default)` — initial_schema.sql
- `travel_group_member (group_id, person_id)` — initial_schema.sql
- `transport_leg.group_id → travel_group` — initial_schema.sql
- `trips (id, household_id)` + `transport_leg.trip_id` — trips.sql (20260906000008)

A `trips` tábla az „egyszeri körút-összevonás" (egy sofőr egyszerre veszi fel/viszi mindkét gyereket egy menetben). A `travel_group` + `travel_group_member` a „rendszeres csoport" (pl. „Reggeli fuvar: Péter + Anna").

**Teljes UI hiány:** nincs képernyő travel group kezelésre, nincs group_id hozzárendelés se a Sablonban, se a Fuvartáblán.

---

### C) TBD helyszín flag
**Állapot: ❌ DB + badge megvan, Beállítások UI nincs**

- `20260912000002_tbd_location.sql`: `is_tbd boolean default false` létezik
- Fuvartabla.tsx: `📍?` badge megjelenik ha `location.is_tbd`
- **Beállítások → Helyszínek**: nincs `is_tbd` checkbox a létrehozás/szerkesztés űrlapon
- Jelenleg TBD helyszínt csak közvetlenül a DB-ben lehet beállítani

---

## Sprint v0.4.0 feladatai

### Feladat 1 — TBD helyszín UI (egyszerű, 30 perc)

**Fájl:** `src/screens/Beallitasok.tsx`

A helyszín létrehozás/szerkesztés form-ba add hozzá:

```tsx
// A meglévő 'Otthon' toggle mellé / alá:
<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
  <input type="checkbox" id="is_tbd" checked={locForm.is_tbd ?? false}
    onChange={e => setLocForm(f => ({...f, is_tbd: e.target.checked}))} />
  <label htmlFor="is_tbd" style={{ fontSize: 13, color: 'var(--color-text)' }}>
    📍? TBD helyszín <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>(a fuvarlapon kérdőjeles badge jelenik meg)</span>
  </label>
</div>
```

A `locForm` state-hez add `is_tbd: boolean` mezőt. Az insert/update payload-ba `is_tbd: locForm.is_tbd ?? false`.

---

### Feladat 2 — Rendszeres összevonások UI (közepes, 2-3 óra)

#### 2a. Új DB migráció: nincs szükség — táblák léteznek

A `travel_group` és `travel_group_member` már az initial_schema-ban van. ✅

#### 2b. Beállítások → új „Csoportok" tab

**Tab neve:** `'csoportok'`  
**Tab ikon:** 👥

UI viselkedés:
- Lista a meglévő csoportokról (kártya: csoport neve, tagok chip-jei)
- `+ Új csoport` gomb → bottom sheet: névmező + személyek multi-select (checkbox-os lista az összes `persons`-ból)
- Törlés gombbal (inline confirm)
- Mentés: `travel_group` insert → tag `person_id`-k insert `travel_group_member`-be
- Szerkesztés: meglévő group betöltés, tagok módosítás

```typescript
// Supabase lekérés:
const { data } = await supabase
  .from('travel_group')
  .select('*, travel_group_member(person_id)')
  .eq('household_id', householdId)
```

#### 2c. Sablon → group_id mező (opcionális)

**FIGYELJ:** a `schedule_template` táblában nincs `group_id` oszlop. Két lehetőség:

**Opció A (könnyebb):** Sablon marad single-person, de `generate_horizon()` után a Fuvartáblán egy új „Összekapcsol" funkció van, amivel manuálisan lehet trip-be vonni két leg-et.

**Opció B (teljesebb):** Migration: `alter table schedule_template add column group_id uuid references travel_group(id)`. A form-ban opcionálisan kiválasztható csoport (akkor `person_id` null / group összes tagja kap occurrence-t). A `generate_horizon()` PG-függvényt is frissíteni kell.

👉 **Javasolt: Opció A az v0.4.0-ban, Opció B v0.5.0-ra halasztva.**

#### 2d. Fuvartabla → „Körútba von" funkció (Trips)

A meglévő `trips` tábla + `transport_leg.trip_id` alapján:

- Fuvartabla leg-kártyán: long-press vagy „⋮" menu → „Körútba von"
- Multi-select módba lép: a felhasználó kijelöl 2-4 leg-et
- „Összekapcsol" gomb: `trips` insert → a kijelölt leg-ek `trip_id`-jét frissíti
- Csoportosított megjelenítés: azonos `trip_id`-vel rendelkező leg-ek egy összevont kártyában jelennek meg (sofőr egyszerre látja a teljes körútját)

---

### Feladat 3 — Push kézbesítés mérése (nagyobb, 4-5 óra)

#### 3a. DB migráció

```sql
-- push_log: minden küldési esemény
create table push_log (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references household(id) on delete cascade,
  sent_by       uuid references person(id),
  title         text not null,
  body          text not null,
  sent_at       timestamptz not null default now(),
  target_count  int not null default 0,
  sent_count    int not null default 0,
  failed_count  int not null default 0
);

-- push_log_receipt: eszközönkénti visszajelzés
create table push_log_receipt (
  id          uuid primary key default gen_random_uuid(),
  log_id      uuid not null references push_log(id) on delete cascade,
  person_id   uuid references person(id),
  event       text not null check (event in ('delivered', 'clicked', 'dismissed')),
  received_at timestamptz not null default now(),
  user_agent  text
);

alter table push_log enable row level security;
alter table push_log_receipt enable row level security;
-- RLS: household tagok olvashatnak, service role ír
```

#### 3b. notify-custom Edge Function módosítás

A jelenlegi `notify-custom/index.ts`-be:
1. Küldés előtt: `push_log` insert (title, body, target_count) → kapott `log_id`
2. A VAPID payload-ba injektálni: `{ log_id, ...existing_data }`
3. Küldés után: `push_log` update (sent_count, failed_count)

#### 3c. Új Edge Function: `push-receipt`

```typescript
// supabase/functions/push-receipt/index.ts
// POST { log_id, event: 'delivered'|'clicked', user_agent }
// → insert push_log_receipt
// Auth: JWT token a push payload-ból (vagy anon + log_id alapján)
```

#### 3d. Service Worker módosítás (`public/sw.js`)

```javascript
// push eseménynél (delivered):
self.addEventListener('push', event => {
  const data = event.data?.json() ?? {}
  if (data.log_id) {
    fetch('/functions/v1/push-receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_id: data.log_id, event: 'delivered', user_agent: navigator.userAgent })
    }).catch(() => {}) // best-effort
  }
  // ... existing notification show logic
})

// notificationclick eseménynél (clicked):
self.addEventListener('notificationclick', event => {
  const { log_id } = event.notification.data ?? {}
  if (log_id) {
    fetch('/functions/v1/push-receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_id, event: 'clicked' })
    }).catch(() => {})
  }
  // ... existing click logic
})
```

#### 3e. Beállítások → 📣 Üzenet tab: „Előzmények" szekció

Az üzenet küldő panel alá:

```tsx
{/* Előzmények */}
<div className="section-label" style={{ marginTop: 24 }}>Előzmények</div>
{pushLogs.map(log => (
  <div key={log.id} className="leg-card" style={{ marginBottom: 8 }}>
    <div className="leg-card-body">
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>{log.title}</div>
        <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>
          {format(new Date(log.sent_at), 'MM.dd HH:mm')} · 
          ✉️ {log.sent_count} küldve · 
          📬 {log.delivered_count ?? '?'} megérkezett · 
          👆 {log.clicked_count ?? '?'} megnyitva
        </div>
      </div>
    </div>
  </div>
))}
```

A `delivered_count` és `clicked_count` Supabase view-val vagy `count()` aggregációval az `push_log_receipt`-ből.

---

## Commit stratégia

```
feat: TBD helyszín checkbox Beállítások helyszín-formban
feat: Csoportok tab Beállítások – travel_group CRUD
feat: Körútba von – Fuvartabla trip összevonás
feat: push_log + push_log_receipt migráció
feat: push-receipt Edge Function
feat: Service Worker delivered/clicked callback
feat: Push előzmények szekció Beállítások 📣 tab
chore: bump to v0.4.0
```

---

## Amit a felhasználónak kell futtatnia a sprint után

```powershell
npm run build          # TypeScript ellenőrzés
supabase db push       # push_log + push_log_receipt migráció
supabase functions deploy push-receipt
supabase functions deploy notify-custom   # frissített verzió
npm run version:minor  # v0.4.0 → package.json
git add -A && git commit -m "feat: v0.4.0 — push mérés, TBD UI, csoportok"
git push origin main
```

---

## Következő sprint (v0.5.0) jelöltek

- Sablon → group_id support + generate_horizon frissítés (Opció B)
- Google Calendar / ICS szinkron (`external_calendar` tábla már megvan)
- Occurrence drag-and-drop áthelyezés a Het nézeten
- Break periods UI (migration már megvan: `20260912000003_break_periods.sql`)
