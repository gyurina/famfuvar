/**
 * BreakModal — Szünet vagy betegség felvitele
 * Megnyílik:
 *   - Ma képernyő "🤒 Beteg" gyorsgombból (pre-fill: illness, holnap)
 *   - Beállítások "Szünetek" tabból (üres form)
 */
import { useState } from 'react'
import { format, addDays } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Person, BreakPeriod, BreakReason } from '../types'

interface Props {
  persons: Person[]             // gyerekek + érintett személyek
  householdId: string
  /** Betegség gyorsmód: előre kitöltött személy + holnaptól */
  quickIllness?: { personId: string }
  onClose: () => void
  onDone: (bp: BreakPeriod) => void
}

const inp: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
  color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box',
}
const btnPrimary: React.CSSProperties = {
  flex: 1, padding: '11px', borderRadius: 10, fontSize: 14, fontWeight: 700,
  background: 'var(--color-blue)', color: '#fff', border: 'none', cursor: 'pointer',
}
const btnGhost: React.CSSProperties = {
  flex: 1, padding: '11px', borderRadius: 10, fontSize: 14, fontWeight: 600,
  background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
  color: 'var(--color-muted)', cursor: 'pointer',
}

const REASONS: { value: BreakReason; label: string; emoji: string }[] = [
  { value: 'illness',  label: 'Betegség',   emoji: '🤒' },
  { value: 'vacation', label: 'Szünet',     emoji: '🏖️' },
  { value: 'other',    label: 'Egyéb',      emoji: '📌' },
]

export function BreakModal({ persons, householdId, quickIllness, onClose, onDone }: Props) {
  const { person: me } = useAuth()
  const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd')
  const today    = format(new Date(), 'yyyy-MM-dd')

  const [personId,  setPersonId]  = useState(quickIllness?.personId ?? persons[0]?.id ?? '')
  const [reason,    setReason]    = useState<BreakReason>(quickIllness ? 'illness' : 'vacation')
  const [dateFrom,  setDateFrom]  = useState(quickIllness ? tomorrow : today)
  const [dateTo,    setDateTo]    = useState(quickIllness ? tomorrow : today)
  const [note,      setNote]      = useState('')
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  async function handleSave() {
    if (!personId) return
    setSaving(true); setError(null)
    try {
      const { data, error: err } = await supabase
        .from('break_period')
        .insert({
          household_id: householdId,
          person_id:    personId,
          date_from:    dateFrom,
          date_to:      dateTo,
          reason,
          note:         note || null,
          created_by:   me?.id ?? null,
        })
        .select('*').single()

      if (err || !data) { setError(err?.message ?? 'Hiba'); return }

      // Alkalmak lemondása (DB függvény)
      await supabase.rpc('apply_break_period', { p_break_id: data.id })
      onDone(data as BreakPeriod)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'flex-end', zIndex: 200,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        width: '100%', background: 'var(--color-surface)',
        borderRadius: '20px 20px 0 0', padding: '20px 20px calc(20px + env(safe-area-inset-bottom))',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
            {quickIllness ? '🤒 Betegség rögzítése' : '📅 Szünet / kiesés'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--color-muted)', lineHeight: 1 }}>✕</button>
        </div>

        {/* Személy */}
        <div>
          <label style={{ fontSize: 11, color: 'var(--color-muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>KI</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {persons.map(p => (
              <button key={p.id} onClick={() => setPersonId(p.id)} style={{
                padding: '7px 14px', borderRadius: 100, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: personId === p.id ? p.color + '22' : 'var(--color-surface-2)',
                border: `1.5px solid ${personId === p.id ? p.color : 'var(--color-border)'}`,
                color: personId === p.id ? p.color : 'var(--color-muted)',
              }}>{p.display_name}</button>
            ))}
          </div>
        </div>

        {/* Oka */}
        <div>
          <label style={{ fontSize: 11, color: 'var(--color-muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>OKA</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {REASONS.map(r => (
              <button key={r.value} onClick={() => setReason(r.value)} style={{
                flex: 1, padding: '8px 4px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: reason === r.value ? 'rgba(79,156,249,0.12)' : 'var(--color-surface-2)',
                border: `1.5px solid ${reason === r.value ? 'var(--color-blue)' : 'var(--color-border)'}`,
                color: reason === r.value ? 'var(--color-blue)' : 'var(--color-muted)',
              }}>{r.emoji} {r.label}</button>
            ))}
          </div>
        </div>

        {/* Dátum */}
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: 'var(--color-muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>TÓLÓL</label>
            <input style={inp} type="date" value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); if (e.target.value > dateTo) setDateTo(e.target.value) }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: 'var(--color-muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>EDDIG</label>
            <input style={inp} type="date" value={dateTo} min={dateFrom}
              onChange={e => setDateTo(e.target.value)} />
          </div>
        </div>

        {/* Megjegyzés */}
        <div>
          <label style={{ fontSize: 11, color: 'var(--color-muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>MEGJEGYZÉS (opcionális)</label>
          <input style={inp} placeholder="pl. láz, osztálykirándulás…"
            value={note} onChange={e => setNote(e.target.value)} />
        </div>

        {error && <div style={{ fontSize: 12, color: 'var(--color-red)' }}>{error}</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button style={btnGhost} onClick={onClose}>Mégsem</button>
          <button style={btnPrimary} onClick={handleSave} disabled={saving || !personId}>
            {saving ? 'Mentés…' : '✓ Rögzít + alkalmak lemondása'}
          </button>
        </div>
      </div>
    </div>
  )
}
