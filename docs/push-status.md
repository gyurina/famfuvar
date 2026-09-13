# Push értesítés — állapotjelentés és robusztusítási terv

> famcal v0.9.1 · 2026-09-13 · branch `fix/push-receipt`

---

## 1. Küldési tesztek összefoglalója (2026-09-12)

| Üzenet  | Idő   | Cél | Küldve | Megérkezett | Megnyitva | Megjegyzés |
|---------|-------|-----|--------|-------------|-----------|------------|
| Próba   | 20:51 | 2   | 2/2    | 0           | 0         | Felhasználó ténylegesen megnyitotta |
| teszt   | 21:02 | 2   | 2/2    | 0           | 0         | Cache API fix deployálva (hatástalan) |
| HELLOKA | 21:13 | 2   | 1/2    | 0           | 0         | 1 lejárt sub törölve (410 Gone) ✓ |
| asasas  | 21:18 | 3   | 2/3    | 0           | 0         | Új sub regisztrálva, payload-URL fix nem éles |

**Akkor: 4 teszt, 0 visszaigazolt kézbesítés — a küldés működött, a visszajelzési csatorna nem.**

---

## 2. Gyökérokok

### #1 — postMessage nem éri el a háttér SW-t ✅ javítva
Az eredeti kód `self.__SUPABASE_URL__`-t postMessage-gel kapta az app-tól. Push háttérben érkezik → URL = `undefined` → fetch el sem indul.
**Fix:** `notify-custom` / `notify-driver` a VAPID payloadba sütötte a `supabase_url`-t.

### #2 — Cache API: időzítési függőség ✅ felülírva
`caches.open('app-config')` csak akkor tartalmaz URL-t, ha az új build után a user újra subscribált.
**Fix:** Payload-os megoldás feleslegessé tette.

### #3 — Lejárt push subscription nem törlődött ✅ javítva
410 Gone → endpoint érvénytelen, de DB-ben maradt.
**Fix:** `notify-custom` és `notify-driver` 410/404-re `push_subscription.delete()`-et hív.

### #4 — push-receipt nincs deployolva ❌ téves gyanú
2026-09-13 éles probe: `OPTIONS /functions/v1/push-receipt` → 204, `x-served-by: supabase-edge-runtime`. A tábla is létezik (dummy UUID → FK `push_log_receipt_log_id_fkey`).

### #5 — Régi service worker ⚠ továbbra is ellenőrizni
`skipWaiting()` + `SW_VERSION` a DevTools konzolban: `[SW] v0.9.1 aktív`.

### #6 — SW POST auth nélkül → 401 ✅ ez volt a blokkoló (2026-09-13)
A Service Worker `reportPushReceipt` **nem küldött** `Authorization` / `apikey` headert. A gateway JWT-t vár:

`UNAUTHORIZED_NO_AUTH_HEADER` → 401, a function el sem indul. A SW `catch` elnyelte.

A háttér-SW-nek nincs user sessionje, ezért:

1. **Réteg 1:** `push-receipt` `verify_jwt = false` (`supabase/config.toml` + deploy `--no-verify-jwt`) — a már kint lévő SW azonnal tud receiptet írni.
2. **Réteg 2:** a payloadban megy a publikus `apikey`, az SW `Authorization: Bearer` + `apikey` headert küld, hogy a JWT később visszatehető legyen.

Hamis receipthez ismert `log_id` UUID kell (FK a `push_log`-ra).

---

## 3. Jelenlegi architektúra (v0.9.1)

```
notify-custom / notify-driver
  → push_log INSERT (logId)
  → VAPID payload: { title, body, log_id, supabase_url, apikey, url }
  → POST (429 retry, max 3) → eszköz endpoint
  → 410/404 → push_subscription DELETE
  → push_log UPDATE { sent_count, failed_count }

sw.js push:  data.supabase_url + apikey → reportPushReceipt(log_id, 'delivered')
sw.js click: notification.data → reportPushReceipt(log_id, 'clicked')
             → clients.openWindow(url)

push-receipt (verify_jwt = false)
  → push_log_receipt INSERT (service_role)
  → ismeretlen log_id → 404 (nem 500 FK)
```

`sent_count` = a push-szerver 2xx ACK-ja (FCM jellemzően 201). Ez **nem** user-visible delivered; azt a SW receipt méri.

---

## 4. Deploy teendők

```powershell
# a fix/push-receipt worktree-ből:
supabase functions deploy push-receipt --no-verify-jwt
supabase functions deploy notify-custom
supabase functions deploy notify-driver
# frontend (új sw.js) a következő Vercel deploy-nál
```

Elfogadás: auth nélküli POST dummy UUID-ra **ne 401 legyen**, hanem 404 `unknown log_id`.

```powershell
curl -X POST https://<project>.supabase.co/functions/v1/push-receipt `
  -H "Content-Type: application/json" `
  -d '{"log_id":"00000000-0000-0000-0000-000000000000","event":"delivered","user_agent":"test"}'
# Elvárt: 404 {"error":"unknown log_id"}
# 401 = JWT még mindig be van kapcsolva
```

---

## 5. Robusztusítási javaslatok

### 5a. Server-side delivered flag — nem kell
A `sent_count` már a push-szerver ACK. Nem egyenlő a user-visible delivereddel.

### 5b. Retry 429-re ✅ kész
`supabase/functions/_shared/pushSend.ts` — max 3 próba, 1s / 2s várakozás.

### 5c. SW receipt hiba logolása ✅ kész
`console.error('[SW] push-receipt …')` HTTP és network hibára.

### 5d. Subscription health check (hetente) — később
Hetente TTL=0 ping, 410-esek törlése. Nem ebben a sprintben.

---

## 6. Automatizált tesztelhetőség

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

### SW verzió
DevTools → Application → Service Workers, konzol: `[SW] v0.9.1 aktív`

---

## 7. Státusz táblázat

| Komponens | Állapot | Teendő |
|---|---|---|
| VAPID küldés | működik | — |
| push_log rögzítés | működik | — |
| Lejárt sub auto-törlés | működik (custom + driver) | — |
| push-receipt function | deployolva | `verify_jwt = false` |
| SW receipt callback | apikey + error log | frontend deploy + SW update |
| push_log_receipt tábla | létezik | — |
| delivered/clicked számlálás | a 401 volt a ok | éles próba a JWT-off után |
| push inbox UI | kész | v0.5.0 |

---

*A 0-ás számok oka a gateway 401 volt, nem a hiányzó deploy. JWT-off + SW apikey után a curl és a fenti SQL megmondja, hogy a receipt-csatorna él.*
