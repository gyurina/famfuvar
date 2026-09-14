import { useState, useEffect, useRef } from 'react'
import { addDays, startOfDay } from 'date-fns'
import { useSearchParams } from 'react-router-dom'
import { Header } from '../components/Header'
import { RideCard } from '../components/RideCard'
import { GroupedRideCard } from '../components/GroupedRideCard'
import { ProgramSheet } from '../components/ProgramSheet'
import { FilterChips } from '../components/FilterChips'
import { SectionHead } from '../components/SectionHead'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { supabase } from '../lib/supabase'
import { db } from '../lib/db'
import { useHousehold } from '../hooks/useHousehold'
import { useAuth } from '../lib/auth'
import { useRole } from '../hooks/useRole'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { useAssignDriver, type AssignmentPatch } from '../hooks/useAssignDriver'
import { getPref, PREF_HIDE_CANCELLED } from '../lib/prefs'
import { fetchGoogleCalendars, fetchExternalEvents } from '../lib/googleCalendar'
import { sortLegs } from '../lib/occurrences'
import { copy } from '../copy'
import { formatTime, formatWeekRange, formatDayTitle, toIsoDate, toRideDirection } from '../lib/format'
import { rideWriteToast } from '../lib/assignmentToast'
import { useToast } from '../components/Toast'
import {
  blocksForRide,
  companionIdsOf,
  findMergeHint,
  guestNameOf,
  isRideOpen,
  nextCompanions,
  rideDurationMins,
  rideState,
  type RideRow,
} from '../lib/rideUi'
import type { Occurrence, ScheduleTemplate } from '../types'

type LegRow = RideRow & { occurrence: Occurrence }

type DisplayItem =
  | { kind: 'solo'; leg: LegRow; sortKey: string }
  | { kind: 'trip'; tripId: string; legs: LegRow[]; sortKey: string }

type RideFilter = 'open' | 'all' | 'mine'

