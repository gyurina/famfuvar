import { useEffect, useState } from 'react'
import { Header } from '../components/Header'
import { EmptyState } from '../components/EmptyState'
import { copy } from '../copy'
import { formatDateTime } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useHousehold } from '../hooks/useHousehold'
import type { PushKind, PushLog } from '../types'

interface RecipientRow {
  person_id: string
  read_at: string | null
}

interface PostaRow extends PushLog {
  recipients: RecipientRow[]
}

function kindLabel(kind: string | null | undefined): string | null {
  if (!kind) return null
  const map = copy.inbox.kind as Record<string, string>
  return map[kind] ?? null
}

export function Posta() {
  const { householdId, personById } = useHousehold()
  const [rows, setRows] = useState<PostaRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!householdId) return
    let cancelled = false
    setLoading(true)
    supabase
      .from('push_log')
      .select('id, household_id, sent_by, actor_id, kind, title, body, sent_at, target_count, sent_count, failed_count, push_recipient ( person_id, read_at )')
      .eq('household_id', householdId)
      .order('sent_at', { ascending: false })
      .limit(80)
      .then(({ data }) => {
        if (cancelled) return
        const mapped: PostaRow[] = (data ?? []).map(row => ({
          id: row.id,
          household_id: row.household_id,
          sent_by: row.sent_by,
          actor_id: row.actor_id,
          kind: row.kind,
          title: row.title,
          body: row.body,
          sent_at: row.sent_at,
          target_count: row.target_count,
          sent_count: row.sent_count,
          failed_count: row.failed_count,
          recipients: (row.push_recipient ?? []) as RecipientRow[],
        }))
        setRows(mapped)
        setLoading(false)
      }, () => {
        if (!cancelled) {
          setRows([])
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [householdId])

  return (
    <div>
      <Header
        title={copy.posta.title}
        subtitle={copy.posta.sub}
        backTo="/egyeb"
        chrome={false}
      />
      <div className="more-page">
        {loading && <div className="inbox-status">{copy.common.loading}</div>}
        {!loading && rows.length === 0 && (
          <EmptyState icon="paper-plane" title={copy.posta.empty} />
        )}
        {rows.map(row => (
          <article key={row.id} className="inbox-card">
            <div className="inbox-card-top">
              {kindLabel(row.kind as PushKind | null) && (
                <span className="inbox-kind">{kindLabel(row.kind as PushKind | null)}</span>
              )}
              <span className="inbox-when">{formatDateTime(row.sent_at)}</span>
            </div>
            <div className="inbox-title">{row.title}</div>
            {row.body && <div className="inbox-body">{row.body}</div>}
            <div className="posta-meta">
              {copy.posta.sent(row.sent_count, row.target_count)}
              {row.failed_count > 0 ? ` · ${copy.posta.failed(row.failed_count)}` : ''}
            </div>
            <div className="posta-recipients">
              <div className="posta-recipients-label">{copy.posta.recipients}</div>
              {row.recipients.length === 0 && (
                <div className="posta-meta">{copy.posta.noRecipients}</div>
              )}
              {row.recipients.map(r => {
                const name = personById(r.person_id)?.display_name ?? copy.common.unknown
                return (
                  <div key={r.person_id} className="posta-recipient">
                    <span>{name}</span>
                    <span className={r.read_at ? 'read' : 'unread'}>
                      {r.read_at ? copy.posta.read : copy.posta.unread}
                    </span>
                  </div>
                )
              })}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
