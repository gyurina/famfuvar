import { useState, useEffect } from 'react'
import { Header } from '../components/Header'
import { supabase } from '../lib/supabase'
import { useHousehold } from '../hooks/useHousehold'
import { useAuth } from '../lib/auth'
import { useRole } from '../hooks/useRole'
import { getPref, setPref, PREF_HIDE_CANCELLED } from '../lib/prefs'
import type { ExternalCalendar, Location, TravelTime, DriverAvailability, UnavailableBlock, TravelGroup, TravelGroupMember, PushLog, BreakPeriod, PersonRole } from '../types'
import { isPushSupported, isPushSubscribed, subscribeToPush, unsubscribeFromPush } from '../lib/push'
import { startGoogleAuth, syncNow, disconnectGoogle, fetchGoogleCalendars } from '../lib/googleCalendar'
import { forceRegenerateLegs } from '../lib/occurrences'
import { copy } from '../copy'
import { formatShortDate, formatDateTime } from '../lib/format'
import { Icon } from '../components/Icon'
import { BreakSheet } from '../components/BreakSheet'
import { useToast } from '../components/Toast'
type Tab = 'helyszin' | 'utido' | 'elerheto' | 'nem_elerheto' | 'csoportok' | 'szunetek' | 'naptarak' | 'push' | 'diagnozis'
export type SettingsSection = 'helyszinek' | 'szunetek' | 'ertesitesek' | 'uzenet' | 'naptarak'

const SECTION_TABS: Record<SettingsSection, Tab[]> = {
  helyszinek: ['helyszin', 'utido'],
  szunetek: ['szunetek'],
  ertesitesek: [],
  uzenet: ['push'],
  naptarak: ['naptarak'],
}

const SECTION_DEFAULT: Record<SettingsSection, Tab> = {
  helyszinek: 'helyszin',
  szunetek: 'szunetek',
  ertesitesek: 'helyszin',
  uzenet: 'push',
  naptarak: 'naptarak',
}

const SECTION_TITLE: Record<SettingsSection, string> = {
  helyszinek: copy.settings.tabs.locations,
  szunetek: copy.settings.tabs.absences,
  ertesitesek: copy.more.notifications,
  uzenet: copy.more.message,
  naptarak: copy.more.google,
}

const inp: React.CSSProperties = {
  width: '100%', padding: '6px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
  color: 'var(--color-text)', outline: 'none',
}
const btnPrimary: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
  background: 'var(--color-blue)', color: '#fff', border: 'none', cursor: 'pointer', minHeight: 34,
}
const btnGhost: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 8, fontSize: 12,
  background: 'transparent', color: 'var(--color-muted)',
  border: '1px solid var(--color-border)', cursor: 'pointer', minHeight: 34,
}
const btnDanger: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 8, fontSize: 12,
  background: 'transparent', color: '#fca5a5',
  border: '1px solid #7f1d1d', cursor: 'pointer', minHeight: 34,
}

