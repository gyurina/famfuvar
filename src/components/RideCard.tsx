import type { ReactNode } from 'react'

export type RideCardVariant = 'assigned' | 'unassigned' | 'self' | 'grouped' | 'cancelled'

interface RideCardProps {
  variant: RideCardVariant
  /** pötty szín (gyerek színe) */
  dotColor?: string
  title: string
  /** pl. "Odaút · Otthonról · 15 perc" vagy "Elmarad — beteg" cancelled esetén */
  subtitle?: ReactNode
  time?: string
  cancelled?: boolean
  /** assigned/self alsó sor tartalma (pl. driver info + „Csere" link) */
  footer?: ReactNode
  /** unassigned esetén ide kerül a DriverRow */
  children?: ReactNode
  onClick?: () => void
}

const variantStyle: Record<RideCardVariant, React.CSSProperties> = {
  assigned:   { background: 'var(--color-surface)', border: '1px solid var(--color-border)' },
  self:       { background: 'var(--color-surface)', border: '1px solid var(--color-border)' },
  grouped:    { background: 'var(--color-surface)', border: '1px solid var(--color-border)' },
  unassigned: { background: 'linear-gradient(160deg, #251016 0%, #14121f 100%)', border: '1px solid rgba(242,107,107,.4)' },
  cancelled:  { background: '#0c1626', border: '1px solid #1b2b3e' },
}

/** Egy fuvar-alkalom kártyája — 5 vizuális állapot, közös vázzal. */
export function RideCard({ variant, dotColor, title, subtitle, time, cancelled, footer, children, onClick }: RideCardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        borderRadius: 18, padding: '15px 16px 14px', ...variantStyle[variant],
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: children || footer ? 12 : 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            {dotColor && <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flex: 'none', opacity: cancelled ? 0.6 : 1 }} />}
            <span style={{
              fontSize: 16, fontWeight: 600,
              textDecoration: cancelled ? 'line-through' : 'none',
              color: cancelled ? 'var(--color-muted)' : 'var(--color-text)',
            }}>{title}</span>
          </div>
          {subtitle && (
            <div style={{ fontSize: 13.5, color: variant === 'cancelled' ? 'var(--color-warn)' : 'var(--color-text-2)' }}>{subtitle}</div>
          )}
        </div>
        {time && (
          <div style={{
            fontSize: 19, fontWeight: 600, fontVariantNumeric: 'tabular-nums', flex: 'none',
            color: cancelled ? 'var(--color-muted)' : 'var(--color-text)',
            textDecoration: cancelled ? 'line-through' : 'none',
          }}>{time}</div>
        )}
      </div>

      {children && (
        <div style={{ paddingTop: variant === 'unassigned' ? 13 : 0, borderTop: variant === 'unassigned' ? '1px solid rgba(242,107,107,.22)' : 'none' }}>
          {children}
        </div>
      )}

      {footer && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12, marginTop: 12, borderTop: '1px solid #1c2e42' }}>
          {footer}
        </div>
      )}
    </div>
  )
}
