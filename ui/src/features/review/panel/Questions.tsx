import { useState } from 'react'
import { cn } from '@/lib/utils.ts'
import type { QuestionsView } from './needs.ts'

/**
 * "Your questions" (spec 058 A13), at the top of the panel of every review: the user's five questions in their order,
 * each with its number out of 10 and its line of evidence, then the kind and the general rate, any floor that holds the
 * change, what is still missing, and who rated it at which commit. Every line keeps its place and its height in every
 * state, rated or not, so nothing under it moves when the ratings arrive: a line of evidence shows two lines, and
 * "Read all" shows each whole. The numbers are plain: the evidence is what the user reads.
 */
export function Questions({ view, heading }: { view: QuestionsView; heading: string }) {
  const [whole, setWhole] = useState(false)
  const rated = view.rows.some((row) => row.evidence !== '')

  return (
    <section aria-label="Your questions" data-state={view.state} className="flex flex-col gap-1">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h3 className={heading}>Your questions</h3>
        {/* Its place is kept with nothing to read whole, so the heading never moves. */}
        <button
          type="button"
          data-stop
          aria-expanded={whole}
          tabIndex={rated ? 0 : -1}
          aria-hidden={!rated}
          onClick={() => setWhole((before) => !before)}
          className={cn('pressable h-7 shrink-0 rounded-md px-2 font-heading text-[12.5px] font-semibold text-muted-foreground', !rated && 'invisible')}
        >
          {whole ? 'Shorter' : 'Read all'}
        </button>
      </div>
      <p className="truncate text-[14px] leading-5 font-medium" title={view.lead}>
        {view.lead}
      </p>
      <ol className="flex flex-col gap-1.5 pt-1">
        {view.rows.map((row) => (
          <li key={row.name} className="flex min-w-0 items-start gap-2.5">
            <span className="w-11 shrink-0 pt-px font-mono text-[15px] leading-5 tabular-nums" aria-label={row.number === '–' ? 'no number' : `${row.number} out of 10`}>
              {row.number}
              {row.number === '–' ? null : <span className="text-[11px] text-muted-foreground">/10</span>}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[13px] leading-5 text-muted-foreground text-pretty">{row.question}</span>
              <span className={cn('min-h-10 text-[14px] leading-5 text-pretty [overflow-wrap:anywhere]', !whole && 'line-clamp-2')} title={whole ? undefined : row.evidence}>
                {row.evidence}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <p className="min-h-5 truncate text-[14px] leading-5 text-warn-fg" title={view.floors ?? undefined}>
        {view.floors}
      </p>
      <p className={cn('min-h-10 text-[14px] leading-5 text-pretty [overflow-wrap:anywhere]', !whole && 'line-clamp-2', view.state === 'pending' || view.state === 'unrated' ? 'text-muted-foreground' : '')}>{view.note}</p>
      <p className="min-h-5 truncate text-[12.5px] leading-5 text-muted-foreground">{view.by}</p>
    </section>
  )
}
