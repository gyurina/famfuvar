import { useRef } from 'react'
import type { TouchEvent } from 'react'
import { copy } from '../copy'

export type DayLoad = 'open' | 'full' | 'empty'

export interface DayStripDay {
  dateStr: string
  weekdayIndex: number
  dayNum: string
  isToday: boolean
  load: DayLoad
}

interface DayStripProps {
  days: DayStripDay[]
  selected: string
  onSelect: (dateStr: string) => void
  onSwipeWeek: (delta: -1 | 1) => void
}

export function DayStrip({ days, selected, onSelect, onSwipeWeek }: DayStripProps) {
  const startX = useRef(0)

  function onTouchStart(e: TouchEvent) {
    startX.current = e.changedTouches[0]?.clientX ?? 0
  }

  function onTouchEnd(e: TouchEvent) {
    const endX = e.changedTouches[0]?.clientX ?? startX.current
    const dx = endX - startX.current
    if (dx > 56) onSwipeWeek(-1)
    else if (dx < -56) onSwipeWeek(1)
  }

  return (
    <div
      className="day-strip"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      role="tablist"
    >
      {days.map(d => {
        const isSelected = d.dateStr === selected
        return (
          <button
            key={d.dateStr}
            type="button"
            role="tab"
            aria-selected={isSelected}
            className={`day-strip-cell${isSelected ? ' is-selected' : ''}${d.isToday ? ' is-today' : ''}`}
            onClick={() => onSelect(d.dateStr)}
          >
            <span className="day-strip-wd">{copy.weekday.short[d.weekdayIndex]}</span>
            <span className="day-strip-num">{d.dayNum}</span>
            <span className={`day-strip-bar load-${d.load}`} />
          </button>
        )
      })}
    </div>
  )
}
