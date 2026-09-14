import { useEffect, useState } from 'react'
import type { Location, Occurrence, ScheduleTemplate } from '../types'
import {
  cancelOccurrence,
  closeTemplateAndCreateNew,
  fetchOccurrenceLegs,
  resetOccurrenceToTemplate,
  restoreCancelledOccurrence,
  undoCloseTemplate,
  updateOccurrence,
} from '../lib/occurrences'
import { copy } from '../copy'
import { formatShortDate, weekdayLong, weekdayOn } from '../lib/format'
import { useToast } from './Toast'
import { Sheet } from './Sheet'
import { Icon, type IconName } from './Icon'
import { supabase } from '../lib/supabase'

type View = 'menu' | 'time' | 'place' | 'note' | 'cancel' | 'reset'
type Scope = 'this' | 'future'

interface Props {
  occ: Occurrence
  template?: ScheduleTemplate | null
  locations: Location[]
  personName?: string
  onClose: () => void
  onDone: () => void
}

export function ProgramSheet({ occ, template, locations, personName, onClose, onDone }: Props) {
  const { show } = useToast()
  const [view, setView] = useState<View>('menu')
  const [tpl, setTpl] = useState<ScheduleTemplate | null>(template ?? null)
  const [legCount, setLegCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<Scope>('this')
  const [startsAt, setStartsAt] = useState(occ.starts_at.slice(0, 5))
  const [endsAt, setEndsAt] = useState(occ.ends_at.slice(0, 5))
  const [locationId, setLocationId] = useState(occ.location_id)
  const [customLoc, setCustomLoc] = useState(occ.custom_location_text ?? '')
  const [note, setNote] = useState(occ.note ?? '')

  const repeating = !!(occ.template_id && tpl)
  const dateLabel = formatShortDate(occ.on_date)
  const whoTitle = personName ? `${personName} · ${occ.title}` : occ.title
  const timeRange = `${occ.starts_at.slice(0, 5)}–${occ.ends_at.slice(0, 5)}`

  useEffect(() => {
    fetchOccurrenceLegs(occ.id).then(legs => setLegCount(legs.length)).catch(() => {})
    if (template) { setTpl(template); return }
    if (!occ.template_id) return
    supabase.from('schedule_template').select('*').eq('id', occ.template_id).maybeSingle()
      .then(({ data }) => { if (data) setTpl(data as ScheduleTemplate) })
  }, [occ.id, occ.template_id, template])

  function goMenu() {
    setView('menu')
    setError(null)
    setScope('this')
  }

  async function saveTime() {
    setSaving(true); setError(null)
    const prevStart = occ.starts_at
    const prevEnd = occ.ends_at
    try {
      let newTplId: string | null = null
      if (scope === 'future' && tpl) {
        newTplId = await closeTemplateAndCreateNew(occ.template_id!, occ.on_date, {
          starts_at: startsAt + ':00',
          ends_at: endsAt + ':00',
        })
        await updateOccurrence(occ.id, { starts_at: startsAt, ends_at: endsAt })
      } else {
        await updateOccurrence(occ.id, { starts_at: startsAt, ends_at: endsAt })
      }
      show({
        text: copy.toast.startsAt(occ.title, startsAt),
        undo: async () => {
          if (newTplId && occ.template_id) await undoCloseTemplate(occ.template_id, newTplId)
          await updateOccurrence(occ.id, { starts_at: prevStart.slice(0, 5), ends_at: prevEnd.slice(0, 5) })
          onDone()
        },
      })
      onDone()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : copy.common.errorOccurred)
      setSaving(false)
    }
  }

  async function savePlace() {
    setSaving(true); setError(null)
    const prevLoc = occ.location_id
    const prevCustom = occ.custom_location_text
    const placeName = customLoc.trim()
      || locations.find(l => l.id === locationId)?.name
      || copy.form.notSet
    try {
      let newTplId: string | null = null
      if (scope === 'future' && tpl) {
        newTplId = await closeTemplateAndCreateNew(occ.template_id!, occ.on_date, {
          location_id: locationId,
        })
      }
      await updateOccurrence(occ.id, {
        location_id: locationId,
        custom_location_text: customLoc.trim() || null,
      })
      show({
        text: copy.toast.placeChanged(occ.title, placeName),
        undo: async () => {
          if (newTplId && occ.template_id) await undoCloseTemplate(occ.template_id, newTplId)
          await updateOccurrence(occ.id, {
            location_id: prevLoc,
            custom_location_text: prevCustom,
          })
          onDone()
        },
      })
      onDone()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : copy.common.errorOccurred)
      setSaving(false)
    }
  }

  async function saveNote() {
    setSaving(true); setError(null)
    const prev = occ.note
    try {
      await updateOccurrence(occ.id, { note })
      show({
        text: copy.toast.noteSaved,
        undo: async () => {
          await updateOccurrence(occ.id, { note: prev ?? '' })
          onDone()
        },
      })
      onDone()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : copy.common.errorOccurred)
      setSaving(false)
    }
  }

  async function saveCancel() {
    setSaving(true); setError(null)
    try {
      const legs = await fetchOccurrenceLegs(occ.id)
      let newTplId: string | null = null
      if (scope === 'future' && tpl && occ.template_id) {
        newTplId = await closeTemplateAndCreateNew(occ.template_id, occ.on_date, {})
      }
      await cancelOccurrence(occ.id)
      show({
        text: copy.toast.cancelled(weekdayLong(occ.on_date).toLowerCase(), occ.title.toLowerCase()),
        undo: async () => {
          if (newTplId && occ.template_id) await undoCloseTemplate(occ.template_id, newTplId)
          await restoreCancelledOccurrence(occ.id, legs)
          onDone()
        },
      })
      onDone()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : copy.common.errorOccurred)
      setSaving(false)
    }
  }

  async function saveReset() {
    if (!tpl) return
    setSaving(true); setError(null)
    const prev = {
      starts_at: occ.starts_at,
      ends_at: occ.ends_at,
      location_id: occ.location_id,
      note: occ.note,
      custom_location_text: occ.custom_location_text,
    }
    try {
      await resetOccurrenceToTemplate(occ.id, tpl)
      show({
        text: copy.toast.reset(occ.title),
        undo: async () => {
          await updateOccurrence(occ.id, {
            starts_at: prev.starts_at.slice(0, 5),
            ends_at: prev.ends_at.slice(0, 5),
            location_id: prev.location_id,
            note: prev.note ?? undefined,
            custom_location_text: prev.custom_location_text,
          })
          onDone()
        },
      })
      onDone()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : copy.common.errorOccurred)
      setSaving(false)
    }
  }

  const scopeBlock = repeating && (
    <div className="sheet-field" style={{ marginTop: 20, marginBottom: 0 }}>
      <div className="sheet-label" style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 11 }}>
        {copy.sheet.validFrom}
      </div>
      <button
        type="button"
        className={`sheet-choice${scope === 'this' ? ' is-on' : ''}`}
        onClick={() => setScope('this')}
      >
        <span className="sheet-radio">{scope === 'this' && <span className="sheet-radio-dot" />}</span>
        <span>
          <div className="sheet-choice-title">{copy.sheet.thisDay}</div>
          <div className="sheet-choice-sub">{dateLabel}</div>
        </span>
      </button>
      <button
        type="button"
        className={`sheet-choice${scope === 'future' ? ' is-on' : ''}`}
        onClick={() => setScope('future')}
      >
        <span className="sheet-radio">{scope === 'future' && <span className="sheet-radio-dot" />}</span>
        <span>
          <div className="sheet-choice-title">{copy.sheet.everyWeekday(weekdayOn(occ.on_date))}</div>
          <div className="sheet-choice-sub">{copy.sheet.everyWeekdaySub}</div>
        </span>
      </button>
    </div>
  )

  if (view === 'menu') {
    const rows: Array<{
      id: View
      icon: IconName
      title: string
      sub?: string
      danger?: boolean
      hide?: boolean
    }> = [
      { id: 'time', icon: 'clock', title: copy.sheet.editTime },
      { id: 'place', icon: 'map-pin', title: copy.sheet.editPlace },
      { id: 'note', icon: 'note', title: copy.sheet.writeNote },
      { id: 'cancel', icon: 'prohibit', title: copy.sheet.cancel, sub: copy.sheet.cancelSub(legCount), danger: true },
      {
        id: 'reset',
        icon: 'arrow-counter-clockwise',
        title: copy.sheet.reset,
        sub: copy.sheet.resetSub,
        hide: !(occ.is_override && tpl),
      },
    ]
    return (
      <Sheet title={whoTitle} subtitle={`${dateLabel} · ${timeRange}`} onClose={onClose}>
        {rows.filter(r => !r.hide).map((r, i) => (
          <div key={r.id}>
            {r.danger && i > 0 && <div className="sheet-divider" />}
            <button
              type="button"
              className={`sheet-row${r.danger ? ' is-danger' : ''}`}
              onClick={() => setView(r.id)}
            >
              <span className="sheet-row-icon"><Icon name={r.icon} size={21} /></span>
              <span className="sheet-row-body">
                <div className="sheet-row-title">{r.title}</div>
                {r.sub && <div className="sheet-row-sub">{r.sub}</div>}
              </span>
              <span className="sheet-row-caret"><Icon name="caret-right" size={16} /></span>
            </button>
          </div>
        ))}
      </Sheet>
    )
  }

  if (view === 'time') {
    return (
      <Sheet
        title={copy.sheet.timeTitle}
        subtitle={`${occ.title} · ${dateLabel}`}
        onClose={onClose}
        onBack={goMenu}
        padded
        secondary={{ label: copy.common.cancel, onClick: goMenu }}
        primary={{ label: saving ? copy.common.saving : copy.sheet.modify, onClick: saveTime, disabled: saving }}
      >
        <div className="sheet-times">
          <label>
            <div className="sheet-label">{copy.form.start}</div>
            <input className="sheet-input tabular" type="time" value={startsAt} onChange={e => setStartsAt(e.target.value)} />
          </label>
          <label>
            <div className="sheet-label">{copy.form.end}</div>
            <input className="sheet-input tabular" type="time" value={endsAt} onChange={e => setEndsAt(e.target.value)} />
          </label>
        </div>
        {scopeBlock}
        {error && <div className="sheet-error">{error}</div>}
      </Sheet>
    )
  }

  if (view === 'place') {
    return (
      <Sheet
        title={copy.sheet.placeTitle}
        subtitle={`${occ.title} · ${dateLabel}`}
        onClose={onClose}
        onBack={goMenu}
        padded
        secondary={{ label: copy.common.cancel, onClick: goMenu }}
        primary={{ label: saving ? copy.common.saving : copy.sheet.modify, onClick: savePlace, disabled: saving }}
      >
        <div className="sheet-field">
          <div className="sheet-label">{copy.form.location}</div>
          <select className="sheet-select" value={locationId} onChange={e => setLocationId(e.target.value)}>
            {locations.map(loc => (
              <option key={loc.id} value={loc.id}>{loc.name}</option>
            ))}
          </select>
        </div>
        <div className="sheet-field">
          <div className="sheet-label">{copy.form.customAddress}</div>
          <input
            className="sheet-input"
            value={customLoc}
            onChange={e => setCustomLoc(e.target.value)}
            placeholder={copy.override.locationPlaceholder}
          />
        </div>
        {scopeBlock}
        {error && <div className="sheet-error">{error}</div>}
      </Sheet>
    )
  }

  if (view === 'note') {
    return (
      <Sheet
        title={copy.sheet.noteTitle}
        subtitle={`${occ.title} · ${dateLabel}`}
        onClose={onClose}
        onBack={goMenu}
        padded
        secondary={{ label: copy.common.cancel, onClick: goMenu }}
        primary={{ label: saving ? copy.common.saving : copy.sheet.modify, onClick: saveNote, disabled: saving }}
      >
        <textarea
          className="sheet-textarea"
          rows={3}
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder={copy.override.notePlaceholder}
        />
        {error && <div className="sheet-error">{error}</div>}
      </Sheet>
    )
  }

  if (view === 'cancel') {
    return (
      <Sheet
        title={copy.sheet.cancelTitle}
        subtitle={`${occ.title} · ${dateLabel}`}
        onClose={onClose}
        onBack={goMenu}
        padded
        secondary={{ label: copy.common.cancel, onClick: goMenu }}
        primary={{
          label: saving ? copy.common.saving : copy.sheet.cancelPrimary,
          onClick: saveCancel,
          disabled: saving,
          danger: true,
        }}
      >
        <div className="sheet-preview">
          <div className="sheet-preview-head">
            <Icon name="warning" size={16} weight="fill" />
            {copy.sheet.previewTitle}
          </div>
          <div className="sheet-preview-body">{copy.sheet.cancelSub(legCount)}</div>
        </div>
        {scopeBlock}
        {error && <div className="sheet-error">{error}</div>}
      </Sheet>
    )
  }

  return (
    <Sheet
      title={copy.sheet.resetTitle}
      subtitle={`${occ.title} · ${dateLabel}`}
      onClose={onClose}
      onBack={goMenu}
      padded
      secondary={{ label: copy.common.cancel, onClick: goMenu }}
      primary={{ label: saving ? copy.common.saving : copy.sheet.resetPrimary, onClick: saveReset, disabled: saving }}
    >
      <div className="sheet-preview-body" style={{ color: 'var(--color-text-2)' }}>{copy.sheet.resetSub}</div>
      {error && <div className="sheet-error">{error}</div>}
    </Sheet>
  )
}
