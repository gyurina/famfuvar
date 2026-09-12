import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useHousehold } from '../hooks/useHousehold'
import { format } from 'date-fns'
import { hu } from 'date-fns/locale'

interface PushMessage {
  id: string
  title: string
  body: string
  sent_at: string
  sent_count: number
}

const LS_KEY = 'push_inbox_last_read'

function getLastRead(): number {
  try { return parseInt(localStorage.getItem(LS_KEY) ?? '0', 10) } catch { return 0 }
}
function setLastRead(ts: number) {
  try { localStorage.setItem(LS_KEY, String(ts)) } catch {}
}

// ── Külső state: más komponensek megnyithatják az inboxot ──
let _openInbox: (() => void) | null = null
export function openPushInbox() { _openInbox?.() }

export function PushInbox() {
  const { householdId } = useHousehold()
  const [open, setOpen]       = useState(false)
  const [msgs, setMsgs]       = useState<PushMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [unread, setUnread]   = useState(0)

  // Regisztrálj a globális megnyitóba
  const doOpen = useCallback(() => setOpen(true), [])
  useEffect(() => {
    _openInbox = doOpen
    return () => { if (_openInbox === doOpen) _openInbox = null }
  }, [doOpen])

  // URL-ből detektál: ?inbox=1 → automatikusan nyílik meg
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('inbox') === '1') {
      setOpen(true)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  // Olvasatlan count lekérése (háttérben, mindig)
  useEffect(() => {
    if (!householdId) return
    const lastRead = getLastRead()
    supabase
      .from('push_log')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', householdId)
      .gt('sent_at', new Date(lastRead || 0).toISOString())
      .then(({ count }) => setUnread(count ?? 0))
  }, [householdId, open])

  // Üzenetek betöltése megnyitáskor
  useEffect(() => {
    if (!open || !householdId) return
    setLoading(true)
    supabase
      .from('push_log')
      .select('id, title, body, sent_at, sent_count')
      .eq('household_id', householdId)
      .order('sent_at', { ascending: false })
      .limit(30)
      .then(({ data }) => {
        setMsgs(data ?? [])
        setLastRead(Date.now())
        setUnread(0)
      })
      .then(() => setLoading(false), () => setLoading(false))
  }, [open, householdId])

  return (
    <>
      {/* ── Harang gomb ── */}
      <button
        className="icon-btn"
        onClick={() => setOpen(true)}
        aria-label="Üzenetek"
        style={{ position: 'relative' }}
      >
        🔔
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 0, right: 0,
            background: 'var(--color-danger, #e74c3c)',
            color: '#fff', borderRadius: '50%',
            fontSize: 10, fontWeight: 700,
            width: 16, height: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1,
          }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* ── Bottom sheet overlay ── */}
      {open && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
          }}
          onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          <div style={{
            background: 'var(--color-surface)',
            borderRadius: '20px 20px 0 0',
            maxHeight: '75vh',
            display: 'flex', flexDirection: 'column',
            padding: '0 0 env(safe-area-inset-bottom, 16px)',
          }}>
            {/* fejléc */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '18px 20px 12px',
              borderBottom: '1px solid var(--color-border)',
            }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>📬 Értesítések</div>
              <button className="icon-btn" onClick={() => setOpen(false)}>✕</button>
            </div>

            {/* lista */}
            <div style={{ overflowY: 'auto', flex: 1, padding: '12px 16px' }}>
              {loading && (
                <div style={{ textAlign: 'center', color: 'var(--color-muted)', padding: 32 }}>
                  Betöltés...
                </div>
              )}
              {!loading && msgs.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--color-muted)', padding: 32 }}>
                  Még nincs értesítés
                </div>
              )}
              {msgs.map(m => (
                <div key={m.id} style={{
                  background: 'var(--color-bg)',
                  borderRadius: 12,
                  padding: '12px 14px',
                  marginBottom: 10,
                  borderLeft: '3px solid var(--color-primary)',
                }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                    {m.title}
                  </div>
                  {m.body && (
                    <div style={{ fontSize: 13, color: 'var(--color-text)', marginBottom: 6, lineHeight: 1.4 }}>
                      {m.body}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                    {format(new Date(m.sent_at), 'MM.dd. HH:mm', { locale: hu })}
                    {m.sent_count > 0 && ` · ${m.sent_count} eszközre küldve`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
