import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { copy } from '../copy'
import { Icon } from './Icon'

export interface ToastShow {
  text: string
  undo?: () => void | Promise<void>
}

interface ToastCtx {
  show: (opts: ToastShow) => void
}

const Ctx = createContext<ToastCtx | null>(null)

const LIFE_MS = 5000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<(ToastShow & { id: number }) | null>(null)
  const idRef = useRef(0)
  const timer = useRef<number | null>(null)

  const clearTimer = () => {
    if (timer.current != null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }

  const show = useCallback((opts: ToastShow) => {
    clearTimer()
    const id = ++idRef.current
    setCurrent({ ...opts, id })
    timer.current = window.setTimeout(() => {
      setCurrent(prev => (prev?.id === id ? null : prev))
    }, LIFE_MS)
  }, [])

  useEffect(() => () => clearTimer(), [])

  async function undo() {
    const fn = current?.undo
    clearTimer()
    setCurrent(null)
    if (fn) await fn()
  }

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      {current && (
        <div className="toast-wrap">
          <div className="toast" role="status">
            <Icon name="check-circle" size={19} weight="fill" color="var(--color-ok)" />
            <span className="toast-text">{current.text}</span>
            {current.undo && (
              <button type="button" className="toast-undo" onClick={undo}>
                {copy.toast.undo}
              </button>
            )}
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast')
  return ctx
}
