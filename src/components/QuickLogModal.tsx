/**
 * QuickLogModal — Gyors naplézás (2 koppintás)
 * Megmutatja a napi programokat; lemondhatók egyenként vagy mind,
 * vagy megjegyzés fűzhető egy adott alkalmhoz.
 */
import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { hu } from 'date-fns/locale'
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

type QuickAction = 'cancel' | 'note'

export function QuickLogModal({ householdId, persons, onClose, onDone }: Props) {
  const { person: me } = useAuth()
  const today = format(new Date(), 'yyyy-MM-dd')
  const todayLabel = format(new Date(), 'EEEE, MMM d.', { locale: hu })

  const targets = persons.filter(p => p.role === 'child' || p.role === 'parent')
  const [personId, setPersonId] = useState(targets.find(p => p.role === 'child')?.id ?? targets[0]?.id ?? '')
  const [action,   setAction]   = useState<QuickAction>('cancel')
  const [occs,     setOccs]     = useState<Occurrence[]>([])
  const [loading,  setLoading]  = useState(false)
  // cancel mode: set of selected occurrence ids (all preselected)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // note mode: single selected occ
  const [noteOccId, setNoteOccId] = useState<string | null>(null)
  const [note,     setNote]     = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  useEffect(() => {
    if (!personId) return
    setLoading(true)
    supabase.from('occurrence').select('*')
      .eq('household_id', householdId)
      .eq('person_id', personId)
      .eq('on_date', today)
      .neq('status', 'cancelled')
      .order('starts_at')
      .then(({ data }) => {
        const list = (data ?? []) as Occurrence[]
        setOccs(list)
        setSelected(new Set(list.map(o => o.id)))
        setNoteOccId(list[0]?.id ?? null)
        setLoading(false)
      })
  }, [personId, householdId])

  function toggleSelect(id: string) {
    setSelected(s => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleSave() {
    setSaving(true); setError(null)
    try {
      if (action === 'cancel') {
        const ids = [...selected]
        if (!ids.length) { setError('Jelölj ki legalább egy programot.'); setSaving(false); return }
        const { error: err } = await supabase.from('occurrence').update({
          status: 'cancelled', is_override: true,
          updated_at: new Date().toISOString(),
          updated_by: me?.id ?? null,
          note: note.trim() || null,
        }).in('id', ids)
        if (err) throw err
      } else {
        if (!noteOccId) { setError('Válassz ki egy programot.'); setSaving(false); return }
        if (!note.trim()) { setError('Írj be egy megjegyzést.'); setSaving(false); return }
        const { error: err } = await supabase.from('occurrence').update({
          note: note.trim(), is_override: true,
          updated_at: new Date().toISOString(),
          updated_by: me?.id ?? null,
        }).eq('id', noteOccId)
        if (err) throw err
      }
      onDone()
    } catch (e) {
      setError(String(e))
      setSaving(false)
    }
  }

  const activePerson = targets.find(p => p.id === personId)

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'flex-end', zIndex: 200,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        width: '100%', background: 'var(--color-surface)',
        borderRadius: '20px 20px 0 0',
        maxHeight: '85dvh', overflowY: 'auto',
        padding: '20px 20px calc(20px + env(safe-area-inset-bottom))',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>⚡ Gyors rögzítés</h3>
            <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>{todayLabel}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20,
            cursor: 'pointer', color: 'var(--color-muted)', lineHeight: 1 }}>✕</button>
        </div>

        {/* Személy választó */}
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

        {/* Akció választó */}
        <div style={{ display: 'flex', gap: 8 }}>
          {([
            { value: 'cancel', label: '🚫 Elmarad', desc: 'Program(ok) lemondása' },
            { value: 'note',   label: '📝 Megjegyzés', desc: 'Rögzítés részletek nélkül' },
          ] as const).map(a => (
            <button key={a.value} onClick={() => setAction(a.value)} style={{
              flex: 1, padding: '10px 8px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
              background: action === a.value ? 'rgba(79,156,249,0.1)' : 'var(--color-surface-2)',
              border: `1.5px solid ${action === a.value ? 'var(--color-blue)' : 'var(--color-border)'}`,
            }}>
              <div style={{ fontSize: 13, fontWeight: 700,
                color: action === a.value ? 'var(--color-blue)' : 'var(--color-text)' }}>{a.label}</div>
              <div style={{ fontSize: 10, color: 'var(--color-muted)', marginTop: 2 }}>{a.desc}</div>
            </button>
          ))}
        </div>

        {/* Mai programok listája */}
        {loading && (
          <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--color-muted)', padding: '12px 0' }}>
            Betöltés…
          </div>
        )}

        {!loading && occs.length === 0 && (
          <div style={{
            textAlign: 'center', fontSize: 13, color: 'var(--color-muted)',
            padding: '16px 0', background: 'var(--color-surface-2)',
            borderRadius: 10, border: '1px solid var(--color-border)',
          }}>
            Nincs aktív program ma{activePerson ? ` — ${activePerson.display_name}` : ''}.
          </div>
        )}

        {!loading && occs.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Cancel all / none quick-select */}
            {action === 'cancel' && occs.length > 1 && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
                <button onClick={() => setSelected(new Set(occs.map(o => o.id)))}
                  style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, cursor: 'pointer',
                    background: 'transparent', border: '1px solid var(--color-border)',
                    color: 'var(--color-muted)' }}>Mind</button>
                <button onClick={() => setSelected(new Set())}
                  style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, cursor: 'pointer',
                    background: 'transparent', border: '1px solid var(--color-border)',
                    color: 'var(--color-muted)' }}>Egyik sem</button>
              </div>
            )}

            {occs.map(occ => {
              const isCancelSelected = action === 'cancel' && selected.has(occ.id)
              const isNoteSelected   = action === 'note'   && noteOccId === occ.id
              const isActive = isCancelSelected || isNoteSelected

              return (
                <button key={occ.id}
                  onClick={() => {
                    if (action === 'cancel') toggleSelect(occ.id)
                    else setNoteOccId(occ.id)
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '11px 14px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                    background: isActive
                      ? (action === 'cancel' ? 'rgba(239,68,68,0.08)' : 'rgba(79,156,249,0.08)')
                      : 'var(--color-surface-2)',
                    border: `1.5px solid ${
                      isActive
                        ? (action === 'cancel' ? 'rgba(239,68,68,0.4)' : 'var(--color-blue)')
                        : 'var(--color-border)'}`,
                    borderLeft: `4px solid ${activePerson?.color ?? 'var(--color-border)'}`,
                    transition: 'border-color 0.15s',
                  }}>
                  {/* Checkbox / radio indicator */}
                  <span style={{
                    width: 20, height: 20, borderRadius: action === 'cancel' ? 5 : '50%',
                    border: `2px solid ${isActive
                      ? (action === 'cancel' ? '#f87171' : 'var(--color-blue)')
                      : 'var(--color-border)'}`,
                    background: isActive
                      ? (action === 'cancel' ? '#f87171' : 'var(--color-blue)')
                      : 'transparent',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, fontSize: 12, color: '#fff', fontWeight: 700,
                  }}>
                    {isActive ? (action === 'cancel' ? '✕' : '●') : ''}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 14, fontWeight: 600,
                      textDecoration: isCancelSelected ? 'line-through' : 'none',
                      color: isCancelSelected ? 'var(--color-muted)' : 'var(--color-text)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{occ.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2,
                      fontVariantNumeric: 'tabular-nums' }}>
                      {occ.starts_at.slice(0, 5)}–{occ.ends_at.slice(0, 5)}
                      {occ.note && <span style={{ marginLeft: 6, fontStyle: 'italic' }}>· {occ.note}</span>}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Megjegyzés mező */}
        <input style={inp}
          placeholder={action === 'cancel' ? 'Ok / megjegyzés (opcionális)…' : 'Megjegyzés *…'}
          value={note} onChange={e => setNote(e.target.value)} />

        {error && <div style={{ fontSize: 12, color: 'var(--color-red)' }}>{error}</div>}

        {/* Gombok */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: 11, borderRadius: 10, fontSize: 14, fontWeight: 600,
            background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
            color: 'var(--color-muted)', cursor: 'pointer',
          }}>Mégsem</button>
          <button onClick={handleSave} disabled={saving || occs.length === 0} style={{
            flex: 2, padding: 11, borderRadius: 10, fontSize: 14, fontWeight: 700,
            background: action === 'cancel' ? '#ef4444' : 'var(--color-blue)',
            color: '#fff', border: 'none', cursor: 'pointer',
            opacity: (saving || occs.length === 0) ? 0.5 : 1,
          }}>
            {saving
              ? 'Mentés…'
              : action === 'cancel'
                ? `🚫 ${selected.size > 1 ? `${selected.size} program` : 'Program'} lemondva`
                : '📝 Megjegyzés rögzítve'}
          </button>
        </div>
      </div>
    </div>
  )
}
