import { useEffect, useState } from 'react'
import { Header } from '../components/Header'
import { copy } from '../copy'
import { supabase } from '../lib/supabase'
import { useHousehold } from '../hooks/useHousehold'
import { useToast } from '../components/Toast'
import {
  DEFAULT_HOUSEHOLD_SETTINGS,
  parseHouseholdSettings,
  type HouseholdSettings,
} from '../types'

export function Rendszer() {
  const { householdId } = useHousehold()
  const { show } = useToast()
  const [form, setForm] = useState<HouseholdSettings>(DEFAULT_HOUSEHOLD_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!householdId) return
    let cancelled = false
    supabase
      .from('household')
      .select('settings')
      .eq('id', householdId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setForm(parseHouseholdSettings(data?.settings))
        setLoading(false)
      }, () => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [householdId])

  async function save() {
    if (!householdId) return
    setSaving(true)
    const next = parseHouseholdSettings(form)
    const { error } = await supabase
      .from('household')
      .update({ settings: next })
      .eq('id', householdId)
    setSaving(false)
    if (error) {
      show({ text: copy.common.errorOccurred })
      return
    }
    setForm(next)
    show({ text: copy.rendszer.saved })
  }

  function toggle(key: 'notify_on_time_change' | 'notify_other_parents_on_time_change') {
    setForm(f => ({ ...f, [key]: !f[key] }))
  }

  return (
    <div>
      <Header
        title={copy.rendszer.title}
        subtitle={copy.rendszer.sub}
        backTo="/egyeb"
        chrome={false}
      />
      <div className="more-page">
        {loading ? (
          <div className="inbox-status">{copy.common.loading}</div>
        ) : (
          <>
            <label className="sys-field">
              <span className="sys-label">{copy.rendszer.horizon}</span>
              <span className="sys-hint">{copy.rendszer.horizonHint}</span>
              <input
                type="number"
                min={7}
                max={90}
                value={form.horizon_days}
                onChange={e => setForm(f => ({ ...f, horizon_days: Number(e.target.value) }))}
                className="sys-input"
              />
            </label>
            <label className="sys-field">
              <span className="sys-label">{copy.rendszer.reminder}</span>
              <span className="sys-hint">{copy.rendszer.reminderHint}</span>
              <input
                type="number"
                min={5}
                max={180}
                value={form.reminder_minutes}
                onChange={e => setForm(f => ({ ...f, reminder_minutes: Number(e.target.value) }))}
                className="sys-input"
              />
            </label>
            <button type="button" className="more-row sys-toggle" onClick={() => toggle('notify_on_time_change')}>
              <span className="more-row-text">
                <span className="more-row-title">{copy.rendszer.notifyTime}</span>
                <span className="more-row-sub">{copy.rendszer.notifyTimeHint}</span>
              </span>
              <span className={`sys-switch${form.notify_on_time_change ? ' on' : ''}`}>
                <span />
              </span>
            </button>
            <button
              type="button"
              className="more-row sys-toggle"
              onClick={() => toggle('notify_other_parents_on_time_change')}
              disabled={!form.notify_on_time_change}
            >
              <span className="more-row-text">
                <span className="more-row-title">{copy.rendszer.notifyParents}</span>
                <span className="more-row-sub">{copy.rendszer.notifyParentsHint}</span>
              </span>
              <span className={`sys-switch${form.notify_other_parents_on_time_change && form.notify_on_time_change ? ' on' : ''}`}>
                <span />
              </span>
            </button>
            <button
              type="button"
              className="sys-save"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? copy.common.saving : copy.common.save}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
