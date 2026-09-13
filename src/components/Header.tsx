import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PushInbox } from './PushInbox'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { copy } from '../copy'
import { useAuth } from '../lib/auth'
import { useRole } from '../hooks/useRole'

interface HeaderProps {
  title: string
  kicker?: string
  subtitle?: string
  action?: ReactNode
  backTo?: string
  chrome?: boolean
}

export function Header({
  title,
  kicker,
  subtitle,
  action,
  backTo,
  chrome = true,
}: HeaderProps) {
  const nav = useNavigate()
  const { person } = useAuth()
  const { canSeeMore } = useRole()
  const showChrome = chrome && !backTo
  const avatar = (
    <Avatar person={person} size={34} />
  )

  return (
    <header className="app-header">
      <div className="header-row">
        {backTo && (
          <button
            type="button"
            className="icon-btn header-back"
            onClick={() => nav(backTo)}
            aria-label={copy.a11y.back}
          >
            <Icon name="caret-left" size={22} />
          </button>
        )}
        <div className="header-lead">
          {kicker && <div className="header-kicker">{kicker}</div>}
          <h1 className="header-title">{title}</h1>
        </div>
        {showChrome && (
          <div className="header-chrome">
            <PushInbox />
            {person && (
              canSeeMore
                ? <Link to="/egyeb" className="header-profile" aria-label={copy.a11y.profile}>{avatar}</Link>
                : <span className="header-profile" aria-hidden>{avatar}</span>
            )}
          </div>
        )}
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
