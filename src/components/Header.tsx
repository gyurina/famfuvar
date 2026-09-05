import { useNavigate } from 'react-router-dom'

interface HeaderProps {
  title: string
  subtitle?: string
  action?: React.ReactNode
}

export function Header({ title, subtitle, action }: HeaderProps) {
  const nav = useNavigate()
  return (
    <header className="app-header">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div className="header-title">{title}</div>
          {subtitle && <div className="header-subtitle">{subtitle}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {action}
          <button
            className="icon-btn"
            onClick={() => nav('/beallitasok')}
            aria-label="Beállítások"
          >
            ⚙️
          </button>
        </div>
      </div>
    </header>
  )
}
