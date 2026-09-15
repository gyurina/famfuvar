import { Link } from 'react-router-dom'
import { copy } from '../copy'
import { Icon } from './Icon'
import { useUnreadInbox } from '../hooks/useUnreadInbox'

export function PushInbox() {
  const { unread } = useUnreadInbox()

  return (
    <Link
      to="/uzenetek"
      className="icon-btn inbox-bell"
      aria-label={copy.a11y.messages}
    >
      <Icon name="bell" size={24} />
      {unread > 0 && (
        <span className="inbox-bell-badge">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  )
}
