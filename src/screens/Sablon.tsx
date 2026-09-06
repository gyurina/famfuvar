import { useState, useEffect } from 'react'
import { Header } from '../components/Header'
import { supabase } from '../lib/supabase'
import { useHousehold } from '../hooks/useHousehold'
import type { ScheduleTemplate } from '../types'
import { format } from 'date-fns'

const WEEKDAYS = ['Hétfő','Kedd','Szerda','Csütörtök','Péntek','Szombat','Vasárnap']

interface FormData {
  person_id: string; title: string; weekday: number
  starts_at: string; ends_at: string; location_id: string
  needs_dropoff: boolean; needs_pickup: boolean
  valid_from: string; valid_to: string
}

const EMPTY: FormData = {
  person_id: '', title: '', weekday: 1,
  starts_at: '08:00', ends_at: '10:00',
  location_id: '', needs_dropoff: true, needs_pickup: true,
  valid_from: format(new Date(), 'yyyy-MM-dd'), valid_to: '',
}

export function Sablon() {
  const { children, locations, householdId } = useHousehold()
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<ScheduleTemplate | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormData>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genResult, setGenResult] = useState<string | null>(null)

  useEffect(() => {
    if (!householdId) return
    supabase.from('schedule_template').select('*')
      .eq('household_id', householdId)
      .order('weekday').order('starts_at')
      .then(({ data }) => { setTemplates(data ?? []); setLoading(false) })
  }, [householdId])

  function openNew() {
    setEditing(null)
    setForm({ ...EMPTY, person_id: children[0]?.id ?? '' })
    setError(null); setDeleteConfirm(null)
    setShowForm(true)
  }

  function openEdit(t: ScheduleTemplate) {
    setEditing(t)
    setForm({
      person_id: t.person_id, title: t.title, weekday: t.weekday,
      starts_at: t.starts_at.slice(0, 5), ends_at: t.ends_at.slice(0, 5),
      location_id: t.location_id, needs_dropoff: t.needs_dropoff,
      needs_pickup: t.needs_pickup, valid_from: t.valid_from,
      valid_to: t.valid_to ?? '',
    })
    setError(null); setDeleteConfirm(null)
    setShowForm(true)
  }

  async function handleSave() {
    if (!householdId) return
    if (!form.person_id || !form.location_id || !form.title) {
      setError('Töltsd ki a kötelező mezőket!'); return
    }
    if (form.starts_at >= form.ends_at) {
      setError('A befejezési időnek a kezdési idő után kell lennie!'); return
    }
    setSaving(true); setError(null)
    const payload = {
      household_id: householdId,
      person_id: form.person_id, title: form.title, weekday: form.weekday,
      starts_at: form.starts_at + ':00', ends_at: form.ends_at + ':00',
      location_id: form.location_id, needs_dropoff: form.needs_dropoff,
      needs_pickup: form.needs_pickup, valid_from: form.valid_from,
      valid_to: form.valid_to || null,
    }
    const { data, error: err } = editing
      ? await supabase.from('schedule_template').update(payload).eq('id', editing.id).select().single()
      : await supabase.from('schedule_template').insert(payload).select().single()
    if (err) { setError(err.message); setSaving(false); return }
    setTemplates(prev =>
      editing ? prev.map(t => t.id === editing.id ? data : t) : [...prev, data]
    )
    setSaving(false); setShowForm(false)
  }

  async function handleDelete(id: string) {
    await supabase.from('schedule_template').delete().eq('id', id)
    setTemplates(prev => prev.filter(t => t.id !== id))
    setDeleteConfirm(null); setShowForm(false)
  }

  async function generateHorizon() {
    if (!householdId) return
    setGenerating(true); setGenResult(null)
    const { data, error: err } = await supabase.rpc('generate_horizon', {
      p_household_id: householdId,
      p_days_ahead:   30,
    })
    if (err) setGenResult('Hiba: ' + err.message)
    else setGenResult(`Kész! ${data ?? 0} sor generálva (30 nap)`)
    setGenerating(false)
  }

  const childMap = Object.fromEntries(children.map(c => [c.id, c]))
  const locMap   = Object.fromEntries(locations.map(l => [l.id, l]))
  const grouped  = WEEKDAYS.map((name, i) => ({
    name, weekday: i + 1,
    rows: templates.filter(t => t.weekday === i + 1),
  }))

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    padding: '9px 12px', borderRadius: 'var(--r-sm)',
    background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
    color: 'var(--color-text)', fontSize: 14, outline: 'none', WebkitAppearance: 'none',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: 'var(--color-muted)',
    textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5,
  }

  return (
    <div style={{ background: 'var(--color-bg)', minHeight: '100dvh' }}>
      <Header
        title="Sablon"
        subtitle="Ismétlődő órarend"
        action={
          <button
            onClick={openNew}
            style={{
              background: 'var(--color-blue)', color: '#fff', border: 'none',
              borderRadius: 'var(--r-sm)', padding: '6px 14px', fontWeight: 700,
              fontSize: 13, cursor: 'pointer',
            }}
          >+ Új</button>
        }
      />

      {/* Horizon generator */}
      <div style={{ margin: '12px 16px 0', padding: '12px 14px', borderRadius: 'var(--r-md)', background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Occurrence generálás</div>
            <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
              Sablonokból létrehozza a következő 30 nap programjait és fuvarjait
            </div>
          </div>
          <button
            onClick={generateHorizon}
            disabled={generating}
            style={{
              padding: '7px 14px', borderRadius: 'var(--r-sm)', flexShrink: 0,
              background: generating ? 'var(--color-surface-2)' : 'rgba(45,216,138,0.12)',
              color: generating ? 'var(--color-muted)' : 'var(--color-green)',
              border: `1px solid ${generating ? 'var(--color-border)' : 'rgba(45,216,138,0.3)'}`,
              fontWeight: 600, fontSize: 12, cursor: generating ? 'default' : 'pointer',
            }}
          >{generating ? '⏳ Fut…' : '▶ Generálj'}</button>
        </div>
        {genResult && (
          <div style={{
            marginTop: 8, padding: '7px 10px', borderRadius: 'var(--r-sm)', fontSize: 12,
            background: genResult.startsWith('Hiba') ? 'rgba(242,107,107,0.1)' : 'rgba(45,216,138,0.08)',
            color: genResult.startsWith('Hiba') ? 'var(--color-red)' : 'var(--color-green)',
            border: `1px solid ${genResult.startsWith('Hiba') ? 'rgba(242,107,107,0.25)' : 'rgba(45,216,138,0.2)'}`,
          }}>{genResult}</div>
        )}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--color-muted)', fontSize: 13 }}>
          Betöltés…
        </div>
      )}

      {!loading && (
        <div style={{ padding: '16px 16px 96px' }}>
          {templates.length === 0 && (
            <div className="empty-state">
              <div className="icon">📋</div>
              <div className="title">Nincs sablon</div>
              <div className="sub">Adj hozzá egyet a + Új gombbal</div>
            </div>
          )}

          {grouped.map(g => g.rows.length > 0 && (
            <div key={g.weekday} style={{ marginBottom: 24 }}>
              <div className="section-label">{g.name}</div>
              {g.rows.map(t => {
                const child = childMap[t.person_id]
                const loc   = locMap[t.location_id]
                return (
                  <div
                    key={t.id}
                    className="leg-card"
                    style={{ display: 'flex', marginBottom: 8, cursor: 'pointer' }}
                    onClick={() => openEdit(t)}
                  >
                    <div className="leg-card-stripe" style={{ background: child?.color ?? 'var(--color-border)' }} />
                    <div className="leg-card-body">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-muted)' }}>
                            {t.starts_at.slice(0,5)}–{t.ends_at.slice(0,5)}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{t.title}</span>
                          {child && <span style={{ fontSize: 11, color: child.color }}>{child.display_name}</span>}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
                          {loc?.name ?? '?'}
                          {t.needs_dropoff ? ' · →oda' : ''}
                          {t.needs_pickup  ? ' · ←vissza' : ''}
                          {t.valid_to ? ` · ig: ${t.valid_to}` : ''}
                        </div>
                      </div>
                      <div style={{ color: 'var(--color-muted)', fontSize: 16, padding: '0 4px' }}>›</div>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* Bottom sheet form */}
      {showForm && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) setShowForm(false) }}
        >
          <div style={{
            width: '100%', maxHeight: '94dvh', overflowY: 'auto',
            background: 'var(--color-surface)', borderRadius: 'var(--r-lg) var(--r-lg) 0 0',
            padding: '20px 20px 48px', boxShadow: 'var(--shadow-popup)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{editing ? 'Sablon szerkesztése' : 'Új sablon-sor'}</div>
              <button onClick={() => setShowForm(false)}
                style={{ background: 'none', border: 'none', color: 'var(--color-muted)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Gyerek */}
              <div>
                <label style={labelStyle}>Kinek *</label>
                <select style={inputStyle} value={form.person_id} onChange={e => setForm(f => ({...f, person_id: e.target.value}))}>
                  <option value="">Válassz…</option>
                  {children.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
                </select>
              </div>

              {/* Cím */}
              <div>
                <label style={labelStyle}>Program neve *</label>
                <input style={inputStyle} value={form.title} placeholder="pl. Zeneiskola"
                  onChange={e => setForm(f => ({...f, title: e.target.value}))} />
              </div>

              {/* Nap */}
              <div>
                <label style={labelStyle}>Nap</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  {WEEKDAYS.map((d, i) => (
                    <button key={i} onClick={() => setForm(f => ({...f, weekday: i+1}))}
                      style={{
                        flex: 1, padding: '8px 0', borderRadius: 'var(--r-sm)', border: 'none',
                        fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        background: form.weekday === i+1 ? 'var(--color-blue)' : 'var(--color-surface-2)',
                        color: form.weekday === i+1 ? '#fff' : 'var(--color-muted)',
                      }}>
                      {d[0]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Idő */}
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Kezdés</label>
                  <input type="time" style={inputStyle} value={form.starts_at}
                    onChange={e => setForm(f => ({...f, starts_at: e.target.value}))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Vége</label>
                  <input type="time" style={inputStyle} value={form.ends_at}
                    onChange={e => setForm(f => ({...f, ends_at: e.target.value}))} />
                </div>
              </div>

              {/* Helyszín */}
              <div>
                <label style={labelStyle}>Helyszín *</label>
                <select style={inputStyle} value={form.location_id} onChange={e => setForm(f => ({...f, location_id: e.target.value}))}>
                  <option value="">Válassz…</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>

              {/* Fuvar */}
              <div>
                <label style={labelStyle}>Szállítás</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[
                    { label: 'Odavitel', key: 'needs_dropoff' as const },
                    { label: 'Visszahozás', key: 'needs_pickup' as const },
                  ].map(({ label, key }) => (
                    <button key={key} onClick={() => setForm(f => ({...f, [key]: !f[key]}))}
                      style={{
                        flex: 1, padding: '9px 0', borderRadius: 'var(--r-sm)',
                        fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        background: form[key] ? 'rgba(79,156,249,0.12)' : 'var(--color-surface-2)',
                        color: form[key] ? 'var(--color-blue)' : 'var(--color-muted)',
                        border: `1px solid ${form[key] ? 'rgba(79,156,249,0.3)' : 'var(--color-border)'}`,
                      }}>
                      {form[key] ? '✓ ' : ''}{label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Érvényesség */}
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Érvényes-től</label>
                  <input type="date" style={inputStyle} value={form.valid_from}
                    onChange={e => setForm(f => ({...f, valid_from: e.target.value}))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Érvényes-ig (üres=örök)</label>
                  <input type="date" style={inputStyle} value={form.valid_to}
                    onChange={e => setForm(f => ({...f, valid_to: e.target.value}))} />
                </div>
              </div>

              {error && (
                <div style={{ padding: '9px 12px', borderRadius: 'var(--r-sm)', fontSize: 12,
                  background: 'rgba(242,107,107,0.1)', color: 'var(--color-red)',
                  border: '1px solid rgba(242,107,107,0.25)' }}>{error}</div>
              )}

              <button onClick={handleSave} disabled={saving}
                style={{
                  marginTop: 4, padding: '13px', borderRadius: 'var(--r-md)', border: 'none',
                  background: saving ? 'var(--color-border)' : 'var(--color-blue)',
                  color: '#fff', fontWeight: 700, fontSize: 15,
                  cursor: saving ? 'default' : 'pointer',
                }}>{saving ? 'Mentés…' : editing ? 'Módosítás mentése' : 'Sablon hozzáadása'}</button>

              {/* Delete — inline confirm */}
              {editing && (
                deleteConfirm === editing.id ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setDeleteConfirm(null)}
                      style={{ flex: 1, padding: '11px', borderRadius: 'var(--r-md)', border: '1px solid var(--color-border)',
                        background: 'transparent', color: 'var(--color-muted)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                      Mégsem
                    </button>
                    <button onClick={() => handleDelete(editing.id)}
                      style={{ flex: 1, padding: '11px', borderRadius: 'var(--r-md)', border: '1px solid rgba(242,107,107,0.3)',
                        background: 'rgba(242,107,107,0.1)', color: 'var(--color-red)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                      Igen, törlöm
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setDeleteConfirm(editing.id)}
                    style={{ padding: '11px', borderRadius: 'var(--r-md)', border: '1px solid rgba(242,107,107,0.3)',
                      background: 'transparent', color: 'var(--color-red)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                    🗑 Sablon törlése
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
