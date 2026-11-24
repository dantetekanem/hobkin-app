import { ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import type { HobkinView } from './needs.ts'

/**
 * hobkin's own scored run (spec 049), under the review's own ratings and named as hobkin's (spec 058): folded to its
 * line when it agrees with the review's within a point on every question, open with each difference marked when it does
 * not, and open alone when the review has none of its own. A finished change it has not scored says so in a line.
 */
export function HobkinScores({ view, heading }: { view: HobkinView; heading: string }) {
  // Folded only while they agree. The part is drawn anew for each review, so a review that disagrees opens.
  const [open, setOpen] = useState(view.state !== 'agrees')
  const foldable = view.state === 'agrees'
  const shown = view.state !== 'none' && (open || !foldable)

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h3 className={heading}>hobkin's own scored run</h3>
        {foldable ? (
          <button type="button" data-stop aria-expanded={open} onClick={() => setOpen((before) => !before)} className="pressable flex h-7 shrink-0 items-center gap-0.5 rounded-md px-2 font-heading text-[12.5px] font-semibold text-muted-foreground">
            {open ? 'Fold' : 'Open'}
            {open ? <ChevronUp aria-hidden="true" className="size-3.5" /> : <ChevronDown aria-hidden="true" className="size-3.5" />}
          </button>
        ) : null}
      </div>
      <p className="text-[14px] leading-5 text-muted-foreground">{view.lead}</p>
      {foldable && !open ? <p className="text-[14px] leading-5 text-muted-foreground">It agrees with this review within a point on every question.</p> : null}
      {shown ? (
        <ul className="flex flex-col">
          {view.rows.map((row) => (
            <li key={row.name} className="flex min-w-0 items-baseline gap-2.5 py-0.5">
              <span className="w-11 shrink-0 font-mono text-[14px] leading-5 tabular-nums">
                {row.number}
                {row.number === '–' ? null : <span className="text-[11px] text-muted-foreground">/10</span>}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13px] leading-5 text-muted-foreground">{row.question}</span>
                <span className="text-[14px] leading-5 text-pretty [overflow-wrap:anywhere]">{row.evidence}</span>
                {row.differs ? <span className="text-[13px] leading-5 font-medium text-warn-fg">Differs: {row.differs}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {shown && view.floors ? <p className="text-[14px] leading-5 text-warn-fg">{view.floors}</p> : null}
      {view.older ? <p className="text-[14px] leading-5 text-muted-foreground">{view.older}</p> : null}
    </div>
  )
}
