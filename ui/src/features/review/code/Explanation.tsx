import { Check, MessageCircleQuestion, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import type { ReviewNode } from '#shared/review/types.ts'
import { cn } from '@/lib/utils.ts'
import { KIND, LevelBadge, statusOf } from '../graph/kinds.tsx'
import { changeAsk, questionAsk } from '../panel/ask.ts'
import { RISK_WORDS, type StepUnit } from '../reading/model.ts'

const HEADING = 'font-heading text-[12px] font-semibold tracking-[0.06em] text-muted-foreground uppercase'
const TONE = { ok: 'text-ok-fg', bad: 'text-bad-fg', quiet: 'text-muted-foreground' } as const

/**
 * The left of the code panel: what the change review says about the unit of the code on the right, its level, its
 * claim, the four facts, why it has this level, what would change it and its questions. Each of the last two can be
 * asked of hobkin at once. A node the review has not rated is told by what the graph knows of it.
 */
export function Explanation({ unit, node, ask }: {
  unit: StepUnit | undefined
  node: ReviewNode | undefined
  /** Sends words to hobkin about this node. Null where hobkin is not connected, as in a sample review. */
  ask: ((text: string) => Promise<boolean>) | null
}) {
  if (!unit) {
    if (node) return <NodeFacts node={node} />
    return <p className="text-[14px] text-muted-foreground">Nothing is said about this code yet.</p>
  }
  return (
    <article className="flex flex-col gap-3.5" aria-label="What the change review says about this code">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <LevelBadge level={unit.level} critical={unit.critical} />
          {node ? <span className="min-w-0 truncate font-mono text-[12px] text-muted-foreground" title={node.subtitle ?? node.title}>{node.title}</span> : null}
        </div>
        {unit.title ? <h3 className="font-heading text-[16px] leading-[1.3] font-semibold text-pretty [overflow-wrap:anywhere]">{unit.title}</h3> : null}
      </div>
      {unit.facts.length > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13.5px] leading-snug">
          {unit.facts.map((fact) => (
            <div key={fact.name} className="contents">
              <dt className="text-muted-foreground">{fact.name}</dt>
              <dd className="[overflow-wrap:anywhere]">{fact.text}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <Part title="Why this level" items={unit.why.map((why, index) => ({ key: `why${index}`, text: why }))} />
      <Part
        title="What would change it"
        items={unit.wouldChange.map((change, index) => ({ key: `change${index}`, text: change.text, after: `Then ${RISK_WORDS[change.level].toLowerCase()}`, asks: changeAsk(unit, change) }))}
        ask={ask}
      />
      <Part
        title="Questions for you"
        items={unit.questions.map((question, index) => ({ key: `question${index}`, text: question.text, after: question.why, asks: questionAsk(unit, question) }))}
        ask={ask}
      />
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
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          // Keyed by its words too, so another unit's item never shows this one's "Asked".
          <li key={`${item.key}:${item.text}`} className="relative flex flex-col gap-1 pl-3.5 text-[13.5px] leading-snug text-pretty before:absolute before:top-[0.55em] before:left-0.5 before:size-1 before:rounded-full before:bg-border-strong">
            <span className="[overflow-wrap:anywhere]">{item.text}</span>
            {item.after ? <span className="text-[12.5px] text-muted-foreground [overflow-wrap:anywhere]">{item.after}</span> : null}
            {item.asks && ask !== undefined ? <AskLink words={item.asks} ask={ask} /> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

type AskState = 'idle' | 'sending' | 'asked' | 'failed'
const ASK_ICON = { idle: MessageCircleQuestion, sending: MessageCircleQuestion, asked: Check, failed: TriangleAlert } as const
const ASK_LABEL: Record<AskState, string> = { idle: 'Ask Hobkin', sending: 'Asking…', asked: 'Asked Hobkin', failed: 'Not sent, try again' }

/** A quick way to ask hobkin about one item: it sends at once, and says so. */
function AskLink({ words, ask }: { words: string; ask: ((text: string) => Promise<boolean>) | null }) {
  const [state, setState] = useState<AskState>('idle')
  const Icon = ASK_ICON[state]
  const title = !ask
    ? 'Hobkin is not connected to this sample review'
    : state === 'failed'
      ? 'It did not go. The conversation in the panel says why.'
      : words
  return (
    <button
      type="button"
      data-stop
      disabled={!ask || state === 'sending' || state === 'asked'}
      title={title}
      onClick={async () => {
        if (!ask) return
        setState('sending')
        setState((await ask(words)) ? 'asked' : 'failed')
      }}
      className={cn(
        'rv-ask-link flex h-7 items-center gap-1.5 self-start rounded-full px-2.5 font-heading text-[12.5px] font-semibold transition-[background-color,opacity,transform] duration-[140ms] ease-[var(--ease-out)] active:scale-[0.97] disabled:active:scale-100 [&_svg]:size-3.5',
        state === 'failed' && 'text-bad-fg',
        !ask && 'opacity-50',
      )}
    >
      <Icon aria-hidden="true" />
      {ASK_LABEL[state]}
    </button>
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
        <span className={cn('flex shrink-0 items-center gap-1 font-heading text-[12.5px] font-semibold', TONE[status.tone])}>
          <status.icon className="size-3.5" aria-hidden="true" />
          {status.text}
        </span>
      </div>
      <p className="text-[14px] leading-[1.5] text-pretty">{node.summary}</p>
      {io ? (
        <p className="text-[13px] leading-snug [overflow-wrap:anywhere]">
          <span className="text-muted-foreground">In </span>
          {io.in || 'nothing'}
          <span className="text-muted-foreground"> · Out </span>
          {io.out || 'nothing said'}
        </p>
      ) : null}
      {node.warning ? <p className="text-[13px] leading-snug text-bad-fg">{node.warning}</p> : null}
      <p className="text-[12.5px] text-muted-foreground">The change review has not rated this code.</p>
    </article>
  )
}
