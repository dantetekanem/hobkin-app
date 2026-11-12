import type { ReviewLevel, ReviewNode } from '#shared/review/types.ts'
import { cn } from '@/lib/utils.ts'
import { KIND, LevelBadge, statusOf } from '../graph/kinds.tsx'

/**
 * What the change review says about the unit this step shows (`packages/change-review`, its `units.json`), in the
 * panel's words. The panel shows it only when it is given.
 */
export interface StepUnit {
  /** The unit's claim, such as "round_money changes its rounding mode for every caller". */
  title?: string
  level: ReviewLevel
  critical?: boolean
  /** The four facts, a few words each: what it does, what proves it, who runs it, what undoes it. */
  facts: { name: string; text: string }[]
  /** Why it has this level, a reason a line. */
  why: string[]
  /** What would change the level, and to which. */
  wouldChange: { text: string; level: ReviewLevel }[]
  questions: { text: string; why?: string }[]
}


const HEADING = 'font-heading text-[12px] font-semibold tracking-[0.06em] text-muted-foreground uppercase'
/** The most nodes told here one by one. A unit shown from the story can focus more. */
const SHOWN = 4

/**
 * The second part of the panel, under the step: what matters for the reviewer here. The change review's unit for the
 * step when there is one, then each node in focus: what it does, what goes in and comes out, its status, and why it
 * needs a look.
 */
export function Matters({ nodes, unit }: { nodes: readonly ReviewNode[]; unit?: StepUnit }) {
  if (nodes.length === 0 && !unit) return null
  return (
    <section aria-label="What matters here" className="flex flex-col gap-3 border-t border-border px-4 py-3.5">
      <h3 className={HEADING}>What matters here</h3>
      {unit ? <UnitFacts unit={unit} /> : null}
      {nodes.slice(0, SHOWN).map((node) => (
        <NodeFacts key={node.id} node={node} />
      ))}
      {nodes.length > SHOWN ? <p className="text-[13px] text-muted-foreground">And {nodes.length - SHOWN} more in focus.</p> : null}
    </section>
  )
}

function UnitFacts({ unit }: { unit: StepUnit }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-background p-3">
      <div className="flex items-center gap-2">
        <LevelBadge level={unit.level} critical={unit.critical} />
        <span className="text-[13px] text-muted-foreground">as the change review rates it</span>
      </div>
      {unit.title ? <p className="font-heading text-[14.5px] leading-snug font-semibold text-pretty">{unit.title}</p> : null}
      {unit.facts.length > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13.5px] leading-snug">
          {unit.facts.map((fact) => (
            <div key={fact.name} className="contents">
              <dt className="text-muted-foreground">{fact.name}</dt>
              <dd className="[overflow-wrap:anywhere]">{fact.text}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <Listed title="Why this level" items={unit.why} />
      <Listed title="What would change it" items={unit.wouldChange.map((entry) => `${entry.text} (${entry.level})`)} />
      <Listed title="Questions" items={unit.questions.map((question) => (question.why ? `${question.text} ${question.why}` : question.text))} />
    </div>
  )
}

function Listed({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      <h4 className={HEADING}>{title}</h4>
      <ul className="flex flex-col gap-1">
        {items.map((item, index) => (
          <li key={index} className="relative pl-3.5 text-[13.5px] leading-snug text-pretty before:absolute before:top-[0.55em] before:left-0.5 before:size-1 before:rounded-full before:bg-border-strong">
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

const TONE = { ok: 'text-ok-fg', bad: 'text-bad-fg', quiet: 'text-muted-foreground' } as const

function NodeFacts({ node }: { node: ReviewNode }) {
  const { icon: Icon, label } = KIND[node.kind]
  const status = statusOf(node)
  const io = node.kind !== 'criterion' && node.io && (node.io.in || node.io.out) ? node.io : null
  const stats = node.stats && node.kind !== 'criterion' && node.kind !== 'context' ? node.stats : null
  return (
    <article className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-label={label} />
        <h4 className="min-w-0 flex-1 truncate font-heading text-[14.5px] font-semibold" title={node.title}>
          {node.title}
        </h4>
        {node.level ? <LevelBadge level={node.level} /> : null}
        <span className={cn('flex shrink-0 items-center gap-1 font-heading text-[12.5px] font-semibold', TONE[status.tone])}>
          <status.icon className="size-3.5" aria-hidden="true" />
          {status.text}
        </span>
      </div>
      {node.subtitle ? (
        <p className="truncate font-mono text-[12px] text-muted-foreground" title={node.subtitle}>
          {node.subtitle}
        </p>
      ) : null}
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
      {stats ? (
        <p className="font-mono text-[12.5px]" aria-label={`${stats.additions} lines added, ${stats.deletions} removed`}>
          <span className="text-ok-fg">+{stats.additions}</span> <span className="text-bad-fg">−{stats.deletions}</span>
        </p>
      ) : null}
    </article>
  )
}
