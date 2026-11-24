import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx'
import { cn } from '@/lib/utils.ts'
import { rateTone, scoreTone, type GradeBlock, type Tone as GradeTone } from './change-list.ts'

/**
 * The general rate in front of a finished change's row and of a stack's layer line, and the five grades behind it on
 * a hover (the user, 2026-11-24: "just leave the average rate and a hover to see details"). One narrow size whatever
 * it holds, so a row never moves when its grades land and the title keeps the room.
 */

const GRADE_TEXT: Record<GradeTone, string> = { good: 'text-ok-fg', middling: 'text-warn-fg', low: 'text-bad-fg' }
const GRADE_ASKS: Record<string, string> = {
  Cover: 'Do tests cover the change?',
  Proof: 'Were tests added or changed to prove it?',
  Safe: 'Does it risk the deploy or data?',
  Watch: 'Would a regression show in monitoring?',
  Undo: 'How fast and safe is the roll back?',
}

/** The place's width, shared by the rows' grid so every row's title starts at the same line. */
export const GRADES_WIDTH = 'w-[6.5rem]'

/** The general rate, or the words for why there is none. The five grades open on a hover of the rate. */
export function Grades({ block, lowest }: { block: GradeBlock; lowest: number }) {
  if (block.kind === 'words') {
    return (
      <div data-grades="" title="The grades land here when its review ends." className={cn('flex h-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-[12px] text-muted-foreground', GRADES_WIDTH)}>
        {block.words}
      </div>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={<div data-grades="" className={cn('flex h-9 shrink-0 cursor-default items-center justify-center rounded-lg bg-surface-2', GRADES_WIDTH, block.stale && 'opacity-60')} />}
        aria-label={`Rate ${block.rate.toFixed(1)}. ${block.cells.map(({ label, score }) => `${label} ${score ?? 'not given'}`).join(', ')}.`}
      >
        <span className={cn('font-heading text-[18px] leading-none font-semibold tracking-[-0.02em] tabular-nums', GRADE_TEXT[rateTone(block.rate, lowest)])}>{block.rate.toFixed(1)}</span>
      </TooltipTrigger>
      <TooltipContent side="right" align="start" sideOffset={8} className="max-w-sm text-left leading-snug whitespace-normal">
        <span className="flex flex-col gap-1.5">
          <span className="text-[11px] opacity-70">
            General rate: the average of the five grades. {lowest} is the lowest you accept.{block.stale ? ' Scored on an older commit than this one.' : ''}
          </span>
          {block.cells.map(({ label, score, evidence }) => (
            <span key={label} className="grid grid-cols-[3.2rem_1.5rem_minmax(0,1fr)] items-baseline gap-x-2">
              <span className="opacity-70">{label}</span>
              <span className={cn('font-semibold tabular-nums', score === null ? 'opacity-60' : GRADE_TEXT[scoreTone(score)])}>{score ?? 'n/a'}</span>
              <span className="text-[11.5px] opacity-80">{evidence || GRADE_ASKS[label]}</span>
            </span>
          ))}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}
