/**
 * BreakModal — Szünet vagy betegség felvitele
 * Megnyílik:
 *   - Ma képernyő betegség gyorsgombjából (pre-fill: illness, holnap)
 *   - Beállítások szünetek tabjából (üres form)
 */
import { useState } from 'react'
import { addDays } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Person, BreakPeriod, BreakReason } from '../types'
import { copy } from '../copy'
import { toIsoDate } from '../lib/format'
import { Icon } from './Icon'

interface Props {
  persons: Person[]
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
  minHeight: 44,
}
const btnGhost: React.CSSProperties = {
  flex: 1, padding: '11px', borderRadius: 10, fontSize: 14, fontWeight: 600,
  background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
  color: 'var(--color-muted)', cursor: 'pointer', minHeight: 44,
}

const REASONS: { value: BreakReason; label: string; icon: 'first-aid' | 'bed' | 'note-pencil' }[] = [
  { value: 'illness',  label: copy.settings.reasonIllness,  icon: 'first-aid' },
  { value: 'vacation', label: copy.settings.reasonVacation, icon: 'bed' },
  { value: 'other',    label: copy.settings.reasonOther,    icon: 'note-pencil' },
]

export function BreakModal({ persons, householdId, quickIllness, onClose, onDone }: Props) {
  const { person: me } = useAuth()
  const tomorrow = toIsoDate(addDays(new Date(), 1))
  const today    = toIsoDate(new Date())

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

      if (err || !data) { setError(err?.message ?? copy.common.error); return }

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
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name={quickIllness ? 'first-aid' : 'calendar-x'} size={20} weight="fill" />
            {quickIllness ? copy.breakModal.illnessTitle : copy.breakModal.absenceTitle}
          </h3>
          <button onClick={onClose} aria-label={copy.a11y.close} style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)',
            width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="x" size={20} />
          </button>
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--color-muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>
            {copy.breakModal.who}
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {persons.map(p => (
              <button key={p.id} onClick={() => setPersonId(p.id)} style={{
                padding: '7px 14px', borderRadius: 100, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                minHeight: 44,
                background: personId === p.id ? p.color + '22' : 'var(--color-surface-2)',
                border: `1.5px solid ${personId === p.id ? p.color : 'var(--color-border)'}`,
                color: personId === p.id ? 'var(--color-text)' : 'var(--color-muted)',
              }}>{p.display_name}</button>
            ))}
          </div>
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--color-muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>
            {copy.breakModal.reason}
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            {REASONS.map(r => (
              <button key={r.value} onClick={() => setReason(r.value)} style={{
                flex: 1, padding: '8px 4px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                background: reason === r.value ? 'rgba(79,156,249,0.12)' : 'var(--color-surface-2)',
                border: `1.5px solid ${reason === r.value ? 'var(--color-blue)' : 'var(--color-border)'}`,
                color: reason === r.value ? 'var(--color-blue)' : 'var(--color-muted)',
              }}>
                <Icon name={r.icon} size={16} />
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: 'var(--color-muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>
              {copy.breakModal.from}
            </label>
            <input style={inp} type="date" value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); if (e.target.value > dateTo) setDateTo(e.target.value) }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: 'var(--color-muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>
              {copy.breakModal.to}
            </label>
            <input style={inp} type="date" value={dateTo} min={dateFrom}
              onChange={e => setDateTo(e.target.value)} />
          </div>
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--color-muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>
            {copy.breakModal.note}
          </label>
          <input style={inp} placeholder={copy.breakModal.notePlaceholder}
            value={note} onChange={e => setNote(e.target.value)} />
        </div>

        {error && <div style={{ fontSize: 12, color: 'var(--color-red)' }}>{error}</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button style={btnGhost} onClick={onClose}>{copy.common.cancel}</button>
          <button style={btnPrimary} onClick={handleSave} disabled={saving || !personId}>
            {saving ? copy.common.saving : copy.breakModal.submit}
          </button>
        </div>
      </div>
    </div>
  )
}
