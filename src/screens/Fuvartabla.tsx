import { useState, useEffect } from 'react'
import { format, startOfWeek, addDays } from 'date-fns'
import { hu } from 'date-fns/locale'
import { Header } from '../components/Header'
import { supabase } from '../lib/supabase'
import { useHousehold } from '../hooks/useHousehold'
import { useAuth } from '../lib/auth'
import { getPref, PREF_HIDE_CANCELLED } from '../lib/prefs'
import type { TransportLeg, Occurrence, ScheduleTemplate } from '../types'
import { OccurrenceOverrideModal } from '../components/OccurrenceOverrideModal'

type LegRow = TransportLeg & {
  occurrence: Occurrence
  companion_id?:  string | null
  companion2_id?: string | null
}

export function Fuvartabla() {
  const { person } = useAuth()
  const { drivers, householdId, personById, locationById, locations } = useHousehold()
  const [weekOffset, setWeekOffset] = useState(0)
  const [legs, setLegs] = useState<LegRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'mine'>('all')
  const [openLegId, setOpenLegId] = useState<string | null>(null)
  const [pickerStep, setPickerStep] = useState<'driver' | 'companion'>('driver')
  const [pendingDriverId, setPendingDriverId] = useState<string | null>(null)
  const [selectedCompanions, setSelectedCompanions] = useState<string[]>([])
  const [returnAlso, setReturnAlso] = useState(false)
  const [transitAlso, setTransitAlso] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([])
  const [selectedOcc, setSelectedOcc] = useState<Occurrence | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const hideCancelled = getPref(PREF_HIDE_CANCELLED)
  const today     = new Date()
  const weekStart = addDays(startOfWeek(today, { weekStartsOn: 1 }), weekOffset * 7)
  const days      = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  useEffect(() => {
    if (!householdId) return
    const from = days[0].toISOString()
    const to   = days[6].toISOString()
    setLoading(true)
    Promise.all([
      supabase.from('transport_leg').select('*, occurrence!inner(*)')
        .eq('household_id', householdId)
        .gte('depart_at', from).lte('depart_at', to)
        .order('depart_at'),
      supabase.from('schedule_template').select('*')
        .eq('household_id', householdId),
    ]).then(([legRes, tplRes]) => {
      setLegs((legRes.data as any) ?? [])
      setTemplates((tplRes.data ?? []) as ScheduleTemplate[])
      setLoading(false)
    })
  }, [householdId, weekOffset, reloadKey])

  function openLeg(legId: string) {
    if (openLegId === legId) {
      setOpenLegId(null)
    } else {
      setOpenLegId(legId)
      setPickerStep('driver')
      setPendingDriverId(null)
      setSelectedCompanions([])
      setReturnAlso(false)
      setTransitAlso(false)
    }
  }

  function pickDriver(legId: string, driverId: string | null) {
    if (driverId === null) {
      doAssign(legId, null, null, null)
    } else {
      const leg = legs.find(l => l.id === legId)
      const pre: string[] = []
      if (leg?.companion_id  && leg.companion_id  !== driverId) pre.push(leg.companion_id)
      if (leg?.companion2_id && leg.companion2_id !== driverId) pre.push(leg.companion2_id)
      setPendingDriverId(driverId)
      setSelectedCompanions(pre)
      setReturnAlso(false)
      setTransitAlso(false)
      setPickerStep('companion')
    }
  }

  function toggleCompanion(personId: string) {
    setSelectedCompanions(prev => {
      if (prev.includes(personId)) return prev.filter(id => id !== personId)
      if (prev.length >= 2) return prev
      return [...prev, personId]
    })
  }

  /** Same occurrence, opposite direction */
  function pairedLeg(legId: string): LegRow | undefined {
    const leg = legs.find(l => l.id === legId)
    if (!leg) return undefined
    return legs.find(l => l.occurrence_id === leg.occurrence_id && l.direction !== leg.direction)
  }

  /** Different occurrence, same person_id, opposite direction, depart/arrive within 30 min */
  function transitLeg(legId: string): LegRow | undefined {
    const leg = legs.find(l => l.id === legId)
    if (!leg) return undefined
    const personId = leg.occurrence?.person_id
    if (!personId) return undefined
    const legTime = leg.direction === 'pickup'
      ? new Date(leg.arrive_at).getTime()
      : new Date(leg.depart_at).getTime()
    return legs.find(other => {
      if (other.occurrence_id === leg.occurrence_id) return false
      if (other.occurrence?.person_id !== personId) return false
      if (other.direction === leg.direction) return false
      const otherTime = other.direction === 'dropoff'
        ? new Date(other.depart_at).getTime()
        : new Date(other.arrive_at || other.depart_at).getTime()
      return Math.abs(otherTime - legTime) < 30 * 60 * 1000
    })
  }

  /** True if driverId is already assigned to another overlapping leg */
  function hasConflict(driverId: string, currentLeg: LegRow): boolean {
    if (!currentLeg.arrive_at) return false
    return legs.some(l =>
      l.id !== currentLeg.id &&
      l.driver_id === driverId &&
      l.occurrence?.status !== 'cancelled' &&
      l.depart_at < currentLeg.arrive_at &&
      l.arrive_at > currentLeg.depart_at
    )
  }

  async function confirmCompanions(legId: string) {
    const comp1 = selectedCompanions[0] ?? null
    const comp2 = selectedCompanions[1] ?? null
    await doAssign(legId, pendingDriverId, comp1, comp2)

    if (returnAlso) {
      const paired = pairedLeg(legId)
      if (paired) await doAssign(paired.id, pendingDriverId, comp1, comp2, true)
    }
    if (transitAlso) {
      const transit = transitLeg(legId)
      if (transit) await doAssign(transit.id, pendingDriverId, comp1, comp2, true)
    }
  }

  async function doAssign(
    legId: string,
    driverId: string | null,
    comp1: string | null,
    comp2: string | null,
    silent = false,
    selfTransport = false,
  ) {
    if (!silent) setAssigning(true)
    const { data } = await supabase.from('transport_leg')
      .update({ driver_id: driverId, companion_id: comp1, companion2_id: comp2, self_transport: selfTransport })
      .eq('id', legId).select('*, occurrence!inner(*)').single()
    if (data) setLegs(prev => prev.map(l => l.id === legId ? data as any : l))
    // Push értesítés a sofőrnek (fire-and-forget)
    if (driverId && !selfTransport) {
      supabase.functions.invoke('notify-driver', { body: { leg_id: legId } })
        .catch(e => console.warn('notify-driver:', e))
    }
    if (!silent) {
      setOpenLegId(null)
      setPickerStep('driver')
      setPendingDriverId(null)
      setSelectedCompanions([])
      setReturnAlso(false)
      setTransitAlso(false)
      setAssigning(false)
    }
  }

  const myId    = person?.id
  const visLegs = hideCancelled ? legs.filter(l => l.occurrence?.status !== 'cancelled') : legs
  const orphans     = visLegs.filter(l => !l.driver_id && !l.self_transport && l.occurrence?.status !== 'cancelled')
  const allAssigned = visLegs.length > 0 && orphans.length === 0
  const bannerClass = allAssigned ? 'ok' : orphans.length ? 'warn' : 'neutral'

  const seenOccIds = new Set<string>()

  const grouped = days.map(d => {
    let dayLegs = visLegs.filter(l => l.depart_at.startsWith(format(d, 'yyyy-MM-dd')))
    if (filter === 'mine' && myId) {
      dayLegs = dayLegs.filter(l =>
        l.driver_id === myId || l.companion_id === myId || l.companion2_id === myId
      )
    }
    return { date: d, label: format(d, 'EEEE, MMM d.', { locale: hu }), legs: dayLegs }
  })

  function crewLabel(leg: LegRow) {
    return [
      personById(leg.driver_id)?.display_name,
      personById(leg.companion_id)?.display_name,
      personById(leg.companion2_id)?.display_name,
    ].filter(Boolean).join(' + ')
  }

  return (
    <div style={{ background: 'var(--color-bg)', minHeight: '100dvh' }}>
      <Header
        title="Fuvartábla"
        subtitle={`${format(days[0], 'MMM d.', { locale: hu })} – ${format(days[6], 'MMM d.', { locale: hu })}`}
        action={
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="week-nav-btn" onClick={() => setWeekOffset(o => o - 1)}>◀</button>
            <button className="week-nav-today" onClick={() => setWeekOffset(0)}>Ma</button>
            <button className="week-nav-btn" onClick={() => setWeekOffset(o => o + 1)}>▶</button>
          </div>
        }
      />

      <div className={`status-banner ${bannerClass}`} style={{ margin: '12px 16px 0' }}>
        {loading
          ? 'Betöltés…'
          : allAssigned
            ? <><span>✓</span><span>Minden láb ki van osztva</span></>
            : orphans.length > 0
              ? <><span>⚠</span><span>{orphans.length} gazdátlan láb ezen a héten</span></>
              : <span>Nincs fuvar ezen a héten</span>}
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 8, padding: '10px 16px 0' }}>
        {(['all', 'mine'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '5px 14px', borderRadius: 100, fontSize: 12, fontWeight: 600,
            border: `1px solid ${filter === f ? 'var(--color-blue)' : 'var(--color-border)'}`,
            background: filter === f ? 'rgba(79,156,249,0.12)' : 'var(--color-surface)',
            color: filter === f ? 'var(--color-blue)' : 'var(--color-muted)',
            cursor: 'pointer', transition: 'all 0.15s',
          }}>
            {f === 'all' ? 'Összes' : 'Csak én'}
          </button>
        ))}
      </div>

      {!loading && (
        <div style={{ padding: '16px 16px 96px' }}>
          {grouped.every(g => g.legs.length === 0) && (
            <div className="empty-state">
              <div className="icon">📭</div>
              <div className="title">
                {filter === 'mine' ? 'Neked nincs fuvarod ezen a héten' : 'Nincs fuvar ezen a héten'}
              </div>
            </div>
          )}

          {grouped.map(g => g.legs.length > 0 && (
            <div key={g.date.toISOString()} style={{ marginBottom: 24 }}>
              <div className="day-header">{g.label}</div>

              {g.legs.map(leg => {
                const occ      = leg.occurrence
                const driver   = personById(leg.driver_id)
                const child    = personById(occ?.person_id)
                const isOrphan = !leg.driver_id && !leg.self_transport && occ?.status !== 'cancelled'
                const isOpen   = openLegId === leg.id
                const fromLoc  = locationById(leg.from_location)
                const toLoc    = locationById(leg.to_location)
                const stripe   = child?.color ?? 'var(--color-border)'
                const hasPaired  = !!pairedLeg(leg.id)
                const hasTransit = !!transitLeg(leg.id)

                return (
                  <div key={leg.id} style={{ marginBottom: 8 }}>
                    <div
                      className={`leg-card ${isOrphan ? 'orphan' : ''}`}
                      style={{
                        display: 'flex',
                        borderRadius: isOpen ? 'var(--r-md) var(--r-md) 0 0' : undefined,
                        opacity: occ?.status === 'cancelled' ? 0.5 : 1,
                      }}
                    >
                      <div className="leg-card-stripe" style={{ background: stripe }} />
                      <div className="leg-card-body">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                              {format(new Date(leg.depart_at), 'HH:mm')}
                            </span>
                            <span style={{ fontSize: 13 }}>
                              {leg.direction === 'dropoff' ? '→' : '←'} {occ?.title ?? '?'}
                            </span>
                            {child && <span style={{ fontSize: 11, color: child.color, fontWeight: 600 }}>({child.display_name})</span>}
                            {occ?.is_override && occ.status !== 'cancelled' && (
                              <span title="Módosított" style={{ fontSize: 11 }}>✏️</span>
                            )}
                            {(() => {
                              if (!occ || seenOccIds.has(occ.id)) return null
                              seenOccIds.add(occ.id)
                              return (
                                <button
                                  onClick={e => { e.stopPropagation(); setSelectedOcc(occ as Occurrence) }}
                                  style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', fontSize: 16, padding: '0 4px', lineHeight: 1 }}
                                  title="Módosítás / Lemondás"
                                >⋯</button>
                              )
                            })()}
                          </div>
                          {(fromLoc || toLoc) && (
                            <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
                              {fromLoc?.name}{fromLoc && toLoc ? ' → ' : ''}{toLoc?.name}
                            </div>
                          )}
                          {hasTransit && (
                            <div style={{ fontSize: 10, color: 'var(--color-yellow)', marginTop: 2 }}>
                              ⚡ Átszállítás: {(() => { const t = transitLeg(leg.id); return t ? `${format(new Date(t.depart_at),'HH:mm')} ${t.direction==='dropoff'?'→':'←'} ${t.occurrence?.title}` : '' })()}
                            </div>
                          )}
                        </div>

                        <button
                          className={`driver-badge ${isOrphan ? 'orphan' : leg.self_transport ? 'self' : 'assigned'}`}
                          onClick={() => openLeg(leg.id)}
                          disabled={occ?.status === 'cancelled'}
                          style={{ opacity: occ?.status === 'cancelled' ? 0.6 : 1 }}
                        >
                          {!leg.self_transport && driver && <div className="driver-avatar" style={{ background: driver.color }}>{driver.display_name[0]}</div>}
                          <span>{leg.self_transport ? '🚶 Önállóan' : isOrphan ? '? Nincs' : crewLabel(leg)}</span>
                        </button>
                      </div>
                    </div>

                    {/* Picker */}
                    {isOpen && (
                      <div className="picker-panel" style={{ borderRadius: '0 0 var(--r-md) var(--r-md)', border: '1px solid var(--color-border)', borderTop: 'none' }}>
                        {pickerStep === 'driver' ? (
                          <>
                            <div className="picker-label">Ki vezet?</div>

                            {/* Transit banner */}
                            {hasTransit && (() => {
                              const t = transitLeg(leg.id)!
                              return (
                                <div style={{
                                  marginBottom: 10, padding: '7px 10px', borderRadius: 'var(--r-sm)',
                                  background: 'rgba(245,200,66,0.08)', border: '1px solid rgba(245,200,66,0.25)',
                                  fontSize: 11, color: 'var(--color-yellow)',
                                }}>
                                  ⚡ <strong>Átszállítás</strong> — {format(new Date(t.depart_at),'HH:mm')} {t.direction==='dropoff'?'→':'←'} {t.occurrence?.title}.
                                  Ha ugyanaz a sofőr viszi, közvetlenül mehet tovább.
                                </div>
                              )
                            })()}

                            <div className="picker-grid">
                              <button className="picker-btn self-btn" onClick={() => doAssign(leg.id, null, null, null, false, true)} disabled={assigning}>
                                <span style={{ fontSize: 18 }}>🚶</span>
                                <span style={{ fontSize: 11 }}>Önállóan</span>
                              </button>
                              <button className="picker-btn none-btn" onClick={() => pickDriver(leg.id, null)}>
                                <span style={{ color: 'var(--color-red)' }}>⊘</span>
                                Gazdátlan hagyás
                              </button>
                              {drivers.map(d => {
                                const conflict = hasConflict(d.id, leg)
                                return (
                                  <button
                                    key={d.id}
                                    className={`picker-btn ${leg.driver_id === d.id ? 'selected' : ''}`}
                                    onClick={() => pickDriver(leg.id, d.id)}
                                    disabled={assigning}
                                    style={{ border: conflict ? '1px solid rgba(239,68,68,0.35)' : undefined }}
                                  >
                                    <div className="driver-avatar" style={{ background: d.color }}>{d.display_name[0]}</div>
                                    <span style={{ flex: 1 }}>{d.display_name}</span>
                                    {conflict && (
                                      <span style={{
                                        fontSize: 10, fontWeight: 600, color: 'var(--color-red)',
                                        background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
                                        borderRadius: 4, padding: '1px 5px', flexShrink: 0,
                                      }}>⚠ ütközés</span>
                                    )}
                                  </button>
                                )
                              })}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="picker-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <button
                                onClick={() => { setPickerStep('driver'); setPendingDriverId(null); setSelectedCompanions([]); setReturnAlso(false); setTransitAlso(false) }}
                                style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: 18, padding: 0, lineHeight: 1 }}
                              >←</button>
                              Ki megy még?
                              <span style={{ color: 'var(--color-muted-2)', fontWeight: 500, textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>
                                (max 2 · {personById(pendingDriverId)?.display_name} vezet)
                              </span>
                            </div>

                            <div className="picker-grid">
                              {drivers.filter(d => d.id !== pendingDriverId).map(d => {
                                const sel   = selectedCompanions.includes(d.id)
                                const maxed = !sel && selectedCompanions.length >= 2
                                return (
                                  <button key={d.id} className={`picker-btn ${sel ? 'selected' : ''}`}
                                    onClick={() => toggleCompanion(d.id)} disabled={assigning || maxed}
                                    style={{ opacity: maxed ? 0.4 : 1 }}>
                                    <div className="driver-avatar" style={{ background: d.color }}>{d.display_name[0]}</div>
                                    {d.display_name}
                                    {sel && <span style={{ marginLeft: 'auto', color: 'var(--color-blue)', fontSize: 14 }}>✓</span>}
                                  </button>
                                )
                              })}
                            </div>

                            {/* Visszahozza is? */}
                            {hasPaired && (
                              <button onClick={() => setReturnAlso(r => !r)} style={{
                                display: 'flex', alignItems: 'center', gap: 10, width: '100%', marginTop: 10,
                                padding: '9px 12px', borderRadius: 'var(--r-sm)',
                                background: returnAlso ? 'rgba(45,216,138,0.08)' : 'var(--color-surface-2)',
                                border: `1px solid ${returnAlso ? 'rgba(45,216,138,0.3)' : 'var(--color-border)'}`,
                                color: returnAlso ? 'var(--color-green)' : 'var(--color-muted)',
                                cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'all 0.15s',
                              }}>
                                <span style={{
                                  width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                                  background: returnAlso ? 'var(--color-green)' : 'var(--color-border)',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontSize: 11, color: returnAlso ? '#000' : 'transparent', transition: 'all 0.15s',
                                }}>✓</span>
                                Visszahozza is — ugyanez a csapat
                              </button>
                            )}

                            {/* Átszállítást is ez a csapat vigye */}
                            {hasTransit && (() => {
                              const t = transitLeg(leg.id)!
                              return (
                                <button onClick={() => setTransitAlso(v => !v)} style={{
                                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', marginTop: 8,
                                  padding: '9px 12px', borderRadius: 'var(--r-sm)',
                                  background: transitAlso ? 'rgba(245,200,66,0.08)' : 'var(--color-surface-2)',
                                  border: `1px solid ${transitAlso ? 'rgba(245,200,66,0.3)' : 'var(--color-border)'}`,
                                  color: transitAlso ? 'var(--color-yellow)' : 'var(--color-muted)',
                                  cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'all 0.15s',
                                }}>
                                  <span style={{
                                    width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                                    background: transitAlso ? 'var(--color-yellow)' : 'var(--color-border)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 11, color: transitAlso ? '#000' : 'transparent', transition: 'all 0.15s',
                                  }}>✓</span>
                                  ⚡ Az átszállítást is ő vigye
                                  <span style={{ fontSize: 10, color: 'var(--color-muted)', fontWeight: 400, marginLeft: 2 }}>
                                    ({format(new Date(t.depart_at),'HH:mm')} {t.direction==='dropoff'?'→':'←'} {t.occurrence?.title})
                                  </span>
                                </button>
                              )
                            })()}

                            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                              <button className="picker-btn none-btn" onClick={() => confirmCompanions(leg.id)} disabled={assigning} style={{
                                flex: 1, justifyContent: 'center',
                                background: 'rgba(79,156,249,0.12)', color: 'var(--color-blue)',
                                border: '1px solid rgba(79,156,249,0.3)', fontWeight: 600,
                              }}>
                                {assigning
                                  ? 'Mentés…'
                                  : selectedCompanions.length === 0
                                    ? 'Egyedül megy ✓'
                                    : `Kész (${1 + selectedCompanions.length} fő) ✓`}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
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
