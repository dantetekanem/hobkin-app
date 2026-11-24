import { cn } from '@/lib/utils.ts'
import type { ScoresLine as Line } from './needs.ts'

/**
 * The scores (spec 058): one line of the five numbers, each a short word and its number, with the general rate first.
 * A question and its evidence are in the tooltip of its number, what holds the change is the quiet line under, and the
 * kind, what is still missing and who rated it are in the tooltip of the line. A review with no ratings has one short
 * quiet line. Numbers made at another commit are in the warning color, so they never read as current. A number hobkin's
 * own run scored more than a point apart carries a dot, and hobkin's number is in its tooltip.
 */
export function ScoresLine({ line }: { line: Line }) {
  if (line.quiet) return <p data-state={line.state} className="text-[13.5px] leading-5 text-muted-foreground">{line.quiet}</p>

  return (
    <section aria-label="Scores" data-state={line.state} className="flex flex-col gap-0.5" title={line.tip}>
      <p className={cn('flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-[13px] leading-5', line.older ? 'text-warn-fg' : 'text-foreground')}>
        {line.by === 'hobkin' ? <span className="font-medium text-muted-foreground">hobkin</span> : null}
        {line.rate ? (
          <span className="font-semibold">
            <span className="font-normal text-muted-foreground">Rate </span>
            <span className="font-mono tabular-nums">{line.rate}</span>
          </span>
        ) : null}
        {line.items.map((item) => (
          <span key={item.name} title={item.tip} aria-label={`${item.word} ${item.value === '–' ? 'no number' : `${item.value} out of 10`}`} className="whitespace-nowrap">
            <span className="text-muted-foreground">{item.word} </span>
            <span className="font-mono text-[14px] font-semibold tabular-nums">{item.value}</span>
            {item.hobkin ? <span aria-hidden="true" className="ml-0.5 inline-block size-1.5 rounded-full bg-warn-fg align-middle" /> : null}
          </span>
        ))}
      </p>
      {line.holds ? (
        <p className="truncate text-[13px] leading-5 text-warn-fg" title={`${line.holds}\n${line.tip}`}>
          {line.holds}
        </p>
      ) : null}
    </section>
  )
}
