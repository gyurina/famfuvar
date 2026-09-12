/**
 * QuickLogModal — Gyors naplézés (2 koppintás)
 * Váratlan változás rögzítése részletek nélkül.
 * Részletek utólag pótolhatók az OccurrenceOverrideModal-ban.
 */
import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Person, Occurrence } from '../types'

interface Props {
  householdId: string
  persons: Person[]
  onClose: () => void
  onDone: () => void
}

const inp: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
  color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box',
}

type QuickAction = 'cancel_today' | 'note'

export function QuickLogModal({ householdId, persons, onClose, onDone }: Props) {
  const { person: me } = useAuth()
  const [personId, setPersonId]   = useState(persons.find(p => p.role === 'child')?.id ?? persons[0]?.id ?? '')
  const [action,   setAction]     = useState<QuickAction>('cancel_today')
  const [note,     setNote]       = useState('')
  const [occs,     setOccs]       = useState<Occurrence[]>([])
  const [occId,    setOccId]      = useState<string | null>(null)
  const [saving,   setSaving]     = useState(false)
  const [error,    setError]      = useState<string | null>(null)
  const today = format(new Date(), 'yyyy-MM-dd')

  useEffect(() => {
    if (!personId) return
    supabase.from('occurrence').select('*')
      .eq('household_id', householdId)
      .eq('person_id', personId)
      .eq('on_date', today)
      .neq('status', 'cancelled')
      .order('starts_at')
      .then(({ data }) => {
        const list = (data ?? []) as Occurrence[]
        setOccs(list)
        setOccId(list[0]?.id ?? null)
      })
  }, [personId, householdId])

  async function handleSave() {
    setSaving(true); setError(null)
    try {
      if (action === 'cancel_today') {
        // Összes mai alkalom lemondása az adott személynek
        const ids = occs.map(o => o.id)
        if (!ids.length) { setError('Nincs mai program ennek a személynek.'); return }
        await supabase.from('occurrence').update({
          status: 'cancelled', is_override: true, updated_at: new Date().toISOString(),
          updated_by: me?.id ?? null, note: note || null,
        }).in('id', ids)
      } else {
        // Megjegyzés egy kiválasztott alkalmhoz
        if (!occId) { setError('Válassz ki egy programot.'); return }
        await supabase.from('occurrence').update({
          note: note, is_override: true, updated_at: new Date().toISOString(),
          updated_by: me?.id ?? null,
        }).eq('id', occId)
      }
      onDone()
    } finally {
      setSaving(false)
    }
  }

  const targets = persons.filter(p => p.role === 'child' || p.role === 'parent')

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'flex-end', zIndex: 200,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        width: '100%', background: 'var(--color-surface)',
        borderRadius: '20px 20px 0 0',
        padding: '20px 20px calc(20px + env(safe-area-inset-bottom))',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>⚡ Gyors rögzítés</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--color-muted)', lineHeight: 1 }}>✕</button>
        </div>

        {/* Személy */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {targets.map(p => (
            <button key={p.id} onClick={() => setPersonId(p.id)} style={{
              padding: '7px 14px', borderRadius: 100, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: personId === p.id ? p.color + '22' : 'var(--color-surface-2)',
              border: `1.5px solid ${personId === p.id ? p.color : 'var(--color-border)'}`,
              color: personId === p.id ? p.color : 'var(--color-muted)',
            }}>{p.display_name}</button>
          ))}
        </div>

        {/* Művelet */}
        <div style={{ display: 'flex', gap: 8 }}>
          {([
            { value: 'cancel_today', label: '🚫 Ma elmarad', desc: 'Minden mai program lemondva' },
            { value: 'note',         label: '📝 Megjegyzés', desc: 'Egy programhoz rögzít' },
          ] as const).map(a => (
            <button key={a.value} onClick={() => setAction(a.value)} style={{
              flex: 1, padding: '10px 8px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
              background: action === a.value ? 'rgba(79,156,249,0.1)' : 'var(--color-surface-2)',
              border: `1.5px solid ${action === a.value ? 'var(--color-blue)' : 'var(--color-border)'}`,
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: action === a.value ? 'var(--color-blue)' : 'var(--color-text)' }}>{a.label}</div>
              <div style={{ fontSize: 10, color: 'var(--color-muted)', marginTop: 2 }}>{a.desc}</div>
            </button>
          ))}
        </div>

        {/* Ha "megjegyzés" — program választó */}
        {action === 'note' && occs.length > 0 && (
          <select style={inp} value={occId ?? ''} onChange={e => setOccId(e.target.value)}>
            {occs.map(o => (
              <option key={o.id} value={o.id}>{o.starts_at.slice(0,5)} {o.title}</option>
            ))}
          </select>
        )}
        {action === 'note' && occs.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--color-muted)', textAlign: 'center' }}>Nincs mai program ennek a személynek.</div>
        )}

        {/* Megjegyzés */}
        <input style={inp}
          placeholder={action === 'cancel_today' ? 'Ok / megjegyzés (opcionális)…' : 'Megjegyzés…'}
          value={note} onChange={e => setNote(e.target.value)} />

        {error && <div style={{ fontSize: 12, color: 'var(--color-red)' }}>{error}</div>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '11px', borderRadius: 10, fontSize: 14, fontWeight: 600, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-muted)', cursor: 'pointer' }}>Mégsem</button>
          <button onClick={handleSave} disabled={saving} style={{ flex: 2, padding: '11px', borderRadius: 10, fontSize: 14, fontWeight: 700, background: 'var(--color-blue)', color: '#fff', border: 'none', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Mentés…' : '✓ Rögzít'}
          </button>
        </div>
      </div>
    </div>
  )
}