export function Beallitasok({ section }: { section?: SettingsSection } = {}) {
  const { signOut, person } = useAuth()
  const { canEditHousehold } = useRole()
  const { show } = useToast()
  const {
    persons, drivers,
    locations: initLocations,
    travelTimes: initTravelTimes,
    availabilities: initAvails,
    householdId,
  } = useHousehold()

  const [tab, setTab] = useState<Tab>(section ? SECTION_DEFAULT[section] : 'helyszin')
  const [extCals, setExtCals] = useState<ExternalCalendar[]>([])
  const [hideCancelled, setHideCancelled] = useState(() => getPref(PREF_HIDE_CANCELLED))

  // Push értesítés állapot
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [googleCals, setGoogleCals] = useState<Array<{ id: string; person_id: string; display_name: string; last_synced_at: string | null }>>([])
  const [syncing, setSyncing]       = useState(false)
  const [googleMsg, setGoogleMsg]   = useState<string | null>(null)
  const [googleOk, setGoogleOk]     = useState(false)
  const [pushOk, setPushOk]         = useState(false)
  const pushSupported = isPushSupported()

  useEffect(() => {
    isPushSubscribed().then(setPushEnabled)
  }, [])

  async function togglePush() {
    setPushLoading(true)
    if (pushEnabled) {
      await unsubscribeFromPush()
      setPushEnabled(false)
    } else {
      if (!householdId) return
      const ok = await subscribeToPush(householdId)
      setPushEnabled(ok)
    }
    setPushLoading(false)
  }

  // Local editable copies
  const [locations, setLocations] = useState<Location[]>([])
  const [travelTimes, setTravelTimes] = useState<TravelTime[]>([])
  const [availabilities, setAvailabilities] = useState<DriverAvailability[]>([])
  const [unavailBlocks, setUnavailBlocks] = useState<UnavailableBlock[]>([])
  const [unavailLoading, setUnavailLoading] = useState(false)
  const [newUnavail, setNewUnavail] = useState<{ personId: string; weekday: number } | null>(null)
  const [newUnavailFrom, setNewUnavailFrom] = useState('00:00')
  const [newUnavailTo, setNewUnavailTo] = useState('23:59')
  const [newUnavailLabel, setNewUnavailLabel] = useState('')
  const [unavailSaving, setUnavailSaving] = useState(false)
  const [unavailError, setUnavailError] = useState<string | null>(null)

  // Custom push message state
  const [pushTitle, setPushTitle] = useState('')
  const [pushBody, setPushBody] = useState('')
  const [pushTargetIds, setPushTargetIds] = useState<string[]>([])
  const [pushSending, setPushSending] = useState(false)
  const [pushResult, setPushResult] = useState<string | null>(null)
  const [pushLogs, setPushLogs] = useState<PushLog[]>([])
  const [pushLogsLoading, setPushLogsLoading] = useState(false)

  async function refreshPushLogs() {
    if (!householdId) return
    setPushLogsLoading(true)
    const { data: logs } = await supabase.from('push_log')
      .select('id, title, body, sent_at, target_count, sent_count, failed_count, sent_by')
      .eq('household_id', householdId)
      .order('sent_at', { ascending: false })
      .limit(10)
    if (!logs?.length) { setPushLogs([]); setPushLogsLoading(false); return }
    const logIds = logs.map(l => l.id)
    const { data: receipts } = await supabase
      .from('push_log_receipt')
      .select('log_id, event')
      .in('log_id', logIds)
    const countMap: Record<string, { delivered: number; clicked: number }> = {}
    for (const r of receipts ?? []) {
      if (!countMap[r.log_id]) countMap[r.log_id] = { delivered: 0, clicked: 0 }
      if (r.event === 'delivered') countMap[r.log_id].delivered++
      if (r.event === 'clicked') countMap[r.log_id].clicked++
    }
    setPushLogs(logs.map(l => ({
      ...l,
      delivered_count: countMap[l.id]?.delivered ?? 0,
      clicked_count:   countMap[l.id]?.clicked   ?? 0,
    })) as PushLog[])
    setPushLogsLoading(false)
  }

  async function sendCustomPush() {
    if (!householdId || !pushTitle.trim()) return
    setPushSending(true)
    setPushResult(null)
    const { data: { session } } = await supabase.auth.getSession()
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-custom`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            household_id: householdId,
            person_ids: pushTargetIds,
            title: pushTitle.trim(),
            body: pushBody.trim(),
            sent_by: person?.id ?? null,
          }),
        }
      )
      const json = await res.json()
      setPushResult(copy.settings.pushSent(json.sent ?? 0, json.failed))
      setPushOk(true)
      setPushTitle(''); setPushBody(''); setPushTargetIds([])
      await refreshPushLogs()
    } catch (e) {
      setPushResult(copy.settings.pushError(String(e)))
      setPushOk(false)
    }
    setPushSending(false)
  }

  useEffect(() => {
    if (!householdId || tab !== 'push') return
    refreshPushLogs()
  }, [householdId, tab])

  useEffect(() => { setLocations(initLocations) }, [initLocations])
  useEffect(() => { setTravelTimes(initTravelTimes) }, [initTravelTimes])
  useEffect(() => { setAvailabilities(initAvails) }, [initAvails])

  useEffect(() => {
    if (!householdId || tab !== 'nem_elerheto') return
    setUnavailLoading(true)
    supabase.from('unavailable_block').select('*')
      .eq('household_id', householdId)
      .order('weekday').order('from_time')
      .then(({ data }) => {
        setUnavailBlocks((data ?? []) as UnavailableBlock[])
        setUnavailLoading(false)
      })
  }, [householdId, tab])

  async function addUnavailBlock() {
    if (!householdId || !newUnavail) return
    setUnavailSaving(true)
    setUnavailError(null)
    const { data, error } = await supabase.from('unavailable_block').insert({
      household_id: householdId,
      person_id: newUnavail.personId,
      weekday: newUnavail.weekday,
      from_time: newUnavailFrom + ':00',
      to_time: newUnavailTo + ':00',
      label: newUnavailLabel.trim() || null,
    }).select().single()
    if (error) { setUnavailError(error.message); setUnavailSaving(false); return }
    setUnavailBlocks(bs => [...bs, data as UnavailableBlock])
    setNewUnavail(null); setNewUnavailLabel(''); setUnavailSaving(false)
  }

  async function deleteUnavailBlock(id: string) {
    await supabase.from('unavailable_block').delete().eq('id', id)
    setUnavailBlocks(bs => bs.filter(b => b.id !== id))
  }

  // Google Calendar: URL param kezelés + betöltés
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const googleStatus = params.get('google')
    if (googleStatus === 'connected') {
      setGoogleMsg(copy.settings.googleOk)
      setGoogleOk(true)
      window.history.replaceState({}, '', window.location.pathname)
    } else if (googleStatus === 'error') {
      setGoogleMsg(copy.settings.googleFail)
      setGoogleOk(false)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  useEffect(() => {
    if (!householdId) return
    fetchGoogleCalendars(householdId).then(setGoogleCals)
  }, [householdId])

  useEffect(() => {
    if (!householdId) return
    supabase.from('external_calendar').select('*').eq('household_id', householdId).then(({ data }) => {
      setExtCals(data ?? [])
    })
  }, [householdId])

  function toggleHideCancelled() {
    const v = !hideCancelled
    setHideCancelled(v)
    setPref(PREF_HIDE_CANCELLED, v)
  }

  const allTabs: { key: Tab; label: string }[] = [
    { key: 'helyszin', label: copy.settings.tabs.locations },
    { key: 'utido',    label: copy.settings.tabs.travel },
    { key: 'elerheto', label: copy.settings.tabs.available },
    { key: 'nem_elerheto', label: copy.settings.tabs.unavailable },
    { key: 'naptarak', label: copy.settings.tabs.calendars },
    { key: 'csoportok', label: copy.settings.tabs.groups },
    { key: 'szunetek',  label: copy.settings.tabs.absences },
    { key: 'push',      label: copy.settings.tabs.message },
    { key: 'diagnozis', label: copy.settings.tabs.diagnose },
  ]
  const tabs = section
    ? allTabs.filter(t => SECTION_TABS[section].includes(t.key))
    : allTabs

  // ── Helyszínek state ──
  const [editLocId, setEditLocId] = useState<string | null>(null)
  const [editLocName, setEditLocName] = useState('')
  const [editLocAddr, setEditLocAddr] = useState('')
  const [newLocOpen, setNewLocOpen] = useState(false)
  const [newLocName, setNewLocName] = useState('')
  const [newLocAddr, setNewLocAddr] = useState('')
  const [newLocHome, setNewLocHome] = useState(false)
  const [newLocTbd, setNewLocTbd] = useState(false)
  const [editLocTbd, setEditLocTbd] = useState(false)
  const [locSaving, setLocSaving] = useState(false)
  const [locError, setLocError] = useState<string | null>(null)

  function startEditLoc(loc: Location) {
    setEditLocId(loc.id)
    setEditLocName(loc.name)
    setEditLocAddr(loc.address ?? '')
    setEditLocTbd(loc.is_tbd)
    setLocError(null)
  }

  async function saveLoc() {
    if (!editLocId) return
    setLocSaving(true); setLocError(null)
    const { error } = await supabase.from('location')
      .update({ name: editLocName.trim(), address: editLocAddr.trim() || null, is_tbd: editLocTbd })
      .eq('id', editLocId)
    setLocSaving(false)
    if (error) { setLocError(error.message); return }
    setLocations(ls => ls.map(l => l.id === editLocId
      ? { ...l, name: editLocName.trim(), address: editLocAddr.trim() || null, is_tbd: editLocTbd }
      : l))
    setEditLocId(null)
  }

  async function deleteLoc(id: string) {
    if (!confirm(copy.settings.confirmDeleteLocation)) return
    const { error } = await supabase.from('location').delete().eq('id', id)
    if (error) { alert(error.message); return }
    setLocations(ls => ls.filter(l => l.id !== id))
  }

  async function addLoc() {
    if (!newLocName.trim() || !householdId) return
    setLocSaving(true); setLocError(null)
    const { data, error } = await supabase.from('location').insert({
      household_id: householdId,
      name: newLocName.trim(),
      address: newLocAddr.trim() || null,
      is_home: newLocHome,
      is_tbd: newLocTbd,
    }).select().single()
    setLocSaving(false)
    if (error) { setLocError(error.message); return }
    setLocations(ls => [...ls, data as Location])
    setNewLocName(''); setNewLocAddr(''); setNewLocHome(false); setNewLocTbd(false); setNewLocOpen(false)
  }

  // ── Útidő state ──
  const [editTT, setEditTT] = useState<{ from: string; to: string } | null>(null)
  const [editTTMin, setEditTTMin] = useState('')
  const [newTTOpen, setNewTTOpen] = useState(false)
  const [newTTFrom, setNewTTFrom] = useState('')
  const [newTTTo, setNewTTTo] = useState('')
  const [newTTMin, setNewTTMin] = useState('')
  const [ttSaving, setTTSaving] = useState(false)
  const [ttError, setTTError] = useState<string | null>(null)

  function startEditTT(tt: TravelTime) {
    setEditTT({ from: tt.from_location, to: tt.to_location })
    setEditTTMin(String(tt.minutes))
    setTTError(null)
  }

  async function saveTT() {
    if (!editTT) return
    const mins = parseInt(editTTMin, 10)
    if (isNaN(mins) || mins < 1) { setTTError(copy.settings.invalidMinutes); return }
    setTTSaving(true); setTTError(null)
    const { error } = await supabase.from('travel_time')
      .update({ minutes: mins })
      .eq('from_location', editTT.from)
      .eq('to_location', editTT.to)
    setTTSaving(false)
    if (error) { setTTError(error.message); return }
    setTravelTimes(tts => tts.map(tt =>
      tt.from_location === editTT.from && tt.to_location === editTT.to
        ? { ...tt, minutes: mins } : tt))
    setEditTT(null)
  }

  async function deleteTT(from: string, to: string) {
    if (!confirm(copy.settings.confirmDeleteRoute)) return
    const { error } = await supabase.from('travel_time')
      .delete().eq('from_location', from).eq('to_location', to)
    if (error) { alert(error.message); return }
    setTravelTimes(tts => tts.filter(tt => !(tt.from_location === from && tt.to_location === to)))
  }

  async function addTT() {
    if (!newTTFrom || !newTTTo || !householdId) return
    const mins = parseInt(newTTMin, 10)
    if (isNaN(mins) || mins < 1) { setTTError(copy.settings.invalidMinutes); return }
    setTTSaving(true); setTTError(null)
    const { data, error } = await supabase.from('travel_time').insert({
      household_id: householdId,
      from_location: newTTFrom,
      to_location: newTTTo,
      minutes: mins,
    }).select().single()
    setTTSaving(false)
    if (error) { setTTError(error.message); return }
    setTravelTimes(tts => [...tts, data as TravelTime])
    setNewTTFrom(''); setNewTTTo(''); setNewTTMin(''); setNewTTOpen(false)
  }

  // ── Elérhetőség state ──
  const [newSlot, setNewSlot] = useState<{ personId: string; weekday: number } | null>(null)
  const [newSlotFrom, setNewSlotFrom] = useState('08:00')
  const [newSlotTo, setNewSlotTo] = useState('18:00')
  const [availSaving, setAvailSaving] = useState(false)
  const [availError, setAvailError] = useState<string | null>(null)

  async function deleteAvail(id: string) {
    const { error } = await supabase.from('driver_availability').delete().eq('id', id)
    if (error) { alert(error.message); return }
    setAvailabilities(avs => avs.filter(a => a.id !== id))
  }

  async function addAvail() {
    if (!newSlot || !householdId) return
    setAvailSaving(true); setAvailError(null)
    const { data, error } = await supabase.from('driver_availability').insert({
      household_id: householdId,
      person_id: newSlot.personId,
      weekday: newSlot.weekday,
      from_time: newSlotFrom + ':00',
      to_time: newSlotTo + ':00',
    }).select().single()
    setAvailSaving(false)
    if (error) { setAvailError(error.message); return }
    setAvailabilities(avs => [...avs, data as DriverAvailability])
    setNewSlot(null); setNewSlotFrom('08:00'); setNewSlotTo('18:00')
  }

  // ── Csoportok state ──
  const [groups, setGroups] = useState<(TravelGroup & { members: TravelGroupMember[] })[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [groupFormOpen, setGroupFormOpen] = useState(false)
  const [editGroup, setEditGroup] = useState<(TravelGroup & { members: TravelGroupMember[] }) | null>(null)
  const [groupName, setGroupName] = useState('')
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([])
  const [groupSaving, setGroupSaving] = useState(false)
  const [groupError, setGroupError] = useState<string | null>(null)
  const [groupDeleteConfirm, setGroupDeleteConfirm] = useState<string | null>(null)

  useEffect(() => {
    if (!householdId || tab !== 'csoportok') return
    setGroupsLoading(true)
    supabase.from('travel_group').select('*, travel_group_member(person_id)')
      .eq('household_id', householdId)
      .order('name')
      .then(({ data }) => {
        setGroups((data ?? []).map((g: any) => ({
          ...g,
          members: (g.travel_group_member ?? []) as TravelGroupMember[],
        })))
        setGroupsLoading(false)
      })
  }, [householdId, tab])

  function openNewGroup() {
    setEditGroup(null)
    setGroupName('')
    setGroupMemberIds([])
    setGroupError(null)
    setGroupDeleteConfirm(null)
    setGroupFormOpen(true)
  }

  function openEditGroup(g: TravelGroup & { members: TravelGroupMember[] }) {
    setEditGroup(g)
    setGroupName(g.name)
    setGroupMemberIds(g.members.map(m => m.person_id).filter((id): id is string => id !== null))
    setGroupError(null)
    setGroupDeleteConfirm(null)
    setGroupFormOpen(true)
  }

  async function saveGroup() {
    if (!householdId || !groupName.trim()) { setGroupError(copy.settings.groupNameRequired); return }
    if (groupMemberIds.length < 2) { setGroupError(copy.settings.groupMinMembers); return }
    setGroupSaving(true); setGroupError(null)
    if (editGroup) {
      const { error } = await supabase.from('travel_group').update({ name: groupName.trim() }).eq('id', editGroup.id)
      if (error) { setGroupError(error.message); setGroupSaving(false); return }
      await supabase.from('travel_group_member').delete().eq('group_id', editGroup.id)
      await supabase.from('travel_group_member').insert(groupMemberIds.map(pid => ({ group_id: editGroup.id, person_id: pid })))
      setGroups(gs => gs.map(g => g.id === editGroup.id
        ? { ...g, name: groupName.trim(), members: groupMemberIds.map(pid => ({ group_id: editGroup.id, person_id: pid })) }
        : g))
    } else {
      const { data, error } = await supabase.from('travel_group').insert({ household_id: householdId, name: groupName.trim() }).select().single()
      if (error) { setGroupError(error.message); setGroupSaving(false); return }
      await supabase.from('travel_group_member').insert(groupMemberIds.map(pid => ({ group_id: data.id, person_id: pid })))
      setGroups(gs => [...gs, { ...data, members: groupMemberIds.map(pid => ({ group_id: data.id, person_id: pid })) }])
    }
    setGroupSaving(false); setGroupFormOpen(false)
  }

  async function deleteGroup(id: string) {
    await supabase.from('travel_group').delete().eq('id', id)
    setGroups(gs => gs.filter(g => g.id !== id))
    setGroupDeleteConfirm(null); setGroupFormOpen(false)
  }


  // ── Szünet-időszakok state ───────────────────────────────────────────────
  const [breakPeriods, setBreakPeriods] = useState<BreakPeriod[]>([])
  const [breakLoading, setBreakLoading] = useState(false)
  const [newBreakOpen, setNewBreakOpen] = useState(false)
  const [breakError, setBreakError] = useState<string | null>(null)
  const [breakMsg, setBreakMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!householdId || tab !== 'szunetek') return
    setBreakLoading(true)
    supabase.from('break_period').select('*')
      .eq('household_id', householdId)
      .order('date_from', { ascending: false })
      .then(({ data }) => {
        setBreakPeriods((data ?? []) as BreakPeriod[])
        setBreakLoading(false)
      })
  }, [householdId, tab])

  async function deleteBreakPeriod(bp: BreakPeriod) {
    if (!confirm(copy.settings.confirmDeleteBreak)) return
    setBreakMsg(null)
    const { data: cnt } = await supabase.rpc('revert_break_period', {
      p_household_id: bp.household_id,
      p_person_id: bp.person_id,
      p_date_from: bp.date_from,
      p_date_to: bp.date_to,
    })
    await supabase.from('break_period').delete().eq('id', bp.id)
    setBreakPeriods(bs => bs.filter(b => b.id !== bp.id))
    setBreakMsg(copy.settings.breakDeleted(cnt ?? 0))
    show({ text: copy.settings.breakDeleted(cnt ?? 0) })
  }

  // ── Diagnózis state ──────────────────────────────────────────────────────
  type DiagSeverity = 'ok' | 'warn' | 'error'
  type DiagResult = { id: string; severity: DiagSeverity; label: string; detail?: string; fixable?: boolean; fixIds?: string[] }

  const [diagRunning, setDiagRunning] = useState(false)
  const [diagResults, setDiagResults] = useState<DiagResult[] | null>(null)
  const [fixingId, setFixingId] = useState<string | null>(null)

  async function fixResult(r: DiagResult) {
    if (!r.fixIds?.length) return
    setFixingId(r.id)
    try {
      if (r.id === 'cancelled_legs' || r.id === 'orphan_legs') {
        // Leg-ek törlése
        for (const legId of r.fixIds) {
          await supabase.from('transport_leg').delete().eq('id', legId)
        }
      } else if (r.id === 'legs_missing' || r.id === 'legs_incomplete') {
        // Leg regeneráció occurrence-ként
        for (const occId of r.fixIds) {
          await forceRegenerateLegs(occId)
        }
      }
      await runDiagnosis()
    } catch (e: unknown) {
      alert(copy.settings.diagnoseFixError(e instanceof Error ? e.message : String(e)))
    }
    setFixingId(null)
  }

  async function runDiagnosis() {
    if (!householdId) return
    setDiagRunning(true)
    setDiagResults(null)
    const results: DiagResult[] = []

    try {
      // Adatok lekérése
      const [occRes, legRes, tplRes, locRes, ttRes] = await Promise.all([
        supabase.from('occurrence').select('*').eq('household_id', householdId),
        supabase.from('transport_leg').select('*').eq('household_id', householdId),
        supabase.from('schedule_template').select('*').eq('household_id', householdId),
        supabase.from('location').select('*').eq('household_id', householdId),
        supabase.from('travel_time').select('*').eq('household_id', householdId),
      ])

      const occs  = occRes.data  ?? []
      const legs  = legRes.data  ?? []
      const tpls  = tplRes.data  ?? []
      const locs  = locRes.data  ?? []
      const tts   = ttRes.data   ?? []

      // ── 1. Nincs otthoni helyszín ──────────────────────────────────────
      const homeLoc = locs.find((l: Location) => l.is_home)
      if (!homeLoc) {
        results.push({ id: 'no_home', severity: 'error', label: copy.settings.diagnose.noHome })
      } else {
        results.push({ id: 'home_ok', severity: 'ok', label: copy.settings.diagnose.homeOk(homeLoc.name) })
      }

      // ── 2. Tervezett alkalmak leg nélkül ──────────────────────────────
      const legsByOcc = new Map<string, { dropoff: boolean; pickup: boolean }>()
      for (const l of legs) {
        const e = legsByOcc.get(l.occurrence_id) ?? { dropoff: false, pickup: false }
        if (l.direction === 'dropoff') e.dropoff = true
        if (l.direction === 'pickup')  e.pickup  = true
        legsByOcc.set(l.occurrence_id, e)
      }

      const plannedNoLeg = occs.filter((o: Record<string, unknown>) =>
        o.status === 'planned' && (o.needs_dropoff || o.needs_pickup) && !legsByOcc.has(o.id as string)
      )
      if (plannedNoLeg.length === 0) {
        results.push({ id: 'legs_ok', severity: 'ok', label: copy.settings.diagnose.ridesOk })
      } else {
        results.push({
          id: 'legs_missing', severity: 'warn',
          label: copy.settings.diagnose.ridesMissing(plannedNoLeg.length),
          detail: plannedNoLeg.slice(0, 5).map((o: Record<string, unknown>) => copy.settings.diagnose.item(formatShortDate(o.on_date as string), String(o.title))).join(', ') + (plannedNoLeg.length > 5 ? '…' : ''),
          fixable: true,
          fixIds: plannedNoLeg.map((o: Record<string, unknown>) => o.id as string),
        })
      }

      // ── 3. Hiányos leg (kell dropoff, de nincs / kell pickup, de nincs) ─
      const incompleteLegs = occs.filter((o: Record<string, unknown>) => {
        if (o.status !== 'planned') return false
        const e = legsByOcc.get(o.id as string)
        if (!e) return false
        return (o.needs_dropoff && !e.dropoff) || (o.needs_pickup && !e.pickup)
      })
      if (incompleteLegs.length === 0) {
        results.push({ id: 'legs_complete_ok', severity: 'ok', label: copy.settings.diagnose.dirsOk })
      } else {
        results.push({
          id: 'legs_incomplete', severity: 'warn',
          label: copy.settings.diagnose.dirsIncomplete(incompleteLegs.length),
          detail: incompleteLegs.slice(0, 5).map((o: Record<string, unknown>) => copy.settings.diagnose.item(formatShortDate(o.on_date as string), String(o.title))).join(', '),
          fixable: true,
          fixIds: incompleteLegs.map((o: Record<string, unknown>) => o.id as string),
        })
      }

      // ── 4. Lemondott alkalom, de még van leg-je ────────────────────────
      const cancelledWithLegs = occs.filter((o: Record<string, unknown>) =>
        o.status === 'cancelled' && legsByOcc.has(o.id as string)
      )
      if (cancelledWithLegs.length === 0) {
        results.push({ id: 'cancelled_ok', severity: 'ok', label: copy.settings.diagnose.cancelledOk })
      } else {
        const cancelledLegIds = legs
          .filter((l: Record<string, unknown>) => cancelledWithLegs.some((o: Record<string, unknown>) => o.id === l.occurrence_id))
          .map((l: Record<string, unknown>) => l.id as string)
        results.push({
          id: 'cancelled_legs', severity: 'error',
          label: copy.settings.diagnose.cancelledHasRides(cancelledWithLegs.length),
          detail: cancelledWithLegs.slice(0, 5).map((o: Record<string, unknown>) => copy.settings.diagnose.item(formatShortDate(o.on_date as string), String(o.title))).join(', '),
          fixable: true,
          fixIds: cancelledLegIds,
        })
      }

      // ── 5. Leg sofőr nélkül ────────────────────────────────────────────
      const legNoDriver = legs.filter((l: Record<string, unknown>) => !l.driver_id)
      if (legNoDriver.length === 0) {
        results.push({ id: 'driver_ok', severity: 'ok', label: copy.settings.diagnose.driversOk })
      } else {
        results.push({
          id: 'driver_missing', severity: 'warn',
          label: copy.settings.diagnose.driversMissing(legNoDriver.length),
        })
      }

      // ── 6. Árva leg (occurrence nem létezik) ──────────────────────────
      const occIds = new Set(occs.map((o: Record<string, unknown>) => o.id as string))
      const orphanLegs = legs.filter((l: Record<string, unknown>) => !occIds.has(l.occurrence_id as string))
      if (orphanLegs.length === 0) {
        results.push({ id: 'orphan_ok', severity: 'ok', label: copy.settings.diagnose.orphanOk })
      } else {
        results.push({
          id: 'orphan_legs', severity: 'error',
          label: copy.settings.diagnose.orphanRides(orphanLegs.length),
          fixable: true,
          fixIds: orphanLegs.map((l: Record<string, unknown>) => l.id as string),
        })
      }

      // ── 7. Sablonok overlap (azonos személy + hét napja, átfedő dátumok) ─
      let overlapCount = 0
      for (let i = 0; i < tpls.length; i++) {
        for (let j = i + 1; j < tpls.length; j++) {
          const a = tpls[i], b = tpls[j]
          if (a.person_id !== b.person_id || a.weekday !== b.weekday) continue
          const aFrom = a.valid_from, aTo = a.valid_to ?? '9999-12-31'
          const bFrom = b.valid_from, bTo = b.valid_to ?? '9999-12-31'
          if (aFrom <= bTo && bFrom <= aTo) overlapCount++
        }
      }
      if (overlapCount === 0) {
        results.push({ id: 'tpl_overlap_ok', severity: 'ok', label: copy.settings.diagnose.overlapOk })
      } else {
        results.push({
          id: 'tpl_overlap', severity: 'error',
          label: copy.settings.diagnose.overlap(overlapCount),
        })
      }

      // ── 8. Hiányzó útidők a sablonok helyszíneihez ───────────────────
      if (homeLoc) {
        const locUsedInTpls = new Set(tpls.map((t: Record<string, unknown>) => t.location_id as string))
        const ttSet = new Set(tts.map((t: Record<string, unknown>) => `${t.from_location}→${t.to_location}`))
        const missingRoutes: string[] = []
        for (const locId of locUsedInTpls) {
          if (locId === homeLoc.id) continue
          const loc = locs.find((l: Location) => l.id === locId)
          if (loc?.is_tbd) continue  // TBD helyszínnek sosem lesz ismert útideje
          const name = loc?.name ?? locId
          if (!ttSet.has(`${homeLoc.id}→${locId}`)) missingRoutes.push(copy.settings.diagnose.homeTo(name))
          if (!ttSet.has(`${locId}→${homeLoc.id}`)) missingRoutes.push(copy.settings.diagnose.toHome(name))
        }
        if (missingRoutes.length === 0) {
          results.push({ id: 'tt_ok', severity: 'ok', label: copy.settings.diagnose.travelOk })
        } else {
          results.push({
            id: 'tt_missing', severity: 'warn',
            label: copy.settings.diagnose.travelMissing(missingRoutes.join(', ')),
          })
        }
      }

      // ── 9. Occurrence starts_at < ends_at ellenőrzés ─────────────────
      const badTimes = occs.filter((o: Record<string, unknown>) =>
        o.starts_at && o.ends_at && (o.starts_at as string) >= (o.ends_at as string)
      )
      if (badTimes.length === 0) {
        results.push({ id: 'times_ok', severity: 'ok', label: copy.settings.diagnose.timesOk })
      } else {
        results.push({
          id: 'times_bad', severity: 'error',
          label: copy.settings.diagnose.timesBad(badTimes.length),
          detail: badTimes.slice(0, 3).map((o: Record<string, unknown>) => copy.settings.diagnose.item(formatShortDate(o.on_date as string), String(o.title))).join(', '),
        })
      }

      // ── 10. Összesítő ─────────────────────────────────────────────────
      const errCount  = results.filter(r => r.severity === 'error').length
      const warnCount = results.filter(r => r.severity === 'warn').length
      results.unshift({
        id: 'summary',
        severity: errCount > 0 ? 'error' : warnCount > 0 ? 'warn' : 'ok',
        label: errCount === 0 && warnCount === 0
          ? copy.settings.diagnose.summaryOk(occs.length, legs.length, tpls.length)
          : copy.settings.diagnose.summaryIssues(errCount, warnCount, occs.length, legs.length),
      })

    } catch (e: unknown) {
      results.push({ id: 'fetch_error', severity: 'error', label: copy.settings.diagnoseFetchError(e instanceof Error ? e.message : String(e)) })
    }

    setDiagResults(results)
    setDiagRunning(false)
  }

  return (
    <div style={{ background: 'var(--color-bg)', minHeight: '100dvh' }}>
      <Header
        title={section ? SECTION_TITLE[section] : copy.settings.title}
        backTo={section ? '/egyeb' : undefined}
        chrome={!section}
      />

      {(!section || section === 'ertesitesek') && (
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
        <div className="section-label" style={{ marginBottom: 10 }}>{copy.settings.appearance}</div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderRadius: 'var(--r-md)',
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{copy.settings.hideCancelled}</div>
            <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
              {copy.settings.hideCancelledHint}
            </div>
          </div>
          <button
            onClick={toggleHideCancelled}
            style={{
              width: 44, height: 26, borderRadius: 13, flexShrink: 0,
              background: hideCancelled ? 'var(--color-blue)' : 'var(--color-surface-2)',
              border: `1px solid ${hideCancelled ? 'var(--color-blue)' : 'var(--color-border)'}`,
              cursor: 'pointer', position: 'relative', transition: 'all 0.2s',
            }}
          >
            <span style={{
              position: 'absolute', top: 3,
              left: hideCancelled ? 20 : 3,
              width: 18, height: 18, borderRadius: '50%',
              background: '#fff', transition: 'left 0.2s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            }} />
          </button>
        </div>

        {pushSupported && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderRadius: 'var(--r-md)', marginTop: 8,
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{copy.settings.push}</div>
              <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
                {copy.settings.pushHint}
              </div>
            </div>
            <button
              onClick={togglePush}
              disabled={pushLoading}
              style={{
                width: 44, height: 26, borderRadius: 13, flexShrink: 0,
                background: pushEnabled ? 'var(--color-blue)' : 'var(--color-surface-2)',
                border: `1px solid ${pushEnabled ? 'var(--color-blue)' : 'var(--color-border)'}`,
                cursor: pushLoading ? 'wait' : 'pointer', position: 'relative', transition: 'all 0.2s',
                opacity: pushLoading ? 0.6 : 1,
              }}
            >
              <span style={{
                position: 'absolute', top: 3,
                left: pushEnabled ? 20 : 3,
                width: 18, height: 18, borderRadius: '50%',
                background: '#fff', transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
            </button>
          </div>
        )}
      </div>
      )}

      {tabs.length > 1 && (
      <div style={{ display: 'flex', gap: 4, padding: '12px 16px', overflowX: 'auto',
                    borderBottom: '1px solid var(--color-border)' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              flexShrink: 0, padding: '6px 12px', borderRadius: 8, fontSize: 12,
              fontWeight: 500, minHeight: 34, border: 'none', cursor: 'pointer',
              background: tab === t.key ? 'var(--color-blue)' : 'var(--color-surface)',
              color: tab === t.key ? '#fff' : 'var(--color-muted)',
            }}>
            {t.label}
          </button>
        ))}
      </div>
      )}

      <div style={{ padding: '16px 16px calc(var(--nav-height) + 40px)' }}>

        {/* ══════════════════════════════════════
            HELYSZÍNEK
        ══════════════════════════════════════ */}
        {tab === 'helyszin' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ fontSize: 12, color: 'var(--color-muted)', margin: '0 0 4px' }}>
              {copy.settings.locationsHint}
            </p>

            {locError && (
              <div style={{ fontSize: 12, color: '#fca5a5', padding: '6px 10px',
                            background: '#450a0a', borderRadius: 8 }}>{locError}</div>
            )}

            {locations.map(loc => (
              <div key={loc.id} style={{
                borderRadius: 12, padding: '12px 14px',
                background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              }}>
                {editLocId === loc.id ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <input style={inp} value={editLocName}
                      onChange={e => setEditLocName(e.target.value)}
                      placeholder={copy.settings.name} />
                    <input style={inp} value={editLocAddr}
                      onChange={e => setEditLocAddr(e.target.value)}
                      placeholder={copy.settings.address} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      <input type="checkbox" checked={editLocTbd}
                        onChange={e => setEditLocTbd(e.target.checked)} />
                      {copy.settings.tbdLabel}
                    </label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button style={btnPrimary} disabled={locSaving} onClick={saveLoc}>
                        {locSaving ? copy.common.working : copy.common.save}
                      </button>
                      <button style={btnGhost} onClick={() => setEditLocId(null)}>{copy.common.cancel}</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {loc.is_home && (
                          <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 6,
                                         background: '#1e3a5f', color: '#93c5fd' }}>{copy.common.home}</span>
                        )}
                        {loc.is_tbd && (
                          <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 6,
                                         background: '#3d2e00', color: '#fbbf24' }}>{copy.status.locationMissing}</span>
                        )}
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{loc.name}</span>
                      </div>
                      {loc.address && (
                        <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 2 }}>
                          {loc.address}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button style={btnGhost} onClick={() => startEditLoc(loc)} aria-label={copy.a11y.edit}><Icon name="pencil" size={14} /></button>
                      <button style={btnDanger} disabled={loc.is_home}
                        title={loc.is_home ? copy.settings.homeCannotDelete : ''}
                        aria-label={copy.a11y.delete}
                        onClick={() => deleteLoc(loc.id)}><Icon name="trash" size={14} /></button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* + Új helyszín */}
            {newLocOpen ? (
              <div style={{
                borderRadius: 12, padding: '12px 14px',
                background: 'var(--color-surface)', border: '1px dashed var(--color-blue)',
                display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-blue)' }}>
                  {copy.settings.newLocation}
                </div>
                <input style={inp} value={newLocName}
                  onChange={e => setNewLocName(e.target.value)}
                  placeholder={copy.settings.nameRequired} />
                <input style={inp} value={newLocAddr}
                  onChange={e => setNewLocAddr(e.target.value)}
                  placeholder={copy.settings.address} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={newLocHome}
                    onChange={e => setNewLocHome(e.target.checked)} />
                  {copy.settings.isHome}
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={newLocTbd}
                    onChange={e => setNewLocTbd(e.target.checked)} />
                  {copy.settings.tbdLabel}
                </label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button style={btnPrimary} disabled={locSaving || !newLocName.trim()} onClick={addLoc}>
                    {locSaving ? copy.common.working : copy.common.add}
                  </button>
                  <button style={btnGhost} onClick={() => { setNewLocOpen(false); setLocError(null) }}>{copy.common.cancel}</button>
                </div>
              </div>
            ) : canEditHousehold ? (
              <button onClick={() => setNewLocOpen(true)} style={{
                ...btnGhost, width: '100%', borderStyle: 'dashed', borderColor: 'var(--color-blue)',
                color: 'var(--color-blue)', fontSize: 13,
              }}>{copy.settings.newLocation}</button>
            ) : null}
          </div>
        )}

        {/* ══════════════════════════════════════
            ÚTIDŐ MÁTRIX
        ══════════════════════════════════════ */}
        {tab === 'utido' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 12, color: 'var(--color-muted)', margin: '0 0 4px' }}>
              {copy.settings.travelHint}
            </p>

            {ttError && (
              <div style={{ fontSize: 12, color: '#fca5a5', padding: '6px 10px',
                            background: '#450a0a', borderRadius: 8 }}>{ttError}</div>
            )}

            <div style={{ borderRadius: 12, overflowX: 'auto', overflowY: 'hidden', border: '1px solid var(--color-border)' }}>
              <table style={{ width: '100%', minWidth: 320, borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--color-surface)',
                                borderBottom: '1px solid var(--color-border)' }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11,
                                  color: 'var(--color-muted)', fontWeight: 500 }}>{copy.settings.travelFrom}</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11,
                                  color: 'var(--color-muted)', fontWeight: 500 }}>{copy.settings.travelTo}</th>
                    <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: 11,
                                  color: 'var(--color-muted)', fontWeight: 500 }}>{copy.settings.travelMins}</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {travelTimes.map(tt => {
                    const from = locations.find(l => l.id === tt.from_location)
                    const to   = locations.find(l => l.id === tt.to_location)
                    const isEditing = editTT?.from === tt.from_location && editTT?.to === tt.to_location
                    return (
                      <tr key={`${tt.from_location}-${tt.to_location}`}
                        style={{ borderTop: '1px solid var(--color-border)' }}>
                        <td style={{ padding: '10px 12px' }}>{from?.name ?? '?'}</td>
                        <td style={{ padding: '10px 12px' }}>{to?.name ?? '?'}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                          {isEditing ? (
                            <input
                              style={{ ...inp, width: 70, textAlign: 'right' }}
                              type="number" min={1} value={editTTMin}
                              onChange={e => setEditTTMin(e.target.value)}
                              onBlur={saveTT}
                              onKeyDown={e => { if (e.key === 'Enter') saveTT(); if (e.key === 'Escape') setEditTT(null) }}
                              autoFocus
                            />
                          ) : (
                            <button
                              onClick={() => startEditTT(tt)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer',
                                        color: 'var(--color-text)', fontWeight: 600, fontSize: 13,
                                        padding: '2px 6px', borderRadius: 6,
                                        textDecoration: 'underline dotted' }}>
                              {tt.minutes}
                            </button>
                          )}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                          <button style={{ ...btnDanger, padding: '4px 8px', fontSize: 12 }}
                            onClick={() => deleteTT(tt.from_location, tt.to_location)} aria-label={copy.a11y.delete}><Icon name="trash" size={14} /></button>
                        </td>
                      </tr>
                    )
                  })}
                  {travelTimes.length === 0 && (
                    <tr><td colSpan={4} style={{ padding: '24px 12px', textAlign: 'center',
                                                  fontSize: 12, color: 'var(--color-muted)' }}>
                      {copy.settings.travelEmpty}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* + Új útvonal */}
            {newTTOpen ? (
              <div style={{
                borderRadius: 12, padding: '12px 14px',
                background: 'var(--color-surface)', border: '1px dashed var(--color-blue)',
                display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-blue)' }}>{copy.settings.newRoute}</div>
                <select style={inp} value={newTTFrom} onChange={e => setNewTTFrom(e.target.value)}>
                  <option value="">{copy.settings.travelFromPick}</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <select style={inp} value={newTTTo} onChange={e => setNewTTTo(e.target.value)}>
                  <option value="">{copy.settings.travelToPick}</option>
                  {locations.filter(l => l.id !== newTTFrom).map(l =>
                    <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <input style={{ ...inp, width: 120 }} type="number" min={1}
                  value={newTTMin} onChange={e => setNewTTMin(e.target.value)}
                  placeholder={copy.settings.minutesPlaceholder} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={btnPrimary}
                    disabled={ttSaving || !newTTFrom || !newTTTo || !newTTMin}
                    onClick={addTT}>
                    {ttSaving ? copy.common.working : copy.common.add}
                  </button>
                  <button style={btnGhost} onClick={() => { setNewTTOpen(false); setTTError(null) }}>{copy.common.cancel}</button>
                </div>
              </div>
            ) : canEditHousehold ? (
              <button onClick={() => setNewTTOpen(true)} style={{
                ...btnGhost, width: '100%', borderStyle: 'dashed', borderColor: 'var(--color-blue)',
                color: 'var(--color-blue)', fontSize: 13,
              }}>{copy.settings.newRoute}</button>
            ) : null}
          </div>
        )}

        {/* ══════════════════════════════════════
            ELÉRHETŐSÉG
        ══════════════════════════════════════ */}
        {tab === 'elerheto' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 12, color: 'var(--color-muted)', margin: '0 0 4px' }}>
              {copy.settings.availHint}
            </p>

            {availError && (
              <div style={{ fontSize: 12, color: '#fca5a5', padding: '6px 10px',
                            background: '#450a0a', borderRadius: 8 }}>{availError}</div>
            )}

            {drivers.map(driver => {
              const avails = availabilities.filter(a => a.person_id === driver.id)
              return (
                <div key={driver.id} style={{
                  borderRadius: 12, padding: '12px 14px',
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
                    {driver.display_name}
                  </div>
                  {copy.weekday.long.map((_day, i) => {
                    const weekday = i + 1
                    const slots = avails.filter(a => a.weekday === weekday)
                    const isAdding = newSlot?.personId === driver.id && newSlot?.weekday === weekday
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center',
                                             gap: 6, padding: '5px 0',
                                             borderTop: i > 0 ? '1px solid var(--color-border)' : 'none' }}>
                        <span style={{ fontSize: 12, width: 60, flexShrink: 0,
                                        color: 'var(--color-muted)' }}>{copy.weekday.mid[i]}</span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1 }}>
                          {slots.map(s => (
                            <span key={s.id} style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              fontSize: 11, padding: '2px 8px', borderRadius: 20,
                              background: '#14532d', color: '#4ade80',
                            }}>
                              {s.from_time.slice(0, 5)}–{s.to_time.slice(0, 5)}
                              <button onClick={() => deleteAvail(s.id)} style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: '#4ade80', fontSize: 13, lineHeight: 1, padding: 0,
                              }}>×</button>
                            </span>
                          ))}
                          {slots.length === 0 && !isAdding && (
                            <span style={{ fontSize: 11, color: 'var(--color-border)' }}>—</span>
                          )}
                        </div>
                        {isAdding ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input type="time" value={newSlotFrom}
                              onChange={e => setNewSlotFrom(e.target.value)}
                              style={{ ...inp, width: 90, padding: '4px 6px' }} />
                            <span style={{ fontSize: 12 }}>–</span>
                            <input type="time" value={newSlotTo}
                              onChange={e => setNewSlotTo(e.target.value)}
                              style={{ ...inp, width: 90, padding: '4px 6px' }} />
                            <button style={{ ...btnPrimary, padding: '4px 10px' }}
                              disabled={availSaving} onClick={addAvail}>
                              {availSaving ? copy.common.working : <Icon name="check" size={14} weight="bold" />}
                            </button>
                            <button style={{ ...btnGhost, padding: '4px 8px' }}
                              onClick={() => { setNewSlot(null); setAvailError(null) }} aria-label={copy.a11y.close}><Icon name="x" size={14} /></button>
                          </div>
                        ) : (
                          <button onClick={() => {
                            setNewSlot({ personId: driver.id, weekday })
                            setNewSlotFrom('08:00'); setNewSlotTo('18:00')
                            setAvailError(null)
                          }} style={{
                            background: 'none', border: '1px solid var(--color-border)',
                            borderRadius: 6, cursor: 'pointer', color: 'var(--color-blue)',
                            fontSize: 14, width: 28, height: 28,
                          }}>+</button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}

            {drivers.length === 0 && (
              <p style={{ fontSize: 13, textAlign: 'center', padding: '32px 0',
                           color: 'var(--color-muted)' }}>{copy.settings.noDrivers}</p>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════
            NEM ELÉRHETŐ blokkok (inverz logika)
        ══════════════════════════════════════ */}
        {tab === 'nem_elerheto' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 12, color: 'var(--color-muted)', margin: '0 0 4px' }}>
              {copy.settings.unavailHint}
            </p>
            {unavailError && (
              <div style={{ fontSize: 12, color: '#fca5a5', padding: '6px 10px',
                            background: '#450a0a', borderRadius: 8 }}>{unavailError}</div>
            )}
            {unavailLoading && (
              <div style={{ fontSize: 13, color: 'var(--color-muted)', textAlign: 'center', padding: 24 }}>{copy.common.loading}</div>
            )}
            {!unavailLoading && persons.map(person => {
              const blocks = unavailBlocks.filter(b => b.person_id === person.id)
              return (
                <div key={person.id} style={{
                  borderRadius: 12, padding: '12px 14px',
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span style={{ width: 22, height: 22, borderRadius: '50%', background: person.color,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, color: '#fff', fontWeight: 700, flexShrink: 0 }}>
                      {person.display_name[0]}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{person.display_name}</span>
                    <span style={{ fontSize: 11, color: 'var(--color-muted)', marginLeft: 2,
                      background: 'var(--color-surface-2)', padding: '1px 6px', borderRadius: 8 }}>
                      {copy.role[person.role as PersonRole]}
                    </span>
                  </div>
                  {copy.weekday.long.map((_day, i) => {
                    const weekday = i
                    const slots = blocks.filter(b => b.weekday === weekday)
                    const isAdding = newUnavail?.personId === person.id && newUnavail?.weekday === weekday
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0',
                                             borderTop: i > 0 ? '1px solid var(--color-border)' : 'none' }}>
                        <span style={{ fontSize: 12, width: 60, flexShrink: 0, color: 'var(--color-muted)' }}>{copy.weekday.mid[i]}</span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1 }}>
                          {slots.map(s => (
                            <span key={s.id} style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11,
                              padding: '2px 8px', borderRadius: 20, background: '#450a0a', color: '#fca5a5',
                            }}>
                              {s.from_time.slice(0,5)}–{s.to_time.slice(0,5)}
                              {s.label && <span style={{ opacity: 0.8 }}>· {s.label}</span>}
                              <button onClick={() => deleteUnavailBlock(s.id)} style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: '#fca5a5', fontSize: 13, lineHeight: 1, padding: 0,
                              }}>×</button>
                            </span>
                          ))}
                          {slots.length === 0 && !isAdding && (
                            <span style={{ fontSize: 11, color: 'var(--color-border)' }}>—</span>
                          )}
                        </div>
                        {isAdding ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                            <input type="time" value={newUnavailFrom}
                              onChange={e => setNewUnavailFrom(e.target.value)}
                              style={{ ...inp, width: 90, padding: '4px 6px' }} />
                            <span style={{ fontSize: 12 }}>–</span>
                            <input type="time" value={newUnavailTo}
                              onChange={e => setNewUnavailTo(e.target.value)}
                              style={{ ...inp, width: 90, padding: '4px 6px' }} />
                            <input placeholder={copy.settings.noteOptional}
                              value={newUnavailLabel}
                              onChange={e => setNewUnavailLabel(e.target.value)}
                              style={{ ...inp, width: 140, padding: '4px 6px', fontSize: 11 }} />
                            <button style={{ ...btnPrimary, padding: '4px 10px' }}
                              disabled={unavailSaving} onClick={addUnavailBlock}>
                              {unavailSaving ? copy.common.working : <Icon name="check" size={14} weight="bold" />}
                            </button>
                            <button style={{ ...btnGhost, padding: '4px 8px' }}
                              onClick={() => { setNewUnavail(null); setUnavailError(null) }} aria-label={copy.a11y.close}><Icon name="x" size={14} /></button>
                          </div>
                        ) : (
                          <button onClick={() => {
                            setNewUnavail({ personId: person.id, weekday })
                            setNewUnavailFrom('00:00'); setNewUnavailTo('23:59')
                            setNewUnavailLabel('')
                            setUnavailError(null)
                          }} style={{
                            background: 'none', border: '1px solid var(--color-border)',
                            borderRadius: 6, cursor: 'pointer', color: '#fca5a5',
                            fontSize: 14, width: 28, height: 28,
                          }}>+</button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
            {persons.length === 0 && (
              <p style={{ fontSize: 13, textAlign: 'center', padding: '32px 0', color: 'var(--color-muted)' }}>{copy.settings.noPersons}</p>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════
            NAPTÁRAK (read-only)
        ══════════════════════════════════════ */}
        {tab === 'naptarak' && section !== 'ertesitesek' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Google Calendar csatlakoztatás */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M19.5 22H4.5C3.12 22 2 20.88 2 19.5V7l5-5h12.5C20.88 2 22 3.12 22 4.5v15c0 1.38-1.12 2.5-2.5 2.5z" fill="#4285f4"/>
                  <path d="M7 2v5H2" fill="#a8c7fa"/>
                  <rect x="7" y="10" width="10" height="1.5" rx=".75" fill="#fff"/>
                  <rect x="7" y="13" width="7" height="1.5" rx=".75" fill="#fff"/>
                </svg>
                Google Calendar
              </div>
              <p style={{ fontSize: 12, color: 'var(--color-muted)', margin: '0 0 10px' }}>
                {copy.settings.googleHint}
              </p>

              {googleMsg && (
                <div style={{
                  padding: '8px 12px', borderRadius: 8, marginBottom: 10, fontSize: 12,
                  background: googleOk ? '#14532d' : '#78350f',
                  color:      googleOk ? '#4ade80'  : '#fbbf24',
                }}>
                  {googleMsg}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {persons.filter(p => p.role === 'parent').map(parent => {
                  const gcal = googleCals.find(c => c.person_id === parent.id)
                  return (
                    <div key={parent.id} style={{
                      borderRadius: 12, padding: '12px 14px',
                      background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                          background: parent.color, display: 'flex', alignItems: 'center',
                          justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff',
                        }}>
                          {parent.display_name[0]}
                        </span>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{parent.display_name}</div>
                          {gcal ? (
                            <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 1 }}>
                              {gcal.display_name}
                              {gcal.last_synced_at && (
                                <> · {formatDateTime(gcal.last_synced_at)}</>
                              )}
                            </div>
                          ) : (
                            <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 1 }}>{copy.settings.googleNotConnected}</div>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {gcal ? (
                          <>
                            <button
                              onClick={async () => {
                                setSyncing(true)
                                const ok = await syncNow(parent.id)
                                setSyncing(false)
                                if (ok) {
                                  const updated = await fetchGoogleCalendars(householdId!)
                                  setGoogleCals(updated)
                                  setGoogleMsg(copy.settings.googleSynced)
                                  setGoogleOk(true)
                                  setTimeout(() => setGoogleMsg(null), 3000)
                                }
                              }}
                              disabled={syncing}
                              style={{ ...btnGhost, fontSize: 11, padding: '4px 10px' }}
                            >
                              {syncing ? copy.common.working : copy.settings.googleSync}
                            </button>
                            <button
                              onClick={async () => {
                                if (!confirm(copy.settings.confirmDisconnectGoogle(parent.display_name))) return
                                await disconnectGoogle(parent.id)
                                setGoogleCals(prev => prev.filter(c => c.person_id !== parent.id))
                                setGoogleMsg(copy.settings.googleDisconnected)
                                setGoogleOk(false)
                              }}
                              style={{ ...btnDanger, fontSize: 11, padding: '4px 10px' }}
                            >
                              {copy.settings.googleDisconnect}
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => householdId && startGoogleAuth(parent.id, householdId)}
                            style={{ ...btnPrimary, fontSize: 11, padding: '4px 12px', background: '#4285f4' }}
                          >
                            {copy.settings.googleConnect}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Meglévő naptárak (ICS stb.) */}
            {extCals.filter(c => c.source !== 'google').length > 0 && (
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{copy.settings.otherCalendars}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {extCals.filter(c => c.source !== 'google').map(cal => {
                    const owner = persons.find(p => p.id === cal.person_id)
                    return (
                      <div key={cal.id} style={{
                        borderRadius: 12, padding: '12px 14px',
                        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 10, height: 10, borderRadius: '50%',
                                            background: cal.color, flexShrink: 0 }} />
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 500 }}>{cal.display_name}</div>
                              <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
                                {owner?.display_name ?? '—'}
                              </div>
                            </div>
                          </div>
                          <span style={{
                            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                            background: cal.is_active ? '#4ade80' : '#475569',
                          }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}


        {tab === 'csoportok' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ fontSize: 12, color: 'var(--color-muted)', margin: '0 0 4px' }}>
              {copy.settings.groupHint}
            </p>

            {groupsLoading ? (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--color-muted)', fontSize: 13 }}>{copy.common.loading}</div>
            ) : groups.length === 0 && !groupFormOpen ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-muted)', fontSize: 13 }}>
                {copy.settings.groupEmpty}
              </div>
            ) : (
              groups.map(g => (
                <div key={g.id} style={{
                  borderRadius: 12, padding: '10px 14px',
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Icon name="users-three" size={16} /> {g.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {g.members.map(m => {
                        const p = persons.find(pp => pp.id === m.person_id)
                        return p ? (
                          <span key={m.person_id} style={{
                            padding: '1px 6px', borderRadius: 4, fontSize: 11,
                            background: p.color + '22', color: 'var(--color-text-2)', fontWeight: 600,
                          }}>{p.display_name}</span>
                        ) : null
                      })}
                    </div>
                  </div>
                  <button style={btnGhost} onClick={() => openEditGroup(g)} aria-label={copy.a11y.edit}><Icon name="pencil" size={14} /></button>
                </div>
              ))
            )}

            {groupFormOpen ? (
              <div style={{
                borderRadius: 12, padding: '14px 16px',
                background: 'var(--color-surface)', border: '1px dashed var(--color-blue)',
                display: 'flex', flexDirection: 'column', gap: 10,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-blue)' }}>
                  {editGroup ? copy.settings.groupEdit : copy.settings.groupNew}
                </div>
                <input style={inp} value={groupName}
                  onChange={e => setGroupName(e.target.value)}
                  placeholder={copy.settings.groupName} />
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{copy.common.members}</div>
                  {persons.map(p => (
                    <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 4, cursor: 'pointer' }}>
                      <input type="checkbox"
                        checked={groupMemberIds.includes(p.id)}
                        onChange={e => setGroupMemberIds(ids =>
                          e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id)
                        )} />
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: p.color, display: 'inline-block', flexShrink: 0 }} />
                      {p.display_name}
                    </label>
                  ))}
                </div>
                {groupError && (
                  <div style={{ fontSize: 12, color: '#fca5a5', padding: '6px 10px', background: '#450a0a', borderRadius: 8 }}>{groupError}</div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button style={btnPrimary} disabled={groupSaving} onClick={saveGroup}>
                    {groupSaving ? copy.common.working : editGroup ? copy.common.save : copy.common.create}
                  </button>
                  <button style={btnGhost} onClick={() => { setGroupFormOpen(false); setGroupError(null) }}>{copy.common.cancel}</button>
                  {editGroup && (
                    groupDeleteConfirm === editGroup.id ? (
                      <>
                        <button style={btnDanger} onClick={() => deleteGroup(editGroup.id)}>{copy.common.yesDelete}</button>
                        <button style={btnGhost} onClick={() => setGroupDeleteConfirm(null)}>{copy.common.cancel}</button>
                      </>
                    ) : (
                      <button style={btnDanger} onClick={() => setGroupDeleteConfirm(editGroup.id)} aria-label={copy.a11y.delete}>
                        <Icon name="trash" size={14} /> {copy.common.delete}
                      </button>
                    )
                  )}
                </div>
              </div>
            ) : (
              <button onClick={openNewGroup} style={{
                ...btnGhost, width: '100%', borderStyle: 'dashed', borderColor: 'var(--color-blue)',
                color: 'var(--color-blue)', fontSize: 13,
              }}>{copy.settings.groupNew}</button>
            )}
          </div>
        )}

        {tab === 'push' && section !== 'ertesitesek' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 12, color: 'var(--color-muted)', margin: '0 0 4px' }}>
              {copy.settings.pushCustomHint}
            </p>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-muted)', display: 'block', marginBottom: 4 }}>{copy.settings.pushTitleLabel}</label>
              <input value={pushTitle} onChange={e => setPushTitle(e.target.value)}
                placeholder={copy.settings.pushPlaceholder} style={{ ...inp }} maxLength={80} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-muted)', display: 'block', marginBottom: 4 }}>{copy.settings.pushBodyLabel}</label>
              <textarea value={pushBody} onChange={e => setPushBody(e.target.value)}
                placeholder={copy.settings.pushBody} rows={3}
                style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} maxLength={200} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-muted)', display: 'block', marginBottom: 6 }}>{copy.settings.pushWho}</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <button onClick={() => setPushTargetIds([])} style={{
                  padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                  border: '1px solid var(--color-border)',
                  background: pushTargetIds.length === 0 ? 'var(--color-blue)' : 'transparent',
                  color: pushTargetIds.length === 0 ? '#fff' : 'var(--color-muted)',
                }}>{copy.common.everyone}</button>
                {persons.map(p => {
                  const sel = pushTargetIds.includes(p.id)
                  return (
                    <button key={p.id}
                      onClick={() => setPushTargetIds(ids => sel ? ids.filter(id => id !== p.id) : [...ids, p.id])}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                        border: `1px solid ${sel ? p.color : 'var(--color-border)'}`,
                        background: sel ? `${p.color}22` : 'transparent',
                        color: sel ? 'var(--color-text)' : 'var(--color-muted)',
                      }}>
                      <span style={{ width: 14, height: 14, borderRadius: '50%', background: p.color,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 7, color: '#fff', fontWeight: 700 }}>{p.display_name[0]}</span>
                      {p.display_name.split(' ')[0]}
                    </button>
                  )
                })}
              </div>
            </div>
            <button onClick={sendCustomPush} disabled={pushSending || !pushTitle.trim()}
              style={{ ...btnPrimary, width: '100%', padding: '12px 0', fontSize: 14, fontWeight: 700,
                opacity: !pushTitle.trim() ? 0.5 : 1, cursor: !pushTitle.trim() ? 'not-allowed' : 'pointer' }}>
              {pushSending ? copy.settings.pushSending : copy.settings.pushSend}
            </button>
            {pushResult && (
              <div style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, textAlign: 'center',
                background: pushOk ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                border: `1px solid ${pushOk ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                color: pushOk ? '#4ade80' : '#fca5a5' }}>
                {pushResult}
              </div>
            )}

            {/* ── Előzmények ── */}
            <div style={{ marginTop: 20 }}>
              <div className="section-label">{copy.common.history}</div>
              {pushLogsLoading ? (
                <div style={{ textAlign: 'center', padding: 16, color: 'var(--color-muted)', fontSize: 12 }}>{copy.common.loading}</div>
              ) : pushLogs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 16, color: 'var(--color-muted)', fontSize: 12 }}>{copy.settings.pushEmptyLogs}</div>
              ) : pushLogs.map(log => (
                <div key={log.id} style={{
                  borderRadius: 10, padding: '9px 12px', marginBottom: 6,
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{log.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
                    {formatDateTime(log.sent_at)}
                    {' · '}{copy.settings.pushLogSent(log.sent_count, log.target_count)}
                    {' · '}{copy.settings.pushLogDelivered(log.delivered_count ?? 0)}
                    {' · '}{copy.settings.pushLogOpened(log.clicked_count ?? 0)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}


        {/* ══════════════════════════════════════
            SZÜNETEK
        ══════════════════════════════════════ */}
        {tab === 'szunetek' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ fontSize: 12, color: 'var(--color-muted)', margin: '0 0 4px' }}>
              {copy.settings.breakHint}
            </p>

            {breakMsg && (
              <div style={{ fontSize: 12, color: '#86efac', padding: '8px 12px',
                            background: 'rgba(16,185,129,0.1)', borderRadius: 8 }}>
                {breakMsg}
              </div>
            )}
            {breakError && (
              <div style={{ fontSize: 12, color: '#fca5a5', padding: '8px 12px',
                            background: '#450a0a', borderRadius: 8 }}>
                {breakError}
              </div>
            )}

            {/* Új szünet */}
            <button style={btnPrimary} onClick={() => { setNewBreakOpen(true); setBreakError(null); setBreakMsg(null) }}>
              {copy.settings.breakAdd}
            </button>
            {newBreakOpen && householdId && (
              <BreakSheet
                persons={persons}
                householdId={householdId}
                householdNames={persons.map(p => p.display_name)}
                onClose={() => setNewBreakOpen(false)}
                onDone={() => {
                  setNewBreakOpen(false)
                  supabase.from('break_period').select('*')
                    .eq('household_id', householdId)
                    .order('date_from', { ascending: false })
                    .then(({ data }) => setBreakPeriods((data ?? []) as BreakPeriod[]))
                }}
              />
            )}

            {/* Lista */}
            {breakLoading ? (
              <div style={{ fontSize: 13, color: 'var(--color-muted)', padding: '12px 0' }}>{copy.common.loading}</div>
            ) : breakPeriods.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--color-muted)', padding: '12px 0', textAlign: 'center' }}>
                {copy.settings.breakEmpty}
              </div>
            ) : breakPeriods.map(bp => {
              const person = persons.find(p => p.id === bp.person_id)
              const reasonLabel = bp.reason === 'illness' ? copy.settings.reasonIllness
                                : bp.reason === 'vacation' ? copy.settings.reasonVacation
                                : copy.settings.reasonOther
              const reasonColor = bp.reason === 'illness' ? '#fca5a5'
                                : bp.reason === 'vacation' ? '#93c5fd'
                                : 'var(--color-muted)'
              return (
                <div key={bp.id} style={{
                  borderRadius: 12, padding: '12px 14px',
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {person && (
                        <span style={{
                          display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                          background: person.color, flexShrink: 0,
                        }} />
                      )}
                      <span style={{ fontSize: 13, fontWeight: 600 }}>
                        {person?.display_name ?? bp.person_id}
                      </span>
                      <span style={{
                        fontSize: 11, padding: '2px 6px', borderRadius: 6,
                        background: 'var(--color-surface-2)', color: reasonColor,
                      }}>{reasonLabel}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 3 }}>
                      {bp.date_from === bp.date_to
                        ? formatShortDate(bp.date_from)
                        : `${formatShortDate(bp.date_from)} – ${formatShortDate(bp.date_to)}`}
                      {bp.note && <span style={{ marginLeft: 6 }}>· {bp.note}</span>}
                    </div>
                  </div>
                  <button style={btnDanger} onClick={() => deleteBreakPeriod(bp)} title={copy.settings.breakDelete} aria-label={copy.settings.breakDelete}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {tab === 'diagnozis' && (
          <div style={{ padding: '16px' }}>
            <p style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 16 }}>
              {copy.settings.diagnoseHint}
            </p>
            <button
              onClick={runDiagnosis}
              disabled={diagRunning}
              style={{
                width: '100%', padding: '12px 0', borderRadius: 10, fontSize: 14,
                fontWeight: 700, background: 'var(--color-blue)', color: '#fff',
                border: 'none', cursor: diagRunning ? 'not-allowed' : 'pointer',
                opacity: diagRunning ? 0.7 : 1, marginBottom: 20,
              }}
            >{diagRunning ? copy.settings.diagnoseRunning : copy.settings.diagnoseRun}</button>

            {diagResults && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {diagResults.map(r => (
                  <div key={r.id} style={{
                    padding: '10px 14px', borderRadius: 8, fontSize: 13,
                    background: r.severity === 'ok'    ? 'rgba(16,185,129,0.08)'
                              : r.severity === 'warn'  ? 'rgba(245,158,11,0.08)'
                              : 'rgba(239,68,68,0.08)',
                    border: `1px solid ${
                      r.severity === 'ok'   ? 'rgba(16,185,129,0.25)' :
                      r.severity === 'warn' ? 'rgba(245,158,11,0.25)' :
                                              'rgba(239,68,68,0.25)'}`,
                    color: r.id === 'summary' ? 'var(--color-text)' : 'var(--color-muted)',
                    fontWeight: r.id === 'summary' ? 700 : 400,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <span style={{ marginRight: 6 }}>
                          {r.severity === 'ok' ? <Icon name="check-circle" size={14} weight="fill" /> : r.severity === 'warn' ? <Icon name="warning" size={14} weight="fill" /> : <Icon name="x" size={14} weight="bold" />}
                        </span>
                        {r.label}
                        {r.detail && (
                          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-muted)', opacity: 0.8 }}>
                            {r.detail}
                          </div>
                        )}
                      </div>
                      {r.fixable && (
                        <button
                          onClick={() => fixResult(r)}
                          disabled={fixingId !== null}
                          style={{
                            flexShrink: 0, padding: '4px 10px', borderRadius: 6,
                            fontSize: 11, fontWeight: 600, cursor: 'pointer',
                            background: 'var(--color-blue)', color: '#fff',
                            border: 'none', opacity: fixingId === r.id ? 0.6 : 1,
                          }}
                        >{fixingId === r.id ? copy.common.working : copy.settings.diagnoseFix}</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!section && (
          <>
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <span style={{
            display: 'inline-block', fontSize: 11, color: 'var(--color-muted)',
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 100, padding: '3px 12px', letterSpacing: '0.04em',
          }}>
            v{__APP_VERSION__}
          </span>
        </div>

        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
          <button onClick={signOut} style={{
            width: '100%', borderRadius: 12, padding: '12px 0', fontSize: 13,
            fontWeight: 500, cursor: 'pointer', minHeight: 44,
            border: '1px solid #7f1d1d', background: 'transparent', color: '#fca5a5',
          }}>
            {copy.settings.signOut}
          </button>
        </div>
          </>
        )}
      </div>
    </div>
  )
}
