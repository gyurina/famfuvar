import { NavLink } from 'react-router-dom'
import { useRole } from '../hooks/useRole'

const allTabs = [
  { to: '/',        label: 'Ma',         icon: '☀️' },
  { to: '/fuvar',   label: 'Fuvartábla', icon: '🚗' },
  { to: '/het',     label: 'Hét',        icon: '📅' },
  { to: '/esemeny', label: 'Események',  icon: '🎯' },
  { to: '/sablon',  label: 'Sablon',     icon: '📋' },
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
          <span className="nav-icon">{t.icon}</span>
          <span className="nav-label">{t.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
