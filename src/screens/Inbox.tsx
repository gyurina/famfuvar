import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Header } from '../components/Header'
import { EmptyState } from '../components/EmptyState'
import { copy } from '../copy'
import { formatDateTime } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { PushKind } from '../types'

interface InboxRow {
  log_id: string
  read_at: string | null
  title: string
  body: string
  sent_at: string
  kind: string | null
}

function kindLabel(kind: string | null): string | null {
  if (!kind) return null
  const map = copy.inbox.kind as Record<string, string>
  return map[kind] ?? null
}

export function Inbox() {
  const { person } = useAuth()
  const [params, setParams] = useSearchParams()
  const highlightId = params.get('m')
  const [rows, setRows] = useState<InboxRow[]>([])
  const [loading, setLoading] = useState(true)
  const highlightRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!person) return
    let cancelled = false
    setLoading(true)
    supabase
      .from('push_recipient')
      .select('log_id, read_at, push_log ( id, title, body, sent_at, kind )')
      .eq('person_id', person.id)
      .then(({ data }) => {
        if (cancelled) return
        const mapped: InboxRow[] = (data ?? []).flatMap(r => {
          const raw = r.push_log as {
            id: string
            title: string
            body: string
            sent_at: string
            kind: PushKind | string | null
          } | { id: string; title: string; body: string; sent_at: string; kind: PushKind | string | null }[] | null
          const log = Array.isArray(raw) ? raw[0] : raw
          if (!log) return []
          return [{
            log_id: log.id,
            read_at: r.read_at,
            title: log.title,
            body: log.body,
            sent_at: log.sent_at,
            kind: log.kind,
          }]
        })
        mapped.sort((a, b) => b.sent_at.localeCompare(a.sent_at))
        setRows(mapped)
        setLoading(false)
        const unreadIds = mapped.filter(m => !m.read_at).map(m => m.log_id)
        if (unreadIds.length) {
          void supabase
            .from('push_recipient')
            .update({ read_at: new Date().toISOString() })
            .eq('person_id', person.id)
            .in('log_id', unreadIds)
        }
      }, () => {
        if (!cancelled) {
          setRows([])
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [person?.id])

  useEffect(() => {
    if (!highlightId) return
    highlightRef.current?.scrollIntoView({ block: 'center' })
  }, [highlightId, rows])

  useEffect(() => {
    if (params.get('inbox') === '1') {
      params.delete('inbox')
      setParams(params, { replace: true })
    }
  }, [params, setParams])

  const unreadCount = useMemo(() => rows.filter(r => !r.read_at).length, [rows])

  return (
    <div>
      <Header
        title={copy.inbox.title}
        subtitle={unreadCount > 0 ? copy.inbox.unread(unreadCount) : undefined}
        backTo="/"
        chrome={false}
      />
      <div className="more-page">
        {loading && (
          <div className="inbox-status">{copy.common.loading}</div>
        )}
        {!loading && rows.length === 0 && (
          <EmptyState
            icon="bell"
            title={copy.empty.inbox.title}
            sub={copy.empty.inbox.sub}
          />
        )}
        {rows.map(row => (
          <div
            key={row.log_id}
            ref={row.log_id === highlightId ? highlightRef : undefined}
            className={[
              'inbox-card',
              !row.read_at ? 'unread' : '',
              row.log_id === highlightId ? 'highlight' : '',
            ].filter(Boolean).join(' ')}
          >
            <div className="inbox-card-top">
              {kindLabel(row.kind) && (
                <span className="inbox-kind">{kindLabel(row.kind)}</span>
              )}
              <span className="inbox-when">{formatDateTime(row.sent_at)}</span>
            </div>
            <div className="inbox-title">{row.title}</div>
            {row.body && <div className="inbox-body">{row.body}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
