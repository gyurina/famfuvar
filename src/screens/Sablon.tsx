import { useState, useEffect } from 'react'
import { Header } from '../components/Header'
import { supabase } from '../lib/supabase'
import { useHousehold } from '../hooks/useHousehold'
import { useRole } from '../hooks/useRole'
import type { ScheduleTemplate, TravelGroup } from '../types'
import { copy } from '../copy'
import { formatShortDate, toIsoDate } from '../lib/format'
import { Icon } from '../components/Icon'
import { useToast } from '../components/Toast'
import { refreshHorizon, syncTemplateRides } from '../lib/horizon'

type Mode = 'single' | 'group'

interface FormData {
  mode: Mode
  person_id: string
  group_id: string
  title: string
  weekdays: number[]
  starts_at: string
  ends_at: string
  location_id: string
  needs_dropoff: boolean
  needs_pickup: boolean
  valid_from: string
  valid_to: string
}

const EMPTY: FormData = {
  mode: 'single',
  person_id: '', group_id: '', title: '', weekdays: [1],
  starts_at: '08:00', ends_at: '10:00',
  location_id: '', needs_dropoff: true, needs_pickup: true,
  valid_from: toIsoDate(new Date()), valid_to: '',
}

export function Sablon({ embedded = false }: { embedded?: boolean }) {
  const { children, locations, householdId } = useHousehold()
  const { canEditSchedule } = useRole()
  const { show } = useToast()
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([])
  const [groups, setGroups] = useState<TravelGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<ScheduleTemplate | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormData>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  useEffect(() => {
    if (!householdId) return
    Promise.all([
      supabase.from('schedule_template').select('*')
        .eq('household_id', householdId)
        .order('weekday').order('starts_at'),
      supabase.from('travel_group').select('*')
        .eq('household_id', householdId)
        .order('name'),
    ]).then(([tRes, gRes]) => {
      setTemplates(tRes.data ?? [])
      setGroups(gRes.data ?? [])
      setLoading(false)
    })
  }, [householdId])

  function openNew() {
    setEditing(null)
    setForm({ ...EMPTY, person_id: children[0]?.id ?? '' })
    setError(null); setDeleteConfirm(null)
    setShowForm(true)
  }

  function openEdit(t: ScheduleTemplate) {
    setEditing(t)
    setForm({
      mode: t.group_id ? 'group' : 'single',
      person_id: t.person_id ?? '',
      group_id: t.group_id ?? '',
      title: t.title,
      weekdays: [t.weekday],
      starts_at: t.starts_at.slice(0, 5),
      ends_at: t.ends_at.slice(0, 5),
      location_id: t.location_id,
      needs_dropoff: t.needs_dropoff,
      needs_pickup: t.needs_pickup,
      valid_from: t.valid_from,
      valid_to: t.valid_to ?? '',
    })
    setError(null); setDeleteConfirm(null)
    setShowForm(true)
  }

  async function handleSave() {
    if (!householdId) return
    if (form.mode === 'single' && !form.person_id) {
      setError(copy.schedule.pickChild); return
    }
    if (form.mode === 'group' && !form.group_id) {
      setError(copy.schedule.pickGroup); return
    }
    if (!form.location_id || !form.title) {
      setError(copy.schedule.fillRequired); return
    }
    if (form.starts_at >= form.ends_at) {
      setError(copy.schedule.timeOrder); return
    }
    if (form.weekdays.length === 0) {
      setError(copy.schedule.pickDay); return
    }
    setSaving(true); setError(null)
    const basePayload = {
      household_id: householdId,
      person_id: form.mode === 'single' ? form.person_id : null,
      group_id: form.mode === 'group' ? form.group_id : null,
      title: form.title,
      starts_at: form.starts_at + ':00',
      ends_at: form.ends_at + ':00',
      location_id: form.location_id,
      needs_dropoff: form.needs_dropoff,
      needs_pickup: form.needs_pickup,
      valid_from: form.valid_from,
      valid_to: form.valid_to || null,
    }

    if (editing) {
      // Edit: always single weekday (the first selected)
      const payload = { ...basePayload, weekday: form.weekdays[0] ?? 1 }
      const { data, error: err } = await supabase
        .from('schedule_template').update(payload).eq('id', editing.id).select().single()
      if (err) { setError(err.message); setSaving(false); return }
      setTemplates(prev => prev.map(t => t.id === editing.id ? data : t))
      try {
        await syncTemplateRides(data)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : copy.common.errorOccurred)
        setSaving(false)
        return
      }
    } else {
      // Create: one template per selected weekday
      const inserts = form.weekdays.map(wd => ({ ...basePayload, weekday: wd }))
      const { data, error: err } = await supabase
        .from('schedule_template').insert(inserts).select()
      if (err) { setError(err.message); setSaving(false); return }
      setTemplates(prev => [...prev, ...(data ?? [])])
      try {
        for (const row of data ?? []) await syncTemplateRides(row)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : copy.common.errorOccurred)
        setSaving(false)
        return
      }
    }

    const genErr = await refreshHorizon(householdId)
    setSaving(false); setShowForm(false)
    show({ text: genErr ? copy.schedule.generateError(genErr) : copy.toast.scheduleSaved })
  }

  async function handleDelete(id: string) {
    await supabase.from('schedule_template').delete().eq('id', id)
    setTemplates(prev => prev.filter(t => t.id !== id))
    setDeleteConfirm(null); setShowForm(false)
    const genErr = householdId ? await refreshHorizon(householdId) : null
    show({ text: genErr ? copy.schedule.generateError(genErr) : copy.toast.scheduleSaved })
  }

  const childMap = Object.fromEntries(children.map(c => [c.id, c]))
  const locMap   = Object.fromEntries(locations.map(l => [l.id, l]))
  const groupMap = Object.fromEntries(groups.map(g => [g.id, g]))
  const grouped  = copy.weekday.long.map((name, i) => ({
    name, weekday: i + 1,
    rows: templates.filter(t => t.weekday === i + 1),
  }))

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    padding: '9px 12px', borderRadius: 'var(--r-sm)',
    background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
    color: 'var(--color-text)', fontSize: 14, outline: 'none', WebkitAppearance: 'none',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: 'var(--color-muted)',
    textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5,
  }

  return (
    <div style={{ background: 'var(--color-bg)', minHeight: '100dvh' }}>
      <Header
        title={copy.schedule.title}
        subtitle={copy.schedule.subtitle}
        backTo={embedded ? '/egyeb' : undefined}
        chrome={!embedded}
        action={canEditSchedule ? (
          <button
            onClick={openNew}
            style={{
              background: 'var(--color-blue)', color: '#fff', border: 'none',
              borderRadius: 'var(--r-sm)', padding: '6px 14px', fontWeight: 700,
              fontSize: 13, cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center', gap: 4,
            }}
          ><Icon name="plus" size={14} weight="bold" /> {copy.common.new}</button>
        ) : undefined}
      />

      {canEditSchedule && (
        <p className="schedule-hint">{copy.schedule.saveHint}</p>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--color-muted)', fontSize: 13 }}>
          {copy.common.loading}
        </div>
      )}

      {!loading && (
        <div style={{ padding: '16px 16px calc(var(--nav-height) + 40px)' }}>
          {templates.length === 0 && (
            <div className="empty-state">
              <div className="icon"><Icon name="clipboard" size={40} weight="thin" color="#3a5670" /></div>
              <div className="title">{copy.schedule.emptyTitle}</div>
              <div className="sub">{copy.schedule.emptySub}</div>
            </div>
          )}

          {grouped.map(g => g.rows.length > 0 && (
            <div key={g.weekday} style={{ marginBottom: 24 }}>
              <div className="section-label">{g.name}</div>
              {g.rows.map(t => {
                const child = t.person_id ? childMap[t.person_id] : null
                const group = t.group_id ? groupMap[t.group_id] : null
                const loc   = locMap[t.location_id]
                const stripeColor = child?.color ?? 'var(--color-border)'
                return (
                  <div
                    key={t.id}
                    className="leg-card"
                    style={{ display: 'flex', marginBottom: 8, cursor: canEditSchedule ? 'pointer' : 'default' }}
                    onClick={() => { if (canEditSchedule) openEdit(t) }}
                  >
                    <div className="leg-card-stripe" style={{ background: stripeColor }} />
                    <div className="leg-card-body">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-muted)' }}>
                            {t.starts_at.slice(0,5)}–{t.ends_at.slice(0,5)}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{t.title}</span>
                          {child && (
                            <span style={{ fontSize: 11, color: 'var(--color-text-2)' }}>{child.display_name}</span>
                          )}
                          {group && (
                            <span style={{ fontSize: 11, color: 'var(--color-blue)', background: 'rgba(79,156,249,0.1)', padding: '1px 6px', borderRadius: 'var(--r-sm)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <Icon name="users-three" size={12} /> {group.name}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
                          {loc?.name ?? copy.common.unknown}
                          {t.needs_dropoff ? ` · ${copy.direction.viszi}` : ''}
                          {t.needs_pickup  ? ` · ${copy.direction.begyujti}` : ''}
                          {t.valid_to ? ` · ${copy.form.until(formatShortDate(t.valid_to))}` : ''}
                        </div>
                      </div>
                      <div style={{ color: 'var(--color-muted)', fontSize: 16, padding: '0 4px' }}>›</div>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* Bottom sheet form */}
      {showForm && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) setShowForm(false) }}
        >
          <div style={{
            width: '100%', maxHeight: '94dvh', overflowY: 'auto',
            background: 'var(--color-surface)', borderRadius: 'var(--r-lg) var(--r-lg) 0 0',
            padding: '20px 20px 48px', boxShadow: 'var(--shadow-popup)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{editing ? copy.schedule.editRow : copy.schedule.newRow}</div>
              <button onClick={() => setShowForm(false)} aria-label={copy.a11y.close}
                style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer',
                  width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="x" size={22} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Mód: Gyerek vs Csoport */}
              <div>
                <label style={labelStyle}>{copy.form.whoRequired}</label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  {([['single', copy.form.child] as const, ['group', copy.form.group] as const]).map(([m, label]) => (
                    <button key={m} onClick={() => setForm(f => ({ ...f, mode: m }))}
                      style={{
                        flex: 1, padding: '8px 0', borderRadius: 'var(--r-sm)', border: 'none',
                        fontSize: 13, fontWeight: 600, cursor: 'pointer', minHeight: 44,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        background: form.mode === m ? 'var(--color-blue)' : 'var(--color-surface-2)',
                        color: form.mode === m ? '#fff' : 'var(--color-muted)',
                      }}>
                      <Icon name={m === 'single' ? 'person-simple-walk' : 'users-three'} size={16} />
                      {label}
                    </button>
                  ))}
                </div>
                {form.mode === 'single' ? (
                  <select style={inputStyle} value={form.person_id} onChange={e => setForm(f => ({...f, person_id: e.target.value}))}>
                    <option value="">{copy.form.pickChild}</option>
                    {children.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
                  </select>
                ) : (
                  <>
                    <select style={inputStyle} value={form.group_id} onChange={e => setForm(f => ({...f, group_id: e.target.value}))}>
                      <option value="">{copy.form.pickGroup}</option>
                      {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                    {groups.length === 0 && (
                      <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 4 }}>
                        {copy.schedule.noGroups}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Cím */}
              <div>
                <label style={labelStyle}>{copy.form.programNameRequired}</label>
                <input style={inputStyle} value={form.title} placeholder={copy.form.placeholderProgram}
                  onChange={e => setForm(f => ({...f, title: e.target.value}))} />
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <label style={labelStyle}>
                    {editing ? copy.schedule.day : copy.schedule.days}
                  </label>
                  {!editing && (
                    <button
                      type="button"
                      onClick={() => setForm(f => ({
                        ...f,
                        weekdays: f.weekdays.length === 5 && f.weekdays.every(d => d <= 5)
                          ? [1] : [1, 2, 3, 4, 5],
                      }))}
                      style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 6, border: 'none',
                        cursor: 'pointer', fontWeight: 600, minHeight: 44,
                        background: form.weekdays.length === 5 && form.weekdays.every(d => d <= 5)
                          ? 'var(--color-blue)' : 'var(--color-surface-2)',
                        color: form.weekdays.length === 5 && form.weekdays.every(d => d <= 5)
                          ? '#fff' : 'var(--color-muted)',
                      }}>
                      {copy.schedule.weekdaysMonFri}
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {copy.weekday.short.map((d, i) => {
                    const wd = i + 1
                    const selected = form.weekdays.includes(wd)
                    return (
                      <button key={i} type="button"
                        onClick={() => {
                          if (editing) {
                            setForm(f => ({ ...f, weekdays: [wd] }))
                          } else {
                            setForm(f => ({
                              ...f,
                              weekdays: selected
                                ? f.weekdays.filter(w => w !== wd)
                                : [...f.weekdays, wd].sort((a, b) => a - b),
                            }))
                          }
                        }}
                        style={{
                          flex: 1, padding: '8px 0', borderRadius: 'var(--r-sm)', border: 'none',
                          fontSize: 11, fontWeight: 600, cursor: 'pointer', minHeight: 44,
                          background: selected ? 'var(--color-blue)' : 'var(--color-surface-2)',
                          color: selected ? '#fff' : 'var(--color-muted)',
                        }}>
                        {d}
                      </button>
                    )
                  })}
                </div>
                {!editing && form.weekdays.length > 1 && (
                  <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 4 }}>
                    {copy.schedule.createNDays(form.weekdays.length)}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>{copy.form.start}</label>
                  <input type="time" style={inputStyle} value={form.starts_at}
                    onChange={e => setForm(f => ({...f, starts_at: e.target.value}))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>{copy.form.end}</label>
                  <input type="time" style={inputStyle} value={form.ends_at}
                    onChange={e => setForm(f => ({...f, ends_at: e.target.value}))} />
                </div>
              </div>

              <div>
                <label style={labelStyle}>{copy.form.locationRequired}</label>
                <select style={inputStyle} value={form.location_id} onChange={e => setForm(f => ({...f, location_id: e.target.value}))}>
                  <option value="">{copy.form.pick}</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>

              <div>
                <label style={labelStyle}>{copy.form.transport}</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[
                    { label: copy.schedule.outbound, key: 'needs_dropoff' as const },
                    { label: copy.schedule.inbound, key: 'needs_pickup' as const },
                  ].map(({ label, key }) => (
                    <button key={key} onClick={() => setForm(f => ({...f, [key]: !f[key]}))}
                      style={{
                        flex: 1, padding: '9px 0', borderRadius: 'var(--r-sm)',
                        fontSize: 12, fontWeight: 600, cursor: 'pointer', minHeight: 44,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        background: form[key] ? 'rgba(79,156,249,0.12)' : 'var(--color-surface-2)',
                        color: form[key] ? 'var(--color-blue)' : 'var(--color-muted)',
                        border: `1px solid ${form[key] ? 'rgba(79,156,249,0.3)' : 'var(--color-border)'}`,
                      }}>
                      {form[key] ? <Icon name="check" size={14} weight="bold" /> : null}{label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>{copy.schedule.validFrom}</label>
                  <input type="date" style={inputStyle} value={form.valid_from}
                    onChange={e => setForm(f => ({...f, valid_from: e.target.value}))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>{copy.schedule.validTo}</label>
                  <input type="date" style={inputStyle} value={form.valid_to}
                    onChange={e => setForm(f => ({...f, valid_to: e.target.value}))} />
                </div>
              </div>

              {error && (
                <div style={{ padding: '9px 12px', borderRadius: 'var(--r-sm)', fontSize: 12,
                  background: 'rgba(242,107,107,0.1)', color: 'var(--color-red)',
                  border: '1px solid rgba(242,107,107,0.25)' }}>{error}</div>
              )}

              <button onClick={handleSave} disabled={saving}
                style={{
                  marginTop: 4, padding: '13px', borderRadius: 'var(--r-md)', border: 'none',
                  background: saving ? 'var(--color-border)' : 'var(--color-blue)',
                  color: '#fff', fontWeight: 700, fontSize: 15,
                  cursor: saving ? 'default' : 'pointer', minHeight: 44,
                }}>{saving ? copy.common.saving : editing ? copy.events.saveEdit : copy.schedule.addRow}</button>

              {editing && (
                deleteConfirm === editing.id ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setDeleteConfirm(null)}
                      style={{ flex: 1, padding: '11px', borderRadius: 'var(--r-md)', border: '1px solid var(--color-border)',
                        background: 'transparent', color: 'var(--color-muted)', fontWeight: 600, fontSize: 14, cursor: 'pointer', minHeight: 44 }}>
                      {copy.common.cancel}
                    </button>
                    <button onClick={() => handleDelete(editing.id)}
                      style={{ flex: 1, padding: '11px', borderRadius: 'var(--r-md)', border: '1px solid rgba(242,107,107,0.3)',
                        background: 'rgba(242,107,107,0.1)', color: 'var(--color-red)', fontWeight: 700, fontSize: 14, cursor: 'pointer', minHeight: 44 }}>
                      {copy.common.yesDelete}
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setDeleteConfirm(editing.id)}
                    style={{ padding: '11px', borderRadius: 'var(--r-md)', border: '1px solid rgba(242,107,107,0.3)',
                      background: 'transparent', color: 'var(--color-red)', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                      minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%' }}>
                    <Icon name="trash" size={16} /> {copy.schedule.deleteRow}
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
