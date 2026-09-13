/**
 * OccurrenceOverrideModal
 *
 * Megnyílik egy programkártya további-műveletek gombjára kattintva.
 * Két dimenzió:
 *   scope:  'this'   = csak ez az alkalom
 *           'future' = ezt és minden jövőbeli alkalmat (órarend csere)
 *   action: 'cancel' = lemondás
 *           'edit'   = időpont / megjegyzés módosítás
 */
import { useState } from 'react'
import type { Occurrence, Location, ScheduleTemplate } from '../types'
import {
  cancelOccurrence,
  updateOccurrence,
  closeTemplateAndCreateNew,
  resetOccurrenceToTemplate,
} from '../lib/occurrences'
import { copy } from '../copy'
import { formatShortDate } from '../lib/format'
import { Icon } from './Icon'

type Scope  = 'this' | 'future'
type Action = 'cancel' | 'edit'

interface Props {
  occ:       Occurrence
  template:  ScheduleTemplate | null
  locations: Location[]
  isAdmin:   boolean
  onClose:   () => void
  onDone:    () => void
}

export function OccurrenceOverrideModal({ occ, template, locations, isAdmin, onClose, onDone }: Props) {
  const [scope,  setScope]  = useState<Scope>('this')
  const [action, setAction] = useState<Action | null>(null)
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  const [startsAt,    setStartsAt]    = useState(occ.starts_at.slice(0, 5))
  const [endsAt,      setEndsAt]      = useState(occ.ends_at.slice(0, 5))
  const [locationId,  setLocationId]  = useState(occ.location_id)
  const [note,        setNote]        = useState(occ.note ?? '')
  const [customLoc,   setCustomLoc]   = useState(occ.custom_location_text ?? '')

  const hasTemplate = !!occ.template_id && !!template
  const dateLabel = formatShortDate(occ.on_date)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      if (action === 'cancel') {
        if (scope === 'this') {
          await cancelOccurrence(occ.id)
        } else {
          if (template) {
            await closeTemplateAndCreateNew(occ.template_id!, occ.on_date, {
            })
          }
          await cancelOccurrence(occ.id)
        }
      } else {
        const patch = {
          starts_at:   startsAt   !== occ.starts_at.slice(0, 5) ? startsAt   : undefined,
          ends_at:     endsAt     !== occ.ends_at.slice(0, 5)   ? endsAt     : undefined,
          location_id: locationId !== occ.location_id           ? locationId : undefined,
          note:        note !== (occ.note ?? '')                 ? note       : undefined,
          custom_location_text: customLoc !== (occ.custom_location_text ?? '') ? customLoc : undefined,
        }
        const hasChanges = Object.values(patch).some(v => v !== undefined)
        if (scope === 'this') {
          if (hasChanges) {
            await updateOccurrence(occ.id, patch)
          }
        } else {
          if (template) {
            await closeTemplateAndCreateNew(occ.template_id!, occ.on_date, {
              starts_at:   startsAt,
              ends_at:     endsAt,
              location_id: locationId,
            })
          }
        }
      }
      onDone()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : copy.common.errorOccurred)
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'var(--color-surface)',
        borderRadius: 'var(--r-lg) var(--r-lg) 0 0',
        padding: '20px 20px 36px',
        boxShadow: '0 -4px 32px rgba(0,0,0,0.25)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{occ.title}</div>
            <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
              {dateLabel} · {occ.starts_at.slice(0, 5)}–{occ.ends_at.slice(0, 5)}
            </div>
          </div>
          <button onClick={onClose} aria-label={copy.a11y.close} style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)',
            width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
          }}>
            <Icon name="x" size={20} />
          </button>
        </div>

        {hasTemplate && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['this', 'future'] as Scope[]).map(s => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  style={{
                    flex: 1, padding: '9px 0', borderRadius: 'var(--r-sm)',
                    minHeight: 44,
                    border: `2px solid ${scope === s ? 'var(--color-blue)' : 'var(--color-border)'}`,
                    background: scope === s ? 'rgba(59,130,246,0.08)' : 'var(--color-surface-2)',
                    color: scope === s ? 'var(--color-blue)' : 'var(--color-text)',
                    fontWeight: scope === s ? 700 : 400, fontSize: 13, cursor: 'pointer',
                  }}
                >
                  {s === 'this' ? copy.override.thisOnly : copy.override.fromNow}
                </button>
              ))}
            </div>
            {scope === 'future' && (
              <div style={{ fontSize: 11, color: 'var(--color-yellow)', marginTop: 6, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <Icon name="warning" size={14} weight="fill" />
                {copy.override.templateWarn}
              </div>
            )}
          </div>
        )}

        {action === null && isAdmin && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => setAction('edit')}
              style={{
                flex: 1, padding: '14px 0', borderRadius: 'var(--r-md)',
                background: 'var(--color-blue)', color: '#fff',
                border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer',
                minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <Icon name="pencil" size={16} />
              {copy.common.edit}
            </button>
            <button
              onClick={() => setAction('cancel')}
              style={{
                flex: 1, padding: '14px 0', borderRadius: 'var(--r-md)',
                background: 'rgba(242,107,107,0.12)',
                color: 'var(--color-red)',
                border: '1.5px solid rgba(242,107,107,0.3)',
                fontWeight: 700, fontSize: 14, cursor: 'pointer',
                minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <Icon name="calendar-x" size={16} />
              {copy.override.cancelAction}
            </button>
          </div>
        )}

        {action === 'cancel' && (
          <div>
            <div style={{
              background: 'rgba(242,107,107,0.08)', border: '1px solid rgba(242,107,107,0.25)',
              borderRadius: 'var(--r-sm)', padding: '12px 14px', marginBottom: 16,
              fontSize: 13, color: 'var(--color-text)',
            }}>
              {scope === 'this'
                ? copy.override.confirmThis(dateLabel)
                : copy.override.confirmFuture(dateLabel)}
            </div>
            {error && <div style={{ color: 'var(--color-red)', fontSize: 12, marginBottom: 10 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setAction(null)}
                style={{ flex: 1, padding: '12px 0', borderRadius: 'var(--r-md)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', fontSize: 14, cursor: 'pointer', color: 'var(--color-text)', minHeight: 44 }}
              >{copy.common.back}</button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{ flex: 1, padding: '12px 0', borderRadius: 'var(--r-md)', background: 'var(--color-red)', color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: saving ? 0.6 : 1, minHeight: 44 }}
              >{saving ? copy.common.saving : copy.override.cancelAction}</button>
            </div>
          </div>
        )}

        {action === 'edit' && (
          <div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <label style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 5 }}>{copy.form.start}</div>
                <input
                  type="time" value={startsAt}
                  onChange={e => setStartsAt(e.target.value)}
                  style={{ width: '100%', padding: '9px 10px', borderRadius: 'var(--r-sm)', border: '1.5px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 15 }}
                />
              </label>
              <label style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 5 }}>{copy.form.end}</div>
                <input
                  type="time" value={endsAt}
                  onChange={e => setEndsAt(e.target.value)}
                  style={{ width: '100%', padding: '9px 10px', borderRadius: 'var(--r-sm)', border: '1.5px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 15 }}
                />
              </label>
            </div>

            <label style={{ display: 'block', marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 5 }}>{copy.form.location}</div>
              <select
                value={locationId}
                onChange={e => setLocationId(e.target.value)}
                style={{ width: '100%', padding: '9px 10px', borderRadius: 'var(--r-sm)', border: '1.5px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 14 }}
              >
                {locations.map(loc => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </select>
            </label>

            <label style={{ display: 'block', marginBottom: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 5 }}>{copy.form.customAddress}</div>
              <input
                type="text"
                value={customLoc}
                onChange={e => setCustomLoc(e.target.value)}
                placeholder={copy.override.locationPlaceholder}
                style={{ width: '100%', padding: '9px 10px', borderRadius: 'var(--r-sm)', border: '1.5px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 13, boxSizing: 'border-box' }}
              />
            </label>

            <label style={{ display: 'block', marginBottom: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 5 }}>{copy.form.note}</div>
              <textarea
                value={note} rows={2}
                onChange={e => setNote(e.target.value)}
                placeholder={copy.override.notePlaceholder}
                style={{ width: '100%', padding: '9px 10px', borderRadius: 'var(--r-sm)', border: '1.5px solid var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
              />
            </label>

            {error && <div style={{ color: 'var(--color-red)', fontSize: 12, marginBottom: 10 }}>{error}</div>}

            {occ.is_override && hasTemplate && template && (
              <button
                onClick={async () => {
                  setSaving(true); setError(null)
                  try {
                    await resetOccurrenceToTemplate(occ.id, template)
                    onDone()
                  } catch (e: unknown) {
                    setError(e instanceof Error ? e.message : copy.common.errorOccurred)
                    setSaving(false)
                  }
                }}
                disabled={saving}
                style={{
                  width: '100%', marginBottom: 10, padding: '10px 0',
                  borderRadius: 'var(--r-md)', fontSize: 13, cursor: 'pointer',
                  background: 'transparent',
                  color: 'var(--color-muted)',
                  border: '1px dashed var(--color-border)',
                  opacity: saving ? 0.6 : 1, minHeight: 44,
                }}
              >{copy.override.resetSchedule}</button>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setAction(null)}
                style={{ flex: 1, padding: '12px 0', borderRadius: 'var(--r-md)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', fontSize: 14, cursor: 'pointer', color: 'var(--color-text)', minHeight: 44 }}
              >{copy.common.back}</button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{ flex: 1, padding: '12px 0', borderRadius: 'var(--r-md)', background: 'var(--color-blue)', color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: saving ? 0.6 : 1, minHeight: 44 }}
              >{saving ? copy.common.saving : copy.common.save}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
