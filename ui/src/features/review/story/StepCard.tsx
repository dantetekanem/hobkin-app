import type { Review, ReviewNode, StoryStep } from '#shared/review/types.ts'
import { Hob } from '@/avatar/Hob.tsx'
import type { Mood } from '@/avatar/moods.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { LevelBadge } from '../graph/kinds.tsx'

/** A step of the story, as it is told. */
export interface StepContent {
  kind: 'step'
  key: string
  step: StoryStep
  index: number
  total: number
}

/** What is told on the canvas: a step of the story, or a node the reviewer stepped aside to. */
/** A node looked at off the story, with the step to go back to: null in Free Roam, where no step leads. */
export type CardContent = StepContent | { kind: 'node'; key: string; node: ReviewNode; backTo: number | null }

const MOOD: Record<StoryStep['kind'], Mood> = { outcome: 'hello', walk: 'focused', closing: 'happy' }

/**
 * The words of the card beside the whole graph: the opening and the closing, which have no node to be told beside.
 * Every other step is told on its card beside its node (`StepBody.tsx`). Drawn twice: once unseen, to measure it, and
 * once in place. Its type is 14 pixels and up, as the step's card's is.
 */
export function CardBody({ content, review }: { content: StepContent; review: Review }) {
  const { step, index, total } = content

  return (
    <div className="rv-step-body">
      <div className="flex items-center gap-2">
        <Hob mood={MOOD[step.kind]} size={30} stage="var(--rv-float)" still />
        <span className="rv-step-eyebrow">
          Step {index + 1} of {total}
        </span>
        {step.level ? <LevelBadge level={step.level} /> : null}
        {step.specStep ? <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 font-heading text-[14px] font-semibold text-muted-foreground">{step.specStep}</span> : null}
      </div>
      <h2 className="rv-step-claim">{step.title}</h2>
      {step.text ? <p className="rv-step-text">{step.text}</p> : null}

      {step.kind === 'outcome' ? (
        <>
          {review.summary && review.summary !== step.text ? <p className="rv-step-where">{review.summary}</p> : null}
          <p className="font-mono text-[14px] text-muted-foreground">
            {review.change.files} files <span className="text-ok-fg">+{review.change.additions}</span> <span className="text-bad-fg">−{review.change.deletions}</span>
          </p>
          {review.notices.map((notice) => (
            <p key={notice} className="text-[14px] leading-snug text-muted-foreground">
              {notice}
            </p>
          ))}
        </>
      ) : null}

      {step.kind === 'closing' ? (
        <div className="flex flex-col gap-3">
          <Listed title="Out of scope" items={review.spec?.outOfScope ?? []} />
          <Listed title="Risk" items={review.change.risk ? [review.change.risk] : []} />
          <Listed title="Open questions" items={review.spec?.openQuestions ?? []} />
        </div>
      ) : null}

      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd>
          steps
        </span>
        <span className="flex items-center gap-1">
          <Kbd>/</Kbd>
          find
        </span>
      </div>
    </div>
  )
}

function Listed({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null
  return (
    <section>
      <h3 className="rv-step-section-title">{title}</h3>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item} className="relative pl-3.5 text-[14px] leading-snug text-pretty before:absolute before:top-[0.55em] before:left-0.5 before:size-1 before:rounded-full before:bg-border-strong">
            {item}
          </li>
        ))}
      </ul>
    </section>
  )
}
