import { useState, useEffect } from 'react'
import { Header } from '../components/Header'
import { supabase } from '../lib/supabase'
import { useHousehold } from '../hooks/useHousehold'
import { useAuth } from '../lib/auth'
import { useRole } from '../hooks/useRole'
import { useAssignDriver, type AssignmentPatch } from '../hooks/useAssignDriver'
import type { Occurrence } from '../types'
import { BreakSheet } from '../components/BreakSheet'
import { NewEventSheet } from '../components/NewEventSheet'
import { ProgramSheet } from '../components/ProgramSheet'
import { RideCard } from '../components/RideCard'
import { copy } from '../copy'
import { formatDayLong, formatTime, directionWord } from '../lib/format'
import { rideWriteToast } from '../lib/assignmentToast'
import { useToast } from '../components/Toast'
import { useMidnightRefresh } from '../hooks/useMidnightRefresh'
import {
  blocksForRide,
  companionIdsOf,
  nextCompanions,
  rideState,
  type RideRow,
} from '../lib/rideUi'
import { Icon } from '../components/Icon'
import { Avatar } from '../components/Avatar'
import { Pill } from '../components/Pill'

type LegWithOcc = RideRow & { occurrence: Occurrence }

export function Ma() {
  const { person } = useAuth()
  const { canAssignOthers, canSelfAssign, canEditOccurrence, canReleaseOwn } = useRole()
  const { personById, locationById, householdId, persons, drivers, children, locations, home } = useHousehold()
  const { show } = useToast()
  const today = useMidnightRefresh()
  const [showBreak,    setShowBreak]    = useState(false)
  const [breakPersonId,setBreakPersonId]= useState<string | undefined>(undefined)
  const [showNew,      setShowNew]      = useState(false)
  const [selectedOcc,  setSelectedOcc]  = useState<Occurrence | null>(null)
  const [reloadKey,    setReloadKey]    = useState(0)
  const [allLegs, setAllLegs] = useState<LegWithOcc[]>([])
  const [loading, setLoading] = useState(true)
  const [pinnedOpenIds, setPinnedOpenIds] = useState<Set<string>>(new Set())

  const todayDisplay = formatDayLong(today)
  const householdNames = persons.map(p => p.display_name)

  function applyPatch(patch: AssignmentPatch) {
    setAllLegs(prev => prev.map(l => l.id === patch.id ? { ...l, ...patch } : l))
    setPinnedOpenIds(prev => new Set(prev).add(patch.id))
  }
  const { assign, release, claim } = useAssignDriver(applyPatch)

  function toastRide(leg: LegWithOcc, nextDriverId: string | null, self = false) {
    const prev = {
      driver_id: leg.driver_id,
      companions: companionIdsOf(leg).filter(id => id !== leg.driver_id),
      self: leg.self_transport,
    }
    show({
      text: rideWriteToast({
        driver: nextDriverId ? personById(nextDriverId) : null,
        child: personById(leg.occurrence?.person_id ?? null),
        direction: leg.direction,
        self,
      }),
      undo: () => assign(leg.id, prev.driver_id, prev.companions, prev.self),
    })
  }

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
  }, [householdId, person?.id, reloadKey, today])

  const myLegs     = allLegs.filter(l =>
    (l.driver_id === person?.id || l.companion_id === person?.id || l.companion2_id === person?.id)
    && !pinnedOpenIds.has(l.id)
  )
  const otherLegs  = allLegs.filter(l =>
    l.driver_id &&
    l.driver_id !== person?.id &&
    l.companion_id !== person?.id &&
    l.companion2_id !== person?.id &&
    !pinnedOpenIds.has(l.id)
  )
  const orphanLegs = allLegs.filter(l =>
    pinnedOpenIds.has(l.id) ||
    (!l.driver_id && !l.self_transport && l.occurrence?.status !== 'cancelled')
  )
  const hasIssue   = allLegs.some(l =>
    !l.driver_id && !l.self_transport && l.occurrence?.status !== 'cancelled'
  )

  return (
    <div style={{ background: 'var(--color-bg)', minHeight: '100dvh' }}>
      <Header title={copy.ma.title} kicker={todayDisplay} />

      <div className={`status-banner ${hasIssue ? 'warn' : 'ok'}`} style={{ margin: '12px 16px 0' }}>
        {hasIssue
          ? <><Icon name="warning" size={16} weight="fill" /><span>{copy.ma.openCount(orphanLegs.length)}</span></>
          : <><Icon name="check" size={16} weight="fill" /><span>{copy.ma.calendarOk(formatTime(new Date()))}</span></>}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--color-muted)', fontSize: 13 }}>
          {copy.common.loading}
        </div>
      )}

      {!loading && (
        <div style={{ padding: '20px 16px 112px' }}>

          <div className="section-label">{copy.ma.yourDay}</div>

          {myLegs.length === 0 ? (
            <div className="card" style={{
              padding: '24px 16px', textAlign: 'center',
              color: 'var(--color-muted)', fontSize: 13, marginBottom: 24
            }}>
              {copy.ma.noRidesYours}
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
                          {gapMins < 20 ? copy.status.tightBang(gapMins) : copy.status.gapMins(gapMins)}
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
                      {directionWord(leg.direction).charAt(0)}
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
                              <span className="tabular" style={{ fontSize: 17, fontWeight: 700 }}>
                                {formatTime(leg.depart_at)}
                              </span>
                              <span style={{ fontSize: 13, textDecoration: cancelled ? 'line-through' : 'none' }}>
                                {occ.title}
                              </span>
                              {child && (
                                <span style={{ fontSize: 11, color: 'var(--color-text-2)', fontWeight: 600 }}>
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
                                {copy.status.cancelled}
                              </div>
                            )}
                          </div>
                          {!cancelled && (
                            isDriver
                              ? <Pill tone="accent" icon="steering-wheel">
                                  {copy.status.youDrive}
                                  {companion && ` + ${companion.display_name}`}
                                </Pill>
                              : <Pill tone="ok">
                                  {companion
                                    ? copy.sentence.youAlsoGo(personById(leg.driver_id)?.display_name ?? '')
                                    : copy.status.comingAlong}
                                </Pill>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {otherLegs.length > 0 && (
            <>
              <div className="section-label" style={{ marginTop: 4 }}>{copy.ma.othersToday}</div>
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
                            <span className="tabular" style={{ fontWeight: 700 }}>
                              {formatTime(leg.depart_at)}
                            </span>
                            {' '}{directionWord(leg.direction)} {occ.title}
                            {child && <span style={{ fontSize: 11, color: 'var(--color-text-2)', marginLeft: 4 }}>({child.display_name})</span>}
                          </div>
                        </div>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 5,
                          padding: '5px 10px', borderRadius: 100, flexShrink: 0,
                          fontSize: 11, fontWeight: 600,
                          background: 'rgba(79,156,249,0.1)', color: 'var(--color-accent-ink)',
                          border: '1px solid rgba(79,156,249,0.2)',
                        }}>
                          {driver && (
                            <Avatar person={driver} size={26} householdNames={householdNames} />
                          )}
                          {driver?.display_name ?? copy.common.unknown}
                          {companion && ` + ${companion.display_name}`}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {orphanLegs.length > 0 && (
            <>
              <div className="section-label" style={{ marginTop: 12, color: 'var(--color-red)' }}>
                {copy.ma.openRides}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {orphanLegs.map(leg => {
                  const occ   = leg.occurrence
                  const child = personById(occ.person_id)
                  if (!child) return null
                  const fromLoc = locationById(leg.from_location)
                  return (
                    <RideCard
                      key={leg.id}
                      ride={leg}
                      event={{ title: occ.title, locationName: fromLoc?.name }}
                      child={child}
                      state={rideState(leg)}
                      mergeHint={undefined}
                      canAssign={canAssignOthers}
                      canClaim={canSelfAssign && !canAssignOthers}
                      canEdit={canEditOccurrence}
                      canRelease={canReleaseOwn}
                      drivers={drivers}
                      blocks={blocksForRide(leg, allLegs, drivers, [])}
                      householdNames={householdNames}
                      viewerId={person?.id}
                      fromHome={!!fromLoc?.is_home}
                      fromName={fromLoc?.name ?? null}
                      onAssign={driverId => {
                        assign(leg.id, driverId, companionIdsOf(leg).filter(id => id !== driverId))
                        toastRide(leg, driverId)
                      }}
                      onCompanion={id => {
                        if (!leg.driver_id) { assign(leg.id, id); toastRide(leg, id); return }
                        assign(leg.id, leg.driver_id, nextCompanions(companionIdsOf(leg).filter(c => c !== leg.driver_id), id))
                      }}
                      onSelf={() => { assign(leg.id, null, [], true); toastRide(leg, null, true) }}
                      onRelease={() => { release(leg.id); toastRide(leg, null) }}
                      onClaim={person?.id ? () => { claim(leg.id, person.id); toastRide(leg, person.id) } : undefined}
                      onMerge={() => {}}
                      onOpenMenu={() => setSelectedOcc(occ)}
                    />
                  )
                })}
              </div>
            </>
          )}

          {allLegs.length === 0 && (
            <div className="empty-state" style={{ marginTop: 16 }}>
              <div className="icon"><Icon name="sun-horizon" size={40} weight="thin" color="#3a5670" /></div>
              <div className="title">{copy.empty.todayNone.title}</div>
              <div className="sub">{copy.empty.todayNone.sub}</div>
            </div>
          )}
        </div>
      )}
      <div style={{
        position: 'fixed', bottom: 'calc(72px + env(safe-area-inset-bottom, 0) + 12px)', right: 16,
        display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-end',
      }}>
        <button
          onClick={() => { setBreakPersonId(undefined); setShowBreak(true) }}
          title={copy.ma.illnessTitle}
          style={{
            padding: '10px 16px', borderRadius: 100, fontSize: 12, fontWeight: 700, minHeight: 44,
            background: 'rgba(245,200,66,0.15)', border: '1px solid rgba(245,200,66,0.4)',
            color: 'var(--color-yellow)', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
          <Icon name="first-aid" size={16} weight="fill" />
          {copy.ma.illness}
        </button>
        <button
          onClick={() => setShowNew(true)}
          title={copy.a11y.addEvent}
          aria-label={copy.a11y.addEvent}
          style={{
            width: 50, height: 50, borderRadius: '50%',
            background: 'var(--color-blue)', border: 'none',
            color: '#fff', cursor: 'pointer', boxShadow: '0 3px 10px rgba(79,156,249,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          <Icon name="plus" size={24} weight="bold" />
        </button>
      </div>

      {showBreak && householdId && (
        <BreakSheet
          persons={persons}
          householdId={householdId}
          householdNames={householdNames}
          quickIllness={breakPersonId ? { personId: breakPersonId } : { personId: children[0]?.id ?? persons[0]?.id ?? '' }}
          onClose={() => setShowBreak(false)}
          onDone={() => { setShowBreak(false); setReloadKey(k => k + 1) }}
        />
      )}
      {showNew && householdId && (
        <NewEventSheet
          householdId={householdId}
          date={today}
          childrenPeople={children}
          locations={locations}
          home={home}
          householdNames={householdNames}
          onClose={() => setShowNew(false)}
          onDone={() => { setShowNew(false); setReloadKey(k => k + 1) }}
        />
      )}
      {selectedOcc && (
        <ProgramSheet
          occ={selectedOcc}
          locations={locations}
          personName={personById(selectedOcc.person_id)?.display_name}
          onClose={() => setSelectedOcc(null)}
          onDone={() => { setSelectedOcc(null); setReloadKey(k => k + 1) }}
        />
      )}
    </div>
  )
}
