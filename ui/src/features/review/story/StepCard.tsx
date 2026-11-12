import { ArrowLeft, CornerDownLeft } from 'lucide-react'
import type { Review, ReviewNode, StoryStep } from '#shared/review/types.ts'
import { Hob } from '@/avatar/Hob.tsx'
import type { Mood } from '@/avatar/moods.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { KIND, LevelBadge, statusOf } from '../graph/kinds.tsx'

/** What the card beside the focus says: a step of the story, or a node the reviewer stepped aside to. */
export type CardContent =
  | { kind: 'step'; key: string; step: StoryStep; index: number; total: number }
  | { kind: 'node'; key: string; node: ReviewNode; backTo: number }

interface CardActions {
  focusOn(nodeId: string): void
  openCode(): void
  back(): void
}

const MOOD: Record<StoryStep['kind'], Mood> = { outcome: 'hello', walk: 'focused', closing: 'happy' }

/**
 * The words of the card. Drawn twice: once unseen, to measure it, and once in place.
 *
 * `brief` is the card while the steps panel is open. The panel then tells the step in full, so the card
 * keeps only its name beside the focus: a step is never told twice.
 */
export function CardBody({ content, review, actions, canOpenCode, brief = false }: { content: CardContent; review: Review; actions: CardActions; canOpenCode: boolean; brief?: boolean }) {
  if (content.kind === 'node') return <NodeBody node={content.node} backTo={content.backTo} actions={actions} canOpenCode={canOpenCode} />
  const { step, index, total } = content
  const closing = step.kind === 'closing'

  if (brief) {
    return (
      <div className="flex flex-col gap-1.5 px-4 py-3.5">
        <span className="flex items-center gap-2">
          <span className="eyebrow text-[12px]">
            Step {index + 1} of {total}
          </span>
          {step.level ? <LevelBadge level={step.level} /> : null}
        </span>
        <h2 className="font-heading text-[16px] leading-[1.22] font-semibold tracking-[-0.02em] text-balance">{step.title}</h2>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5 p-[18px]">
      <div className="flex items-center gap-2">
        <Hob mood={MOOD[step.kind]} size={30} stage="var(--rv-float)" still />
        <span className="eyebrow text-[12px]">
          Step {index + 1} of {total}
        </span>
        {step.level ? <LevelBadge level={step.level} /> : null}
        {step.specStep ? <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 font-heading text-[12px] font-semibold text-muted-foreground">{step.specStep}</span> : null}
      </div>
      <h2 className="font-heading text-[18px] leading-[1.22] font-semibold tracking-[-0.02em] text-balance">{step.title}</h2>
      {step.text ? <p className="rv-text text-pretty">{step.text}</p> : null}

      {step.kind === 'outcome' ? (
        <>
          {review.summary && review.summary !== step.text ? <p className="rv-text text-pretty text-muted-foreground">{review.summary}</p> : null}
          <p className="font-mono text-[12.5px] text-muted-foreground">
            {review.change.files} files <span className="text-ok-fg">+{review.change.additions}</span> <span className="text-bad-fg">−{review.change.deletions}</span>
          </p>
          {review.notices.map((notice) => (
            <p key={notice} className="text-[13px] leading-snug text-muted-foreground">
              {notice}
            </p>
          ))}
        </>
      ) : null}

      {closing ? (
        <div className="flex flex-col gap-3">
          <Listed title="Out of scope" items={review.spec?.outOfScope ?? []} />
          <Listed title="Risk" items={review.change.risk ? [review.change.risk] : []} />
          <Listed title="Open questions" items={review.spec?.openQuestions ?? []} />
        </div>
      ) : null}

      {step.criteria.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] text-muted-foreground">Serves</span>
          {step.criteria.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => actions.focusOn(id)}
              title={review.nodes.find((node) => node.id === id)?.summary}
              className="rounded-full bg-[color-mix(in_oklab,var(--hb-sun)_22%,var(--rv-float))] px-2 py-0.5 font-heading text-[12.5px] font-semibold text-sun-fg transition-transform duration-[140ms] ease-[var(--ease-out)] active:scale-[0.97]"
            >
              {id}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd>
          steps
        </span>
        {canOpenCode ? (
          <span className="flex items-center gap-1">
            <Kbd>
              <CornerDownLeft />
            </Kbd>
            code
          </span>
        ) : null}
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
      <h3 className="eyebrow mb-1">{title}</h3>
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

function NodeBody({ node, backTo, actions, canOpenCode }: { node: ReviewNode; backTo: number; actions: CardActions; canOpenCode: boolean }) {
  const { icon: Icon, label } = KIND[node.kind]
  const status = statusOf(node)

  return (
    <div className="flex flex-col gap-2.5 p-[18px]">
      <div className="flex items-center gap-1.5">
        <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="eyebrow text-[12px]">{label}</span>
        {node.level ? <LevelBadge level={node.level} /> : null}
        <span className="ml-auto flex items-center gap-1 font-heading text-[12.5px] font-semibold text-muted-foreground data-[tone=bad]:text-bad-fg data-[tone=ok]:text-ok-fg" data-tone={status.tone}>
          <status.icon className="size-3" aria-hidden="true" />
          {status.text}
        </span>
      </div>
      <h2 className="font-heading text-[17px] leading-[1.24] font-semibold tracking-[-0.02em] [overflow-wrap:anywhere]">{node.title}</h2>
      {node.subtitle ? <p className="font-mono text-[12.5px] [overflow-wrap:anywhere] text-muted-foreground">{node.subtitle}</p> : null}
      <p className="rv-text text-pretty">{node.summary}</p>
      {node.warning ? <p className="text-[13.5px] leading-snug text-bad-fg">{node.warning}</p> : null}
      {node.proof && !node.warning ? <p className="font-mono text-[12.5px] leading-relaxed [overflow-wrap:anywhere] text-muted-foreground">{node.proof}</p> : null}
      {node.stats && node.kind !== 'criterion' && node.kind !== 'context' ? (
        <p className="font-mono text-[12.5px]">
          <span className="text-ok-fg">+{node.stats.additions}</span> <span className="text-bad-fg">−{node.stats.deletions}</span>
        </p>
      ) : null}
      <div className="mt-1 flex flex-wrap gap-2">
        {canOpenCode ? (
          <Button size="sm" onClick={actions.openCode}>
            Open code
            <Kbd className="bg-primary-foreground/15 text-primary-foreground">
              <CornerDownLeft />
            </Kbd>
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={actions.back}>
          <ArrowLeft />
          Back to step {backTo + 1}
          <Kbd>B</Kbd>
        </Button>
      </div>
    </div>
  )
}
