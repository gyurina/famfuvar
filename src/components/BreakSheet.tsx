import { useEffect, useState } from 'react'
import { addDays, endOfWeek } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useToast } from './Toast'
import { Sheet } from './Sheet'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { copy } from '../copy'
import { formatShortDate, formatShortMonthDay, joinNames, toIsoDate } from '../lib/format'
import type { BreakPeriod, BreakReason, Person } from '../types'

interface Props {
  persons: Person[]
  householdId: string
  householdNames?: string[]
  quickIllness?: { personId: string }
  onClose: () => void
  onDone: () => void
}

type Span = 'today' | 'three' | 'weekend' | 'custom'

const REASONS: { value: BreakReason; label: string; icon: 'thermometer' | 'island' | 'dots-three-circle' }[] = [
  { value: 'illness', label: copy.sheet.reasonIllness, icon: 'thermometer' },
  { value: 'vacation', label: copy.sheet.reasonVacation, icon: 'island' },
  { value: 'other', label: copy.sheet.reasonOther, icon: 'dots-three-circle' },
]

export function BreakSheet({ persons, householdId, householdNames = [], quickIllness, onClose, onDone }: Props) {
  const { person: me } = useAuth()
  const { show } = useToast()
  const today = toIsoDate(new Date())
  const weekEnd = toIsoDate(endOfWeek(new Date(), { weekStartsOn: 1 }))

  const [personId, setPersonId] = useState(quickIllness?.personId ?? persons[0]?.id ?? '')
  const [reason, setReason] = useState<BreakReason>(quickIllness ? 'illness' : 'vacation')
  const [span, setSpan] = useState<Span>(quickIllness ? 'three' : 'today')
  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(quickIllness ? toIsoDate(addDays(new Date(), 2)) : today)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState({ programs: 0, rides: 0, names: [] as string[] })

  function applySpan(next: Span) {
    setSpan(next)
    if (next === 'today') {
      setDateFrom(today); setDateTo(today)
    } else if (next === 'three') {
      setDateFrom(today); setDateTo(toIsoDate(addDays(new Date(), 2)))
    } else if (next === 'weekend') {
      setDateFrom(today); setDateTo(weekEnd)
    }
  }

  useEffect(() => {
    if (!personId || !dateFrom || !dateTo) return
    let cancelled = false
    supabase.from('occurrence')
      .select('id')
      .eq('household_id', householdId)
      .eq('person_id', personId)
      .eq('status', 'planned')
      .gte('on_date', dateFrom)
      .lte('on_date', dateTo)
      .then(async ({ data: occs }) => {
        if (cancelled) return
        const ids = (occs ?? []).map(o => o.id)
        if (ids.length === 0) {
          setPreview({ programs: 0, rides: 0, names: [] })
          return
        }
        const { data: legs } = await supabase
          .from('transport_leg')
          .select('id, driver_id')
          .in('occurrence_id', ids)
        if (cancelled) return
        const driverIds = [...new Set((legs ?? []).map(l => l.driver_id).filter((id): id is string => !!id))]
        const names = driverIds
          .map(id => persons.find(p => p.id === id)?.display_name)
          .filter((n): n is string => !!n)
        setPreview({ programs: ids.length, rides: (legs ?? []).length, names })
      })
    return () => { cancelled = true }
  }, [personId, dateFrom, dateTo, householdId, persons])

  async function handleSave() {
    if (!personId) return
    setSaving(true); setError(null)
    try {
      const { data, error: err } = await supabase
        .from('break_period')
        .insert({
          household_id: householdId,
          person_id: personId,
          date_from: dateFrom,
          date_to: dateTo,
          reason,
          note: null,
          created_by: me?.id ?? null,
        })
        .select('*').single()
      if (err || !data) { setError(err?.message ?? copy.common.error); setSaving(false); return }
      const bp = data as BreakPeriod
      const { data: cnt } = await supabase.rpc('apply_break_period', { p_break_id: bp.id })
      const n = (cnt as number | null) ?? preview.programs
      const who = persons.find(p => p.id === personId)
      const until = formatShortMonthDay(dateTo)
      const toastFn = reason === 'illness' ? copy.toast.breakIllness
        : reason === 'vacation' ? copy.toast.breakVacation
        : copy.toast.breakOther
      show({
        text: toastFn(who?.display_name ?? '', until, n),
        undo: async () => {
          await supabase.rpc('revert_break_period', {
            p_household_id: bp.household_id,
            p_person_id: bp.person_id,
            p_date_from: bp.date_from,
            p_date_to: bp.date_to,
          })
          await supabase.from('break_period').delete().eq('id', bp.id)
          await supabase.rpc('generate_horizon', {
            p_household_id: householdId,
            p_days_ahead: 30,
          })
          onDone()
        },
      })
      onDone()
    } finally {
      setSaving(false)
    }
  }

  const previewText = preview.programs === 0
    ? copy.sheet.previewNone
    : copy.sheet.preview(preview.programs, preview.rides, joinNames(preview.names))

  return (
    <Sheet
      title={copy.sheet.breakTitle}
      subtitle={copy.sheet.breakSub}
      onClose={onClose}
      padded
      secondary={{ label: copy.common.cancel, onClick: onClose }}
      primary={{ label: saving ? copy.common.saving : copy.sheet.saveBreak, onClick: handleSave, disabled: saving || !personId }}
    >
      <div className="sheet-field">
        <div className="sheet-label">{copy.sheet.who}</div>
        <div className="sheet-chips">
          {persons.map(p => (
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

      <div className="sheet-field">
        <div className="sheet-label">{copy.sheet.why}</div>
        <div className="sheet-reasons">
          {REASONS.map(r => (
            <button
              key={r.value}
              type="button"
              className={`sheet-reason${reason === r.value ? ' is-on' : ''}`}
              onClick={() => setReason(r.value)}
            >
              <Icon name={r.icon} size={20} weight={reason === r.value ? 'fill' : 'regular'} />
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="sheet-field" style={{ marginBottom: 0 }}>
        <div className="sheet-label">{copy.sheet.howLong}</div>
        <div className="sheet-pills">
          {([
            ['today', copy.sheet.todayOnly],
            ['three', copy.sheet.threeDays],
            ['weekend', copy.sheet.weekEnd],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`sheet-pill${span === id ? ' is-on' : ''}`}
              onClick={() => applySpan(id)}
            >{label}</button>
          ))}
        </div>
        <div className="sheet-dates">
          <label>
            <div className="sheet-label">{copy.sheet.from}</div>
            <input
              className="sheet-input"
              type="date"
              value={dateFrom}
              aria-label={`${copy.sheet.from}: ${formatShortDate(dateFrom)}`}
              onChange={e => {
                setSpan('custom')
                setDateFrom(e.target.value)
                if (e.target.value > dateTo) setDateTo(e.target.value)
              }}
            />
          </label>
          <label>
            <div className="sheet-label">{copy.sheet.until}</div>
            <input
              className="sheet-input"
              type="date"
              value={dateTo}
              min={dateFrom}
              aria-label={`${copy.sheet.until}: ${formatShortDate(dateTo)}`}
              onChange={e => { setSpan('custom'); setDateTo(e.target.value) }}
            />
          </label>
        </div>
      </div>

      <div className="sheet-preview">
        <div className="sheet-preview-head">
          <Icon name="warning" size={16} weight="fill" />
          {copy.sheet.previewTitle}
        </div>
        <div className="sheet-preview-body">{previewText}</div>
      </div>
      {error && <div className="sheet-error">{error}</div>}
    </Sheet>
  )
}
