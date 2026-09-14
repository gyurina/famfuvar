import { useState, useEffect, useRef } from 'react'
import { startOfWeek, addDays, isToday } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { Header } from '../components/Header'
import { DayStrip, type DayLoad } from '../components/DayStrip'
import { SectionHead } from '../components/SectionHead'
import { EmptyState } from '../components/EmptyState'
import { Avatar } from '../components/Avatar'
import { Pill } from '../components/Pill'
import { ProgramSheet } from '../components/ProgramSheet'
import { NewEventSheet } from '../components/NewEventSheet'
import { Icon } from '../components/Icon'
import { useToast } from '../components/Toast'
import { supabase } from '../lib/supabase'
import { db } from '../lib/db'
import { useHousehold } from '../hooks/useHousehold'
import { useAuth } from '../lib/auth'
import { useRole } from '../hooks/useRole'
import { useAssignDriver, type AssignmentPatch } from '../hooks/useAssignDriver'
import { getPref, PREF_HIDE_CANCELLED } from '../lib/prefs'
import { copy } from '../copy'
import { formatWeekRange, formatDayTitle, toIsoDate, directionWord } from '../lib/format'
import { rideWriteToast } from '../lib/assignmentToast'
import { sortLegs } from '../lib/occurrences'
import type { Occurrence, TransportLeg, ScheduleTemplate } from '../types'

type OccWithLegs = Occurrence & { legs: TransportLeg[] }

