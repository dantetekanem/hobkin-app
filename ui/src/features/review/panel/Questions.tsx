import { useState } from 'react'
import { cn } from '@/lib/utils.ts'
import type { QuestionsView } from './needs.ts'

/**
 * "Your questions" (spec 058 A13), at the top of the panel of every review: the user's five questions in their order,
 * each with its number out of 10 and its line of evidence, then the kind and the general rate, any floor that holds the
 * change, what is still missing, and who rated it at which commit. A line of evidence shows two lines, and "Read all"
 * shows each whole. The numbers are plain: the evidence is what the user reads.
 *
 * A review with no ratings says so in two lines and draws nothing else. It once kept the five rows with a dash and
 * room for their evidence, which read as a broken panel (the user, 2026-11-24: "this ui during review is broken").
 */
export function Questions({ view, heading }: { view: QuestionsView; heading: string }) {
  const [whole, setWhole] = useState(false)
  const rated = view.state !== 'pending' && view.state !== 'unrated'

  return (
    <section aria-label="Your questions" data-state={view.state} className="flex flex-col gap-1">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h3 className={heading}>Your questions</h3>
        {rated ? (
          <button
            type="button"
            data-stop
            aria-expanded={whole}
            onClick={() => setWhole((before) => !before)}
            className="pressable h-7 shrink-0 rounded-md px-2 font-heading text-[12.5px] font-semibold text-muted-foreground"
          >
            {whole ? 'Shorter' : 'Read all'}
          </button>
        ) : null}
      </div>

      <p className={cn('text-[14px] leading-5 font-medium', rated ? 'truncate' : 'text-pretty')} title={rated ? view.lead : undefined}>
        {view.lead}
      </p>

      {rated ? (
        <ol className="flex flex-col gap-1.5 pt-1">
          {view.rows.map((row) => (
            <li key={row.name} className="flex min-w-0 items-start gap-2.5">
              <span className="w-11 shrink-0 pt-px font-mono text-[15px] leading-5 tabular-nums" aria-label={row.number === '–' ? 'no number' : `${row.number} out of 10`}>
                {row.number}
                {row.number === '–' ? null : <span className="text-[11px] text-muted-foreground">/10</span>}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13px] leading-5 text-muted-foreground text-pretty">{row.question}</span>
                {row.evidence ? (
                  <span className={cn('text-[14px] leading-5 text-pretty [overflow-wrap:anywhere]', !whole && 'line-clamp-2')} title={whole ? undefined : row.evidence}>
                    {row.evidence}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {view.floors ? (
        <p className="truncate pt-1 text-[14px] leading-5 text-warn-fg" title={view.floors}>
          {view.floors}
        </p>
      ) : null}

      {view.note ? (
        <p className={cn('text-[14px] leading-5 text-pretty [overflow-wrap:anywhere]', rated && !whole && 'line-clamp-2', !rated && 'text-muted-foreground')}>{view.note}</p>
      ) : null}

      {/* Ratings made at another commit say which, in the host's words. */}
      {view.by ? (
        <p className={cn('line-clamp-2 text-[12.5px] leading-5', view.state === 'older' ? 'text-warn-fg' : 'text-muted-foreground')} title={view.by}>
          {view.by}
        </p>
      ) : null}
    </section>
  )
}
