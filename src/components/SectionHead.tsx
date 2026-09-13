interface SectionHeadProps {
  title: string
  meta?: string
  variant?: 'section' | 'day'
}

export function SectionHead({ title, meta, variant = 'section' }: SectionHeadProps) {
  return (
    <div className={`section-head ${variant}`}>
      <span className="section-head-title">{title}</span>
      {meta && <span className="section-head-meta">{meta}</span>}
    </div>
  )
}