export function Rides() {
  const { person } = useAuth()
  const { canAssignOthers, canSelfAssign, canEditOccurrence, canReleaseOwn } = useRole()
  const { drivers, householdId, personById, locationById, locations, travelTimes } = useHousehold()
  const { show } = useToast()
  const online = useOnlineStatus()
  const [searchParams] = useSearchParams()
  const highlightId = searchParams.get('ride')
  const [weekOffset, setWeekOffset] = useState(0)
  const [legs, setLegs] = useState<LegRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<RideFilter>(highlightId ? 'all' : 'open')
  const [mergeMode, setMergeMode] = useState(false)
  const [selectedLegIds, setSelectedLegIds] = useState<Set<string>>(new Set())
  const [merging, setMerging] = useState(false)
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([])
  const [selectedOcc, setSelectedOcc] = useState<Occurrence | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [extEvents, setExtEvents] = useState<Array<{ calendar_id: string; starts_at: string; ends_at: string; title: string | null; person_id?: string }>>([])
  const [highlight, setHighlight] = useState(highlightId)
  const highlightRef = useRef<HTMLDivElement | null>(null)

  const hideCancelled = getPref(PREF_HIDE_CANCELLED)
  const today = new Date()
  const weekStart = addDays(startOfDay(today), weekOffset * 7)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const householdNames = drivers.map(d => d.display_name)

  function applyPatch(patch: AssignmentPatch) {
    setLegs(prev => prev.map(l => l.id === patch.id ? { ...l, ...patch } : l))
  }

  const { assign, assignMany, release, claim } = useAssignDriver(applyPatch)

  function toastRide(leg: LegRow, nextDriverId: string | null, self = false, guest: string | null = null) {
    const prev = {
      driver_id: leg.driver_id,
      companions: companionIdsOf(leg).filter(id => id !== leg.driver_id),
      self: leg.self_transport,
      guest: guestNameOf(leg),
    }
    show({
      text: rideWriteToast({
        driver: nextDriverId ? personById(nextDriverId) : null,
        child: personById(leg.occurrence?.person_id ?? null),
        direction: leg.direction,
        self,
        guest,
      }),
      undo: () => assign(leg.id, prev.driver_id, prev.companions, prev.self, prev.guest),
    })
  }

  useEffect(() => {
    if (!householdId) return
    const from = days[0].toISOString()
    const to = addDays(days[6], 1).toISOString()
    setLoading(true)

    if (!online) {
      db.transport_legs
        .where('depart_at').between(from, to, true, true)
        .filter(l => l.household_id === householdId)
        .toArray()
        .then(cached => { setLegs(sortLegs(cached as LegRow[])); setLoading(false) })
        .catch(() => setLoading(false))
      return
    }

    Promise.all([
      supabase.from('transport_leg').select('*, occurrence!inner(*)')
        .eq('household_id', householdId)
        .gte('depart_at', from).lte('depart_at', to)
        .order('depart_at'),
      supabase.from('schedule_template').select('*')
        .eq('household_id', householdId),
    ]).then(([legRes, tplRes]) => {
      const legData = (legRes.data as LegRow[]) ?? []
      setLegs(sortLegs(legData))
      db.transport_legs.bulkPut(legData).catch(() => {})
      if (householdId) {
        fetchGoogleCalendars(householdId).then(async gcals => {
          if (!gcals.length) return
          const calMap = new Map(gcals.map(c => [c.id, c.person_id]))
          const events = await fetchExternalEvents(gcals.map(c => c.id), from, to)
          setExtEvents(events.map(e => ({ ...e, person_id: calMap.get(e.calendar_id) ?? undefined })))
        }).catch(() => {})
      }
      setTemplates((tplRes.data ?? []) as ScheduleTemplate[])
      setLoading(false)
    }).catch(async () => {
      const cached = await db.transport_legs
        .where('depart_at').between(from, to, true, true)
        .filter(l => l.household_id === householdId)
        .toArray()
      setLegs(sortLegs(cached as LegRow[]))
      setLoading(false)
    })
  }, [householdId, weekOffset, reloadKey, online])

  useEffect(() => {
    if (!householdId) return
    const channel = supabase
      .channel(`rides-rt-${householdId}`)
      .on('postgres_changes' as never, {
        event: 'UPDATE', schema: 'public', table: 'transport_leg',
        filter: `household_id=eq.${householdId}`,
      }, (payload: { new: Record<string, unknown> }) => {
        const updated = payload.new
        setLegs(prev => prev.map(l => l.id === updated.id ? { ...l, ...updated } : l))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [householdId])

  function pairedLeg(legId: string): LegRow | undefined {
    const leg = legs.find(l => l.id === legId)
    if (!leg) return undefined
    return legs.find(l => l.occurrence_id === leg.occurrence_id && l.direction !== leg.direction)
  }

  async function mergeIds(ids: string[]) {
    if (ids.length < 2 || !householdId) return
    setMerging(true)
    try {
      const { data: tripRow, error } = await supabase.from('trips')
        .insert({ household_id: householdId })
        .select('id').single()
      if (error || !tripRow) { console.error('trips insert:', error); return }
      const tripId = tripRow.id
      await supabase.from('transport_leg').update({ trip_id: tripId }).in('id', ids)
      setLegs(prev => prev.map(l => ids.includes(l.id) ? { ...l, trip_id: tripId } : l))
      setMergeMode(false)
      setSelectedLegIds(new Set())
    } finally {
      setMerging(false)
    }
  }

  async function handleSplit(tripId: string, tripLegs: LegRow[]) {
    const ids = tripLegs.map(l => l.id)
    await supabase.from('transport_leg').update({ trip_id: null }).in('id', ids)
    await supabase.from('trips').delete().eq('id', tripId)
    setLegs(prev => prev.map(l => ids.includes(l.id) ? { ...l, trip_id: null } : l))
  }

  const myId = person?.id
  const visLegs = hideCancelled
    ? legs.filter(l => l.occurrence?.status !== 'cancelled')
    : legs
  const orphans = visLegs.filter(l => isRideOpen(l))
  const mineCount = visLegs.filter(l =>
    myId && (l.driver_id === myId || l.companion_id === myId || l.companion2_id === myId),
  ).length

  useEffect(() => {
    if (filter === 'open' && orphans.length === 0 && visLegs.length > 0 && !highlightId) {
      setFilter('all')
    }
  }, [orphans.length, visLegs.length, filter, highlightId])

  useEffect(() => {
    if (!highlight) return
    const el = highlightRef.current ?? document.getElementById(`ride-${highlight}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const t = window.setTimeout(() => setHighlight(null), 1200)
    return () => window.clearTimeout(t)
  }, [highlight, loading])

  const grouped = days.map(d => {
    let dayLegs = visLegs.filter(l => l.depart_at.startsWith(toIsoDate(d)))
    if (filter === 'open') {
      dayLegs = dayLegs.filter(l => isRideOpen(l))
    } else if (filter === 'mine' && myId) {
      dayLegs = dayLegs.filter(l =>
        l.driver_id === myId || l.companion_id === myId || l.companion2_id === myId,
      )
    }
    const items: DisplayItem[] = []
    const seenTripIds = new Set<string>()
    for (const leg of dayLegs) {
      if (!leg.trip_id) {
        items.push({ kind: 'solo', leg, sortKey: leg.depart_at })
      } else if (!seenTripIds.has(leg.trip_id)) {
        seenTripIds.add(leg.trip_id)
        const tripLegs = dayLegs.filter(l => l.trip_id === leg.trip_id)
        const sortKey = tripLegs.reduce((min, l) => l.depart_at < min ? l.depart_at : min, leg.depart_at)
        items.push({ kind: 'trip', tripId: leg.trip_id, legs: tripLegs, sortKey })
      }
    }
    items.sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    return { date: d, label: formatDayTitle(d), items }
  })

  function toggleMergeMode() {
    setMergeMode(m => !m)
    setSelectedLegIds(new Set())
  }

  function toggleSelectLeg(legId: string) {
    setSelectedLegIds(prev => {
      const next = new Set(prev)
      if (next.has(legId)) next.delete(legId)
      else next.add(legId)
      return next
    })
  }

  function renderSoloCard(leg: LegRow) {
    const occ = leg.occurrence
    const child = personById(occ?.person_id)
    if (!child) return null
    const fromLoc = locationById(leg.from_location)
    const isSelected = selectedLegIds.has(leg.id)
    const state = rideState(leg)
    const mergeHint = mergeMode ? undefined : findMergeHint(leg, visLegs, travelTimes, personById)

    if (mergeMode) {
      return (
        <button
          key={leg.id}
          type="button"
          className="ride-card"
          style={{
            width: '100%',
            textAlign: 'left',
            outline: isSelected ? '2px solid var(--color-accent)' : undefined,
            marginBottom: 8,
          }}
          onClick={() => toggleSelectLeg(leg.id)}
        >
          <span className="ride-card-title">{child.display_name} · {occ.title}</span>
        </button>
      )
    }

    return (
      <div
        key={leg.id}
        id={`ride-${leg.id}`}
        ref={highlight === leg.id ? highlightRef : undefined}
        className={highlight === leg.id ? 'ride-highlight' : undefined}
        style={{ marginBottom: 8 }}
      >
        <RideCard
          ride={leg}
          event={{ title: occ.title, locationName: fromLoc?.name }}
          child={child}
          state={state}
          pairedRide={pairedLeg(leg.id) ?? null}
          mergeHint={mergeHint}
          canAssign={canAssignOthers}
          canClaim={canSelfAssign && !canAssignOthers}
          canEdit={canEditOccurrence}
          canRelease={canReleaseOwn}
          drivers={drivers}
          blocks={blocksForRide(leg, legs, drivers, extEvents)}
          householdNames={householdNames}
          viewerId={myId}
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
          onGuest={name => { assign(leg.id, null, [], false, name); toastRide(leg, null, false, name) }}
          onRelease={() => { release(leg.id); toastRide(leg, null) }}
          onClaim={myId ? () => { claim(leg.id, myId); toastRide(leg, myId) } : undefined}
          onMerge={rideId => mergeIds([leg.id, rideId])}
          onOpenMenu={() => setSelectedOcc(occ)}
        />
      </div>
    )
  }

  function renderTripCard(tripId: string, tripLegs: LegRow[]) {
    const sorted = [...tripLegs].sort((a, b) => a.depart_at.localeCompare(b.depart_at))
    const rep = sorted[0]
    const state = sorted.every(l => l.driver_id || guestNameOf(l)) ? 'assigned' as const : 'open' as const
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    const duration = first && last
      ? rideDurationMins({ depart_at: first.depart_at, arrive_at: last.arrive_at })
      : null
    const interval = first && last ? { start: first.depart_at, end: last.arrive_at } : undefined
    const stops = sorted.flatMap(l => {
      const child = personById(l.occurrence?.person_id)
      if (!child) return []
      const loc = toRideDirection(l.direction) === 'inbound'
        ? locationById(l.from_location)
        : locationById(l.to_location)
      return [{
        rideId: l.id,
        time: formatTime(l.depart_at),
        child,
        place: loc?.name ?? l.occurrence.title,
        direction: toRideDirection(l.direction),
      }]
    })

    return (
      <div
        key={tripId}
        id={`ride-${sorted[0]?.id ?? tripId}`}
        ref={sorted.some(l => l.id === highlight) ? highlightRef : undefined}
        className={sorted.some(l => l.id === highlight) ? 'ride-highlight' : undefined}
        style={{ marginBottom: 8 }}
      >
        <GroupedRideCard
          trip={{ id: tripId }}
          stops={stops}
          state={state}
          driverId={rep?.driver_id ?? null}
          companionIds={rep ? companionIdsOf(rep) : []}
          guestName={rep ? guestNameOf(rep) : null}
          blocks={rep ? blocksForRide(rep, legs, drivers, extEvents, interval) : {}}
          drivers={drivers}
          canAssign={canAssignOthers}
          canClaim={canSelfAssign && !canAssignOthers}
          canRelease={canReleaseOwn}
          householdNames={householdNames}
          durationMins={duration}
          viewerId={myId}
          onAssign={driverId => {
            const snapshot = sorted.map(l => ({
              id: l.id,
              driver_id: l.driver_id,
              companions: companionIdsOf(l).filter(id => id !== l.driver_id),
              self: l.self_transport,
              guest: guestNameOf(l),
            }))
            assignMany(sorted.map(l => l.id), driverId, rep ? companionIdsOf(rep).filter(id => id !== driverId) : [])
            show({
              text: rideWriteToast({
                driver: personById(driverId),
                child: personById(rep?.occurrence?.person_id ?? null),
                direction: rep?.direction ?? 'pickup',
                self: false,
              }),
              undo: () => { snapshot.forEach(s => assign(s.id, s.driver_id, s.companions, s.self, s.guest)) },
            })
          }}
          onCompanion={id => {
            if (!rep?.driver_id) { assignMany(sorted.map(l => l.id), id); return }
            assignMany(sorted.map(l => l.id), rep.driver_id, nextCompanions(companionIdsOf(rep).filter(c => c !== rep.driver_id), id))
          }}
          onGuest={name => {
            const snapshot = sorted.map(l => ({
              id: l.id,
              driver_id: l.driver_id,
              companions: companionIdsOf(l).filter(id => id !== l.driver_id),
              self: l.self_transport,
              guest: guestNameOf(l),
            }))
            assignMany(sorted.map(l => l.id), null, [], false, name)
            show({
              text: rideWriteToast({
                driver: null,
                child: personById(rep?.occurrence?.person_id ?? null),
                direction: rep?.direction ?? 'pickup',
                self: false,
                guest: name,
              }),
              undo: () => { snapshot.forEach(s => assign(s.id, s.driver_id, s.companions, s.self, s.guest)) },
            })
          }}
          onRelease={() => {
            const snapshot = sorted.map(l => ({
              id: l.id,
              driver_id: l.driver_id,
              companions: companionIdsOf(l).filter(id => id !== l.driver_id),
              self: l.self_transport,
              guest: guestNameOf(l),
            }))
            assignMany(sorted.map(l => l.id), null, [])
            show({
              text: rideWriteToast({
                driver: null,
                child: personById(rep?.occurrence?.person_id ?? null),
                direction: rep?.direction ?? 'pickup',
                self: false,
              }),
              undo: () => { snapshot.forEach(s => assign(s.id, s.driver_id, s.companions, s.self, s.guest)) },
            })
          }}
          onClaim={myId ? () => {
            const snapshot = sorted.map(l => ({
              id: l.id,
              driver_id: l.driver_id,
              companions: companionIdsOf(l).filter(id => id !== l.driver_id),
              self: l.self_transport,
              guest: guestNameOf(l),
            }))
            assignMany(sorted.map(l => l.id), myId)
            show({
              text: rideWriteToast({
                driver: person,
                child: personById(rep?.occurrence?.person_id ?? null),
                direction: rep?.direction ?? 'pickup',
                self: false,
              }),
              undo: () => { snapshot.forEach(s => assign(s.id, s.driver_id, s.companions, s.self, s.guest)) },
            })
          } : undefined}
          onSplit={() => handleSplit(tripId, sorted)}
          onOpenMenu={() => { if (rep?.occurrence) setSelectedOcc(rep.occurrence) }}
        />
      </div>
    )
  }

  return (
    <div>
      <Header
        title={copy.rides.title}
        subtitle={formatWeekRange(days[0], days[6])}
        action={
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className="week-nav-btn"
              onClick={toggleMergeMode}
              title={mergeMode ? copy.rides.mergeExit : copy.rides.mergeStart}
              aria-label={copy.a11y.merge}
            >
              <Icon name="link" size={20} />
            </button>
            <button className="week-nav-btn" onClick={() => setWeekOffset(o => o - 1)} aria-label={copy.a11y.prevWeek}>
              <Icon name="caret-left" size={20} />
            </button>
            <button className="week-nav-today" onClick={() => setWeekOffset(0)}>{copy.common.today}</button>
            <button className="week-nav-btn" onClick={() => setWeekOffset(o => o + 1)} aria-label={copy.a11y.nextWeek}>
              <Icon name="caret-right" size={20} />
            </button>
          </div>
        }
      />

      {mergeMode && (
        <div className="status-banner" style={{ margin: '10px 16px 0' }}>
          {copy.rides.mergeHint}
        </div>
      )}

      <FilterChips
        value={filter}
        onChange={id => setFilter(id as RideFilter)}
        chips={[
          { id: 'open', label: copy.rides.chipOpen(orphans.length), count: orphans.length, tone: 'danger' },
          { id: 'all', label: copy.rides.chipAll(visLegs.length), count: visLegs.length },
          { id: 'mine', label: copy.rides.chipMine(mineCount), count: mineCount },
        ]}
      />

      {loading && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--color-muted)', fontSize: 13 }}>
          {copy.common.loading}
        </div>
      )}

      {!loading && (
        <div style={{ padding: '0 16px calc(var(--nav-height) + 40px)' }}>
          {visLegs.length === 0 && (
            <EmptyState icon="calendar-blank" title={copy.rides.emptyWeek} sub={copy.empty.week.sub} />
          )}
          {visLegs.length > 0 && grouped.every(g => g.items.length === 0) && filter === 'open' && (
            <EmptyState icon="steering-wheel" title={copy.empty.rides.title} sub={copy.empty.rides.sub} />
          )}
          {visLegs.length > 0 && grouped.every(g => g.items.length === 0) && filter !== 'open' && (
            <EmptyState
              icon="funnel"
              title={copy.empty.ridesFilter.title}
              sub={copy.empty.ridesFilter.sub}
              action={{ label: copy.rides.showAll, onClick: () => setFilter('all') }}
            />
          )}

          {grouped.map(g => g.items.length > 0 && (
            <div key={g.date.toISOString()} style={{ marginBottom: 24 }}>
              <SectionHead variant="day" title={g.label} />
              {g.items.map(item =>
                item.kind === 'solo'
                  ? renderSoloCard(item.leg)
                  : renderTripCard(item.tripId, item.legs),
              )}
            </div>
          ))}
        </div>
      )}

      {mergeMode && (
        <div style={{
          position: 'fixed', bottom: 'var(--nav-height)', left: 0, right: 0,
          padding: 12, background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)',
          display: 'flex', gap: 8, maxWidth: 'var(--content-max-width)', margin: '0 auto',
        }}>
          <button className="week-nav-today" onClick={toggleMergeMode} style={{ flex: 1 }}>{copy.common.cancel}</button>
          <button
            className="week-nav-today"
            onClick={() => mergeIds(Array.from(selectedLegIds))}
            disabled={selectedLegIds.size < 2 || merging}
            style={{ flex: 2, background: selectedLegIds.size >= 2 ? 'var(--color-accent)' : undefined, color: selectedLegIds.size >= 2 ? '#fff' : undefined }}
          >
            {merging ? copy.rides.merging : selectedLegIds.size < 2 ? copy.rides.mergeSelected(selectedLegIds.size) : copy.rides.mergeN(selectedLegIds.size)}
          </button>
        </div>
      )}

      {selectedOcc && (
        <ProgramSheet
          occ={selectedOcc}
          template={templates.find(t => t.id === selectedOcc.template_id) ?? null}
          locations={locations}
          personName={personById(selectedOcc.person_id)?.display_name}
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
