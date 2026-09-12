import { useState, useEffect } from 'react'
import { format, parseISO } from 'date-fns'
import { hu } from 'date-fns/locale'
import { Header } from '../components/Header'
import { supabase } from '../lib/supabase'
import { useHousehold } from '../hooks/useHousehold'
import type { Occurrence } from '../types'

export function Esemeny() {
  const { children, locations, home, householdId, personById, locationById } = useHousehold()
  const [events, setEvents] = useState<Occurrence[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingEvent, setEditingEvent] = useState<Occurrence | null>(null)

  const today = format(new Date(), 'yyyy-MM-dd')

  // Form state
  const [fDate,     setFDate]     = useState(today)
  const [fTitle,    setFTitle]    = useState('')
  const [fPersonId, setFPersonId] = useState('')
  const [fStartsAt, setFStartsAt] = useState('08:00')
  const [fEndsAt,   setFEndsAt]   = useState('10:00')
  const [fLocId,    setFLocId]    = useState('')
  const [fDropoff,  setFDropoff]  = useState(true)
  const [fPickup,   setFPickup]   = useState(true)

  useEffect(() => {
    if (!householdId) return
    supabase.from('occurrence')
      .select('*')
      .eq('household_id', householdId)
      .filter('template_id', 'is', null)
      .gte('on_date', today)
      .order('on_date').order('starts_at')
      .then(({ data, error }) => {
        if (error) console.error('occurrence query:', error)
        setEvents((data as Occurrence[]) ?? [])
        setLoading(false)
      })
  }, [householdId])

  async function openForm(event?: Occurrence) {
    if (event) {
      // Edit mode — pre-fill form
      setEditingEvent(event)
      setFDate(event.on_date)
      setFTitle(event.title)
      setFPersonId(event.person_id ?? '')
      setFStartsAt(event.starts_at.slice(0, 5))
      setFEndsAt(event.ends_at.slice(0, 5))
      setFLocId(event.location_id ?? '')
      // Load existing legs to determine dropoff/pickup state
      const { data: legs } = await supabase
        .from('transport_leg')
        .select('direction')
        .eq('occurrence_id', event.id)
      setFDropoff(legs?.some(l => l.direction === 'dropoff') ?? true)
      setFPickup(legs?.some(l => l.direction === 'pickup') ?? true)
    } else {
      // New mode
      setEditingEvent(null)
      setFDate(today)
      setFTitle('')
      setFPersonId(children[0]?.id ?? '')
      setFStartsAt('08:00')
      setFEndsAt('10:00')
      setFLocId(locations.find(l => !l.is_home)?.id ?? '')
      setFDropoff(true)
      setFPickup(true)
    }
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingEvent(null)
  }

  async function save() {
    if (!householdId || !fTitle || !fPersonId) return
    setSaving(true)
    const loc    = fLocId || null
    const homeId = home?.id ?? null

    if (editingEvent) {
      // UPDATE
      const { data: updated } = await supabase.from('occurrence')
        .update({
          person_id:   fPersonId,
          title:       fTitle,
          on_date:     fDate,
          starts_at:   fStartsAt + ':00',
          ends_at:     fEndsAt   + ':00',
          location_id: loc ?? homeId,
        })
        .eq('id', editingEvent.id)
        .select().single()

      if (updated) {
        setEvents(prev => prev.map(e => e.id === editingEvent.id ? updated as Occurrence : e))
      }

      // Reconcile legs: delete existing, re-insert
      await supabase.from('transport_leg').delete().eq('occurrence_id', editingEvent.id)
      const legs = []
      if (fDropoff) legs.push({
        household_id:  householdId,
        occurrence_id: editingEvent.id,
        direction:     'dropoff',
        driver_id:     null,
        depart_at:     `${fDate}T${fStartsAt}:00+02:00`,
        arrive_at:     `${fDate}T${fStartsAt}:00+02:00`,
        from_location: homeId,
        to_location:   loc,
      })
      if (fPickup) legs.push({
        household_id:  householdId,
        occurrence_id: editingEvent.id,
        direction:     'pickup',
        driver_id:     null,
        depart_at:     `${fDate}T${fEndsAt}:00+02:00`,
        arrive_at:     `${fDate}T${fEndsAt}:00+02:00`,
        from_location: loc,
        to_location:   homeId,
      })
      if (legs.length) await supabase.from('transport_leg').insert(legs)

    } else {
      // INSERT
      const { data: occ } = await supabase.from('occurrence').insert({
        household_id: householdId,
        template_id:  null,
        person_id:    fPersonId,
        title:        fTitle,
        on_date:      fDate,
        starts_at:    fStartsAt + ':00',
        ends_at:      fEndsAt   + ':00',
        location_id:  loc ?? homeId,
        status:       'planned',
      }).select().single()

      if (occ) {
        const legs = []
        if (fDropoff) legs.push({
          household_id:  householdId,
          occurrence_id: occ.id,
          direction:     'dropoff',
          driver_id:     null,
          depart_at:     `${fDate}T${fStartsAt}:00+02:00`,
          arrive_at:     `${fDate}T${fStartsAt}:00+02:00`,
          from_location: homeId,
          to_location:   loc,
        })
        if (fPickup) legs.push({
          household_id:  householdId,
          occurrence_id: occ.id,
          direction:     'pickup',
          driver_id:     null,
          depart_at:     `${fDate}T${fEndsAt}:00+02:00`,
          arrive_at:     `${fDate}T${fEndsAt}:00+02:00`,
          from_location: loc,
          to_location:   homeId,
        })
        if (legs.length) await supabase.from('transport_leg').insert(legs)
        setEvents(prev => [...prev, occ as Occurrence].sort((a, b) =>
          a.on_date.localeCompare(b.on_date) || a.starts_at.localeCompare(b.starts_at)
        ))
      }
    }

    setSaving(false)
    closeForm()
  }

  async function cancelEvent(id: string) {
    await supabase.from('occurrence').update({ status: 'cancelled' }).eq('id', id)
    setEvents(prev => prev.map(e => e.id === id ? { ...e, status: 'cancelled' } : e))
    closeForm()
  }

  // Group events by date
  const grouped: { date: string; label: string; evts: Occurrence[] }[] = []
  for (const e of events) {
    let g = grouped.find(x => x.date === e.on_date)
    if (!g) {
      g = { date: e.on_date, label: format(parseISO(e.on_date), 'EEEE, MMM d.', { locale: hu }), evts: [] }
      grouped.push(g)
    }
    g.evts.push(e)
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    padding: '9px 12px', borderRadius: 'var(--r-sm)',
    background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
    color: 'var(--color-text)', fontSize: 14, outline: 'none',
    WebkitAppearance: 'none',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: 'var(--color-muted)',
    textTransform: 'uppercase', letterSpacing: '0.06em',
    display: 'block', marginBottom: 5,
  }

  return (
    <div style={{ background: 'var(--color-bg)', minHeight: '100dvh' }}>
      <Header title="Események" subtitle="Egyszeri programok" />

      {!loading && events.length === 0 && !showForm && (
        <div className="empty-state" style={{ marginTop: 48 }}>
          <div className="icon">🎯</div>
          <div className="title">Nincs egyszeri esemény</div>
          <div className="sub">Nyomj + a hozzáadáshoz</div>
        </div>
      )}

      {!loading && grouped.length > 0 && (
        <div style={{ padding: '16px 16px 120px' }}>
          {grouped.map(g => (
            <div key={g.date} style={{ marginBottom: 24 }}>
              <div className="day-header">{g.label}</div>
              {g.evts.map(e => {
                const child = personById(e.person_id)
                const loc   = locationById(e.location_id)
                return (
                  <div
                    key={e.id}
                    className="leg-card"
                    style={{ display: 'flex', marginBottom: 8, cursor: 'pointer', opacity: e.status === 'cancelled' ? 0.5 : 1 }}
                    onClick={() => openForm(e)}
                  >
                    <div className="leg-card-stripe" style={{ background: child?.color ?? 'var(--color-border)' }} />
                    <div className="leg-card-body">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>
                            {e.starts_at.slice(0, 5)}–{e.ends_at.slice(0, 5)}
                          </span>
                          <span style={{ fontSize: 13, textDecoration: e.status === 'cancelled' ? 'line-through' : 'none' }}>
                            {e.title}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
                          {child?.display_name}{loc ? ` · ${loc.name}` : ''}
                        </div>
                      </div>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        padding: '4px 10px', borderRadius: 100, fontSize: 11, fontWeight: 600, flexShrink: 0,
                        background: e.status === 'cancelled' ? 'var(--color-surface-2)' : 'rgba(79,156,249,0.1)',
                        color: e.status === 'cancelled' ? 'var(--color-muted)' : 'var(--color-blue)',
                        border: `1px solid ${e.status === 'cancelled' ? 'var(--color-border)' : 'rgba(79,156,249,0.25)'}`,
                      }}>
                        {e.status === 'cancelled' ? 'Elmarad' : '✎ Szerkeszt'}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* FAB */}
      {!showForm && (
        <button
          onClick={() => openForm()}
          style={{
            position: 'fixed', bottom: 80, right: 20, zIndex: 50,
            width: 52, height: 52, borderRadius: '50%',
            background: 'var(--color-blue)', color: '#fff',
            border: 'none', fontSize: 26, cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(79,156,249,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >+</button>
      )}

      {/* Bottom sheet form */}
      {showForm && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) closeForm() }}
        >
          <div style={{
            width: '100%', maxHeight: '92dvh', overflowY: 'auto',
            background: 'var(--color-surface)',
            borderRadius: 'var(--r-lg) var(--r-lg) 0 0',
            padding: '20px 20px 48px',
            boxShadow: 'var(--shadow-popup)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {editingEvent ? 'Esemény szerkesztése' : 'Új esemény'}
              </div>
              <button onClick={closeForm}
                style={{ background: 'none', border: 'none', color: 'var(--color-muted)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={labelStyle}>Program neve</label>
                <input style={inputStyle} value={fTitle} onChange={e => setFTitle(e.target.value)} placeholder="pl. Zeneiskola" />
              </div>

              <div>
                <label style={labelStyle}>Dátum</label>
                <input type="date" style={inputStyle} value={fDate} onChange={e => setFDate(e.target.value)} />
              </div>

              <div>
                <label style={labelStyle}>Kinek</label>
                <select style={inputStyle} value={fPersonId} onChange={e => setFPersonId(e.target.value)}>
                  {children.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
                </select>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Kezdés</label>
                  <input type="time" style={inputStyle} value={fStartsAt} onChange={e => setFStartsAt(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Vége</label>
                  <input type="time" style={inputStyle} value={fEndsAt} onChange={e => setFEndsAt(e.target.value)} />
                </div>
              </div>

              <div>
                <label style={labelStyle}>Helyszín</label>
                <select style={inputStyle} value={fLocId} onChange={e => setFLocId(e.target.value)}>
                  <option value="">— Nincs megadva —</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Szállítás</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[
                    { label: 'Odavitel', value: fDropoff, set: setFDropoff },
                    { label: 'Visszahozás', value: fPickup, set: setFPickup },
                  ].map(({ label, value, set }) => (
                    <button
                      key={label}
                      onClick={() => set(v => !v)}
                      style={{
                        flex: 1, padding: '9px 0', borderRadius: 'var(--r-sm)',
                        fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        background: value ? 'rgba(79,156,249,0.12)' : 'var(--color-surface-2)',
                        color: value ? 'var(--color-blue)' : 'var(--color-muted)',
                        border: `1px solid ${value ? 'rgba(79,156,249,0.3)' : 'var(--color-border)'}`,
                        transition: 'all 0.15s',
                      }}
                    >{value ? '✓ ' : ''}{label}</button>
                  ))}
                </div>
              </div>

              <button
                onClick={save}
                disabled={saving || !fTitle || !fPersonId}
                style={{
                  marginTop: 6, padding: '13px', borderRadius: 'var(--r-md)',
                  background: saving || !fTitle || !fPersonId ? 'var(--color-border)' : 'var(--color-blue)',
                  color: '#fff', border: 'none', fontWeight: 700, fontSize: 15,
                  cursor: saving || !fTitle || !fPersonId ? 'default' : 'pointer',
                }}
              >{saving ? 'Mentés…' : editingEvent ? 'Módosítás mentése' : 'Esemény hozzáadása'}</button>

              {/* Cancel event button — only in edit mode */}
              {editingEvent && editingEvent.status !== 'cancelled' && (
                <button
                  onClick={() => cancelEvent(editingEvent.id)}
                  disabled={saving}
                  style={{
                    padding: '11px', borderRadius: 'var(--r-md)',
                    background: 'transparent',
                    color: 'var(--color-red)', border: '1px solid rgba(242,107,107,0.3)',
                    fontWeight: 600, fontSize: 14, cursor: 'pointer',
                  }}
                >⊘ Esemény elmarad</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
