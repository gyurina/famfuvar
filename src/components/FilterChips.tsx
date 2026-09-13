interface Chip {
  id: string
  label: string
  count: number
  tone?: 'danger' | 'neutral'
}

interface FilterChipsProps {
  chips: Chip[]
  value: string
  onChange: (id: string) => void
}

export function FilterChips({ chips, value, onChange }: FilterChipsProps) {
  return (
    <div className="filter-chips" role="tablist">
      {chips.map(chip => {
        const empty = chip.count === 0
        const on = value === chip.id
        return (
          <button
            key={chip.id}
            type="button"
            role="tab"
            aria-selected={on}
            disabled={empty}
            className={`filter-chip${on ? ' is-on' : ''}${empty ? ' is-empty' : ''}${chip.tone === 'danger' ? ' tone-danger' : ''}`}
            onClick={() => { if (!empty) onChange(chip.id) }}
          >
            {chip.label}
          </button>
        )
      })}
    </div>
  )
}
