import { useState, useEffect } from 'react'
import { Header } from '../components/Header'
import { supabase } from '../lib/supabase'
import { useHousehold } from '../hooks/useHousehold'
import { useAuth } from '../lib/auth'
import { getPref, setPref, PREF_HIDE_CANCELLED } from '../lib/prefs'
import type { ExternalCalendar, Location, TravelTime, DriverAvailability } from '../types'
import { format } from 'date-fns'

const WEEKDAYS = ['Hétfő','Kedd','Szerda','Csütörtök','Péntek','Szombat','Vasárnap']
type Tab = 'helyszin' | 'utido' | 'elerheto' | 'naptarak'

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

  // Local editable copies
  const [locations, setLocations] = useState<Location[]>([])
  const [travelTimes, setTravelTimes] = useState<TravelTime[]>([])
  const [availabilities, setAvailabilities] = useState<DriverAvailability[]>([])

  useEffect(() => { setLocations(initLocations) }, [initLocations])
  useEffect(() => { setTravelTimes(initTravelTimes) }, [initTravelTimes])
  useEffect(() => { setAvailabilities(initAvails) }, [initAvails])

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
    { key: 'naptarak', label: 'Naptárak' },
  ]

  // ── Helyszínek state ──
  const [editLocId, setEditLocId] = useState<string | null>(null)
  const [editLocName, setEditLocName] = useState('')
  const [editLocAddr, setEditLocAddr] = useState('')
  const [newLocOpen, setNewLocOpen] = useState(false)
  const [newLocName, setNewLocName] = useState('')
  const [newLocAddr, setNewLocAddr] = useState('')
  const [newLocHome, setNewLocHome] = useState(false)
  const [locSaving, setLocSaving] = useState(false)
  const [locError, setLocError] = useState<string | null>(null)

  function startEditLoc(loc: Location) {
    setEditLocId(loc.id)
    setEditLocName(loc.name)
    setEditLocAddr(loc.address ?? '')
    setLocError(null)
  }

  async function saveLoc() {
    if (!editLocId) return
    setLocSaving(true); setLocError(null)
    const { error } = await supabase.from('location')
      .update({ name: editLocName.trim(), address: editLocAddr.trim() || null })
      .eq('id', editLocId)
    setLocSaving(false)
    if (error) { setLocError(error.message); return }
    setLocations(ls => ls.map(l => l.id === editLocId
      ? { ...l, name: editLocName.trim(), address: editLocAddr.trim() || null }
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
    }).select().single()
    setLocSaving(false)
    if (error) { setLocError(error.message); return }
    setLocations(ls => [...ls, data as Location])
    setNewLocName(''); setNewLocAddr(''); setNewLocHome(false); setNewLocOpen(false)
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
            NAPTÁRAK (read-only)
        ══════════════════════════════════════ */}
        {tab === 'naptarak' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ fontSize: 12, color: 'var(--color-muted)', margin: '0 0 4px' }}>
              A kiírási naptár és a behúzott külső naptárak.
            </p>
            {extCals.map(cal => {
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
                          {owner?.display_name ?? '—'} ·{' '}
                          {cal.visibility === 'busy_only' ? 'Csak foglalt' : 'Teljes'} ·{' '}
                          {cal.affects_driving ? 'Ütközésvizsgálat' : 'Csak megjelenítés'}
                        </div>
                      </div>
                    </div>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      background: cal.is_active ? '#4ade80' : '#475569',
                    }} />
                  </div>
                  {cal.last_synced_at && (
                    <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 6 }}>
                      Szinkronizálva: {format(new Date(cal.last_synced_at), 'MMM d, HH:mm')}
                    </div>
                  )}
                </div>
              )
            })}
            {extCals.length === 0 && (
              <p style={{ fontSize: 13, textAlign: 'center', padding: '32px 0',
                           color: 'var(--color-muted)' }}>Nincs behúzott naptár.</p>
            )}
          </div>
        )}

        {/* Kijelentkezés */}
        <div style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
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
