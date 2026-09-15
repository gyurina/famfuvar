import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Header } from '../components/Header'
import { Avatar } from '../components/Avatar'
import { Icon, type IconName } from '../components/Icon'
import { copy } from '../copy'
import { useAuth } from '../lib/auth'
import { useRole } from '../hooks/useRole'
import { useHousehold } from '../hooks/useHousehold'
import { getPref, setPref, PREF_HIDE_CANCELLED } from '../lib/prefs'
import { isPushSupported, isPushSubscribed } from '../lib/push'
import { fetchGoogleCalendars } from '../lib/googleCalendar'
import { supabase } from '../lib/supabase'
import { formatMonthDay, toIsoDate } from '../lib/format'
import type { BreakPeriod } from '../types'

export function More() {
  const { person, signOut } = useAuth()
  const { isAdmin, isSysAdmin, isGrandparent, isBabysitter } = useRole()
  const { persons, drivers, children, locations, travelTimes, householdId } = useHousehold()
  const [householdName, setHouseholdName] = useState('')
  const [templateCount, setTemplateCount] = useState(0)
  const [lastTpl, setLastTpl] = useState<string | null>(null)
  const [activeBreak, setActiveBreak] = useState<BreakPeriod | null>(null)
  const [googleCount, setGoogleCount] = useState(0)
  const [pushOn, setPushOn] = useState(false)
  const [hideCancelled, setHideCancelled] = useState(() => getPref(PREF_HIDE_CANCELLED))

  useEffect(() => {
    if (!householdId) return
    supabase.from('household').select('name').eq('id', householdId).maybeSingle()
      .then(({ data }) => { if (data?.name) setHouseholdName(data.name) })
    supabase.from('schedule_template').select('id, valid_from')
      .eq('household_id', householdId)
      .then(({ data }) => {
        setTemplateCount(data?.length ?? 0)
        const latest = (data ?? []).map(r => r.valid_from).filter(Boolean).sort().at(-1)
        setLastTpl(latest ?? null)
      })
    const today = toIsoDate(new Date())
    supabase.from('break_period').select('*')
      .eq('household_id', householdId)
      .gte('date_to', today)
      .lte('date_from', today)
      .then(({ data }) => { setActiveBreak((data ?? [])[0] ?? null) })
    fetchGoogleCalendars(householdId).then(c => setGoogleCount(c.length)).catch(() => {})
    if (isPushSupported()) isPushSubscribed().then(setPushOn)
  }, [householdId])

  const missingTravel = locations.filter(l => !l.is_home && !l.is_tbd).reduce((n, loc) => {
    const home = locations.find(x => x.is_home)
    if (!home) return n
    const there = travelTimes.some(t => t.from_location === home.id && t.to_location === loc.id)
    const back = travelTimes.some(t => t.from_location === loc.id && t.to_location === home.id)
    return n + (there ? 0 : 1) + (back ? 0 : 1)
  }, 0)

  const breakPerson = persons.find(p => p.id === activeBreak?.person_id)
  const breakSub = activeBreak && breakPerson
    ? copy.more.breaksActive(breakPerson.display_name, formatMonthDay(activeBreak.date_to))
    : copy.more.breaksNone
  const breakWarn = !!activeBreak

  const scheduleSub = templateCount === 0
    ? copy.more.scheduleSubNone
    : copy.more.scheduleSub(templateCount, lastTpl ? formatMonthDay(lastTpl) : copy.common.dash)

  const placesSub = copy.more.placesSub(locations.length, missingTravel)
  const placesWarn = missingTravel > 0

  function toggleHide() {
    const v = !hideCancelled
    setHideCancelled(v)
    setPref(PREF_HIDE_CANCELLED, v)
  }

  function row(
    to: string,
    icon: IconName,
    title: string,
    sub: string,
    warn?: boolean,
    readOnly?: boolean,
  ) {
    const inner = (
      <>
        <Icon name={icon} size={21} color="var(--color-accent-ink)" />
        <span className="more-row-text">
          <span className="more-row-title">{title}</span>
          <span className={`more-row-sub${warn ? ' warn' : ''}`}>{sub}</span>
        </span>
        {!readOnly && <Icon name="caret-right" size={17} color="var(--color-muted)" />}
      </>
    )
    if (readOnly) {
      return (
        <Link key={to} to={to} className="more-row">
          {inner}
        </Link>
      )
    }
    return <Link key={to} to={to} className="more-row">{inner}</Link>
  }

  return (
    <div>
      <Header title={copy.more.title} chrome={false} />
      <div className="more-page">
        {person && (
          <div className="more-profile">
            <Avatar person={person} size={46} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="more-profile-name">{person.display_name}</div>
              <div className="more-profile-sub">
                {copy.more.roleHousehold(copy.role[person.role], householdName || copy.common.dash)}
              </div>
            </div>
          </div>
        )}

        {!isBabysitter && (
          <>
            <div className="more-group-label">{copy.more.familyLife}</div>
            <div className="more-group">
              {row('/egyeb/orarend', 'calendar-dots', copy.more.schedule, scheduleSub, false, isGrandparent)}
              {isAdmin && row(
                '/egyeb/szunetek',
                'bed',
                copy.more.breaks,
                breakSub,
                breakWarn,
              )}
              {row(
                '/egyeb/csalad',
                'users-three',
                copy.more.family,
                copy.more.familySub(persons.length, drivers.length, children.length),
                false,
                isGrandparent,
              )}
              {row(
                '/egyeb/helyszinek',
                'map-pin',
                copy.more.places,
                placesSub,
                placesWarn,
                isGrandparent,
              )}
            </div>
          </>
        )}

        <div className="more-group-label">{copy.more.app}</div>
        <div className="more-group">
          {row(
            '/egyeb/ertesitesek',
            'bell',
            copy.more.notifications,
            pushOn ? copy.more.notificationsOn : copy.more.notificationsOff,
            !pushOn,
          )}
          {isAdmin && row(
            '/egyeb/uzenet',
            'paper-plane',
            copy.more.message,
            copy.more.messageSub,
          )}
          {isAdmin && row(
            '/egyeb/naptarak',
            'google-logo',
            copy.more.google,
            copy.more.googleSub(googleCount),
          )}
          <button type="button" className="more-row" onClick={toggleHide}>
            <Icon name="eye-slash" size={21} color="var(--color-accent-ink)" />
            <span className="more-row-text">
              <span className="more-row-title">{copy.more.hideCancelled}</span>
            </span>
            <span
              style={{
                width: 46, height: 28, borderRadius: 100, flex: 'none',
                background: hideCancelled ? 'var(--color-accent)' : 'var(--color-surface-2)',
                display: 'flex', alignItems: 'center',
                justifyContent: hideCancelled ? 'flex-end' : 'flex-start',
                padding: 3,
              }}
            >
              <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#fff' }} />
            </span>
          </button>
        </div>

        {isSysAdmin && (
          <>
            <div className="more-group-label">{copy.more.adminGroup}</div>
            <div className="more-group">
              {row('/egyeb/naplo', 'clipboard', copy.more.naplo, copy.more.naploSub)}
              {row('/egyeb/posta', 'list', copy.more.posta, copy.more.postaSub)}
              {row('/egyeb/rendszer', 'gear', copy.more.rendszer, copy.more.rendszerSub)}
            </div>
          </>
        )}

        <button type="button" className="more-signout" onClick={signOut}>
          <Icon name="sign-out" size={19} />
          {copy.more.signOut}
        </button>
        <div className="more-version">{copy.more.version(__APP_VERSION__)}</div>
      </div>
    </div>
  )
}
