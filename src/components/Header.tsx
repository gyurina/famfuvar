import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { PushInbox } from './PushInbox'
import { Icon } from './Icon'
import { copy } from '../copy'

interface HeaderProps {
  title: string
  subtitle?: string
  action?: ReactNode
}

export function Header({ title, subtitle, action }: HeaderProps) {
  const nav = useNavigate()
  return (
    <header className="app-header">
      <div className="header-row">
        <h1 className="header-title">{title}</h1>
        <div className="header-chrome">
          <PushInbox />
          <button
            className="icon-btn"
            onClick={() => nav('/beallitasok')}
            aria-label={copy.a11y.settings}
          >
            <Icon name="gear" size={22} />
          </button>
        </div>
      </div>
      {(subtitle || action) && (
        <div className="header-meta">
          {subtitle && <p className="header-subtitle">{subtitle}</p>}
          {action && <div className="header-toolbar">{action}</div>}
        </div>
      )}
    </header>
  )
}
