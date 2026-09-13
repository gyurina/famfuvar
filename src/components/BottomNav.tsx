import { addDays, startOfDay } from 'date-fns'
import { NavLink } from 'react-router-dom'
import { useRole } from '../hooks/useRole'
import { useOpenRides } from '../hooks/useOpenRides'
import { copy } from '../copy'
import { Icon } from './Icon'
import { ROLE_THEME, tabsForRole } from '../roleTheme'
import type { PersonRole } from '../types'

export function BottomNav() {
  const { role } = useRole()
  const from = startOfDay(new Date()).toISOString()
  const to = addDays(startOfDay(new Date()), 7).toISOString()
  const { total } = useOpenRides(from, to)
  const tabs = tabsForRole(role)
  const theme = ROLE_THEME[(role ?? 'child') as PersonRole]

  if (tabs.length === 0) return null

  return (
    <nav className="bottom-nav" style={{ ['--nav-ink' as string]: theme.ink }}>
      {tabs.map(t => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.to === '/'}
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          {({ isActive }) => (
            <>
              <span className="nav-icon">
                <Icon name={t.icon} size={24} weight={isActive ? 'fill' : 'regular'} />
                {t.badge === 'openRides' && total > 0 && (
                  <span className="nav-badge" aria-label={copy.a11y.openRides(total)}>{total}</span>
                )}
              </span>
              <span>{t.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
