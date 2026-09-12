# Push értesítés — állapotjelentés és robusztusítási terv

> famcal v0.6.3 · 2026-09-12

---

## 1. Küldési tesztek összefoglalója

| Üzenet  | Idő   | Cél | Küldve | Megérkezett | Megnyitva | Megjegyzés |
|---------|-------|-----|--------|-------------|-----------|------------|
| Próba   | 20:51 | 2   | 2/2    | 0           | 0         | Felhasználó ténylegesen megnyitotta |
| teszt   | 21:02 | 2   | 2/2    | 0           | 0         | Cache API fix deployálva (hatástalan) |
| HELLOKA | 21:13 | 2   | 1/2    | 0           | 0         | 1 lejárt sub törölve (410 Gone) ✓ |
| asasas  | 21:18 | 3   | 2/3    | 0           | 0         | Új sub regisztrálva, payload-URL fix nem éles |

**Összesítve: 4 teszt, 0 visszaigazolt kézbesítés — a küldés működik, a visszajelzési csatorna nem.**

---

## 2. Gyökérokok

### #1 — postMessage nem éri el a háttér SW-t ✅ javítva
Az eredeti kód `self.__SUPABASE_URL__`-t postMessage-gel kapta az app-tól. Push háttérben érkezik → URL = `undefined` → fetch el sem indul.  
**Fix:** `notify-custom` a VAPID payloadba sütötte a `supabase_url`-t.

### #2 — Cache API: időzítési függőség ✅ felülírva
`caches.open('app-config')` csak akkor tartalmaz URL-t, ha az új build után a user újra subscribált. Régi SW + régi sub → üres cache → silent fail.  
**Fix:** Payload-os megoldás feleslegessé tette.

### #3 — Lejárt push subscription nem törlődött ✅ javítva
410 Gone → endpoint érvénytelen, de DB-ben maradt → minden küldésnél visszatérő `1 hiba`.  
**Fix:** `notify-custom` 410/404-re `push_subscription.delete()`-et hív.

### #4 — push-receipt Edge Function valószínűleg nincs deployolva ⚠ blokkoló
SW POST-ja `push-receipt`-re megy. Ha nincs deploy, 404-et kap; `catch(() => {})` elnyeli → silent fail.  
**Fix:** `supabase functions deploy push-receipt`

### #5 — Régi service worker még aktív ⚠ ellenőrizni
`skipWaiting()` benne van, de tab-bezárás / reload szükséges az aktiváláshoz.  
**Fix:** DevTools → Application → Service Workers → Update

---

## 3. Jelenlegi architektúra (v0.6.3)

```
notify-custom → push_log INSERT (logId)
             → VAPID payload: { title, body, log_id, supabase_url, url: '/?inbox=1' }
             → POST → eszköz endpoint
             → 410/404 → push_subscription DELETE
             → push_log UPDATE { sent_count, failed_count }

sw.js push:           data.supabase_url → reportPushReceipt(log_id, 'delivered')
sw.js click:  notification.data.supabase_url → reportPushReceipt(log_id, 'clicked')
              → clients.openWindow('/?inbox=1')

push-receipt → push_log_receipt INSERT (service_role, RLS bypass)
```

---

## 4. Deploy teendők (egyszeri)

```powershell
git push origin main
supabase db push                           # push_log + push_log_receipt táblák
supabase functions deploy push-receipt     # ← kritikus
supabase functions deploy notify-custom    # supabase_url payloadban
npm run build                              # új sw.js
# DevTools → Application → Service Workers → Update → reload
```

---

## 5. Robusztusítási javaslatok (jövőbeli sprint)

### 5a. Server-side delivered flag (SW-független)
A push szerver 201-es ACK-ja jelzi, hogy az üzenet megérkezett az eszközhöz. Megbízhatóbb, mint a SW callback.
```sql
alter table push_log add column server_ack_count int not null default 0;
-- notify-custom: res.status === 201 → server_ack_count++
```

### 5b. Retry exponential backoff-fal (429 kezelés)
```typescript
async function sendWithRetry(endpoint, body, headers, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(endpoint, { method: 'POST', headers, body })
    if (res.ok || res.status === 410 || res.status === 404) return res
    if (res.status === 429 && i < attempts - 1) {
      await new Promise(r => setTimeout(r, 1000 * (i + 1)))
      continue
    }
    return res
  }
}
```

### 5c. SW receipt: hiba logolása (ne nyeld el csendben)
```javascript
} catch (e) {
  console.error('[SW] push-receipt fetch failed:', e)
}
```

### 5d. Subscription health check (hetente)
Hetente egyszer egy Edge Function pingeli az összes sub-ot (TTL=0), 410-eseket törli. Nem kell várni a következő küldésig.

---

## 6. Automatizált tesztelhetőség

### push-receipt közvetlenül tesztelhető curl-lel
```bash
curl -X POST https://<project>.supabase.co/functions/v1/push-receipt \
  -H "Content-Type: application/json" \
  -d '{"log_id":"<valós-push-log-id>","event":"delivered","user_agent":"test"}'
# Elvárt: {"ok":true}
# Ha 404: function nincs deployolva
# Ha 500: push_log_receipt tábla hiányzik (supabase db push)
```

### Küldés utáni DB query
```sql
select l.title, l.sent_at, l.sent_count, l.failed_count,
       count(r.*) filter (where r.event = 'delivered') as delivered,
       count(r.*) filter (where r.event = 'clicked')   as clicked
from push_log l
left join push_log_receipt r on r.log_id = l.id
order by l.sent_at desc
limit 5;
```

### SW verzió konstans (DevTools-ban ellenőrizhető)
```javascript
// sw.js tetején:
const SW_VERSION = '0.6.3'
self.addEventListener('activate', () => console.log(`[SW] v${SW_VERSION} aktív`))
```

---

## 7. Státusz táblázat

| Komponens | Állapot | Teendő |
|---|---|---|
| VAPID küldés | ✅ működik | — |
| push_log rögzítés | ✅ működik | — |
| Lejárt sub auto-törlés | ✅ működik | — |
| push-receipt function kód | ✅ kész | deploy! |
| SW receipt callback | ✅ kód kész | deploy + SW update |
| push_log_receipt tábla | ⚠ migration | supabase db push |
| delivered/clicked számlálás | ❌ 0 | fentiek után tesztelendő |
| push inbox UI (🔔) | ✅ kész | v0.5.0 |

---

*A rendszer elvben teljes és helyes. A 0-ás számok valószínűleg deploy-hiányból adódnak, nem logikai hibából. A curl teszt és a DB query az élesítés után azonnal megmondja, melyik lépésnél akad el.*
