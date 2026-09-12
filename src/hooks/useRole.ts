import { useAuth } from '../lib/auth'
import type { PersonRole } from '../types'

/**
 * Role-based permissions
 * parent      → admin (full access)
 * grandparent → limited (own driver assignment only)
 * babysitter  → drive-only, filtered view (only their assigned legs)
 * child       → read-only, no edit
 */
export function useRole() {
  const { person } = useAuth()
  const role: PersonRole | undefined = person?.role

  const isAdmin       = role === 'parent'
  const isGrandparent = role === 'grandparent'
  const isBabysitter  = role === 'babysitter'
  const isChild       = role === 'child'

  // Can only be assigned as driver for their own occurrence; can't edit others
  const canDriveOnly = isGrandparent || isBabysitter
  // Hide template management from non-admins
  const canSeeSablon = isAdmin
  // Babysitter: only sees legs where they are the driver/companion
  const isFilteredView = isBabysitter

  return { role, isAdmin, isGrandparent, isBabysitter, isChild, canDriveOnly, canSeeSablon, isFilteredView }
}
