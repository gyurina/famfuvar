import { NavLink } from 'react-router-dom'
import { useRole } from '../hooks/useRole'
import { copy } from '../copy'
import { Icon, type IconName } from './Icon'

const allTabs: { to: string; label: string; icon: IconName }[] = [
  { to: '/',        label: copy.nav.today,    icon: 'sun-horizon' },
  { to: '/fuvar',   label: copy.nav.rides,    icon: 'steering-wheel' },
  { to: '/het',     label: copy.nav.week,     icon: 'calendar-blank' },
  { to: '/esemeny', label: copy.nav.events,   icon: 'target' },
  { to: '/sablon',  label: copy.nav.schedule, icon: 'clipboard' },
]

export function BottomNav() {
  const { canSeeSablon } = useRole()
  const tabs = allTabs.filter(t => t.to !== '/sablon' || canSeeSablon)

  return (
    <nav className="bottom-nav">
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
              </span>
              <span>{t.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
