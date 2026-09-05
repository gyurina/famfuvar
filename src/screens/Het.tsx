import { useState, useEffect } from 'react'
import { format, startOfWeek, addDays, isSameDay } from 'date-fns'
import { hu } from 'date-fns/locale'
import { Header } from '../components/Header'
import { supabase } from '../lib/supabase'
import { useHousehold } from '../hooks/useHousehold'
import type { Occurrence, ExternalEvent } from '../types'

const WEEKDAY_NAMES = ['H', 'K', 'Sz', 'Cs', 'P', 'Sz', 'V']

function parseTime(t: string) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

const DAY_START = 7 * 60   // 07:00
const DAY_END   = 20 * 60  // 20:00
const TOTAL     = DAY_END - DAY_START

export function Het() {
  const { persons, children, householdId, locationById } = useHousehold()
  const [weekOffset, setWeekOffset] = useState(0)
  const [occurrences, setOccurrences] = useState<Occurrence[]>([])
  const [extEvents, setExtEvents] = useState<ExternalEvent[]>([])
  const [loading, setLoading] = useState(true)

  const today = new Date()
  const weekStart = addDays(startOfWeek(today, { weekStartsOn: 1 }), weekOffset * 7)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  useEffect(() => {
    if (!householdId) return
    const from = format(days[0], 'yyyy-MM-dd')
    const to   = format(days[6], 'yyyy-MM-dd')
    setLoading(true)

    Promise.all([
      supabase.from('occurrence').select('*')
        .eq('household_id', householdId)
        .gte('on_date', from).lte('on_date', to),
      supabase.from('external_event').select('*, external_calendar!inner(person_id, household_id, is_active, affects_driving)')
        .gte('starts_at', days[0].toISOString())
        .lte('ends_at', days[6].toISOString()),
    ]).then(([occ, ext]) => {
      setOccurrences(occ.data ?? [])
      setExtEvents(ext.data ?? [])
      setLoading(false)
    })
  }, [householdId, weekOffset])

  function occurrencesForPersonDay(personId: string, date: Date) {
    return occurrences.filter(o =>
      o.person_id === personId &&
      o.on_date === format(date, 'yyyy-MM-dd') &&
      o.status !== 'cancelled'
    )
  }

  function pct(minutes: number) {
    return ((minutes - DAY_START) / TOTAL) * 100
  }
  function width(start: string, end: string) {
    return ((parseTime(end) - parseTime(start)) / TOTAL) * 100
  }

  return (
    <div style={{ background: 'var(--color-bg)', minHeight: '100dvh' }}>
      <Header
        title="Hét"
        subtitle={`${format(days[0], 'MMM d', { locale: hu })} – ${format(days[6], 'MMM d', { locale: hu })}`}
        action={
          <div className="flex gap-1">
            <button onClick={() => setWeekOffset(o => o - 1)}
              className="px-2 py-1 rounded-lg text-sm hover:bg-slate-700" style={{ minHeight: 36 }}>◀</button>
            <button onClick={() => setWeekOffset(0)}
              className="px-2 py-1 rounded-lg text-xs hover:bg-slate-700" style={{ minHeight: 36 }}>Ma</button>
            <button onClick={() => setWeekOffset(o => o + 1)}
              className="px-2 py-1 rounded-lg text-sm hover:bg-slate-700" style={{ minHeight: 36 }}>▶</button>
          </div>
        }
      />

      {/* Nap fejlécek */}
      <div className="flex px-2 pt-2 pb-1 gap-1" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ width: 48 }} />
        {days.map((d, i) => (
          <div key={i} className="flex-1 text-center">
            <div className="text-xs" style={{ color: 'var(--color-muted)' }}>{WEEKDAY_NAMES[i]}</div>
            <div className={`text-sm font-medium rounded-full w-7 h-7 flex items-center justify-center mx-auto ${isSameDay(d, today) ? 'bg-blue-500 text-white' : ''}`}>
              {format(d, 'd')}
            </div>
          </div>
        ))}
      </div>

      {loading && (
        <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-muted)' }}>
          Betöltés…
        </div>
      )}

      {!loading && (
        <div className="px-2 pt-3 space-y-4">
          {/* Gyereksávok */}
          {children.map(child => (
            <div key={child.id}>
              <div className="text-xs font-medium px-1 mb-1 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: child.color }} />
                {child.display_name}
              </div>
              <div className="flex gap-1">
                <div style={{ width: 48 }}>
                  {/* időjelölő */}
                  <div className="text-xs text-right pr-1" style={{ color: 'var(--color-muted)', paddingTop: 8 }}>7</div>
                </div>
                {days.map((_d, di) => { const d = _d
                  const occs = occurrencesForPersonDay(child.id, d)
                  return (
                    <div key={di} className="flex-1 relative rounded" style={{ height: 56, background: 'var(--color-surface)' }}>
                      {occs.map(o => {
                        const left = pct(parseTime(o.starts_at))
                        const w = width(o.starts_at, o.ends_at)
                        const loc = locationById(o.location_id)
                        return (
                          <div key={o.id}
                            title={`${o.title}${loc ? ' · ' + loc.name : ''}`}
                            className="absolute top-0 bottom-0 rounded text-xs flex items-center justify-center overflow-hidden"
                            style={{
                              left: `${left}%`, width: `${Math.max(w, 10)}%`,
                              background: child.color + '55',
                              borderLeft: `2px solid ${child.color}`,
                              fontSize: 9,
                              color: child.color,
                            }}
                          >
                            <span className="truncate px-0.5">{o.title}</span>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {/* Felnőtt elfoglaltság sávok */}
          {persons.filter(p => p.can_drive).map(driver => (
            <div key={driver.id}>
              <div className="text-xs px-1 mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-muted)' }}>
                <span className="text-xs">🚗</span>
                {driver.display_name}
              </div>
              <div className="flex gap-1">
                <div style={{ width: 48 }} />
                {days.map((_d, di) => {
                  const events = extEvents.filter((e: any) => {
                    const ec = e.external_calendar
                    return ec?.person_id === driver.id && ec?.is_active
                  })
                  return (
                    <div key={di} className="flex-1 relative rounded" style={{ height: 24, background: 'var(--color-surface)', opacity: 0.7 }}>
                      {events.map((ev: any) => (
                        <div key={ev.id} className="absolute top-0 bottom-0 bg-red-800 rounded opacity-50"
                          style={{ left: '10%', width: '30%' }}
                          title={ev.title ?? 'Foglalt'} />
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {occurrences.length === 0 && !loading && (
            <div className="text-center py-8" style={{ color: 'var(--color-muted)' }}>
              <div className="text-3xl mb-2">📅</div>
              <p className="text-sm">Nincs generált program erre a hétre</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
