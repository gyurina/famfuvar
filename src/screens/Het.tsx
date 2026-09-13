import { useState, useEffect, useRef } from 'react'
import { format, startOfWeek, addDays, isToday } from 'date-fns'
import { hu } from 'date-fns/locale'
import { Header } from '../components/Header'
import { supabase } from '../lib/supabase'
import { useHousehold } from '../hooks/useHousehold'
import { getPref, PREF_HIDE_CANCELLED } from '../lib/prefs'
import type { Occurrence, TransportLeg, ScheduleTemplate, LegDirection } from '../types'
import DirectionBadge from '../components/DirectionBadge'
import { sortLegs } from '../lib/occurrences'
import { useRole } from '../hooks/useRole'
import { OccurrenceOverrideModal } from '../components/OccurrenceOverrideModal'
import { db } from '../lib/db'

type OccWithLegs = Occurrence & { legs: TransportLeg[] }

export function Het() {
  const { isAdmin } = useRole()
  const { householdId, personById, locationById, locations, persons } = useHousehold()
  const [weekOffset, setWeekOffset] = useState(0)
  const [items, setItems] = useState<OccWithLegs[]>([])
  const [loading, setLoading] = useState(true)
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([])
  const [selectedOcc, setSelectedOcc] = useState<Occurrence | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const hideCancelled = getPref(PREF_HIDE_CANCELLED)

  // Drag-and-drop state
  const [dragOccId, setDragOccId] = useState<string | null>(null)
  const [dragOverDate, setDragOverDate] = useState<string | null>(null)
  const dragOccRef = useRef<string | null>(null)

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
      db.occurrences.bulkPut(occs).catch(() => {})
      db.transport_legs.bulkPut(legs).catch(() => {})
    }).catch(async () => {
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

  // Drag handler: move occurrence to new date
  async function handleDrop(targetDate: string) {
    const occId = dragOccRef.current
    setDragOccId(null); setDragOverDate(null); dragOccRef.current = null
    if (!occId) return
    const occ = items.find(o => o.id === occId)
    if (!occ || occ.on_date === targetDate) return

    // Optimistic update
    setItems(prev => prev.map(o =>
      o.id === occId ? { ...o, on_date: targetDate, is_override: true } : o
    ))

    const { error } = await supabase.from('occurrence').update({
      on_date: targetDate,
      is_override: true,
      updated_at: new Date().toISOString(),
    }).eq('id', occId)

    if (error) {
      // Revert on failure
      setReloadKey(k => k + 1)
    }
  }

  // Transfer (körút) map
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
  const isDragging = dragOccId !== null

  return (
    <div style={{ background: 'var(--color-bg)', minHeight: '100dvh' }}>
      <Header
        title="Hét"
        subtitle={`${format(days[0], 'MMM d.', { locale: hu })} – ${format(days[6], 'MMM d.', { locale: hu })}`}
        action={
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="week-nav-btn" onClick={() => setViewMode(m => m === 'list' ? 'grid' : 'list')}
              title={viewMode === 'list' ? 'Rácsnézet' : 'Listanézet'}
              style={{ fontFamily: 'monospace', fontWeight: 700 }}>
              {viewMode === 'list' ? '⊞' : '☰'}
            </button>
            <button className="week-nav-btn" onClick={() => setWeekOffset(o => o - 1)}>◀</button>
            <button className="week-nav-today" onClick={() => setWeekOffset(0)}>Ma</button>
            <button className="week-nav-btn" onClick={() => setWeekOffset(o => o + 1)}>▶</button>
          </div>
        }
      />

      {/* Mini week strip */}
      <div style={{ display: 'flex', padding: '10px 16px 10px', gap: 4, borderBottom: '1px solid var(--color-border)' }}>
        {grouped.map(g => (
          <div key={g.dateStr} style={{ flex: '1 1 0%', minWidth: 0, textAlign: 'center' }}>
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

      {!loading && totalItems === 0 && !isDragging && (
        <div className="empty-state" style={{ marginTop: 32 }}>
          <div className="icon">📅</div>
          <div className="title">Nincs program ezen a héten</div>
          <div className="sub">Futtasd a generate_horizon-t vagy adj hozzá egyszeri eseményt</div>
        </div>
      )}

      {/* ─── GRID VIEW ──────────────────────────────────────────────── */}
      {!loading && viewMode === 'grid' && (
        <div style={{ overflowX: 'auto', paddingBottom: 'calc(var(--nav-height) + 40px)' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 480, fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 11,
                  color: 'var(--color-muted)', fontWeight: 600, background: 'var(--color-surface)',
                  position: 'sticky', left: 0, zIndex: 2, borderBottom: '1px solid var(--color-border)',
                  minWidth: 70 }}>Személy</th>
                {grouped.map(g => (
                  <th key={g.dateStr} style={{
                    padding: '6px 6px', textAlign: 'center', fontSize: 11, fontWeight: 600,
                    background: g.isToday ? 'var(--color-blue)' : 'var(--color-surface)',
                    color: g.isToday ? '#fff' : 'var(--color-muted)',
                    borderBottom: '1px solid var(--color-border)', minWidth: 80, maxWidth: 110,
                  }}>
                    <div>{g.label.slice(0,1).toUpperCase() + g.label.slice(1,4)}</div>
                    <div style={{ fontWeight: 400, opacity: 0.8 }}>{g.dayNum}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {persons.map(person => (
                <tr key={person.id}>
                  <td style={{
                    padding: '6px 8px', position: 'sticky', left: 0, zIndex: 1,
                    background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)',
                    verticalAlign: 'top',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 18, height: 18, borderRadius: '50%', background: person.color,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 8, color: '#fff', fontWeight: 700, flexShrink: 0 }}>
                        {person.display_name[0]}
                      </span>
                      <span style={{ fontWeight: 600, fontSize: 11, color: 'var(--color-text)' }}>
                        {person.display_name.split(' ')[0]}
                      </span>
                    </div>
                  </td>
                  {grouped.map(g => {
                    const personItems = g.items.filter(o => o.person_id === person.id)
                    const isDropTarget = isDragging && dragOverDate === g.dateStr
                    return (
                      <td key={g.dateStr}
                        onDragOver={e => { e.preventDefault(); setDragOverDate(g.dateStr) }}
                        onDragLeave={() => setDragOverDate(null)}
                        onDrop={() => handleDrop(g.dateStr)}
                        style={{
                          padding: '5px 5px', verticalAlign: 'top',
                          background: isDropTarget
                            ? 'rgba(79,156,249,0.12)'
                            : g.isToday ? 'rgba(59,130,246,0.04)' : 'transparent',
                          borderBottom: '1px solid var(--color-border)',
                          borderLeft: `1px solid ${isDropTarget ? 'rgba(79,156,249,0.5)' : 'var(--color-border)'}`,
                          transition: 'background 0.15s',
                        }}>
                        {personItems.map(occ => {
                          const cancelled = occ.status === 'cancelled'
                          const noDriver = occ.legs.some(l => !l.driver_id && !l.self_transport)
                          return (
                            <div key={occ.id}
                              draggable={isAdmin}
                              onDragStart={() => { dragOccRef.current = occ.id; setDragOccId(occ.id) }}
                              onDragEnd={() => { setDragOccId(null); setDragOverDate(null); dragOccRef.current = null }}
                              onClick={() => isAdmin ? setSelectedOcc(occ) : undefined}
                              style={{
                                borderRadius: 5, padding: '3px 5px', marginBottom: 3, fontSize: 10,
                                background: cancelled ? 'rgba(239,68,68,0.08)' : 'var(--color-surface)',
                                border: `1px solid ${cancelled ? 'rgba(239,68,68,0.2)' : (person.color ?? 'var(--color-border)')}`,
                                borderLeft: `3px solid ${person.color ?? 'var(--color-border)'}`,
                                opacity: dragOccId === occ.id ? 0.4 : cancelled ? 0.5 : 1,
                                cursor: isAdmin ? 'grab' : 'default',
                              }}>
                              <div style={{ fontWeight: 600, textDecoration: cancelled ? 'line-through' : 'none',
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 90 }}>
                                {occ.title}
                              </div>
                              <div style={{ color: 'var(--color-muted)', fontVariantNumeric: 'tabular-nums', fontSize: 10 }}>
                                {occ.starts_at.slice(0,5)}
                              </div>
                              {noDriver && !cancelled && (
                                <div style={{ color: 'var(--color-red)', fontWeight: 700, fontSize: 9 }}>⚠ nincs sofőr</div>
                              )}
                            </div>
                          )
                        })}
                        {isDropTarget && (
                          <div style={{
                            height: 30, border: '2px dashed rgba(79,156,249,0.5)',
                            borderRadius: 5, display: 'flex', alignItems: 'center',
                            justifyContent: 'center', fontSize: 10, color: 'var(--color-blue)',
                          }}>ide</div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── LIST VIEW ──────────────────────────────────────────────── */}
      {!loading && viewMode === 'list' && (
        <div style={{ padding: '12px 16px calc(var(--nav-height) + 40px)' }}>
          {grouped.map(g => {
            const isDropTarget = isDragging && dragOverDate === g.dateStr
            const showDay = g.items.length > 0 || isDropTarget
            if (!showDay) return null
            return (
              <div key={g.dateStr} style={{ marginBottom: 28 }}>
                {/* Day header — also a drop zone */}
                <div
                  onDragOver={e => { e.preventDefault(); setDragOverDate(g.dateStr) }}
                  onDragLeave={e => {
                    // Only clear if not entering a child element of this section
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverDate(null)
                  }}
                  onDrop={() => handleDrop(g.dateStr)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
                    padding: isDropTarget ? '6px 8px' : '0',
                    borderRadius: isDropTarget ? 'var(--r-md)' : 0,
                    background: isDropTarget ? 'rgba(79,156,249,0.08)' : 'transparent',
                    border: isDropTarget ? '2px dashed rgba(79,156,249,0.4)' : '2px solid transparent',
                    transition: 'all 0.15s',
                  }}
                >
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
                  {isDropTarget && (
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-blue)', fontWeight: 600 }}>
                      ↓ ide húzva
                    </span>
                  )}
                </div>

                {/* Occurrences */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 8 }}>
                  {g.items.map(occ => {
                    const child    = personById(occ.person_id)
                    const loc      = locationById(occ.location_id)
                    const cancelled = occ.status === 'cancelled'
                    const dropoff  = occ.legs.find(l => l.direction === 'dropoff')
                    const pickup   = occ.legs.find(l => l.direction === 'pickup')

                    return (
                      <div key={occ.id}
                        draggable={isAdmin}
                        onDragStart={() => { dragOccRef.current = occ.id; setDragOccId(occ.id) }}
                        onDragEnd={() => { setDragOccId(null); setDragOverDate(null); dragOccRef.current = null }}
                        style={{
                          borderRadius: 'var(--r-md)', background: 'var(--color-surface)',
                          border: '1px solid var(--color-border)', overflow: 'hidden',
                          opacity: dragOccId === occ.id ? 0.4 : cancelled ? 0.5 : 1,
                          cursor: isAdmin ? 'grab' : 'default',
                          transition: 'opacity 0.15s',
                        }}
                      >
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
                            {occ.custom_location_text ? (
                              <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>📍 {occ.custom_location_text}</div>
                            ) : loc && !loc.is_home && (
                              <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>📍 {loc.name}</div>
                            )}
                            {cancelled && (
                              <div style={{ fontSize: 11, color: 'var(--color-yellow)', marginTop: 3, fontWeight: 600 }}>🚫 ELMARAD</div>
                            )}
                            {occ.note && !cancelled && (
                              <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2, fontStyle: 'italic' }}>{occ.note}</div>
                            )}
                          </div>
                          {isAdmin && (
                            <button
                              onClick={e => { e.stopPropagation(); setSelectedOcc(occ) }}
                              style={{
                                padding: '10px 12px', background: 'none', border: 'none',
                                cursor: 'pointer', color: 'var(--color-muted)',
                                fontSize: 18, lineHeight: 1, alignSelf: 'flex-start',
                              }}
                              title="Módosítás / Lemondás"
                            >⋯</button>
                          )}
                        </div>

                        {/* Transport legs */}
                        {(dropoff || pickup) && !cancelled && (
                          <div style={{
                            borderTop: '1px solid var(--color-border)',
                            padding: '7px 12px',
                            display: 'flex', flexDirection: 'column', gap: 5,
                          }}>
                            {sortLegs(occ.legs).map(leg => {
                              const transfer = transferMap.get(leg.id)
                              return ({ leg, transfer })
                            }).map(({ leg, transfer }) => {
                              const driver   = personById(leg!.driver_id)
                              const noDriver = !leg!.driver_id && !leg!.self_transport
                              return (
                                <div key={leg!.id} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                  <DirectionBadge direction={leg!.direction} size={12} />
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
                                      ⚡ <DirectionBadge direction={transfer.pairedDir as LegDirection} size={11} /> {transfer.pairedOccTitle}
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
            )
          })}

          {/* Drag hint — show days with 0 items as drop targets when dragging */}
          {isDragging && (
            <div style={{ marginTop: 8 }}>
              {grouped.filter(g => g.items.length === 0).map(g => {
                const isDropTarget = dragOverDate === g.dateStr
                return (
                  <div key={g.dateStr}
                    onDragOver={e => { e.preventDefault(); setDragOverDate(g.dateStr) }}
                    onDragLeave={() => setDragOverDate(null)}
                    onDrop={() => handleDrop(g.dateStr)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8,
                      padding: '10px 12px', borderRadius: 'var(--r-md)',
                      border: `2px dashed ${isDropTarget ? 'rgba(79,156,249,0.7)' : 'rgba(79,156,249,0.2)'}`,
                      background: isDropTarget ? 'rgba(79,156,249,0.08)' : 'transparent',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 700,
                      background: g.isToday ? 'var(--color-blue)' : 'var(--color-surface-2)',
                      color: g.isToday ? '#fff' : 'var(--color-muted)',
                    }}>{g.dayNum}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-muted)', textTransform: 'capitalize' }}>{g.label}</div>
                    {isDropTarget && (
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-blue)', fontWeight: 600 }}>↓ ide</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Override modal */}
      {selectedOcc && (
        <OccurrenceOverrideModal
          occ={selectedOcc}
          template={templates.find(t => t.id === selectedOcc.template_id) ?? null}
          locations={locations}
          isAdmin={isAdmin}
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
