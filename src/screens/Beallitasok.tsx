import { useState, useEffect } from 'react'
import { Header } from '../components/Header'
import { supabase } from '../lib/supabase'
import { useHousehold } from '../hooks/useHousehold'
import { useAuth } from '../lib/auth'
import type { ExternalCalendar } from '../types'
import { format } from 'date-fns'

const WEEKDAYS = ['Hétfő','Kedd','Szerda','Csütörtök','Péntek','Szombat','Vasárnap']
type Tab = 'helyszin' | 'utido' | 'elerheto' | 'naptarak'

export function Beallitasok() {
  const { signOut } = useAuth()
  const { persons, drivers, locations, travelTimes, availabilities, householdId } = useHousehold()
  const [tab, setTab] = useState<Tab>('helyszin')
  const [extCals, setExtCals] = useState<ExternalCalendar[]>([])

  useEffect(() => {
    if (!householdId) return
    supabase.from('external_calendar').select('*').eq('household_id', householdId).then(({ data }) => {
      setExtCals(data ?? [])
    })
  }, [householdId])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'helyszin', label: 'Helyszínek' },
    { key: 'utido',    label: 'Útidő' },
    { key: 'elerheto', label: 'Elérhetőség' },
    { key: 'naptarak', label: 'Naptárak' },
  ]

  return (
    <div style={{ background: 'var(--color-bg)', minHeight: '100dvh' }}>
      <Header title="Beállítások" />

      {/* Belső tab sor */}
      <div className="flex gap-1 px-4 py-3 overflow-x-auto"
           style={{ borderBottom: '1px solid var(--color-border)' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{
              minHeight: 36,
              background: tab === t.key ? 'var(--color-blue)' : 'var(--color-surface)',
              color: tab === t.key ? '#fff' : 'var(--color-muted)',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="px-4 pt-4 pb-20">

        {/* ── Helyszínek ───────────────────────────────── */}
        {tab === 'helyszin' && (
          <div className="space-y-3">
            <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
              Ezek az utazási idő mátrix alapjai. Az "otthon" jelölés kötelező a fuvarszámításhoz.
            </p>
            {locations.map(loc => (
              <div key={loc.id} className="rounded-xl px-4 py-3"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <div className="flex items-center gap-2">
                  {loc.is_home && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#1e3a5f', color: '#93c5fd' }}>Otthon</span>}
                  <span className="text-sm font-medium">{loc.name}</span>
                </div>
                {loc.address && <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{loc.address}</div>}
              </div>
            ))}
            {locations.length === 0 && (
              <p className="text-sm text-center py-8" style={{ color: 'var(--color-muted)' }}>
                Még nincs helyszín felvéve.
              </p>
            )}
            <p className="text-xs pt-2" style={{ color: 'var(--color-border)' }}>
              Helyszíneket a Supabase Studio-ban vagy az onboarding folyamán vehetsz fel.
            </p>
          </div>
        )}

        {/* ── Útidő mátrix ─────────────────────────────── */}
        {tab === 'utido' && (
          <div>
            <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
              Kézzel felvett menetidők (percben). Csak a ténylegesen használt párokat kell megadni.
            </p>
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                    <th className="text-left px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>Honnan</th>
                    <th className="text-left px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>Hová</th>
                    <th className="text-right px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>Perc</th>
                  </tr>
                </thead>
                <tbody>
                  {travelTimes.map(tt => {
                    const from = locations.find(l => l.id === tt.from_location)
                    const to   = locations.find(l => l.id === tt.to_location)
                    return (
                      <tr key={`${tt.from_location}-${tt.to_location}`}
                        style={{ borderTop: '1px solid var(--color-border)' }}>
                        <td className="px-3 py-2.5">{from?.name ?? '?'}</td>
                        <td className="px-3 py-2.5">{to?.name ?? '?'}</td>
                        <td className="px-3 py-2.5 text-right font-medium">{tt.minutes}</td>
                      </tr>
                    )
                  })}
                  {travelTimes.length === 0 && (
                    <tr><td colSpan={3} className="px-3 py-6 text-center text-xs" style={{ color: 'var(--color-muted)' }}>
                      Még nincs menetidő megadva.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Elérhetőség ──────────────────────────────── */}
        {tab === 'elerheto' && (
          <div className="space-y-4">
            <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
              Mikor tud egyáltalán vezeni az adott sofőr. Ez csak figyelmeztető — nem tiltja a beosztást.
            </p>
            {drivers.map(driver => {
              const avails = availabilities.filter(a => a.person_id === driver.id)
              return (
                <div key={driver.id} className="rounded-xl px-4 py-3"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <div className="text-sm font-medium mb-2">{driver.display_name}</div>
                  {WEEKDAYS.map((d, i) => {
                    const slots = avails.filter(a => a.weekday === i + 1)
                    return (
                      <div key={i} className="flex items-center gap-2 py-1">
                        <span className="text-xs w-16" style={{ color: 'var(--color-muted)' }}>{d.slice(0,4)}</span>
                        {slots.length === 0
                          ? <span className="text-xs" style={{ color: 'var(--color-border)' }}>Nem megadott</span>
                          : slots.map(s => (
                              <span key={s.id} className="text-xs px-2 py-0.5 rounded"
                                style={{ background: '#14532d', color: '#4ade80' }}>
                                {s.from_time.slice(0,5)}–{s.to_time.slice(0,5)}
                              </span>
                            ))
                        }
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}

        {/* ── Naptárak ─────────────────────────────────── */}
        {tab === 'naptarak' && (
          <div className="space-y-3">
            <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
              A kiírási naptár és a behúzott külső naptárak. A Last synced mutatja, mikor frissítettük utoljára.
            </p>
            {extCals.map(cal => {
              const owner = persons.find(p => p.id === cal.person_id)
              return (
                <div key={cal.id} className="rounded-xl px-4 py-3"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: cal.color }} />
                      <div>
                        <div className="text-sm font-medium">{cal.display_name}</div>
                        <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
                          {owner?.display_name ?? '—'} · {cal.visibility === 'busy_only' ? 'Csak foglalt' : 'Teljes'} ·
                          {cal.affects_driving ? ' Ütközésvizsgálat' : ' Csak megjelenítés'}
                        </div>
                      </div>
                    </div>
                    <span className={`w-2 h-2 rounded-full ${cal.is_active ? 'bg-green-400' : 'bg-slate-600'}`} />
                  </div>
                  {cal.last_synced_at && (
                    <div className="text-xs mt-1.5" style={{ color: 'var(--color-muted)' }}>
                      Utoljára szinkronizálva: {format(new Date(cal.last_synced_at), 'MMM d, HH:mm')}
                    </div>
                  )}
                </div>
              )
            })}
            {extCals.length === 0 && (
              <p className="text-sm text-center py-8" style={{ color: 'var(--color-muted)' }}>
                Nincs behúzott naptár.
              </p>
            )}
          </div>
        )}

        {/* Kijelentkezés */}
        <div className="mt-8 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
          <button onClick={signOut}
            className="w-full rounded-xl py-3 text-sm font-medium hover:bg-red-950 transition-colors"
            style={{ border: '1px solid #7f1d1d', color: '#fca5a5', minHeight: 44 }}>
            Kijelentkezés
          </button>
        </div>
      </div>
    </div>
  )
}
