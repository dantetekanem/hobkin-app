import type { Sure } from '../../../../shared/protocol/question.ts'
import { cn } from '@/lib/utils.ts'
import { factsOf, ruleOf, sureWords } from './card.ts'
import type { Choice, Question } from './queue.ts'

/** hobkin's pick, marked on its choice, with how sure hobkin is when the card says. */
export function PickMark({ sure, className }: { sure?: Sure | undefined; className?: string }) {
  return (
    <span className={cn('eyebrow shrink-0 text-sun-fg', className)}>
      hobkin's pick
      {sure ? <span className="text-muted-foreground"> · {sureWords(sure)}</span> : null}
    </span>
  )
}

/**
 * A choice's words, cut to fit with the whole label on hover. A learn card's last choice reads as the rule it keeps,
 * on up to two lines.
 */
export function ChoiceText({ choice, question, className }: { choice: Choice; question: Question; className?: string }) {
  const rule = ruleOf(choice, question)
  if (rule === null) return <span title={choice.label} className={cn('block truncate', className)}>{choice.label}</span>
  return (
    <span title={choice.label} className={cn('line-clamp-2', className)}>
      <span className="eyebrow mr-1.5">Always</span>
      {rule}
    </span>
  )
}

/** What the card says of itself, in one quiet line: whether it can be undone, and what hobkin does if nobody answers. */
export function CardFactsLine({ question, now, className }: { question: Question; now: number; className?: string }) {
  const line = factsOf(question, now).join(' · ')
  if (!line) return null
  return <p title={line} className={cn('truncate text-[13px] leading-snug text-muted-foreground', className)}>{line}</p>
}
