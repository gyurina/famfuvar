import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { copy } from '../copy'
import { Icon } from './Icon'

export interface SheetAction {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}

interface SheetProps {
  title: string
  subtitle?: string
  onClose: () => void
  onBack?: () => void
  primary?: SheetAction
  secondary?: SheetAction
  padded?: boolean
  children: ReactNode
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function Sheet({
  title,
  subtitle,
  onClose,
  onBack,
  primary,
  secondary,
  padded = false,
  children,
}: SheetProps) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const startY = useRef(0)
  const [open, setOpen] = useState(prefersReducedMotion())
  const [dy, setDy] = useState(0)

  useEffect(() => {
    if (prefersReducedMotion()) {
      titleRef.current?.focus()
      return
    }
    const id = requestAnimationFrame(() => setOpen(true))
    const t = window.setTimeout(() => titleRef.current?.focus(), 40)
    return () => {
      cancelAnimationFrame(id)
      window.clearTimeout(t)
    }
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function close() {
    if (prefersReducedMotion()) {
      onClose()
      return
    }
    setOpen(false)
    window.setTimeout(onClose, 200)
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    startY.current = e.clientY
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    setDy(Math.max(0, e.clientY - startY.current))
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    if (e.clientY - startY.current > 80) close()
    else setDy(0)
  }

  const dragStyle = dy > 0 ? { transform: `translateY(${dy}px)`, transition: 'none' } : undefined

  return (
    <div
      className="sheet-veil"
      onClick={e => { if (e.target === e.currentTarget) close() }}
    >
      <div
        className={`sheet${open ? ' is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        style={dragStyle}
      >
        <div
          className="sheet-handle"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDy(0)}
        >
          <span className="sheet-handle-bar" />
        </div>
        <div className="sheet-head">
          {onBack && (
            <button type="button" className="sheet-back" onClick={onBack} aria-label={copy.common.back}>
              <Icon name="caret-left" size={20} />
            </button>
          )}
          <div className="sheet-head-text">
            <h2 id="sheet-title" className="sheet-title" tabIndex={-1} ref={titleRef}>
              {title}
            </h2>
            {subtitle && <div className="sheet-sub">{subtitle}</div>}
          </div>
          <button type="button" className="sheet-icon-btn" onClick={close} aria-label={copy.a11y.close}>
            <Icon name="x" size={17} />
          </button>
        </div>
        <div className="sheet-rule" />
        <div className={`sheet-body${padded ? ' has-pad' : ''}`}>{children}</div>
        {(primary || secondary) && (
          <>
            <div className="sheet-foot">
              {secondary && (
                <button type="button" className="sheet-btn sheet-btn-secondary" onClick={secondary.onClick}>
                  {secondary.label}
                </button>
              )}
              {primary && (
                <button
                  type="button"
                  className={`sheet-btn sheet-btn-primary${primary.danger ? ' is-danger' : ''}`}
                  onClick={primary.onClick}
                  disabled={primary.disabled}
                >
                  {primary.label}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
