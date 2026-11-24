import { cn } from '@/lib/utils.ts'
import { rateTone, scoreTone, type GradeBlock, type Tone as GradeTone } from './change-list.ts'

/**
 * The general rate and the five grades in front of a finished change's row and of a stack's layer line. A fixed, compact
 * size whatever it holds, so a row never moves when its grades land and the title keeps the room.
 */

const GRADE_TEXT: Record<GradeTone, string> = { good: 'text-ok-fg', middling: 'text-warn-fg', low: 'text-bad-fg' }
const CELL_TEXT: Record<GradeTone, string> = { good: 'text-foreground', middling: 'text-warn-fg', low: 'text-bad-fg' }
const GRADE_ASKS: Record<string, string> = {
  Cover: 'Do tests cover the change?',
  Proof: 'Were tests added or changed to prove it?',
  Safe: 'Does it risk the deploy or data?',
  Watch: 'Would a regression show in monitoring?',
  Undo: 'How fast and safe is the roll back?',
}

/** The general rate and the five grades, or the words for why there are none. One size either way, so a row never moves when its grades land. */
export function Grades({ block, lowest }: { block: GradeBlock; lowest: number }) {
  if (block.kind === 'words') {
    return (
      <div data-grades="" title="The grades land here when its review ends." className="flex h-11 w-[14rem] shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-[12.5px] text-muted-foreground">
        {block.words}
      </div>
    )
  }
  return (
    <div data-grades="" title={block.stale ? 'Scored on an older commit than this one.' : undefined} className={cn('flex h-11 w-[14rem] shrink-0 items-stretch gap-[3px]', block.stale && 'opacity-60')}>
      <span title={`General rate: the average of the five grades. ${lowest} is the lowest you accept.`} className={cn('flex w-10 shrink-0 items-center justify-center font-heading text-[18px] leading-none font-semibold tracking-[-0.02em] tabular-nums', GRADE_TEXT[rateTone(block.rate, lowest)])}>
        {block.rate.toFixed(1)}
      </span>
      {block.cells.map(({ label, score, evidence }) => (
        <span key={label} title={`${GRADE_ASKS[label]} ${evidence}`.trim()} className="flex min-w-0 flex-1 flex-col items-center justify-center rounded-lg bg-surface-2">
          <span className="text-[8.5px] leading-tight tracking-[0.03em] text-muted-foreground uppercase">{label}</span>
          <span className={cn('font-heading text-[13px] leading-tight font-semibold tabular-nums', score === null ? 'text-muted-foreground' : CELL_TEXT[scoreTone(score)])}>{score ?? 'n/a'}</span>
        </span>
      ))}
    </div>
  )
}

