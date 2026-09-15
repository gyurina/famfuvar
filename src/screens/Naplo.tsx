import { useEffect, useState } from 'react'
import { Header } from '../components/Header'
import { EmptyState } from '../components/EmptyState'
import { copy } from '../copy'
import { formatDateTime } from '../lib/format'
import { naploChanges, naploHeadline } from '../lib/naplo'
import { supabase } from '../lib/supabase'
import { useHousehold } from '../hooks/useHousehold'
import type { AuditEvent } from '../types'

export function Naplo() {
  const { householdId, personById } = useHousehold()
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!householdId) return
    let cancelled = false
    setLoading(true)
    supabase
      .from('audit_event')
      .select('id, household_id, actor_id, source, entity, entity_id, action, before, after, created_at')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false })
      .limit(150)
      .then(({ data }) => {
        if (cancelled) return
        setEvents((data ?? []) as AuditEvent[])
        setLoading(false)
      }, () => {
        if (!cancelled) {
          setEvents([])
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [householdId])

  return (
    <div>
      <Header
        title={copy.naplo.title}
        subtitle={copy.naplo.sub}
        backTo="/egyeb"
        chrome={false}
      />
      <div className="more-page">
        {loading && <div className="inbox-status">{copy.common.loading}</div>}
        {!loading && events.length === 0 && (
          <EmptyState icon="clipboard" title={copy.naplo.empty} />
        )}
        {events.map(ev => {
          const actor = ev.actor_id ? personById(ev.actor_id) : null
          const who = actor?.display_name ?? (ev.source === 'system' ? copy.naplo.system : copy.common.unknown)
          const changes = naploChanges(ev.before, ev.after)
          return (
            <article key={ev.id} className="naplo-card">
              <div className="naplo-card-top">
                <span className="naplo-headline">{naploHeadline(ev)}</span>
                <span className="inbox-when">{formatDateTime(ev.created_at)}</span>
              </div>
              <div className="naplo-actor">{who}</div>
              {changes.length > 0 && (
                <ul className="naplo-diff">
                  {changes.map(ch => (
                    <li key={ch.key}>{ch.text}</li>
                  ))}
                </ul>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