export function Week() {
  const nav = useNavigate()
  const { person } = useAuth()
  const { isAdmin, canAssignOthers, canSelfAssign, isBabysitter, canReleaseOwn } = useRole()
  const { householdId, personById, locationById, locations, persons, children, home } = useHousehold()
  const { show } = useToast()
  const [weekOffset, setWeekOffset] = useState(0)
  const [items, setItems] = useState<OccWithLegs[]>([])
  const [loading, setLoading] = useState(true)
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([])
  const [selectedOcc, setSelectedOcc] = useState<Occurrence | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedDay, setSelectedDay] = useState(toIsoDate(new Date()))
  const dayRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const hideCancelled = getPref(PREF_HIDE_CANCELLED)

  const today = new Date()
  const weekStart = addDays(startOfWeek(today, { weekStartsOn: 1 }), weekOffset * 7)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const householdNames = persons.map(p => p.display_name)

  function applyPatch(patch: AssignmentPatch) {
    setItems(prev => prev.map(o => ({
      ...o,
      legs: o.legs.map(l => l.id === patch.id ? { ...l, ...patch } : l),
    })))
  }
  const { claim, release, assign } = useAssignDriver(applyPatch)

  useEffect(() => {
    if (!householdId) return
    const from = toIsoDate(days[0])
    const to = toIsoDate(addDays(days[6], 1))
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

  const myId = person?.id
  const visible = items.filter(o => {
    if (hideCancelled && o.status === 'cancelled') return false
    if (!isBabysitter || !myId) return true
    return o.legs.some(l => l.driver_id === myId || l.companion_id === myId || l.companion2_id === myId)
  })

  const grouped = days.map(d => {
    const dateStr = toIsoDate(d)
    const dayItems = visible.filter(o => o.on_date === dateStr)
    const wd = (d.getDay() + 6) % 7
    const active = dayItems.filter(o => o.status !== 'cancelled')
    let load: DayLoad = 'empty'
    if (active.length > 0) {
      const open = active.some(o => o.legs.some(l => !l.driver_id && !l.self_transport))
      load = open ? 'open' : 'full'
    }
    return { date: d, dateStr, isToday: isToday(d), wd, items: dayItems, load }
  })

  const totalItems = grouped.reduce((s, g) => s + g.items.length, 0)

  function scrollToDay(dateStr: string) {
    setSelectedDay(dateStr)
    dayRefs.current[dateStr]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function togetherLabel(leg: TransportLeg, occ: OccWithLegs): string | null {
    if (!leg.trip_id) return null
    const other = items.find(o =>
      o.id !== occ.id && o.legs.some(l => l.trip_id === leg.trip_id),
    )
    const child = personById(other?.person_id ?? null)
    return child ? copy.week.togetherWith(child.display_name) : null
  }

  return (
    <div style={{ background: 'var(--color-bg)', minHeight: '100dvh' }}>
      <Header
        title={copy.week.title}
        subtitle={formatWeekRange(days[0], days[6])}
        action={
          <div style={{ display: 'flex', gap: 2 }}>
            <button className="week-nav-btn" onClick={() => setWeekOffset(o => o - 1)} aria-label={copy.a11y.prevWeek}>
              <Icon name="caret-left" size={20} />
            </button>
            <button className="week-nav-today" onClick={() => { setWeekOffset(0); scrollToDay(toIsoDate(new Date())) }}>
              {copy.common.today}
            </button>
            <button className="week-nav-btn" onClick={() => setWeekOffset(o => o + 1)} aria-label={copy.a11y.nextWeek}>
              <Icon name="caret-right" size={20} />
            </button>
          </div>
        }
      />

      <DayStrip
        days={grouped.map(g => ({
          dateStr: g.dateStr,
          weekdayIndex: g.wd,
          dayNum: String(g.date.getDate()),
          isToday: g.isToday,
          load: g.load,
        }))}
        selected={selectedDay}
        onSelect={scrollToDay}
        onSwipeWeek={delta => setWeekOffset(o => o + delta)}
      />

      {loading && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--color-muted)', fontSize: 13 }}>
          {copy.common.loading}
        </div>
      )}

      {!loading && totalItems === 0 && (
        <EmptyState
          icon={isBabysitter ? 'eye' : 'calendar-blank'}
          title={isBabysitter ? copy.empty.weekSitter.title : copy.empty.week.title}
          sub={isBabysitter ? copy.empty.weekSitter.sub : copy.empty.week.sub}
        />
      )}

      {!loading && (
        <div style={{ padding: '0 16px calc(var(--nav-height) + 88px)' }}>
          {grouped.map(g => {
            const showDay = g.items.length > 0 || g.isToday
            if (!showDay) return null
            return (
              <div
                key={g.dateStr}
                ref={el => { dayRefs.current[g.dateStr] = el }}
                style={{ marginBottom: 28 }}
              >
                <SectionHead
                  variant="day"
                  title={formatDayTitle(g.date)}
                  meta={g.items.length > 0 ? copy.week.programCount(g.items.length) : undefined}
                />
                {g.items.length === 0 && g.isToday && (
                  <p style={{ fontSize: 13.5, color: 'var(--color-text-2)', margin: 0 }}>{copy.week.emptyToday}</p>
                )}
                {g.items.map(occ => {
                  const child = personById(occ.person_id)
                  const loc = locationById(occ.location_id)
                  const cancelled = occ.status === 'cancelled'
                  const dropoff = occ.legs.find(l => l.direction === 'dropoff')
                  const pickup = occ.legs.find(l => l.direction === 'pickup')
                  const bothSelf = !!(dropoff?.self_transport && pickup?.self_transport)
                  const place = occ.custom_location_text
                    || (loc && !loc.is_home ? loc.name : null)
                  return (
                    <article key={occ.id} className={`week-event${cancelled ? ' is-cancelled' : ''}`}>
                      <div className="week-event-head">
                        <div className="week-event-time">
                          <div className="week-event-start">{occ.starts_at.slice(0, 5)}</div>
                          {!cancelled && <div className="week-event-end">{occ.ends_at.slice(0, 5)}</div>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="week-event-title">
                            <span className="week-event-dot" style={{ background: child?.color ?? 'var(--color-border)', opacity: cancelled ? 0.6 : 1 }} />
                            <span className="week-event-title-text">
                              {child ? `${child.display_name} · ${occ.title}` : occ.title}
                            </span>
                          </div>
                          {cancelled ? (
                            <div className="week-event-place" style={{ color: 'var(--color-warn)', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <Icon name="prohibit" size={13} weight="fill" />
                              {occ.note ? copy.status.cancelledWithReason(occ.note) : copy.status.cancelled}
                            </div>
                          ) : place ? (
                            <div className="week-event-place">{place}</div>
                          ) : null}
                        </div>
                        {isAdmin && (
                          <button
                            type="button"
                            className="week-event-menu"
                            onClick={() => setSelectedOcc(occ)}
                            aria-label={copy.a11y.moreActions}
                          >
                            <Icon name="dots-three" size={20} />
                          </button>
                        )}
                      </div>

                      {!cancelled && (dropoff || pickup) && (
                        <div className="week-event-rides">
                          {bothSelf ? (
                            <div className="week-ride-row">
                              <span className="week-ride-label">{copy.status.self}</span>
                              <Avatar variant="self" size={26} />
                              <span className="week-ride-name">{copy.week.bothWaysSelf}</span>
                            </div>
                          ) : sortLegs(occ.legs).map(leg => {
                            const open = !leg.driver_id && !leg.self_transport
                            const driver = personById(leg.driver_id)
                            const together = togetherLabel(leg, occ)
                            const mine = myId && (leg.driver_id === myId || leg.companion_id === myId || leg.companion2_id === myId)
                            return (
                              <div key={leg.id} className="week-ride-row">
                                <span className="week-ride-label">
                                  {leg.self_transport ? copy.status.self : directionWord(leg.direction)}
                                </span>
                                {open ? (
                                  <>
                                    <Pill tone="danger">{copy.status.noDriver}</Pill>
                                    {canAssignOthers && (
                                      <button
                                        type="button"
                                        className="week-ride-action"
                                        onClick={() => nav(`/fuvarok?ride=${leg.id}`)}
                                      >
                                        {copy.week.assign}
                                      </button>
                                    )}
                                    {canSelfAssign && !canAssignOthers && myId && (
                                      <button
                                        type="button"
                                        className="week-ride-action claim"
                                        onClick={() => {
                                          claim(leg.id, myId)
                                          show({
                                            text: rideWriteToast({
                                              driver: person,
                                              child: personById(occ.person_id),
                                              direction: leg.direction,
                                              self: false,
                                            }),
                                            undo: () => release(leg.id),
                                          })
                                        }}
                                      >
                                        {copy.rides.claim}
                                      </button>
                                    )}
                                  </>
                                ) : leg.self_transport ? (
                                  <>
                                    <Avatar variant="self" size={26} />
                                    <span className="week-ride-name">{copy.status.selfGoes}</span>
                                  </>
                                ) : (
                                  <>
                                    <Avatar person={driver} size={26} householdNames={householdNames} />
                                    <span className="week-ride-name">{driver?.display_name}</span>
                                    {together && (
                                      <span className="week-ride-together">
                                        <Icon name="users-three" size={12} weight="fill" />
                                        {together}
                                      </span>
                                    )}
                                    {isBabysitter && mine && canReleaseOwn && (
                                      <button
                                        type="button"
                                        className="week-ride-action release"
                                        onClick={() => {
                                          const prevDriver = leg.driver_id
                                          release(leg.id)
                                          show({
                                            text: rideWriteToast({
                                              driver: null,
                                              child: personById(occ.person_id),
                                              direction: leg.direction,
                                              self: false,
                                            }),
                                            undo: () => prevDriver ? assign(leg.id, prevDriver) : claim(leg.id, myId!),
                                          })
                                        }}
                                      >
                                        {copy.rides.cantTake}
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {isAdmin && (
        <button
          type="button"
          className="week-fab"
          onClick={() => setShowNew(true)}
          aria-label={copy.a11y.addEvent}
        >
          <Icon name="plus" size={26} />
        </button>
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
      {showNew && householdId && (
        <NewEventSheet
          householdId={householdId}
          date={selectedDay}
          childrenPeople={children}
          locations={locations}
          home={home}
          householdNames={householdNames}
          onClose={() => setShowNew(false)}
          onDone={() => {
            setShowNew(false)
            setReloadKey(k => k + 1)
          }}
        />
      )}
    </div>
  )
}
