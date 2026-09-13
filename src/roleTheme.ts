import { copy } from './copy'
import type { PersonRole } from './types'
import type { IconName } from './components/Icon'

export const ROLE_THEME = {
  parent:      { ink: 'var(--color-accent-ink)', icon: 'steering-wheel' as const, tabs: 4 },
  grandparent: { ink: 'var(--color-ok)',         icon: 'hand-waving' as const,    tabs: 3 },
  babysitter:  { ink: 'var(--color-text-2)',     icon: 'eye' as const,            tabs: 3 },
  child:       { ink: 'var(--color-text-2)',     icon: 'eye' as const,            tabs: 2 },
} as const satisfies Record<PersonRole, { ink: string; icon: IconName; tabs: number }>

export const TABS: {
  to: string
  label: string
  icon: IconName
  roles: PersonRole[]
  badge?: 'openRides'
}[] = [
  { to: '/',        label: copy.nav.today, icon: 'sun-horizon',       roles: ['parent', 'grandparent', 'babysitter', 'child'] },
  { to: '/het',     label: copy.nav.week,  icon: 'calendar-blank',    roles: ['parent', 'grandparent', 'babysitter', 'child'] },
  { to: '/fuvarok', label: copy.nav.rides, icon: 'steering-wheel',    roles: ['parent'], badge: 'openRides' },
  { to: '/egyeb',   label: copy.nav.more,  icon: 'dots-three-circle', roles: ['parent', 'grandparent', 'babysitter'] },
]

export function tabsForRole(role: PersonRole | undefined) {
  return TABS.filter(t => role && t.roles.includes(role))
}
