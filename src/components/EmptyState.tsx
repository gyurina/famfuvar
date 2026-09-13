import { Icon, type IconName } from './Icon'

interface EmptyStateProps {
  icon: IconName
  title: string
  sub?: string
  action?: { label: string; onClick: () => void }
}

export function EmptyState({ icon, title, sub, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="icon">
        <Icon name={icon} size={40} weight="thin" color="#3a5670" />
      </div>
      <div className="title">{title}</div>
      {sub && <div className="sub">{sub}</div>}
      {action && (
        <button type="button" className="empty-state-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}
