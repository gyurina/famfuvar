import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

export function useUnreadInbox() {
  const { person } = useAuth()
  const [unread, setUnread] = useState(0)

  const refresh = useCallback(async () => {
    if (!person) {
      setUnread(0)
      return
    }
    const { count, error } = await supabase
      .from('push_recipient')
      .select('log_id', { count: 'exact', head: true })
      .eq('person_id', person.id)
      .is('read_at', null)
    if (error) {
      setUnread(0)
      return
    }
    setUnread(count ?? 0)
  }, [person?.id])

  useEffect(() => {
    void refresh()
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    const id = window.setInterval(() => { void refresh() }, 30000)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.clearInterval(id)
    }
  }, [refresh])

  return { unread, refresh }
}
