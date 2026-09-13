import { useState, useEffect } from 'react'
import { addDays, startOfDay } from 'date-fns'
import { Header } from '../components/Header'
import { supabase } from '../lib/supabase'
import { useHousehold } from '../hooks/useHousehold'
import { useAuth } from '../lib/auth'
import { getPref, PREF_HIDE_CANCELLED } from '../lib/prefs'
import type { TransportLeg, Occurrence, ScheduleTemplate } from '../types'
import { OccurrenceOverrideModal } from '../components/OccurrenceOverrideModal'
import DirectionBadge from '../components/DirectionBadge'
import { sortLegs } from '../lib/occurrences'
import { useRole } from '../hooks/useRole'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { fetchGoogleCalendars, fetchExternalEvents } from '../lib/googleCalendar'
import { queueAssignDriver } from '../lib/sync'
import { db } from '../lib/db'
import { copy } from '../copy'
import { formatTime, formatWeekRange, formatDayLong, toIsoDate } from '../lib/format'
import { Icon } from '../components/Icon'

type LegRow = TransportLeg & {
  occurrence: Occurrence
  companion_id?:  string | null
  companion2_id?: string | null
}

type DisplayItem =
  | { kind: 'solo'; leg: LegRow; sortKey: string }
  | { kind: 'trip'; tripId: string; legs: LegRow[]; sortKey: string }

