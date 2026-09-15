import { Header } from '../components/Header'
import { Avatar } from '../components/Avatar'
import { copy } from '../copy'
import { useHousehold } from '../hooks/useHousehold'
import { useAuth } from '../lib/auth'
import { useRole } from '../hooks/useRole'
import { useToast } from '../components/Toast'
import { supabase } from '../lib/supabase'
import { useState } from 'react'
import type { Person } from '../types'

export function Family() {
  const { person, reloadPerson } = useAuth()
  const { isSysAdmin } = useRole()
  const { persons } = useHousehold()
  const { show } = useToast()
  const [local, setLocal] = useState<Person[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const list = local ?? persons
  const names = list.map(p => p.display_name)
  const adminCount = list.filter(p => p.is_admin).length

  async function toggleAdmin(p: Person) {
    if (!isSysAdmin || p.role !== 'parent' || busyId) return
    const next = !p.is_admin
    if (p.is_admin && adminCount <= 1) {
      show({ text: copy.family.lastAdmin })
      return
    }
    setBusyId(p.id)
    const { error } = await supabase.from('person').update({ is_admin: next }).eq('id', p.id)
    setBusyId(null)
    if (error) {
      const msg = /last admin/i.test(error.message)
        ? copy.family.lastAdmin
        : /parent/i.test(error.message)
          ? copy.family.onlyParent
          : copy.common.errorOccurred
      show({ text: msg })
      return
    }
    setLocal(list.map(x => x.id === p.id ? { ...x, is_admin: next } : x))
    if (p.id === person?.id) await reloadPerson()
  }

  return (
    <div>
      <Header
        title={copy.more.family}
        subtitle={copy.more.familySub(
          list.length,
          list.filter(p => p.can_drive).length,
          list.filter(p => p.role === 'child').length,
        )}
        backTo="/egyeb"
        chrome={false}
      />
      <div className="more-page">
        {list.map(p => (
          <div key={p.id} className="family-row">
            <Avatar person={p} size={34} householdNames={names} />
            <div className="family-text">
              <div className="family-name">{p.display_name}</div>
              <div className="family-meta">
                {copy.role[p.role]}
                {p.name_acc ? ` · ${p.name_acc}` : ''}
                {p.is_admin ? ` · ${copy.family.adminBadge}` : ''}
              </div>
            </div>
            {isSysAdmin && p.role === 'parent' && (
              <button
                type="button"
                className="family-admin-btn"
                disabled={busyId === p.id || (p.is_admin && adminCount <= 1)}
                onClick={() => void toggleAdmin(p)}
                aria-label={p.is_admin ? copy.family.adminRevoke : copy.family.adminGrant}
              >
                <span className={`sys-switch${p.is_admin ? ' on' : ''}`}><span /></span>
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
