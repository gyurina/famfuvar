import { useState, useEffect } from 'react'
import { Header } from '../components/Header'
import { supabase } from '../lib/supabase'
import { useHousehold } from '../hooks/useHousehold'
import type { ScheduleTemplate } from '../types'
import { format } from 'date-fns'

const WEEKDAYS = ['Hétfő','Kedd','Szerda','Csütörtök','Péntek','Szombat','Vasárnap']

interface TemplateFormData {
  person_id: string
  title: string
  weekday: number
  starts_at: string
  ends_at: string
  location_id: string
  needs_dropoff: boolean
  needs_pickup: boolean
  valid_from: string
  valid_to: string
}

const EMPTY_FORM: TemplateFormData = {
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
  const [form, setForm] = useState<TemplateFormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!householdId) return
    supabase.from('schedule_template').select('*')
      .eq('household_id', householdId)
      .order('weekday').order('starts_at')
      .then(({ data }) => { setTemplates(data ?? []); setLoading(false) })
  }, [householdId])

  function openNew() {
    setEditing(null)
    setForm({ ...EMPTY_FORM, person_id: children[0]?.id ?? '' })
    setShowForm(true)
    setError(null)
  }

  function openEdit(t: ScheduleTemplate) {
    setEditing(t)
    setForm({
      person_id: t.person_id, title: t.title, weekday: t.weekday,
      starts_at: t.starts_at.slice(0, 5), ends_at: t.ends_at.slice(0, 5),
      location_id: t.location_id, needs_dropoff: t.needs_dropoff,
      needs_pickup: t.needs_pickup,
      valid_from: t.valid_from, valid_to: t.valid_to ?? '',
    })
    setShowForm(true)
    setError(null)
  }

  async function handleSave() {
    if (!householdId) return
    if (!form.person_id || !form.location_id || !form.title) {
      setError('Töltsd ki a kötelező mezőket!')
      return
    }
    if (form.starts_at >= form.ends_at) {
      setError('A befejezési időnek a kezdési idő után kell lennie!')
      return
    }
    setSaving(true); setError(null)
    const payload = {
      household_id: householdId,
      person_id: form.person_id,
      title: form.title,
      weekday: form.weekday,
      starts_at: form.starts_at,
      ends_at: form.ends_at,
      location_id: form.location_id,
      needs_dropoff: form.needs_dropoff,
      needs_pickup: form.needs_pickup,
      valid_from: form.valid_from,
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
    if (!confirm('Biztosan törlöd ezt a sablon-sort?')) return
    await supabase.from('schedule_template').delete().eq('id', id)
    setTemplates(prev => prev.filter(t => t.id !== id))
  }

  const childrenMap = Object.fromEntries(children.map(c => [c.id, c]))
  const locationMap = Object.fromEntries(locations.map(l => [l.id, l]))

  const grouped = WEEKDAYS.map((name, i) => ({
    name, weekday: i + 1,
    rows: templates.filter(t => t.weekday === i + 1),
  }))

  return (
    <div style={{ background: 'var(--color-bg)', minHeight: '100dvh' }}>
      <Header
        title="Sablon"
        subtitle="Ismétlődő órarend"
        action={
          <button onClick={openNew}
            className="text-sm font-semibold px-3 rounded-lg"
            style={{ background: 'var(--color-blue)', color: '#fff', minHeight: 36 }}>
            + Új
          </button>
        }
      />

      {loading && <div className="text-center py-8 text-sm" style={{ color: 'var(--color-muted)' }}>Betöltés…</div>}

      {!loading && !showForm && (
        <div className="px-4 pt-3 space-y-5 pb-6">
          {grouped.map(g => (
            <div key={g.weekday}>
              <div className="text-xs font-semibold uppercase tracking-wider mb-2"
                   style={{ color: 'var(--color-muted)' }}>{g.name}</div>
              {g.rows.length === 0
                ? <div className="text-xs italic px-1" style={{ color: 'var(--color-border)' }}>Nincs program</div>
                : g.rows.map(t => {
                  const child = childrenMap[t.person_id]
                  const loc = locationMap[t.location_id]
                  return (
                    <div key={t.id}
                      className="rounded-xl px-4 py-3 mb-2 flex items-center justify-between"
                      style={{ background: 'var(--color-surface)' }}>
                      <div className="flex items-center gap-3">
                        <span className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: child?.color ?? '#888' }} />
                        <div>
                          <div className="text-sm font-medium">{t.title}</div>
                          <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                            {t.starts_at.slice(0,5)}–{t.ends_at.slice(0,5)} · {loc?.name ?? '?'}
                            {t.needs_dropoff && ' · oda'}
                            {t.needs_pickup && ' · vissza'}
                          </div>
                          {t.valid_to && (
                            <div className="text-xs mt-0.5 text-yellow-400">Érvényes: {t.valid_from} – {t.valid_to}</div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => openEdit(t)}
                          className="text-xs px-2 py-1 rounded-lg hover:bg-slate-700"
                          style={{ minHeight: 32 }}>✏️</button>
                        <button onClick={() => handleDelete(t.id)}
                          className="text-xs px-2 py-1 rounded-lg hover:bg-red-900"
                          style={{ minHeight: 32 }}>🗑️</button>
                      </div>
                    </div>
                  )
                })
              }
            </div>
          ))}
          {templates.length === 0 && (
            <div className="text-center py-12" style={{ color: 'var(--color-muted)' }}>
              <div className="text-4xl mb-2">📋</div>
              <p className="text-sm">Még nincs sablon. Adj hozzá egyet a + Új gombbal.</p>
            </div>
          )}
        </div>
      )}

      {/* Szerkesztő / létrehozó panel */}
      {showForm && (
        <div className="px-4 pt-4 pb-8">
          <h2 className="text-base font-semibold mb-4">{editing ? 'Sablon szerkesztése' : 'Új sablon-sor'}</h2>
          <div className="space-y-4">

            {/* Gyerek */}
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Gyerek *</label>
              <select value={form.person_id} onChange={e => setForm(f => ({...f, person_id: e.target.value}))}
                className="w-full rounded-xl px-3 py-3 text-sm"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                <option value="">Válassz…</option>
                {children.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
              </select>
            </div>

            {/* Megnevezés */}
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Program neve *</label>
              <input value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value}))}
                placeholder="pl. Zeneiskola"
                className="w-full rounded-xl px-3 py-3 text-sm"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}/>
            </div>

            {/* Nap */}
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Nap</label>
              <div className="flex gap-1">
                {WEEKDAYS.map((d, i) => (
                  <button key={i} onClick={() => setForm(f => ({...f, weekday: i+1}))}
                    className="flex-1 rounded-lg py-2 text-xs font-medium transition-colors"
                    style={{
                      minHeight: 36,
                      background: form.weekday === i+1 ? 'var(--color-blue)' : 'var(--color-surface)',
                      color: form.weekday === i+1 ? '#fff' : 'var(--color-muted)',
                    }}>
                    {d[0]}
                  </button>
                ))}
              </div>
            </div>

            {/* Idő */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Kezdés</label>
                <input type="time" value={form.starts_at} onChange={e => setForm(f => ({...f, starts_at: e.target.value}))}
                  className="w-full rounded-xl px-3 py-3 text-sm"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}/>
              </div>
              <div className="flex-1">
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Befejezés</label>
                <input type="time" value={form.ends_at} onChange={e => setForm(f => ({...f, ends_at: e.target.value}))}
                  className="w-full rounded-xl px-3 py-3 text-sm"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}/>
              </div>
            </div>

            {/* Helyszín */}
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Helyszín *</label>
              <select value={form.location_id} onChange={e => setForm(f => ({...f, location_id: e.target.value}))}
                className="w-full rounded-xl px-3 py-3 text-sm"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                <option value="">Válassz…</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>

            {/* Fuvar irányok */}
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.needs_dropoff}
                  onChange={e => setForm(f => ({...f, needs_dropoff: e.target.checked}))} className="w-4 h-4"/>
                Odavitel kell
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.needs_pickup}
                  onChange={e => setForm(f => ({...f, needs_pickup: e.target.checked}))} className="w-4 h-4"/>
                Hazahozatal kell
              </label>
            </div>

            {/* Érvényesség */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Érvényes-tól</label>
                <input type="date" value={form.valid_from} onChange={e => setForm(f => ({...f, valid_from: e.target.value}))}
                  className="w-full rounded-xl px-3 py-3 text-sm"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}/>
              </div>
              <div className="flex-1">
                <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Érvényes-ig (üres = örök)</label>
                <input type="date" value={form.valid_to} onChange={e => setForm(f => ({...f, valid_to: e.target.value}))}
                  className="w-full rounded-xl px-3 py-3 text-sm"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}/>
              </div>
            </div>

            {error && <p className="text-sm text-red-400 bg-red-950 rounded-lg px-3 py-2">{error}</p>}

            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowForm(false)}
                className="flex-1 rounded-xl py-3.5 text-sm font-medium"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', minHeight: 44 }}>
                Mégsem
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 rounded-xl py-3.5 text-sm font-semibold disabled:opacity-50"
                style={{ background: 'var(--color-blue)', color: '#fff', minHeight: 44 }}>
                {saving ? 'Mentés…' : 'Mentés'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
