import { useState, useEffect } from 'react'
import { format, startOfWeek, addDays, isToday } from 'date-fns'
import { hu } from 'date-fns/locale'
import { Header } from '../components/Header'
import { supabase } from '../lib/supabase'
import { useHousehold } from '../hooks/useHousehold'
import { getPref, PREF_HIDE_CANCELLED } from '../lib/prefs'
import type { Occurrence, TransportLeg, ScheduleTemplate } from '../types'
import { OccurrenceOverrideModal } from '../components/OccurrenceOverrideModal'
import { db } from '../lib/db'

type OccWithLegs = Occurrence & { legs: TransportLeg[] }

export function Het() {
  const { householdId, personById, locationById, locations } = useHousehold()
  const [weekOffset, setWeekOffset] = useState(0)
  const [items, setItems] = useState<OccWithLegs[]>([])
  const [loading, setLoading] = useState(true)
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([])
  const [selectedOcc, setSelectedOcc] = useState<Occurrence | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const hideCancelled = getPref(PREF_HIDE_CANCELLED)

  const today     = new Date()
  const weekStart = addDays(startOfWeek(today, { weekStartsOn: 1 }), weekOffset * 7)
  const days      = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  useEffect(() => {
    if (!householdId) return
    const from = format(days[0], 'yyyy-MM-dd')
    const to   = format(addDays(days[6], 1), 'yyyy-MM-dd')
    setLoading(true)

    Promise.all([
      supabase.from('occurrence').select('*')
        .eq('household_id', householdId)
        .gte('on_date', from).lte('on_date', to)
        .order('on_date').order('starts_at'),
      supabase.from('transport_leg').select('*')
        .eq('household_id', householdId)
        .gte('depart_at', days[0].toISOString())
        .lte('depart_at', addDays(days[6], 1).toISOString())
        .order('depart_at'),
      supabase.from('schedule_template').select('*')
        .eq('household_id', householdId),
    ]).then(([occRes, legRes, tplRes]) => {
      const occs = (occRes.data ?? []) as Occurrence[]
      const legs = (legRes.data ?? []) as TransportLeg[]
      setItems(occs.map(o => ({ ...o, legs: legs.filter(l => l.occurrence_id === o.id) })))
      setTemplates((tplRes.data ?? []) as ScheduleTemplate[])
      setLoading(false)
      // Cache for offline use
      db.occurrences.bulkPut(occs).catch(() => {})
      db.transport_legs.bulkPut(legs).catch(() => {})
    }).catch(async () => {
      // Supabase hiba / offline → Dexie fallback
      try {
        const cachedOccs = await db.occurrences
          .where('on_date').between(from, to, true, true)
          .filter(o => o.household_id === householdId)
          .toArray()
        const occIds = cachedOccs.map(o => o.id)
        const cachedLegs = occIds.length
          ? await db.transport_legs.where('occurrence_id').anyOf(occIds).toArray()
          : []
        setItems(cachedOccs.map(o => ({ ...o, legs: cachedLegs.filter(l => l.occurrence_id === o.id) })))
      } catch { /* ignore */ }
      setLoading(false)
    })
  }, [householdId, weekOffset, reloadKey])

  // Build transfer map: legId → { pairedLegId, pairedOccTitle, pairedDirection }
  const transferMap = new Map<string, { pairedLegId: string; pairedOccTitle: string; pairedDir: string }>()
  const allLegsWithPerson = items.flatMap(o =>
    o.legs.map(l => ({ ...l, personId: o.person_id, occTitle: o.title }))
  )
  for (const leg of allLegsWithPerson) {
    if (transferMap.has(leg.id)) continue
    const legTime = leg.direction === 'pickup'
      ? new Date(leg.arrive_at).getTime()
      : new Date(leg.depart_at).getTime()
    const paired = allLegsWithPerson.find(other => {
      if (other.id === leg.id) return false
      if (other.occurrence_id === leg.occurrence_id) return false
      if (other.personId !== leg.personId) return false
      if (other.direction === leg.direction) return false
      const otherTime = other.direction === 'dropoff'
        ? new Date(other.depart_at).getTime()
        : new Date(other.arrive_at).getTime()
      return Math.abs(otherTime - legTime) < 30 * 60 * 1000
    })
    if (paired) {
      transferMap.set(leg.id, { pairedLegId: paired.id, pairedOccTitle: paired.occTitle, pairedDir: paired.direction })
      transferMap.set(paired.id, { pairedLegId: leg.id, pairedOccTitle: leg.occTitle, pairedDir: leg.direction })
    }
  }

  const grouped = days.map(d => {
    const dateStr = format(d, 'yyyy-MM-dd')
    let dayItems  = items.filter(o => o.on_date === dateStr)
    if (hideCancelled) dayItems = dayItems.filter(o => o.status !== 'cancelled')
    return { date: d, dateStr, isToday: isToday(d), label: format(d, 'EEEE', { locale: hu }), dayNum: format(d, 'd'), items: dayItems }
  })

  const totalItems = grouped.reduce((s, g) => s + g.items.length, 0)

  return (
    <div style={{ background: 'var(--color-bg)', minHeight: '100dvh' }}>
      <Header
        title="Hét"
        subtitle={`${format(days[0], 'MMM d.', { locale: hu })} – ${format(days[6], 'MMM d.', { locale: hu })}`}
        action={
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="week-nav-btn" onClick={() => setWeekOffset(o => o - 1)}>◀</button>
            <button className="week-nav-today" onClick={() => setWeekOffset(0)}>Ma</button>
            <button className="week-nav-btn" onClick={() => setWeekOffset(o => o + 1)}>▶</button>
          </div>
        }
      />

      {/* Mini week strip */}
      <div style={{ display: 'flex', padding: '10px 16px 10px', gap: 4, borderBottom: '1px solid var(--color-border)' }}>
        {grouped.map(g => (
          <div key={g.dateStr} style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'var(--color-muted)', marginBottom: 3 }}>
              {g.label.slice(0, 1).toUpperCase()}
            </div>
            <div style={{
              width: 26, height: 26, borderRadius: '50%', margin: '0 auto',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: g.isToday ? 700 : 400,
              background: g.isToday ? 'var(--color-blue)' : 'transparent',
              color: g.isToday ? '#fff' : g.items.length > 0 ? 'var(--color-text)' : 'var(--color-muted)',
            }}>
              {g.dayNum}
            </div>
            {g.items.length > 0 && (
              <div style={{ width: 4, height: 4, borderRadius: '50%', margin: '3px auto 0', background: g.isToday ? 'var(--color-blue)' : 'var(--color-muted)' }} />
            )}
          </div>
        ))}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--color-muted)', fontSize: 13 }}>Betöltés…</div>
      )}

      {!loading && totalItems === 0 && (
        <div className="empty-state" style={{ marginTop: 32 }}>
          <div className="icon">📅</div>
          <div className="title">Nincs program ezen a héten</div>
          <div className="sub">Futtasd a generate_horizon-t vagy adj hozzá egyszeri eseményt</div>
        </div>
      )}

      {!loading && totalItems > 0 && (
        <div style={{ padding: '12px 16px 96px' }}>
          {grouped.map(g => g.items.length > 0 && (
            <div key={g.dateStr} style={{ marginBottom: 28 }}>
              {/* Day header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700,
                  background: g.isToday ? 'var(--color-blue)' : 'var(--color-surface-2)',
                  color: g.isToday ? '#fff' : 'var(--color-text)',
                }}>
                  {g.dayNum}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, textTransform: 'capitalize' }}>{g.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>{format(g.date, 'MMMM d.', { locale: hu })}</div>
                </div>
              </div>

              {/* Occurrences */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 8 }}>
                {g.items.map(occ => {
                  const child    = personById(occ.person_id)
                  const loc      = locationById(occ.location_id)
                  const cancelled = occ.status === 'cancelled'
                  const dropoff  = occ.legs.find(l => l.direction === 'dropoff')
                  const pickup   = occ.legs.find(l => l.direction === 'pickup')

                  // Check if any leg has a transfer pair
                  const dropoffTransfer = dropoff ? transferMap.get(dropoff.id) : undefined
                  const pickupTransfer  = pickup  ? transferMap.get(pickup.id)  : undefined

                  return (
                    <div key={occ.id} style={{
                      borderRadius: 'var(--r-md)', background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)', overflow: 'hidden',
                      opacity: cancelled ? 0.5 : 1,
                    }}>
                      {/* Occurrence header */}
                      <div style={{ display: 'flex', alignItems: 'stretch', borderLeft: `3px solid ${child?.color ?? 'var(--color-border)'}` }}>
                        <div style={{ padding: '10px 12px', flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-muted)' }}>
                              {occ.starts_at.slice(0, 5)}–{occ.ends_at.slice(0, 5)}
                            </span>
                            <span style={{ fontSize: 14, fontWeight: 600, textDecoration: cancelled ? 'line-through' : 'none' }}>
                              {occ.title}
                            </span>
                            {child && (
                              <span style={{ fontSize: 11, color: child.color, fontWeight: 600 }}>{child.display_name}</span>
                            )}
                            {occ.is_override && !cancelled && (
                              <span title="Manuálisan módosított" style={{ fontSize: 11, color: 'var(--color-yellow)' }}>✏️</span>
                            )}
                          </div>
                          {loc && !loc.is_home && (
                            <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>📍 {loc.name}</div>
                          )}
                          {cancelled && (
                            <div style={{ fontSize: 11, color: 'var(--color-yellow)', marginTop: 3, fontWeight: 600 }}>🚫 ELMARAD</div>
                          )}
                          {occ.note && !cancelled && (
                            <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2, fontStyle: 'italic' }}>{occ.note}</div>
                          )}
                        </div>
                        {/* ••• gomb */}
                        <button
                          onClick={() => setSelectedOcc(occ)}
                          style={{
                            padding: '10px 12px', background: 'none', border: 'none',
                            cursor: 'pointer', color: 'var(--color-muted)',
                            fontSize: 18, lineHeight: 1, alignSelf: 'flex-start',
                          }}
                          title="Módosítás / Lemondás"
                        >⋯</button>
                      </div>

                      {/* Transport legs */}
                      {(dropoff || pickup) && !cancelled && (
                        <div style={{
                          borderTop: '1px solid var(--color-border)',
                          padding: '7px 12px',
                          display: 'flex', flexDirection: 'column', gap: 5,
                        }}>
                          {[
                            dropoff ? { leg: dropoff, transfer: dropoffTransfer } : null,
                            pickup  ? { leg: pickup,  transfer: pickupTransfer  } : null,
                          ].filter((x): x is NonNullable<typeof x> => x !== null).map(({ leg, transfer }) => {
                            const driver   = personById(leg!.driver_id)
                            const noDriver = !leg!.driver_id && !leg!.self_transport
                            return (
                              <div key={leg!.id} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <span style={{ color: 'var(--color-muted)', fontSize: 11 }}>
                                  {leg!.direction === 'dropoff' ? '→' : '←'}
                                </span>
                                {noDriver ? (
                                  <span style={{
                                    color: 'var(--color-red)', fontWeight: 600, fontSize: 11,
                                    background: 'rgba(242,107,107,0.1)', padding: '2px 7px',
                                    borderRadius: 100, border: '1px solid rgba(242,107,107,0.25)',
                                  }}>? Nincs vezető</span>
                                ) : (
                                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-muted-2)' }}>
                                    <span style={{
                                      width: 14, height: 14, borderRadius: '50%', background: driver?.color,
                                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                      fontSize: 7, color: '#fff', fontWeight: 700, flexShrink: 0,
                                    }}>{driver?.display_name[0]}</span>
                                    {driver?.display_name}
                                  </span>
                                )}
                                {transfer && (
                                  <span style={{
                                    fontSize: 10, fontWeight: 600,
                                    color: 'var(--color-yellow)',
                                    background: 'rgba(245,200,66,0.1)',
                                    border: '1px solid rgba(245,200,66,0.25)',
                                    borderRadius: 4, padding: '1px 6px', flexShrink: 0,
                                  }}>
                                    ⚡ {transfer.pairedDir === 'dropoff' ? '→' : '←'} {transfer.pairedOccTitle}
                                  </span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Override modal */}
      {selectedOcc && (
        <OccurrenceOverrideModal
          occ={selectedOcc}
          template={templates.find(t => t.id === selectedOcc.template_id) ?? null}
          locations={locations}
          onClose={() => setSelectedOcc(null)}
          onDone={() => {
            setSelectedOcc(null)
            setReloadKey(k => k + 1)
          }}
        />
      )}
    </div>
  )
}