export function Fuvartabla() {
  const { person } = useAuth()
  const { isAdmin, canDriveOnly, isFilteredView } = useRole()
  const { drivers, householdId, personById, locationById, locations, travelTimes } = useHousehold()
  // F4: grandparent csak saját magát látja sofőrként
  const visibleDrivers = canDriveOnly ? drivers.filter(d => d.id === person?.id) : drivers
  const online = useOnlineStatus()
  const [weekOffset, setWeekOffset] = useState(0)
  const [legs, setLegs] = useState<LegRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'mine'>('all')

  // Solo leg picker state
  const [openLegId, setOpenLegId] = useState<string | null>(null)
  const [pickerStep, setPickerStep] = useState<'driver' | 'companion'>('driver')
  const [pendingDriverId, setPendingDriverId] = useState<string | null>(null)
  const [selectedCompanions, setSelectedCompanions] = useState<string[]>([])
  const [returnAlso, setReturnAlso] = useState(false)
  const [transitAlso, setTransitAlso] = useState(false)
  const [assigning, setAssigning] = useState(false)

  // Trip picker state
  const [openTripId, setOpenTripId] = useState<string | null>(null)
  const [tripPickerStep, setTripPickerStep] = useState<'driver' | 'companion'>('driver')
  const [tripPendingDriverId, setTripPendingDriverId] = useState<string | null>(null)
  const [tripSelectedCompanions, setTripSelectedCompanions] = useState<string[]>([])
  const [tripAssigning, setTripAssigning] = useState(false)

  // Merge mode state
  const [mergeMode, setMergeMode] = useState(false)
  const [selectedLegIds, setSelectedLegIds] = useState<Set<string>>(new Set())
  const [merging, setMerging] = useState(false)

  const [templates, setTemplates] = useState<ScheduleTemplate[]>([])
  const [selectedOcc, setSelectedOcc] = useState<Occurrence | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [extEvents, setExtEvents] = useState<Array<{ calendar_id: string; starts_at: string; ends_at: string; title: string | null; person_id?: string }>>([])

  const hideCancelled = getPref(PREF_HIDE_CANCELLED)
  const today     = new Date()
  const weekStart = addDays(startOfDay(today), weekOffset * 7)
  const days      = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  useEffect(() => {
    if (!householdId) return
    const from = days[0].toISOString()
    const to   = addDays(days[6], 1).toISOString()
    setLoading(true)

    if (!online) {
      db.transport_legs
        .where('depart_at').between(from, to, true, true)
        .filter(l => l.household_id === householdId)
        .toArray()
        .then(cached => { setLegs(sortLegs(cached as any)); setLoading(false) })
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
      const legData = (legRes.data as any) ?? []
      setLegs(sortLegs(legData))
      db.transport_legs.bulkPut(legData).catch(() => {})
      if (householdId) {
        fetchGoogleCalendars(householdId).then(async gcals => {
          if (!gcals.length) return
          const calMap = new Map(gcals.map(c => [c.id, c.person_id]))
          const events = await fetchExternalEvents(gcals.map(c => c.id), from, to)
          setExtEvents(events.map(e => ({ ...e, person_id: calMap.get(e.calendar_id) })))
        }).catch(() => {})
      }
      setTemplates((tplRes.data ?? []) as ScheduleTemplate[])
      setLoading(false)
    }).catch(async () => {
      const cached = await db.transport_legs
        .where('depart_at').between(from, to, true, true)
        .filter(l => l.household_id === householdId)
        .toArray()
      setLegs(sortLegs(cached as any))
      setLoading(false)
    })
  }, [householdId, weekOffset, reloadKey])

  useEffect(() => {
    if (!householdId) return
    const channel = supabase
      .channel(`fuvartabla-rt-${householdId}`)
      .on('postgres_changes' as any, {
        event: 'UPDATE', schema: 'public', table: 'transport_leg',
        filter: `household_id=eq.${householdId}`,
      }, (payload: any) => {
        const updated = payload.new as Record<string, unknown>
        setLegs(prev => prev.map(l => l.id === updated.id ? { ...l, ...updated } : l))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [householdId])

  // ── Solo leg picker ──────────────────────────────────────────────────────

  function resetLegPicker() {
    setOpenLegId(null); setPickerStep('driver'); setPendingDriverId(null)
    setSelectedCompanions([]); setReturnAlso(false); setTransitAlso(false)
  }

  function openLeg(legId: string) {
    if (openLegId === legId) { resetLegPicker(); return }
    setOpenTripId(null)
    setOpenLegId(legId)
    setPickerStep('driver'); setPendingDriverId(null)
    setSelectedCompanions([]); setReturnAlso(false); setTransitAlso(false)
  }

  function pickDriver(legId: string, driverId: string | null) {
    if (driverId === null) { doAssign(legId, null, null, null); return }
    const leg = legs.find(l => l.id === legId)
    const pre: string[] = []
    if (leg?.companion_id  && leg.companion_id  !== driverId) pre.push(leg.companion_id)
    if (leg?.companion2_id && leg.companion2_id !== driverId) pre.push(leg.companion2_id)
    setPendingDriverId(driverId); setSelectedCompanions(pre)
    setReturnAlso(false); setTransitAlso(false); setPickerStep('companion')
  }

  function toggleCompanion(personId: string) {
    setSelectedCompanions(prev => {
      if (prev.includes(personId)) return prev.filter(id => id !== personId)
      if (prev.length >= 2) return prev
      return [...prev, personId]
    })
  }

  function pairedLeg(legId: string): LegRow | undefined {
    const leg = legs.find(l => l.id === legId)
    if (!leg) return undefined
    return legs.find(l => l.occurrence_id === leg.occurrence_id && l.direction !== leg.direction)
  }

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

  function hasGoogleConflict(driverId: string, leg: LegRow): boolean {
    const driverCal = extEvents.filter(e => e.person_id === driverId)
    if (!driverCal.length) return false
    const legStart = new Date(leg.depart_at).getTime()
    const legEnd   = leg.arrive_at ? new Date(leg.arrive_at).getTime() : legStart + 30 * 60 * 1000
    return driverCal.some(e => {
      const evStart = new Date(e.starts_at).getTime()
      const evEnd   = new Date(e.ends_at).getTime()
      return evStart < legEnd && evEnd > legStart
    })
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
    if (!online) {
      await queueAssignDriver({
        leg_id: legId, driver_id: driverId,
        companion_id: comp1, companion2_id: comp2, self_transport: selfTransport,
      })
      setLegs(prev => prev.map(l => l.id === legId
        ? { ...l, driver_id: driverId, companion_id: comp1, companion2_id: comp2, self_transport: selfTransport }
        : l
      ))
      if (!silent) { resetLegPicker(); setAssigning(false) }
      return
    }
    const { data } = await supabase.from('transport_leg')
      .update({ driver_id: driverId, companion_id: comp1, companion2_id: comp2, self_transport: selfTransport })
      .eq('id', legId).select('*, occurrence!inner(*)').single()
    if (data) {
      setLegs(prev => prev.map(l => l.id === legId ? data as any : l))
      db.transport_legs.put(data as any).catch(() => {})
    }
    if (driverId && !selfTransport) {
      supabase.functions.invoke('notify-driver', { body: { leg_id: legId } })
        .catch(e => console.warn('notify-driver:', e))
    }
    if (!silent) { resetLegPicker(); setAssigning(false) }
  }

  // ── Trip picker ──────────────────────────────────────────────────────────

  function resetTripPicker() {
    setOpenTripId(null); setTripPickerStep('driver'); setTripPendingDriverId(null)
    setTripSelectedCompanions([])
  }

  function openTripPicker(tripId: string) {
    if (openTripId === tripId) { resetTripPicker(); return }
    setOpenLegId(null)
    setOpenTripId(tripId)
    setTripPickerStep('driver'); setTripPendingDriverId(null); setTripSelectedCompanions([])
  }

  function pickTripDriver(tripLegs: LegRow[], driverId: string | null) {
    if (driverId === null) {
      doAssignTrip(tripLegs, null, null, null)
      return
    }
    const rep = tripLegs[0]
    const pre: string[] = []
    if (rep?.companion_id  && rep.companion_id  !== driverId) pre.push(rep.companion_id)
    if (rep?.companion2_id && rep.companion2_id !== driverId) pre.push(rep.companion2_id)
    setTripPendingDriverId(driverId)
    setTripSelectedCompanions(pre)
    setTripPickerStep('companion')
  }

  function toggleTripCompanion(personId: string) {
    setTripSelectedCompanions(prev => {
      if (prev.includes(personId)) return prev.filter(id => id !== personId)
      if (prev.length >= 2) return prev
      return [...prev, personId]
    })
  }

  async function confirmTripCompanions(tripLegs: LegRow[]) {
    const comp1 = tripSelectedCompanions[0] ?? null
    const comp2 = tripSelectedCompanions[1] ?? null
    await doAssignTrip(tripLegs, tripPendingDriverId, comp1, comp2)
  }

  async function doAssignTrip(
    tripLegs: LegRow[],
    driverId: string | null,
    comp1: string | null,
    comp2: string | null,
  ) {
    setTripAssigning(true)
    try {
      for (const leg of tripLegs) {
        if (!online) {
          await queueAssignDriver({
            leg_id: leg.id, driver_id: driverId,
            companion_id: comp1, companion2_id: comp2, self_transport: false,
          })
          setLegs(prev => prev.map(l => l.id === leg.id
            ? { ...l, driver_id: driverId, companion_id: comp1, companion2_id: comp2, self_transport: false }
            : l
          ))
        } else {
          const { data } = await supabase.from('transport_leg')
            .update({ driver_id: driverId, companion_id: comp1, companion2_id: comp2, self_transport: false })
            .eq('id', leg.id).select('*, occurrence!inner(*)').single()
          if (data) {
            setLegs(prev => prev.map(l => l.id === leg.id ? data as any : l))
            db.transport_legs.put(data as any).catch(() => {})
          }
        }
      }
      if (driverId && online) {
        supabase.functions.invoke('notify-driver', { body: { leg_id: tripLegs[0]?.id } })
          .catch(e => console.warn('notify-driver:', e))
      }
    } finally {
      setTripAssigning(false)
      resetTripPicker()
    }
  }

  function hasTripConflict(driverId: string, tripLegs: LegRow[]): boolean {
    return tripLegs.some(leg => hasConflict(driverId, leg))
  }

  function hasTripGoogleConflict(driverId: string, tripLegs: LegRow[]): boolean {
    return tripLegs.some(leg => hasGoogleConflict(driverId, leg))
  }

  // ── Merge / Split ────────────────────────────────────────────────────────

  function toggleMergeMode() {
    setMergeMode(m => !m)
    setSelectedLegIds(new Set())
    setOpenLegId(null)
    setOpenTripId(null)
  }

  function toggleSelectLeg(legId: string) {
    setSelectedLegIds(prev => {
      const next = new Set(prev)
      if (next.has(legId)) next.delete(legId)
      else next.add(legId)
      return next
    })
  }

  async function handleMerge() {
    if (selectedLegIds.size < 2 || !householdId) return
    setMerging(true)
    try {
      const { data: tripRow, error } = await supabase.from('trips')
        .insert({ household_id: householdId })
        .select('id').single()
      if (error || !tripRow) { console.error('trips insert:', error); return }
      const tripId = tripRow.id
      const ids = Array.from(selectedLegIds)
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
    resetTripPicker()
  }

  // ── Derived state ────────────────────────────────────────────────────────

  const myId    = person?.id
  const visLegs = (() => {
    let ls = hideCancelled ? legs.filter(l => l.occurrence?.status !== 'cancelled') : legs
    // Babysitter: only sees legs where they are the driver or companion
    if (isFilteredView && myId) {
      ls = ls.filter(l => l.driver_id === myId || l.companion_id === myId || l.companion2_id === myId)
    }
    return ls
  })()
  const orphans     = visLegs.filter(l => !l.driver_id && !l.self_transport && l.occurrence?.status !== 'cancelled')
  const allAssigned = visLegs.length > 0 && orphans.length === 0
  const bannerClass = allAssigned ? 'ok' : orphans.length ? 'warn' : 'neutral'

  const seenOccIds = new Set<string>()

  const grouped = days.map(d => {
    let dayLegs = visLegs.filter(l => l.depart_at.startsWith(toIsoDate(d)))
    if (filter === 'mine' && myId) {
      dayLegs = dayLegs.filter(l =>
        l.driver_id === myId || l.companion_id === myId || l.companion2_id === myId
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
    return { date: d, label: formatDayLong(d), items }
  })

  function crewLabel(leg: LegRow) {
    return [
      personById(leg.driver_id)?.display_name,
      personById(leg.companion_id)?.display_name,
      personById(leg.companion2_id)?.display_name,
    ].filter(Boolean).join(' + ')
  }

  function tripStripe(tripLegs: LegRow[]): string {
    const colors = tripLegs.map(l => personById(l.occurrence?.person_id)?.color ?? 'var(--color-border)')
    if (colors.length === 0) return 'var(--color-border)'
    if (colors.length === 1) return colors[0]
    const stops = colors.map((c, i) => `${c} ${Math.round(i * 100 / colors.length)}% ${Math.round((i + 1) * 100 / colors.length)}%`)
    return `linear-gradient(to bottom, ${stops.join(', ')})`
  }


  function travelTimeHint(leg: LegRow): string | null {
    const locId = leg.direction === 'dropoff' ? leg.to_location : leg.from_location
    if (!locId) return null
    const tt = travelTimes.find(t =>
      (leg.direction === 'dropoff' && t.to_location === locId) ||
      (leg.direction === 'pickup'  && t.from_location === locId)
    )
    return tt ? copy.rides.travelMins(tt.minutes) : null
  }

  function isTbdLocation(locId: string | null): boolean {
    if (!locId) return false
    return locations.find(l => l.id === locId)?.is_tbd ?? false
  }

  // ── Render helpers ───────────────────────────────────────────────────────

  function renderSoloCard(leg: LegRow) {
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
    const isSelected = selectedLegIds.has(leg.id)

    return (
      <div key={leg.id} style={{ marginBottom: 8 }}>
        <div
          className={`leg-card ${isOrphan ? 'orphan' : ''}`}
          style={{
            display: 'flex',
            borderRadius: isOpen ? 'var(--r-md) var(--r-md) 0 0' : undefined,
            opacity: occ?.status === 'cancelled' ? 0.5 : 1,
            cursor: mergeMode ? 'pointer' : undefined,
            outline: mergeMode && isSelected ? '2px solid var(--color-blue)' : undefined,
            outlineOffset: mergeMode && isSelected ? '-2px' : undefined,
          }}
          onClick={mergeMode ? () => toggleSelectLeg(leg.id) : undefined}
        >
          {mergeMode && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 36, flexShrink: 0,
            }}>
              <div style={{
                width: 18, height: 18, borderRadius: 4, border: `2px solid ${isSelected ? 'var(--color-blue)' : 'var(--color-border)'}`,
                background: isSelected ? 'var(--color-blue)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, color: '#fff', transition: 'all 0.12s',
              }}>{isSelected ? <Icon name="check" size={12} weight="bold" color="#fff" /> : null}</div>
            </div>
          )}
          <div className="leg-card-stripe" style={{ background: stripe }} />
          <div className="leg-card-body">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {formatTime(leg.depart_at)}
                </span>
                {(() => { const h = travelTimeHint(leg); return h ? <span style={{ fontSize: 10, color: 'var(--color-muted)', fontVariantNumeric: 'tabular-nums' }}>({h})</span> : null })()}
                {(isTbdLocation(leg.to_location) || isTbdLocation(leg.from_location)) && (
                  <span title={copy.settings.tbdLocation} style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-yellow)', background: 'rgba(245,200,66,0.12)', border: '1px solid rgba(245,200,66,0.3)', borderRadius: 4, padding: '1px 5px' }}>{copy.status.locationMissing}</span>
                )}
                <span style={{ fontSize: 13 }}>
                  <DirectionBadge direction={leg.direction} /> {occ?.title ?? '?'}
                </span>
                {child && <span style={{ fontSize: 11, color: 'var(--color-text-2)', fontWeight: 600 }}>({child.display_name})</span>}
                {occ?.is_override && occ.status !== 'cancelled' && (
                  <span title={copy.status.modified}><Icon name="pencil" size={12} /></span>
                )}
                {(() => {
                  if (!occ || seenOccIds.has(occ.id)) return null
                  seenOccIds.add(occ.id)
                  return isAdmin ? (
                    <button
                      onClick={e => { e.stopPropagation(); setSelectedOcc(occ as Occurrence) }}
                      style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', fontSize: 16, padding: '0 4px', lineHeight: 1 }}
                      title={copy.week.editCancel}
                      aria-label={copy.a11y.moreActions}
                    ><Icon name="dots-three" size={18} /></button>
                  ) : null
                })()}
              </div>
              {(fromLoc || toLoc) && (
                <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
                  {fromLoc?.name}{fromLoc && toLoc ? ' → ' : ''}{toLoc?.name}
                </div>
              )}
              {hasTransit && (
                <div style={{ fontSize: 10, color: 'var(--color-yellow)', marginTop: 2 }}>
                  {copy.rides.transfer}: {(() => { const t = transitLeg(leg.id); return t ? `${formatTime(t.depart_at)} ${t.occurrence?.title}` : '' })()}
                </div>
              )}
            </div>

            {!mergeMode && (
              <button
                className={`driver-badge ${isOrphan ? 'orphan' : leg.self_transport ? 'self' : 'assigned'}`}
                onClick={e => { e.stopPropagation(); openLeg(leg.id) }}
                disabled={occ?.status === 'cancelled'}
                style={{ opacity: occ?.status === 'cancelled' ? 0.6 : 1 }}
              >
                {!leg.self_transport && driver && <div className="driver-avatar" style={{ background: driver.color }}>{driver.display_name[0]}</div>}
                <span>{leg.self_transport ? copy.status.self : isOrphan ? copy.status.noDriver : crewLabel(leg)}</span>
              </button>
            )}
          </div>
        </div>

        {/* Solo picker panel */}
        {isOpen && !mergeMode && (
          <div className="picker-panel" style={{ borderRadius: '0 0 var(--r-md) var(--r-md)', border: '1px solid var(--color-border)', borderTop: 'none' }}>
            {pickerStep === 'driver' ? (
              <>
                <div className="picker-label">{copy.rides.pickDriver}</div>
                {hasTransit && (() => {
                  const t = transitLeg(leg.id)!
                  return (
                    <div style={{
                      marginBottom: 10, padding: '7px 10px', borderRadius: 'var(--r-sm)',
                      background: 'rgba(245,200,66,0.08)', border: '1px solid rgba(245,200,66,0.25)',
                      fontSize: 11, color: 'var(--color-yellow)',
                    }}>
                      {copy.rides.transitHint(formatTime(t.depart_at), t.occurrence?.title ?? '')}
                    </div>
                  )
                })()}
                <div className="picker-grid">
                  <button className="picker-btn self-btn" onClick={() => doAssign(leg.id, null, null, null, false, true)} disabled={assigning}>
                    <Icon name="person-simple-walk" size={18} />
                    <span style={{ fontSize: 11 }}>{copy.status.self}</span>
                  </button>
                  <button className="picker-btn none-btn" onClick={() => pickDriver(leg.id, null)}>
                    <Icon name="prohibit" size={16} color="var(--color-danger)" />
                    {copy.rides.leaveOpen}
                  </button>
                  {visibleDrivers.map(d => {
                    const conflict  = hasConflict(d.id, leg)
                    const gConflict = hasGoogleConflict(d.id, leg)
                    return (
                      <button
                        key={d.id}
                        className={`picker-btn ${leg.driver_id === d.id ? 'selected' : ''}`}
                        onClick={() => pickDriver(leg.id, d.id)}
                        disabled={assigning}
                        style={{ border: conflict ? '1px solid rgba(239,68,68,0.35)' : gConflict ? '1px solid rgba(251,191,36,0.4)' : undefined }}
                      >
                        <div className="driver-avatar" style={{ background: d.color }}>{d.display_name[0]}</div>
                        <span style={{ flex: 1 }}>{d.display_name}</span>
                        {conflict && (
                          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-red)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>{copy.rides.conflict}</span>
                        )}
                        {!conflict && gConflict && (
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#fbbf24', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>{copy.rides.calendar}</span>
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
                  {copy.rides.whoElse}
                  <span style={{ color: 'var(--color-muted-2)', fontWeight: 500, textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>
                    {copy.rides.maxCompanions(personById(pendingDriverId)?.display_name ?? '')}
                  </span>
                </div>
                <div className="picker-grid">
                  {visibleDrivers.filter(d => d.id !== pendingDriverId).map(d => {
                    const sel   = selectedCompanions.includes(d.id)
                    const maxed = !sel && selectedCompanions.length >= 2
                    return (
                      <button key={d.id} className={`picker-btn ${sel ? 'selected' : ''}`}
                        onClick={() => toggleCompanion(d.id)} disabled={assigning || maxed}
                        style={{ opacity: maxed ? 0.4 : 1 }}>
                        <div className="driver-avatar" style={{ background: d.color }}>{d.display_name[0]}</div>
                        {d.display_name}
                        {sel && <span style={{ marginLeft: 'auto', color: 'var(--color-blue)', display: 'inline-flex' }}><Icon name="check" size={14} weight="bold" /></span>}
                      </button>
                    )
                  })}
                </div>
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
                      fontSize: 11, transition: 'all 0.15s',
                    }}>{returnAlso ? <Icon name="check" size={12} weight="bold" color="#000" /> : null}</span>
                    {copy.rides.returnAlso}
                  </button>
                )}
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
                        fontSize: 11, transition: 'all 0.15s',
                      }}>{transitAlso ? <Icon name="check" size={12} weight="bold" color="#000" /> : null}</span>
                      {copy.rides.transitAlso}
                      <span style={{ fontSize: 10, color: 'var(--color-muted)', fontWeight: 400, marginLeft: 2 }}>
                        ({formatTime(t.depart_at)} <DirectionBadge direction={t.direction} /> {t.occurrence?.title})
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
                    {assigning ? copy.common.saving : selectedCompanions.length === 0 ? copy.rides.aloneOk : copy.rides.readyCount(1 + selectedCompanions.length)}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  function renderTripCard(tripId: string, tripLegs: LegRow[]) {
    const isOpen    = openTripId === tripId
    const rep       = tripLegs[0]
    const repDriver = rep ? personById(rep.driver_id) : undefined
    const isOrphan  = rep && !rep.driver_id && !rep.self_transport
    const stripe    = tripStripe(tripLegs)

    return (
      <div key={tripId} style={{ marginBottom: 8 }}>
        <div
          className={`leg-card ${isOrphan ? 'orphan' : ''}`}
          style={{
            display: 'flex', flexDirection: 'column',
            borderRadius: isOpen ? 'var(--r-md) var(--r-md) 0 0' : undefined,
          }}
        >
          {/* Trip header row */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div className="leg-card-stripe" style={{ background: stripe, alignSelf: 'stretch' }} />
            <div className="leg-card-body" style={{ flex: 1 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-blue)', letterSpacing: 0.3 }}>{copy.rides.grouped}</span>
                  <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                    {formatTime(tripLegs[0].depart_at)}
                    {tripLegs.length > 1 && ` – ${formatTime(tripLegs[tripLegs.length - 1].depart_at)}`}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>·</span>
                  <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>{copy.rides.groupedCount(tripLegs.length)}</span>
                </div>
                {/* Leg list */}
                <div style={{ marginTop: 4 }}>
                  {tripLegs.map(l => {
                    const child = personById(l.occurrence?.person_id)
                    return (
                      <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, marginTop: 1 }}>
                        <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-muted)' }}>
                          {formatTime(l.depart_at)}
                        </span>
                        <span><DirectionBadge direction={l.direction} /> {l.occurrence?.title ?? '?'}</span>
                        {child && <span style={{ color: 'var(--color-text-2)', fontWeight: 600 }}>({child.display_name})</span>}
                      </div>
                    )
                  })}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <button
                  className={`driver-badge ${isOrphan ? 'orphan' : rep?.self_transport ? 'self' : 'assigned'}`}
                  onClick={() => openTripPicker(tripId)}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {!rep?.self_transport && repDriver && <div className="driver-avatar" style={{ background: repDriver.color }}>{repDriver.display_name[0]}</div>}
                  <span>{rep?.self_transport ? copy.status.self : isOrphan ? copy.status.noDriver : crewLabel(rep!)}</span>
                </button>
                <button
                  onClick={() => handleSplit(tripId, tripLegs)}
                  style={{
                    fontSize: 10, padding: '3px 8px', borderRadius: 8, cursor: 'pointer',
                    background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
                    color: 'var(--color-muted)', fontWeight: 600,
                  }}
                >
                  {copy.rides.split}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Trip picker panel */}
        {isOpen && (
          <div className="picker-panel" style={{ borderRadius: '0 0 var(--r-md) var(--r-md)', border: '1px solid var(--color-border)', borderTop: 'none' }}>
            {tripPickerStep === 'driver' ? (
              <>
                <div className="picker-label">{copy.rides.whoDrivesGrouped}</div>
                <div className="picker-grid">
                  <button className="picker-btn none-btn" onClick={() => pickTripDriver(tripLegs, null)}>
                    <Icon name="prohibit" size={16} color="var(--color-danger)" />
                    {copy.rides.leaveOpen}
                  </button>
                  {visibleDrivers.map(d => {
                    const conflict  = hasTripConflict(d.id, tripLegs)
                    const gConflict = hasTripGoogleConflict(d.id, tripLegs)
                    return (
                      <button
                        key={d.id}
                        className={`picker-btn ${rep?.driver_id === d.id ? 'selected' : ''}`}
                        onClick={() => pickTripDriver(tripLegs, d.id)}
                        disabled={tripAssigning}
                        style={{ border: conflict ? '1px solid rgba(239,68,68,0.35)' : gConflict ? '1px solid rgba(251,191,36,0.4)' : undefined }}
                      >
                        <div className="driver-avatar" style={{ background: d.color }}>{d.display_name[0]}</div>
                        <span style={{ flex: 1 }}>{d.display_name}</span>
                        {conflict && (
                          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-red)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>{copy.rides.conflict}</span>
                        )}
                        {!conflict && gConflict && (
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#fbbf24', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>{copy.rides.calendar}</span>
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
                    onClick={() => { setTripPickerStep('driver'); setTripPendingDriverId(null); setTripSelectedCompanions([]) }}
                    style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: 18, padding: 0, lineHeight: 1 }}
                  >←</button>
                  {copy.rides.whoElse}
                  <span style={{ color: 'var(--color-muted-2)', fontWeight: 500, textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>
                    {copy.rides.maxCompanions(personById(tripPendingDriverId)?.display_name ?? '')}
                  </span>
                </div>
                <div className="picker-grid">
                  {visibleDrivers.filter(d => d.id !== tripPendingDriverId).map(d => {
                    const sel   = tripSelectedCompanions.includes(d.id)
                    const maxed = !sel && tripSelectedCompanions.length >= 2
                    return (
                      <button key={d.id} className={`picker-btn ${sel ? 'selected' : ''}`}
                        onClick={() => toggleTripCompanion(d.id)} disabled={tripAssigning || maxed}
                        style={{ opacity: maxed ? 0.4 : 1 }}>
                        <div className="driver-avatar" style={{ background: d.color }}>{d.display_name[0]}</div>
                        {d.display_name}
                        {sel && <span style={{ marginLeft: 'auto', color: 'var(--color-blue)', display: 'inline-flex' }}><Icon name="check" size={14} weight="bold" /></span>}
                      </button>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="picker-btn none-btn" onClick={() => confirmTripCompanions(tripLegs)} disabled={tripAssigning} style={{
                    flex: 1, justifyContent: 'center',
                    background: 'rgba(79,156,249,0.12)', color: 'var(--color-blue)',
                    border: '1px solid rgba(79,156,249,0.3)', fontWeight: 600,
                  }}>
                    {tripAssigning ? copy.common.saving : tripSelectedCompanions.length === 0 ? copy.rides.aloneOk : copy.rides.readyCount(1 + tripSelectedCompanions.length)}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ background: 'var(--color-bg)', minHeight: '100dvh' }}>
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
              style={{
                background: mergeMode ? 'rgba(79,156,249,0.15)' : undefined,
                color: mergeMode ? 'var(--color-blue)' : undefined,
                border: mergeMode ? '1px solid rgba(79,156,249,0.4)' : undefined,
              }}
            ><Icon name="link" size={20} /></button>
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

      <div className={`status-banner ${bannerClass}`} style={{ margin: '12px 16px 0' }}>
        {loading
          ? copy.common.loading
          : allAssigned
            ? <><Icon name="check" size={16} weight="fill" /><span>{copy.rides.allAssigned}</span></>
            : orphans.length > 0
              ? <><Icon name="warning" size={16} weight="fill" /><span>{copy.rides.openThisWeek(orphans.length)}</span></>
              : <span>{copy.rides.emptyAll}</span>}
      </div>

      {/* Merge mode info banner */}
      {mergeMode && (
        <div style={{
          margin: '10px 16px 0', padding: '10px 14px', borderRadius: 'var(--r-md)',
          background: 'rgba(79,156,249,0.08)', border: '1px solid rgba(79,156,249,0.25)',
          fontSize: 12, color: 'var(--color-blue)', fontWeight: 500,
        }}>
          {copy.rides.mergeHint}
        </div>
      )}

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
            {f === 'all' ? copy.rides.filterAll : copy.rides.filterMine}
          </button>
        ))}
      </div>

      {!loading && (
        <div style={{ padding: '16px 16px 96px' }}>
          {grouped.every(g => g.items.length === 0) && (
            <div className="empty-state">
              <div className="icon"><Icon name="steering-wheel" size={40} weight="thin" color="#3a5670" /></div>
              <div className="title">
                {filter === 'mine' ? copy.rides.emptyMine : copy.empty.rides.title}
              </div>
              <div className="sub">{copy.empty.rides.sub}</div>
            </div>
          )}

          {grouped.map(g => g.items.length > 0 && (
            <div key={g.date.toISOString()} style={{ marginBottom: 24 }}>
              <div className="day-header">{g.label}</div>
              {g.items.map(item =>
                item.kind === 'solo'
                  ? renderSoloCard(item.leg)
                  : renderTripCard(item.tripId, item.legs)
              )}
            </div>
          ))}
        </div>
      )}

      {/* Merge action bar */}
      {mergeMode && (
        <div style={{
          position: 'fixed', bottom: 'calc(72px + env(safe-area-inset-bottom, 0))', left: 0, right: 0,
          padding: '12px 16px', paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
          background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)',
          display: 'flex', gap: 8,
        }}>
          <button
            onClick={toggleMergeMode}
            style={{
              flex: 1, padding: '11px', borderRadius: 'var(--r-md)', fontSize: 14, fontWeight: 600,
              background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
              color: 'var(--color-muted)', cursor: 'pointer',
            }}
          >{copy.common.cancel}</button>
          <button
            onClick={handleMerge}
            disabled={selectedLegIds.size < 2 || merging}
            style={{
              flex: 2, padding: '11px', borderRadius: 'var(--r-md)', fontSize: 14, fontWeight: 700,
              background: selectedLegIds.size >= 2 ? 'var(--color-blue)' : 'var(--color-surface-2)',
              border: 'none', color: selectedLegIds.size >= 2 ? '#fff' : 'var(--color-muted)',
              cursor: selectedLegIds.size >= 2 ? 'pointer' : 'not-allowed', transition: 'all 0.15s',
            }}
          >
            {merging ? copy.rides.merging : selectedLegIds.size < 2 ? copy.rides.mergeSelected(selectedLegIds.size) : copy.rides.mergeN(selectedLegIds.size)}
          </button>
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
