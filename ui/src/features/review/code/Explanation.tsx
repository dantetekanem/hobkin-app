import type { ReviewNode } from '#shared/review/types.ts'
import { Markdown } from '@/features/chat/markdown.ts'
import { cn } from '@/lib/utils.ts'
import { KIND, LevelBadge, statusOf } from '../graph/kinds.tsx'
import { changeAsk, questionAsk } from '../panel/ask.ts'
import { AskLink } from '../panel/AskLink.tsx'
import { PART_WORDS, type StepUnit } from '../reading/model.ts'

const HEADING = 'font-heading text-[12.5px] font-semibold tracking-[0.06em] text-muted-foreground uppercase'
const TONE = { ok: 'text-ok-fg', bad: 'text-bad-fg', quiet: 'text-muted-foreground' } as const

/** What the code panel says about a unit: the words of `StepUnit`, with what changed and where it sits on the path. */
export type ExplainedUnit = StepUnit & { what?: string; where?: string }

/**
 * The left of the code panel: what the change review says about the unit of the code on the right. Its level and
 * claim, what changed and where, why it has this level, the questions it leaves, what would change its level, and
 * the four facts. Each question and each change can be asked of hobkin at once. A node the review has not rated is
 * told by what the graph knows of it.
 */
export function Explanation({ unit, node, ask }: {
  unit: ExplainedUnit | undefined
  node: ReviewNode | undefined
  /** Sends words to hobkin about this node. Null where hobkin is not connected, as in a sample review. */
  ask: ((text: string) => Promise<boolean>) | null
}) {
  if (!unit) {
    if (node) return <NodeFacts node={node} />
    return <p className="text-[14px] text-muted-foreground">Nothing is said about this code yet.</p>
  }
  return (
    <article className="flex flex-col gap-4" aria-label="What the change review says about this code">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <LevelBadge level={unit.level} critical={unit.critical} size="large" />
          {node ? <span className="min-w-0 truncate font-mono text-[12.5px] text-muted-foreground" title={node.subtitle ?? node.title}>{node.title}</span> : null}
        </div>
        {unit.title ? <h3 className="font-heading text-[17px] leading-[1.3] font-semibold text-pretty [overflow-wrap:anywhere]">{unit.title}</h3> : null}
        {unit.what ? (
          <div className="text-[15px] leading-[1.55] text-pretty [overflow-wrap:anywhere]">
            <Markdown text={unit.what} />
          </div>
        ) : null}
        {unit.where ? <p className="text-[14px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{unit.where}</p> : null}
      </div>
      <Part title="Why this level" items={unit.why.map((why, index) => ({ key: `why${index}`, text: why }))} />
      <Part
        title="Questions for you"
        items={unit.questions.map((question, index) => ({ key: `question${index}`, text: question.text, after: question.why, asks: questionAsk(unit, question) }))}
        ask={ask}
      />
      <Part
        title="What would change it"
        items={unit.wouldChange.map((change, index) => ({ key: `change${index}`, text: change.text, after: `Then ${PART_WORDS[change.level].toLowerCase()}`, asks: changeAsk(unit, change) }))}
        ask={ask}
      />
      {unit.facts.length > 0 ? (
        <section className="flex flex-col gap-1.5" aria-label="The facts">
          <h4 className={HEADING}>The facts</h4>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[14px] leading-snug">
            {unit.facts.map((fact) => (
              <div key={fact.name} className="contents">
                <dt className="text-muted-foreground">{fact.name}</dt>
                <dd className="[overflow-wrap:anywhere]">{fact.text}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </article>
  )
}

interface Item {
  key: string
  text: string
  /** A quieter line under it. */
  after?: string
  /** What its quick link sends to hobkin. */
  asks?: string
}

function Part({ title, items, ask }: { title: string; items: readonly Item[]; ask?: ((text: string) => Promise<boolean>) | null }) {
  if (items.length === 0) return null
  return (
    <section className="flex flex-col gap-1.5" aria-label={title}>
      <h4 className={HEADING}>{title}</h4>
      <ul className="flex flex-col gap-2.5">
        {items.map((item) => (
          // Keyed by its words too, so another unit's item never shows this one's "Asked".
          <li key={`${item.key}:${item.text}`} className="relative flex flex-col gap-1 pl-3.5 text-[14px] leading-[1.45] text-pretty before:absolute before:top-[0.6em] before:left-0.5 before:size-1 before:rounded-full before:bg-border-strong">
            <span className="[overflow-wrap:anywhere]">{item.text}</span>
            {item.after ? <span className="text-[13px] text-muted-foreground [overflow-wrap:anywhere]">{item.after}</span> : null}
            {item.asks && ask !== undefined ? <AskLink words={item.asks} ask={ask} className="mt-0.5 self-start" /> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** A node the change review has not rated: what it is, what goes in and out, its status, and why it needs a look. */
function NodeFacts({ node }: { node: ReviewNode }) {
  const { icon: Icon, label } = KIND[node.kind]
  const status = statusOf(node)
  const io = node.kind !== 'criterion' && node.io && (node.io.in || node.io.out) ? node.io : null
  return (
    <article className="flex flex-col gap-2" aria-label={`About ${node.title}`}>
      <div className="flex items-center gap-1.5">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-label={label} />
        <h3 className="min-w-0 flex-1 truncate font-heading text-[15px] font-semibold" title={node.title}>
          {node.title}
        </h3>
        {node.level ? <LevelBadge level={node.level} /> : null}
        <span className={cn('flex shrink-0 items-center gap-1 font-heading text-[13px] font-semibold', TONE[status.tone])}>
          <status.icon className="size-3.5" aria-hidden="true" />
          {status.text}
        </span>
      </div>
      <p className="text-[14.5px] leading-[1.5] text-pretty">{node.summary}</p>
      {io ? (
        <p className="text-[14px] leading-snug [overflow-wrap:anywhere]">
          <span className="text-muted-foreground">In </span>
          {io.in || 'nothing'}
          <span className="text-muted-foreground"> · Out </span>
          {io.out || 'nothing said'}
        </p>
      ) : null}
      {node.warning ? <p className="text-[14px] leading-snug text-bad-fg">{node.warning}</p> : null}
      <p className="text-[13px] text-muted-foreground">The change review has not rated this code.</p>
    </article>
  )
}
