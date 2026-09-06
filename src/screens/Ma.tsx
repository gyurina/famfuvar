import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { hu } from 'date-fns/locale'
import { Header } from '../components/Header'
import { supabase } from '../lib/supabase'
import { useHousehold } from '../hooks/useHousehold'
import { useAuth } from '../lib/auth'
import type { TransportLeg, Occurrence } from '../types'

type LegWithOcc = TransportLeg & { occurrence: Occurrence; companion_id?: string | null }

export function Ma() {
  const { person } = useAuth()
  const { personById, locationById, householdId } = useHousehold()
  const [allLegs, setAllLegs] = useState<LegWithOcc[]>([])
  const [loading, setLoading] = useState(true)

  const today        = format(new Date(), 'yyyy-MM-dd')
  const todayDisplay = format(new Date(), 'EEEE, MMMM d.', { locale: hu })

  useEffect(() => {
    if (!householdId || !person) return
    const from = `${today}T00:00:00.000Z`
    const to   = `${today}T23:59:59.999Z`

    supabase.from('transport_leg').select('*, occurrence!inner(*)')
      .eq('household_id', householdId)
      .gte('depart_at', from).lte('depart_at', to)
      .order('depart_at')
      .then(({ data }) => {
        setAllLegs((data as LegWithOcc[]) ?? [])
        setLoading(false)
      })
  }, [householdId, person?.id])

  // Derived state — all computed from a single source of truth
  const myLegs     = allLegs.filter(l =>
    l.driver_id === person?.id || l.companion_id === person?.id
  )
  const otherLegs  = allLegs.filter(l =>
    l.driver_id &&
    l.driver_id !== person?.id &&
    l.companion_id !== person?.id
  )
  const orphanLegs = allLegs.filter(l =>
    !l.driver_id && l.occurrence?.status !== 'cancelled'
  )
  const hasIssue   = orphanLegs.length > 0

  return (
    <div style={{ background: 'var(--color-bg)', minHeight: '100dvh' }}>
      <Header title="Ma" subtitle={todayDisplay} />

      {/* Status */}
      <div className={`status-banner ${hasIssue ? 'warn' : 'ok'}`} style={{ margin: '12px 16px 0' }}>
        {hasIssue
          ? <><span>⚠</span><span>{orphanLegs.length} gazdátlan láb ma</span></>
          : <><span>✓</span><span>Naptár naprakész · {format(new Date(), 'HH:mm')}</span></>}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--color-muted)', fontSize: 13 }}>
          Betöltés…
        </div>
      )}

      {!loading && (
        <div style={{ padding: '20px 16px 96px' }}>

          {/* ── Saját napod ── */}
          <div className="section-label">A te napod</div>

          {myLegs.length === 0 ? (
            <div className="card" style={{
              padding: '24px 16px', textAlign: 'center',
              color: 'var(--color-muted)', fontSize: 13, marginBottom: 24
            }}>
              Ma nincsenek fuvaraid 🙌
            </div>
          ) : (
            <div className="timeline" style={{ marginBottom: 28 }}>
              {myLegs.map((leg, i) => {
                const occ       = leg.occurrence
                const cancelled = occ.status === 'cancelled'
                const child     = personById(occ.person_id)
                const fromLoc   = locationById(leg.from_location)
                const toLoc     = locationById(leg.to_location)
                const companion = personById(leg.companion_id)
                const isDriver  = leg.driver_id === person?.id
                const stripeColor = child?.color ?? 'var(--color-blue)'

                let gapMins = 0
                if (i > 0) {
                  const prevArrive = new Date(myLegs[i - 1].arrive_at)
                  const thisDepart = new Date(leg.depart_at)
                  gapMins = Math.round((thisDepart.getTime() - prevArrive.getTime()) / 60000)
                }

                return (
                  <div key={leg.id} className="timeline-item">
                    {i > 0 && (
                      <div className="timeline-gap">
                        <div className="timeline-gap-line" />
                        <div
                          className="timeline-gap-label"
                          style={{
                            background: gapMins < 20 ? 'rgba(245,200,66,0.12)' : 'var(--color-surface)',
                            color: gapMins < 20 ? 'var(--color-yellow)' : 'var(--color-muted)',
                            border: `1px solid ${gapMins < 20 ? 'rgba(245,200,66,0.3)' : 'var(--color-border)'}`,
                          }}
                        >
                          {gapMins} perc{gapMins < 20 ? ' — szűkös!' : ''}
                        </div>
                        <div className="timeline-gap-line" />
                      </div>
                    )}

                    <div
                      className="timeline-node"
                      style={{
                        background: cancelled ? 'var(--color-surface-2)' : stripeColor,
                        top: i > 0 ? 50 : 14,
                        color: '#fff', fontSize: 9,
                      }}
                    >
                      {leg.direction === 'dropoff' ? '→' : '←'}
                    </div>

                    <div
                      className="leg-card"
                      style={{
                        opacity: cancelled ? 0.5 : 1,
                        border: `1px solid ${!leg.driver_id ? '#5c1a1a' : 'var(--color-border)'}`,
                      }}
                    >
                      <div style={{ padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 17, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                                {format(new Date(leg.depart_at), 'HH:mm')}
                              </span>
                              <span style={{ fontSize: 13, textDecoration: cancelled ? 'line-through' : 'none' }}>
                                {occ.title}
                              </span>
                              {child && (
                                <span style={{ fontSize: 11, color: child.color, fontWeight: 600 }}>
                                  ({child.display_name})
                                </span>
                              )}
                            </div>
                            {(fromLoc || toLoc) && (
                              <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 3 }}>
                                {fromLoc?.name}{fromLoc && toLoc ? ' → ' : ''}{toLoc?.name}
                              </div>
                            )}
                            {cancelled && (
                              <div style={{ fontSize: 11, color: 'var(--color-yellow)', marginTop: 4, fontWeight: 600 }}>
                                ELMARAD
                              </div>
                            )}
                          </div>
                          {!cancelled && (
                            <div style={{
                              display: 'flex', alignItems: 'center', gap: 5,
                              padding: '5px 11px', borderRadius: 100, flexShrink: 0,
                              fontSize: 11, fontWeight: 600,
                              background: isDriver ? 'rgba(79,156,249,0.12)' : 'rgba(45,216,138,0.1)',
                              color: isDriver ? 'var(--color-blue)' : 'var(--color-green)',
                              border: `1px solid ${isDriver ? 'rgba(79,156,249,0.25)' : 'rgba(45,216,138,0.2)'}`,
                            }}>
                              {isDriver ? '🚗' : '👥'}
                              <span>
                                {isDriver ? 'Vezetek' : 'Jövök'}
                                {companion && isDriver && ` + ${companion.display_name}`}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ── A többiek ma ── */}
          {otherLegs.length > 0 && (
            <>
              <div className="section-label" style={{ marginTop: 4 }}>A többiek ma</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {otherLegs.map(leg => {
                  const occ       = leg.occurrence
                  const driver    = personById(leg.driver_id)
                  const companion = personById(leg.companion_id)
                  const child     = personById(occ.person_id)
                  return (
                    <div key={leg.id} className="leg-card" style={{ display: 'flex', opacity: occ.status === 'cancelled' ? 0.5 : 1 }}>
                      <div className="leg-card-stripe" style={{ background: child?.color ?? 'var(--color-border)' }} />
                      <div className="leg-card-body">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13 }}>
                            <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                              {format(new Date(leg.depart_at), 'HH:mm')}
                            </span>
                            {' '}{leg.direction === 'dropoff' ? '→' : '←'} {occ.title}
                            {child && <span style={{ fontSize: 11, color: child.color, marginLeft: 4 }}>({child.display_name})</span>}
                          </div>
                        </div>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 5,
                          padding: '5px 10px', borderRadius: 100, flexShrink: 0,
                          fontSize: 11, fontWeight: 600,
                          background: 'rgba(79,156,249,0.1)', color: 'var(--color-blue)',
                          border: '1px solid rgba(79,156,249,0.2)',
                        }}>
                          {driver && (
                            <div className="driver-avatar" style={{ background: driver.color, width: 16, height: 16, fontSize: 8 }}>
                              {driver.display_name[0]}
                            </div>
                          )}
                          {driver?.display_name ?? '?'}
                          {companion && ` + ${companion.display_name}`}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* ── Gazdátlan fuvarak ── */}
          {orphanLegs.length > 0 && (
            <>
              <div className="section-label" style={{ marginTop: 12, color: 'var(--color-red)' }}>
                Gazdátlan fuvarak
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {orphanLegs.map(leg => {
                  const occ   = leg.occurrence
                  const child = personById(occ.person_id)
                  return (
                    <div key={leg.id} className="leg-card orphan" style={{ display: 'flex' }}>
                      <div className="leg-card-stripe" style={{ background: child?.color ?? 'var(--color-red)' }} />
                      <div className="leg-card-body">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13 }}>
                            <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                              {format(new Date(leg.depart_at), 'HH:mm')}
                            </span>
                            {' '}{leg.direction === 'dropoff' ? '→' : '←'} {occ.title}
                            {child && <span style={{ fontSize: 11, color: child.color, marginLeft: 4 }}>({child.display_name})</span>}
                          </div>
                        </div>
                        <div style={{
                          padding: '5px 10px', borderRadius: 100, flexShrink: 0,
                          fontSize: 11, fontWeight: 600,
                          background: 'rgba(239,68,68,0.1)', color: 'var(--color-red)',
                          border: '1px solid rgba(239,68,68,0.25)',
                        }}>
                          ? Nincs sofőr
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {allLegs.length === 0 && (
            <div className="empty-state" style={{ marginTop: 16 }}>
              <div className="icon">🌟</div>
              <div className="title">Ma nincs fuvar</div>
              <div className="sub">Szabad nap!</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
