import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from './Toast'
import { Sheet } from './Sheet'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { copy } from '../copy'
import { formatShortDate, isoWeekday, toIsoDate, weekdayOn } from '../lib/format'
import { budapestIso } from '../lib/occurrences'
import type { Location, Person } from '../types'

interface Props {
  householdId: string
  date?: string
  childrenPeople: Person[]
  locations: Location[]
  home: Location | null
  householdNames?: string[]
  onClose: () => void
  onDone: () => void
}

export function NewEventSheet({
  householdId,
  date,
  childrenPeople,
  locations,
  home,
  householdNames = [],
  onClose,
  onDone,
}: Props) {
  const { show } = useToast()
  const today = toIsoDate(new Date())
  const [title, setTitle] = useState('')
  const [personId, setPersonId] = useState(childrenPeople[0]?.id ?? '')
  const [startsAt, setStartsAt] = useState('14:00')
  const [endsAt, setEndsAt] = useState('15:00')
  const [locId, setLocId] = useState(locations.find(l => !l.is_home)?.id ?? '')
  const onDate = date ?? today
  const [repeats, setRepeats] = useState(false)
  const [dropoff, setDropoff] = useState(true)
  const [pickup, setPickup] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dayOn = weekdayOn(onDate)
  const homeId = home?.id ?? null
  const loc = locId || homeId

  async function save() {
    if (!title.trim() || !personId) return
    setSaving(true); setError(null)
    try {
      let openRides = 0
      if (repeats) {
        const { error: err } = await supabase.from('schedule_template').insert({
          household_id: householdId,
          person_id: personId,
          title: title.trim(),
          weekday: isoWeekday(onDate),
          starts_at: startsAt + ':00',
          ends_at: endsAt + ':00',
          location_id: loc,
          needs_dropoff: dropoff,
          needs_pickup: pickup,
          valid_from: onDate,
          valid_to: null,
        })
        if (err) throw err
        openRides = (dropoff ? 1 : 0) + (pickup ? 1 : 0)
      } else {
        const { data: occ, error: occErr } = await supabase.from('occurrence').insert({
          household_id: householdId,
          template_id: null,
          person_id: personId,
          title: title.trim(),
          on_date: onDate,
          starts_at: startsAt + ':00',
          ends_at: endsAt + ':00',
          location_id: loc,
          status: 'planned',
        }).select().single()
        if (occErr || !occ) throw occErr ?? new Error(copy.common.errorOccurred)
        const legs: Record<string, unknown>[] = []
        if (dropoff) {
          legs.push({
            household_id: householdId,
            occurrence_id: occ.id,
            direction: 'dropoff',
            driver_id: null,
            depart_at: budapestIso(onDate, startsAt),
            arrive_at: budapestIso(onDate, startsAt),
            from_location: homeId,
            to_location: loc,
          })
        }
        if (pickup) {
          legs.push({
            household_id: householdId,
            occurrence_id: occ.id,
            direction: 'pickup',
            driver_id: null,
            depart_at: budapestIso(onDate, endsAt),
            arrive_at: budapestIso(onDate, endsAt),
            from_location: loc,
            to_location: homeId,
          })
        }
        if (legs.length) {
          const { error: legErr } = await supabase.from('transport_leg').insert(legs)
          if (legErr) throw legErr
        }
        openRides = legs.length
      }
      show({ text: copy.toast.programAdded(title.trim(), openRides) })
      onDone()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : copy.common.errorOccurred)
      setSaving(false)
    }
  }

  return (
    <Sheet
      title={copy.sheet.newTitle}
      subtitle={formatShortDate(onDate)}
      onClose={onClose}
      padded
      secondary={{ label: copy.common.cancel, onClick: onClose }}
      primary={{
        label: saving ? copy.common.saving : copy.sheet.add,
        onClick: save,
        disabled: saving || !title.trim() || !personId,
      }}
    >
      <div className="sheet-field">
        <input
          className="sheet-input"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={copy.sheet.whatPlaceholder}
          aria-label={copy.sheet.what}
        />
      </div>

      <div className="sheet-field">
        <div className="sheet-label">{copy.sheet.forWhom}</div>
        <div className="sheet-chips">
          {childrenPeople.map(p => (
            <button
              key={p.id}
              type="button"
              className={`sheet-chip${personId === p.id ? ' is-on' : ''}`}
              style={personId === p.id ? { borderColor: p.color, background: p.color + '22' } : undefined}
              onClick={() => setPersonId(p.id)}
            >
              <Avatar person={p} size={26} householdNames={householdNames} />
              {p.display_name}
            </button>
          ))}
        </div>
      </div>

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

      <div className="sheet-field">
        <div className="sheet-select" style={{ display: 'flex', alignItems: 'center', gap: 10, paddingRight: 10 }}>
          <Icon name="map-pin" size={18} color="var(--color-muted)" />
          <select
            value={locId}
            onChange={e => setLocId(e.target.value)}
            aria-label={copy.sheet.where}
            style={{
              flex: 1, height: 46, background: 'transparent', border: 'none',
              color: locId ? 'var(--color-text)' : 'var(--color-muted)', fontSize: 15, outline: 'none',
            }}
          >
            <option value="">{copy.sheet.where}</option>
            {locations.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <Icon name="caret-down" size={15} color="var(--color-muted)" />
        </div>
      </div>

      <div className="sheet-field">
        <button type="button" className="sheet-toggle-row" onClick={() => setRepeats(v => !v)}>
          <span style={{ flex: 1 }}>
            <div className="sheet-choice-title">{copy.sheet.repeats(dayOn)}</div>
            <div className="sheet-choice-sub">{copy.sheet.repeatsSub}</div>
          </span>
          <span className={`sheet-toggle${repeats ? ' is-on' : ''}`}>
            <span className="sheet-toggle-knob" />
          </span>
        </button>
      </div>

      <div className="sheet-field" style={{ marginBottom: 0 }}>
        <div className="sheet-label">{copy.sheet.needsRide}</div>
        <button
          type="button"
          className={`sheet-choice${dropoff ? ' is-on' : ''}`}
          onClick={() => setDropoff(v => !v)}
        >
          <span className="sheet-check">{dropoff && <Icon name="check" size={14} weight="bold" />}</span>
          <span className="sheet-choice-title">{copy.sheet.someoneTakes}</span>
        </button>
        <button
          type="button"
          className={`sheet-choice${pickup ? ' is-on' : ''}`}
          onClick={() => setPickup(v => !v)}
        >
          <span className="sheet-check">{pickup && <Icon name="check" size={14} weight="bold" />}</span>
          <span className="sheet-choice-title">{copy.sheet.someoneCollects}</span>
        </button>
      </div>
      {error && <div className="sheet-error">{error}</div>}
    </Sheet>
  )
}
