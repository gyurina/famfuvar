import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export type PillTone = 'accent' | 'ok' | 'warn' | 'danger'

interface PillProps {
  tone: PillTone
  icon?: IconName
  iconWeight?: 'regular' | 'fill' | 'thin'
  children: ReactNode
}

export function Pill({ tone, icon, iconWeight = 'fill', children }: PillProps) {
  return (
    <span className={`pill ${tone}`}>
      {icon && <Icon name={icon} size={tone === 'warn' ? 13 : 14} weight={iconWeight} />}
      {children}
    </span>
  )
}
