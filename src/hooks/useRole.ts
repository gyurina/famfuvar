import { useAuth } from '../lib/auth'
import type { PersonRole } from '../types'

/**
 * F4 – Role-based permissions
 * parent   → admin (teljes hozzáférés)
 * grandparent → korlátozott (csak saját sofőr-hozzárendelés)
 * child    → nincs szerkesztési jog
 */
export function useRole() {
  const { person } = useAuth()
  const role: PersonRole | undefined = person?.role

  const isAdmin      = role === 'parent'
  const isGrandparent = role === 'grandparent'
  const isChild      = role === 'child'

  // Grandparent csak saját magát rendelheti sofőrként
  const canDriveOnly = isGrandparent
  // Sablon menüpont elrejtése grandparent + child előtt
  const canSeeSablon = isAdmin

  return { role, isAdmin, isGrandparent, isChild, canDriveOnly, canSeeSablon }
}
