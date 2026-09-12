import { useState, useEffect } from 'react'
import { Header } from '../components/Header'
import { supabase } from '../lib/supabase'
import { useHousehold } from '../hooks/useHousehold'
import { useAuth } from '../lib/auth'
import { getPref, setPref, PREF_HIDE_CANCELLED } from '../lib/prefs'
import type { ExternalCalendar, Location, TravelTime, DriverAvailability, UnavailableBlock, TravelGroup, TravelGroupMember, PushLog, BreakPeriod, BreakReason } from '../types'
import { isPushSupported, isPushSubscribed, subscribeToPush, unsubscribeFromPush } from '../lib/push'
import { startGoogleAuth, syncNow, disconnectGoogle, fetchGoogleCalendars } from '../lib/googleCalendar'
import { forceRegenerateLegs } from '../lib/occurrences'
import { format } from 'date-fns'

const WEEKDAYS = ['Hétfő','Kedd','Szerda','Csütörtök','Péntek','Szombat','Vasárnap']
type Tab = 'helyszin' | 'utido' | 'elerheto' | 'nem_elerheto' | 'csoportok' | 'szunetek' | 'naptarak' | 'push' | 'diagnozis'

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

export function Beallitasok() {
  const { signOut } = useAuth()
  const {
    persons, drivers,
    locations: initLocations,
    travelTimes: initTravelTimes,
    availabilities: initAvails,
    householdId,
  } = useHousehold()

  const [tab, setTab] = useState<Tab>('helyszin')
  const [extCals, setExtCals] = useState<ExternalCalendar[]>([])
  const [hideCancelled, setHideCancelled] = useState(() => getPref(PREF_HIDE_CANCELLED))

  // Push értesítés állapot
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [googleCals, setGoogleCals] = useState<Array<{ id: string; person_id: string; display_name: string; last_synced_at: string | null }>>([])
  const [syncing, setSyncing]       = useState(false)
  const [googleMsg, setGoogleMsg]   = useState<string | null>(null)
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
          }),
        }
      )
      const json = await res.json()
      setPushResult(`✓ Elküldve ${json.sent ?? 0} eszközre${json.failed ? ` (${json.failed} hiba)` : ''}`)
      setPushTitle(''); setPushBody(''); setPushTargetIds([])
    } catch (e) {
      setPushResult(`❌ Hiba: ${String(e)}`)
    }
    setPushSending(false)
  }

  useEffect(() => {
    if (!householdId || tab !== 'push') return
    setPushLogsLoading(true)
    supabase.from('push_log')
      .select('id, title, body, sent_at, target_count, sent_count, failed_count, sent_by')
      .eq('household_id', householdId)
      .order('sent_at', { ascending: false })
      .limit(10)
      .then(async ({ data: logs }) => {
        if (!logs?.length) { setPushLogs([]); setPushLogsLoading(false); return }
        // Count delivered/clicked from receipts
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
      })
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
      setGoogleMsg('✓ Google Calendar sikeresen csatlakoztatva!')
      window.history.replaceState({}, '', window.location.pathname)
    } else if (googleStatus === 'error') {
      setGoogleMsg('⚠ Google Calendar csatlakoztatás nem sikerült.')
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

  const tabs: { key: Tab; label: string }[] = [
    { key: 'helyszin', label: 'Helyszínek' },
    { key: 'utido',    label: 'Útidő' },
    { key: 'elerheto', label: 'Elérhetőség' },
    { key: 'nem_elerheto', label: 'Nem elérhető' },
    { key: 'naptarak', label: 'Naptárak' },
    { key: 'csoportok', label: '👥 Csoportok' },
    { key: 'szunetek',  label: '⏸ Szünetek' },
    { key: 'push',      label: '📣 Üzenet' },
    { key: 'diagnozis', label: '🩺 Diagnózis' },
  ]

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
    if (!confirm('Biztosan törlöd ezt a helyszínt?')) return
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
    if (isNaN(mins) || mins < 1) { setTTError('Érvényes percszámot adj meg'); return }
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
    if (!confirm('Törlöd ezt az útvonalat?')) return
    const { error } = await supabase.from('travel_time')
      .delete().eq('from_location', from).eq('to_location', to)
    if (error) { alert(error.message); return }
    setTravelTimes(tts => tts.filter(tt => !(tt.from_location === from && tt.to_location === to)))
  }

  async function addTT() {
    if (!newTTFrom || !newTTTo || !householdId) return
    const mins = parseInt(newTTMin, 10)
    if (isNaN(mins) || mins < 1) { setTTError('Érvényes percszámot adj meg'); return }
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
    if (!householdId || !groupName.trim()) { setGroupError('A csoport nevét kötelező megadni!'); return }
    if (groupMemberIds.length < 2) { setGroupError('Legalább 2 tagot adj hozzá!'); return }
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
  const [newBreakPersonId, setNewBreakPersonId] = useState('')
  const [newBreakFrom, setNewBreakFrom] = useState('')
  const [newBreakTo, setNewBreakTo] = useState('')
  const [newBreakReason, setNewBreakReason] = useState<BreakReason>('vacation')
  const [newBreakNote, setNewBreakNote] = useState('')
  const [breakSaving, setBreakSaving] = useState(false)
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

  async function addBreakPeriod() {
    if (!householdId || !newBreakPersonId || !newBreakFrom || !newBreakTo) {
      setBreakError('Töltsd ki az összes kötelező mezőt (személy, dátum)')
      return
    }
    if (newBreakFrom > newBreakTo) {
      setBreakError('A kezdő dátum nem lehet nagyobb a végdátumnál')
      return
    }
    setBreakSaving(true); setBreakError(null); setBreakMsg(null)
    const { data, error } = await supabase.from('break_period').insert({
      household_id: householdId,
      person_id: newBreakPersonId,
      date_from: newBreakFrom,
      date_to: newBreakTo,
      reason: newBreakReason,
      note: newBreakNote.trim() || null,
    }).select().single()
    if (error) { setBreakError(error.message); setBreakSaving(false); return }
    const bp = data as BreakPeriod
    setBreakPeriods(bs => [bp, ...bs])
    // Apply: cancel occurrences in the range
    const { data: cnt } = await supabase.rpc('apply_break_period', { p_break_id: bp.id })
    setBreakMsg(`✓ Szünet mentve — ${cnt ?? 0} alkalom lemondva`)
    setNewBreakOpen(false)
    setNewBreakPersonId(''); setNewBreakFrom(''); setNewBreakTo('')
    setNewBreakReason('vacation'); setNewBreakNote('')
    setBreakSaving(false)
  }

  async function deleteBreakPeriod(bp: BreakPeriod) {
    if (!confirm('Töröljük a szünetet? A törölt szünet emiatt lemondott alkalmak visszakerülnek tervezettbe.')) return
    setBreakMsg(null)
    const { data: cnt } = await supabase.rpc('revert_break_period', {
      p_household_id: bp.household_id,
      p_person_id: bp.person_id,
      p_date_from: bp.date_from,
      p_date_to: bp.date_to,
    })
    await supabase.from('break_period').delete().eq('id', bp.id)
    setBreakPeriods(bs => bs.filter(b => b.id !== bp.id))
    setBreakMsg(`↩ Szünet törölve — ${cnt ?? 0} alkalom visszaállítva`)
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
      alert('Javítási hiba: ' + (e instanceof Error ? e.message : String(e)))
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
        results.push({ id: 'no_home', severity: 'error', label: 'Nincs otthoni helyszín (is_home = true)' })
      } else {
        results.push({ id: 'home_ok', severity: 'ok', label: `Otthoni helyszín: ${homeLoc.name}` })
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
        results.push({ id: 'legs_ok', severity: 'ok', label: 'Minden tervezett alkalom rendelkezik transport leg-gel' })
      } else {
        results.push({
          id: 'legs_missing', severity: 'warn',
          label: `${plannedNoLeg.length} tervezett alkalom leg nélkül`,
          detail: plannedNoLeg.slice(0, 5).map((o: Record<string, unknown>) => `${o.on_date} ${o.title}`).join(', ') + (plannedNoLeg.length > 5 ? '…' : ''),
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
        results.push({ id: 'legs_complete_ok', severity: 'ok', label: 'Leg irányok teljesek (dropoff/pickup)' })
      } else {
        results.push({
          id: 'legs_incomplete', severity: 'warn',
          label: `${incompleteLegs.length} alkalom hiányos leg-iránnyal`,
          detail: incompleteLegs.slice(0, 5).map((o: Record<string, unknown>) => `${o.on_date} ${o.title}`).join(', '),
          fixable: true,
          fixIds: incompleteLegs.map((o: Record<string, unknown>) => o.id as string),
        })
      }

      // ── 4. Lemondott alkalom, de még van leg-je ────────────────────────
      const cancelledWithLegs = occs.filter((o: Record<string, unknown>) =>
        o.status === 'cancelled' && legsByOcc.has(o.id as string)
      )
      if (cancelledWithLegs.length === 0) {
        results.push({ id: 'cancelled_ok', severity: 'ok', label: 'Lemondott alkalmakhoz nincs transport leg' })
      } else {
        const cancelledLegIds = legs
          .filter((l: Record<string, unknown>) => cancelledWithLegs.some((o: Record<string, unknown>) => o.id === l.occurrence_id))
          .map((l: Record<string, unknown>) => l.id as string)
        results.push({
          id: 'cancelled_legs', severity: 'error',
          label: `${cancelledWithLegs.length} lemondott alkalom még rendelkezik leg-gel`,
          detail: cancelledWithLegs.slice(0, 5).map((o: Record<string, unknown>) => `${o.on_date} ${o.title}`).join(', '),
          fixable: true,
          fixIds: cancelledLegIds,
        })
      }

      // ── 5. Leg sofőr nélkül ────────────────────────────────────────────
      const legNoDriver = legs.filter((l: Record<string, unknown>) => !l.driver_id)
      if (legNoDriver.length === 0) {
        results.push({ id: 'driver_ok', severity: 'ok', label: 'Minden leg rendelkezik sofőrrel' })
      } else {
        results.push({
          id: 'driver_missing', severity: 'warn',
          label: `${legNoDriver.length} leg sofőr nélkül`,
        })
      }

      // ── 6. Árva leg (occurrence nem létezik) ──────────────────────────
      const occIds = new Set(occs.map((o: Record<string, unknown>) => o.id as string))
      const orphanLegs = legs.filter((l: Record<string, unknown>) => !occIds.has(l.occurrence_id as string))
      if (orphanLegs.length === 0) {
        results.push({ id: 'orphan_ok', severity: 'ok', label: 'Nincs árva transport leg' })
      } else {
        results.push({
          id: 'orphan_legs', severity: 'error',
          label: `${orphanLegs.length} árva transport leg (ismeretlen occurrence_id)`,
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
        results.push({ id: 'tpl_overlap_ok', severity: 'ok', label: 'Sablon dátumok nem fedik át egymást' })
      } else {
        results.push({
          id: 'tpl_overlap', severity: 'error',
          label: `${overlapCount} sablon dátum-átfedés (azonos személy + hét napja)`,
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
          if (!ttSet.has(`${homeLoc.id}→${locId}`)) missingRoutes.push(`Otthon→${name}`)
          if (!ttSet.has(`${locId}→${homeLoc.id}`)) missingRoutes.push(`${name}→Otthon`)
        }
        if (missingRoutes.length === 0) {
          results.push({ id: 'tt_ok', severity: 'ok', label: 'Minden sablon-helyszínhez van útidő (oda+vissza)' })
        } else {
          results.push({
            id: 'tt_missing', severity: 'warn',
            label: `Hiányzó útidők: ${missingRoutes.join(', ')}`,
          })
        }
      }

      // ── 9. Occurrence starts_at < ends_at ellenőrzés ─────────────────
      const badTimes = occs.filter((o: Record<string, unknown>) =>
        o.starts_at && o.ends_at && (o.starts_at as string) >= (o.ends_at as string)
      )
      if (badTimes.length === 0) {
        results.push({ id: 'times_ok', severity: 'ok', label: 'Minden alkalom időtartama helyes (starts_at < ends_at)' })
      } else {
        results.push({
          id: 'times_bad', severity: 'error',
          label: `${badTimes.length} alkalom hibás időtartammal (starts_at >= ends_at)`,
          detail: badTimes.slice(0, 3).map((o: Record<string, unknown>) => `${o.on_date} ${o.title} ${o.starts_at}–${o.ends_at}`).join(', '),
        })
      }

      // ── 10. Összesítő ─────────────────────────────────────────────────
      const errCount  = results.filter(r => r.severity === 'error').length
      const warnCount = results.filter(r => r.severity === 'warn').length
      results.unshift({
        id: 'summary',
        severity: errCount > 0 ? 'error' : warnCount > 0 ? 'warn' : 'ok',
        label: errCount === 0 && warnCount === 0
          ? `✅ Minden ellenőrzés sikeres (${occs.length} alkalom, ${legs.length} leg, ${tpls.length} sablon)`
          : `${errCount} hiba · ${warnCount} figyelmeztetés (${occs.length} alkalom, ${legs.length} leg)`,
      })

    } catch (e: unknown) {
      results.push({ id: 'fetch_error', severity: 'error', label: 'Lekérési hiba: ' + (e instanceof Error ? e.message : String(e)) })
    }

    setDiagResults(results)
    setDiagRunning(false)
  }

  return (
    <div style={{ background: 'var(--color-bg)', minHeight: '100dvh' }}>
      <Header title="Beállítások" />

      {/* ── Megjelenítés ── */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
        <div className="section-label" style={{ marginBottom: 10 }}>Megjelenítés</div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderRadius: 'var(--r-md)',
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Elmaradt események elrejtése</div>
            <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
              Hét és Fuvartábla nézetben nem jelenik meg az ELMARAD
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
              <div style={{ fontSize: 13, fontWeight: 500 }}>Push értesítések</div>
              <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
                Értesítés sofőr-hozzárendeléskor
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

      {/* Belső tab sor */}
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

      <div style={{ padding: '16px 16px 80px' }}>

        {/* ══════════════════════════════════════
            HELYSZÍNEK
        ══════════════════════════════════════ */}
        {tab === 'helyszin' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ fontSize: 12, color: 'var(--color-muted)', margin: '0 0 4px' }}>
              Az utazási idő mátrix alapjai. Az „otthon" jelölés kötelező a fuvarszámításhoz.
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
                      placeholder="Név" />
                    <input style={inp} value={editLocAddr}
                      onChange={e => setEditLocAddr(e.target.value)}
                      placeholder="Cím (opcionális)" />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      <input type="checkbox" checked={editLocTbd}
                        onChange={e => setEditLocTbd(e.target.checked)} />
                      📍? TBD helyszín
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button style={btnPrimary} disabled={locSaving} onClick={saveLoc}>
                        {locSaving ? '…' : 'Mentés'}
                      </button>
                      <button style={btnGhost} onClick={() => setEditLocId(null)}>Mégse</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {loc.is_home && (
                          <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 6,
                                         background: '#1e3a5f', color: '#93c5fd' }}>Otthon</span>
                        )}
                        {loc.is_tbd && (
                          <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 6,
                                         background: '#3d2e00', color: '#fbbf24' }}>📍?</span>
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
                      <button style={btnGhost} onClick={() => startEditLoc(loc)}>✎</button>
                      <button style={btnDanger} disabled={loc.is_home}
                        title={loc.is_home ? 'Az otthon helyszín nem törölhető' : ''}
                        onClick={() => deleteLoc(loc.id)}>🗑</button>
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
                  Új helyszín
                </div>
                <input style={inp} value={newLocName}
                  onChange={e => setNewLocName(e.target.value)}
                  placeholder="Név *" />
                <input style={inp} value={newLocAddr}
                  onChange={e => setNewLocAddr(e.target.value)}
                  placeholder="Cím (opcionális)" />
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={newLocHome}
                    onChange={e => setNewLocHome(e.target.checked)} />
                  Ez az otthon
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={newLocTbd}
                    onChange={e => setNewLocTbd(e.target.checked)} />
                  📍? TBD helyszín
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={btnPrimary} disabled={locSaving || !newLocName.trim()} onClick={addLoc}>
                    {locSaving ? '…' : 'Hozzáad'}
                  </button>
                  <button style={btnGhost} onClick={() => { setNewLocOpen(false); setLocError(null) }}>Mégse</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setNewLocOpen(true)} style={{
                ...btnGhost, width: '100%', borderStyle: 'dashed', borderColor: 'var(--color-blue)',
                color: 'var(--color-blue)', fontSize: 13,
              }}>+ Új helyszín</button>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════
            ÚTIDŐ MÁTRIX
        ══════════════════════════════════════ */}
        {tab === 'utido' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 12, color: 'var(--color-muted)', margin: '0 0 4px' }}>
              Kézzel felvett menetidők percben. Kattints a percszámra a szerkesztéshez.
            </p>

            {ttError && (
              <div style={{ fontSize: 12, color: '#fca5a5', padding: '6px 10px',
                            background: '#450a0a', borderRadius: 8 }}>{ttError}</div>
            )}

            <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--color-border)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--color-surface)',
                                borderBottom: '1px solid var(--color-border)' }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11,
                                  color: 'var(--color-muted)', fontWeight: 500 }}>Honnan</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11,
                                  color: 'var(--color-muted)', fontWeight: 500 }}>Hová</th>
                    <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: 11,
                                  color: 'var(--color-muted)', fontWeight: 500 }}>Perc</th>
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
                            onClick={() => deleteTT(tt.from_location, tt.to_location)}>🗑</button>
                        </td>
                      </tr>
                    )
                  })}
                  {travelTimes.length === 0 && (
                    <tr><td colSpan={4} style={{ padding: '24px 12px', textAlign: 'center',
                                                  fontSize: 12, color: 'var(--color-muted)' }}>
                      Még nincs menetidő megadva.
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
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-blue)' }}>Új útvonal</div>
                <select style={inp} value={newTTFrom} onChange={e => setNewTTFrom(e.target.value)}>
                  <option value="">Honnan…</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <select style={inp} value={newTTTo} onChange={e => setNewTTTo(e.target.value)}>
                  <option value="">Hová…</option>
                  {locations.filter(l => l.id !== newTTFrom).map(l =>
                    <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                <input style={{ ...inp, width: 120 }} type="number" min={1}
                  value={newTTMin} onChange={e => setNewTTMin(e.target.value)}
                  placeholder="Percek" />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={btnPrimary}
                    disabled={ttSaving || !newTTFrom || !newTTTo || !newTTMin}
                    onClick={addTT}>
                    {ttSaving ? '…' : 'Hozzáad'}
                  </button>
                  <button style={btnGhost} onClick={() => { setNewTTOpen(false); setTTError(null) }}>Mégse</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setNewTTOpen(true)} style={{
                ...btnGhost, width: '100%', borderStyle: 'dashed', borderColor: 'var(--color-blue)',
                color: 'var(--color-blue)', fontSize: 13,
              }}>+ Új útvonal</button>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════
            ELÉRHETŐSÉG
        ══════════════════════════════════════ */}
        {tab === 'elerheto' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 12, color: 'var(--color-muted)', margin: '0 0 4px' }}>
              Mikor tud vezetni az adott sofőr. Figyelmeztető — nem tiltja a beosztást.
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
                  {WEEKDAYS.map((day, i) => {
                    const weekday = i + 1
                    const slots = avails.filter(a => a.weekday === weekday)
                    const isAdding = newSlot?.personId === driver.id && newSlot?.weekday === weekday
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center',
                                             gap: 6, padding: '5px 0',
                                             borderTop: i > 0 ? '1px solid var(--color-border)' : 'none' }}>
                        <span style={{ fontSize: 12, width: 60, flexShrink: 0,
                                        color: 'var(--color-muted)' }}>{day.slice(0, 4)}</span>
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
                              {availSaving ? '…' : '✓'}
                            </button>
                            <button style={{ ...btnGhost, padding: '4px 8px' }}
                              onClick={() => { setNewSlot(null); setAvailError(null) }}>✕</button>
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
                           color: 'var(--color-muted)' }}>Nincs sofőr a háztartásban.</p>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════
            NEM ELÉRHETŐ blokkok (inverz logika)
        ══════════════════════════════════════ */}
        {tab === 'nem_elerheto' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 12, color: 'var(--color-muted)', margin: '0 0 4px' }}>
              Mikor <strong>nem</strong> elérhető az adott személy. Minden más időpont szabad.
              Figyelmeztető — nem tiltja a beosztást automatikusan.
            </p>
            {unavailError && (
              <div style={{ fontSize: 12, color: '#fca5a5', padding: '6px 10px',
                            background: '#450a0a', borderRadius: 8 }}>{unavailError}</div>
            )}
            {unavailLoading && (
              <div style={{ fontSize: 13, color: 'var(--color-muted)', textAlign: 'center', padding: 24 }}>Betöltés…</div>
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
                      {person.role}
                    </span>
                  </div>
                  {WEEKDAYS.map((day, i) => {
                    const weekday = i
                    const slots = blocks.filter(b => b.weekday === weekday)
                    const isAdding = newUnavail?.personId === person.id && newUnavail?.weekday === weekday
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0',
                                             borderTop: i > 0 ? '1px solid var(--color-border)' : 'none' }}>
                        <span style={{ fontSize: 12, width: 60, flexShrink: 0, color: 'var(--color-muted)' }}>{day.slice(0,4)}</span>
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
                            <input placeholder="Megjegyzés (opcionális)"
                              value={newUnavailLabel}
                              onChange={e => setNewUnavailLabel(e.target.value)}
                              style={{ ...inp, width: 140, padding: '4px 6px', fontSize: 11 }} />
                            <button style={{ ...btnPrimary, padding: '4px 10px' }}
                              disabled={unavailSaving} onClick={addUnavailBlock}>
                              {unavailSaving ? '…' : '✓'}
                            </button>
                            <button style={{ ...btnGhost, padding: '4px 8px' }}
                              onClick={() => { setNewUnavail(null); setUnavailError(null) }}>✕</button>
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
              <p style={{ fontSize: 13, textAlign: 'center', padding: '32px 0', color: 'var(--color-muted)' }}>Nincs személy a háztartásban.</p>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════
            NAPTÁRAK (read-only)
        ══════════════════════════════════════ */}
        {tab === 'naptarak' && (
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
                Szülők csatlakoztatják saját Google-fiókjukat. A hozzárendelt fuvarok automatikusan megjelennek a Google Calendarban, a Google-eseményeket pedig ütközésvizsgálatra használjuk.
              </p>

              {googleMsg && (
                <div style={{
                  padding: '8px 12px', borderRadius: 8, marginBottom: 10, fontSize: 12,
                  background: googleMsg.startsWith('✓') ? '#14532d' : '#78350f',
                  color:      googleMsg.startsWith('✓') ? '#4ade80'  : '#fbbf24',
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
                                <> · {format(new Date(gcal.last_synced_at), 'MMM d HH:mm')}</>
                              )}
                            </div>
                          ) : (
                            <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 1 }}>Nincs csatlakoztatva</div>
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
                                  setGoogleMsg('✓ Szinkronizálva!')
                                  setTimeout(() => setGoogleMsg(null), 3000)
                                }
                              }}
                              disabled={syncing}
                              style={{ ...btnGhost, fontSize: 11, padding: '4px 10px' }}
                            >
                              {syncing ? '…' : '↻ Szinkron'}
                            </button>
                            <button
                              onClick={async () => {
                                if (!confirm(`Lecsatlakoztatod ${parent.display_name} Google Calendarját?`)) return
                                await disconnectGoogle(parent.id)
                                setGoogleCals(prev => prev.filter(c => c.person_id !== parent.id))
                                setGoogleMsg('Google Calendar lecsatlakoztatva.')
                              }}
                              style={{ ...btnDanger, fontSize: 11, padding: '4px 10px' }}
                            >
                              Lecsatlakoztatás
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => householdId && startGoogleAuth(parent.id, householdId)}
                            style={{ ...btnPrimary, fontSize: 11, padding: '4px 12px', background: '#4285f4' }}
                          >
                            Csatlakoztatás
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
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Egyéb naptárak</div>
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
              Fuvar-csoportok: egyszerre több személyt lehet hozzárendelni egy fuvarmenethez.
            </p>

            {groupsLoading ? (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--color-muted)', fontSize: 13 }}>Betöltés…</div>
            ) : groups.length === 0 && !groupFormOpen ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-muted)', fontSize: 13 }}>
                Még nincs csoport. Hozz létre egyet!
              </div>
            ) : (
              groups.map(g => (
                <div key={g.id} style={{
                  borderRadius: 12, padding: '10px 14px',
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>👥 {g.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {g.members.map(m => {
                        const p = persons.find(pp => pp.id === m.person_id)
                        return p ? (
                          <span key={m.person_id} style={{
                            padding: '1px 6px', borderRadius: 4, fontSize: 11,
                            background: p.color + '22', color: p.color, fontWeight: 600,
                          }}>{p.display_name}</span>
                        ) : null
                      })}
                    </div>
                  </div>
                  <button style={btnGhost} onClick={() => openEditGroup(g)}>✎</button>
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
                  {editGroup ? 'Csoport szerkesztése' : 'Új csoport'}
                </div>
                <input style={inp} value={groupName}
                  onChange={e => setGroupName(e.target.value)}
                  placeholder="Csoport neve *" />
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tagok</div>
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
                    {groupSaving ? '…' : editGroup ? 'Mentés' : 'Létrehozás'}
                  </button>
                  <button style={btnGhost} onClick={() => { setGroupFormOpen(false); setGroupError(null) }}>Mégse</button>
                  {editGroup && (
                    groupDeleteConfirm === editGroup.id ? (
                      <>
                        <button style={btnDanger} onClick={() => deleteGroup(editGroup.id)}>Igen, törlöm</button>
                        <button style={btnGhost} onClick={() => setGroupDeleteConfirm(null)}>Mégsem</button>
                      </>
                    ) : (
                      <button style={btnDanger} onClick={() => setGroupDeleteConfirm(editGroup.id)}>🗑 Törlés</button>
                    )
                  )}
                </div>
              </div>
            ) : (
              <button onClick={openNewGroup} style={{
                ...btnGhost, width: '100%', borderStyle: 'dashed', borderColor: 'var(--color-blue)',
                color: 'var(--color-blue)', fontSize: 13,
              }}>+ Új csoport</button>
            )}
          </div>
        )}

        {tab === 'push' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 12, color: 'var(--color-muted)', margin: '0 0 4px' }}>
              Küldj egyedi push értesítést a háztartás tagjainak.
            </p>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-muted)', display: 'block', marginBottom: 4 }}>Cím *</label>
              <input value={pushTitle} onChange={e => setPushTitle(e.target.value)}
                placeholder="pl. Változás a mai napon" style={{ ...inp }} maxLength={80} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-muted)', display: 'block', marginBottom: 4 }}>Szöveg (opcionális)</label>
              <textarea value={pushBody} onChange={e => setPushBody(e.target.value)}
                placeholder="Részletek…" rows={3}
                style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} maxLength={200} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-muted)', display: 'block', marginBottom: 6 }}>Küldés kinek</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <button onClick={() => setPushTargetIds([])} style={{
                  padding: '5px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                  border: '1px solid var(--color-border)',
                  background: pushTargetIds.length === 0 ? 'var(--color-blue)' : 'transparent',
                  color: pushTargetIds.length === 0 ? '#fff' : 'var(--color-muted)',
                }}>Mindenki</button>
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
                        color: sel ? p.color : 'var(--color-muted)',
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
              {pushSending ? '📤 Küldés…' : '📣 Push küldése'}
            </button>
            {pushResult && (
              <div style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, textAlign: 'center',
                background: pushResult.startsWith('✓') ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                border: `1px solid ${pushResult.startsWith('✓') ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                color: pushResult.startsWith('✓') ? '#4ade80' : '#fca5a5' }}>
                {pushResult}
              </div>
            )}

            {/* ── Előzmények ── */}
            <div style={{ marginTop: 20 }}>
              <div className="section-label">Előzmények</div>
              {pushLogsLoading ? (
                <div style={{ textAlign: 'center', padding: 16, color: 'var(--color-muted)', fontSize: 12 }}>Betöltés…</div>
              ) : pushLogs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 16, color: 'var(--color-muted)', fontSize: 12 }}>Még nem volt küldés.</div>
              ) : pushLogs.map(log => (
                <div key={log.id} style={{
                  borderRadius: 10, padding: '9px 12px', marginBottom: 6,
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{log.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
                    {format(new Date(log.sent_at), 'MM.dd HH:mm')}
                    {' · '}✉️ {log.sent_count}/{log.target_count} küldve
                    {' · '}📬 {log.delivered_count ?? 0} megérkezett
                    {' · '}👆 {log.clicked_count ?? 0} megnyitva
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
              Szünet-időszak megadásával az adott személy összes eseménye automatikusan lemondásra kerül a megjelölt napokra.
              Törléskor a sablon-alapú alkalmak visszakerülnek „tervezett" státuszba.
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
            {!newBreakOpen ? (
              <button style={btnPrimary} onClick={() => { setNewBreakOpen(true); setBreakError(null); setBreakMsg(null) }}>
                + Új szünet hozzáadása
              </button>
            ) : (
              <div style={{
                borderRadius: 12, padding: '14px',
                background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                display: 'flex', flexDirection: 'column', gap: 10,
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Új szünet-időszak
                </div>

                {/* Személy */}
                <div>
                  <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 }}>Személy *</div>
                  <select style={inp} value={newBreakPersonId} onChange={e => setNewBreakPersonId(e.target.value)}>
                    <option value="">– válassz –</option>
                    {persons.map(p => (
                      <option key={p.id} value={p.id}>{p.display_name}</option>
                    ))}
                  </select>
                </div>

                {/* Dátumok */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 }}>Tól *</div>
                    <input type="date" style={inp} value={newBreakFrom}
                      onChange={e => setNewBreakFrom(e.target.value)} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 }}>Ig *</div>
                    <input type="date" style={inp} value={newBreakTo}
                      onChange={e => setNewBreakTo(e.target.value)} />
                  </div>
                </div>

                {/* Ok */}
                <div>
                  <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 }}>Ok</div>
                  <select style={inp} value={newBreakReason}
                    onChange={e => setNewBreakReason(e.target.value as BreakReason)}>
                    <option value="vacation">Szünet / vakáció</option>
                    <option value="illness">Betegség</option>
                    <option value="other">Egyéb</option>
                  </select>
                </div>

                {/* Megjegyzés */}
                <div>
                  <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 }}>Megjegyzés</div>
                  <input style={inp} value={newBreakNote} placeholder="pl. téli szünet, influenza…"
                    onChange={e => setNewBreakNote(e.target.value)} />
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button style={btnPrimary} disabled={breakSaving} onClick={addBreakPeriod}>
                    {breakSaving ? '…' : '✓ Mentés'}
                  </button>
                  <button style={btnGhost} onClick={() => { setNewBreakOpen(false); setBreakError(null) }}>
                    Mégse
                  </button>
                </div>
              </div>
            )}

            {/* Lista */}
            {breakLoading ? (
              <div style={{ fontSize: 13, color: 'var(--color-muted)', padding: '12px 0' }}>Betöltés…</div>
            ) : breakPeriods.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--color-muted)', padding: '12px 0', textAlign: 'center' }}>
                Még nincs rögzített szünet-időszak.
              </div>
            ) : breakPeriods.map(bp => {
              const person = persons.find(p => p.id === bp.person_id)
              const reasonLabel = bp.reason === 'illness' ? 'Betegség'
                                : bp.reason === 'vacation' ? 'Szünet'
                                : 'Egyéb'
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
                        ? bp.date_from
                        : `${bp.date_from} – ${bp.date_to}`}
                      {bp.note && <span style={{ marginLeft: 6 }}>· {bp.note}</span>}
                    </div>
                  </div>
                  <button style={btnDanger} onClick={() => deleteBreakPeriod(bp)} title="Szünet törlése">
                    🗑
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {tab === 'diagnozis' && (
          <div style={{ padding: '16px' }}>
            <p style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 16 }}>
              Ellenőrzi az adatbázis koherenciáját: transport leg-ek, időtartamok, sablon-átfedések, útidők.
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
            >{diagRunning ? '🔍 Ellenőrzés…' : '🔍 Diagnózis futtatása'}</button>

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
                          {r.severity === 'ok' ? '✅' : r.severity === 'warn' ? '⚠️' : '❌'}
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
                        >{fixingId === r.id ? '…' : '🔧 Javítás'}</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Verzió */}
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <span style={{
            display: 'inline-block', fontSize: 11, color: 'var(--color-muted)',
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 100, padding: '3px 12px', letterSpacing: '0.04em',
          }}>
            v{__APP_VERSION__}
          </span>
        </div>

        {/* Kijelentkezés */}
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
          <button onClick={signOut} style={{
            width: '100%', borderRadius: 12, padding: '12px 0', fontSize: 13,
            fontWeight: 500, cursor: 'pointer', minHeight: 44,
            border: '1px solid #7f1d1d', background: 'transparent', color: '#fca5a5',
          }}>
            Kijelentkezés
          </button>
        </div>
      </div>
    </div>
  )
}
