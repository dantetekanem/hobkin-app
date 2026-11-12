import { ArrowLeft, CornerDownLeft } from 'lucide-react'
import type { Unit } from '#shared/review/assessment.ts'
import type { ReviewNode } from '#shared/review/types.ts'
import { Kbd } from '@/components/ui/kbd.tsx'
import { isLineCount, testsInWords, type TestGroup } from '../graph/arrange.ts'
import { KIND, LevelBadge, statusOf } from '../graph/kinds.tsx'
import { AskLink } from '../panel/AskLink.tsx'
import { questionAsk } from '../panel/ask.ts'
import type { CardContent } from './StepCard.tsx'
import { exposureWords, proofWords, testsOf, testsWords, undoWords, watchWords } from './words.ts'

/** What the card needs to know of the graph: what each test covers, the cards of folded tests, and every node by id. */
export interface CardGraph {
  covers: Readonly<Record<string, string>>
  groups: Readonly<Record<string, TestGroup>>
  nodeOf: ReadonlyMap<string, ReviewNode>
}

export interface CardActions {
  openCode(): void
  back(): void
}

interface BodyProps {
  content: CardContent
  /** The unit the step tells, or the node's, from the change review. */
  unit: Unit | undefined
  /** Whether a change review has rated this change at all. */
  rated: boolean
  graph: CardGraph
  /** Sends words to hobkin. Null where hobkin is not connected, as in a sample review. */
  ask: ((text: string) => Promise<boolean>) | null
  actions: CardActions
  canOpenCode: boolean
  /** While the code panel is open it explains the unit beside its code, so the card keeps only its name. */
  brief: boolean
}

/**
 * The step told on its card beside its node (the user, 2026-11-12): its number and level, its claim, where it sits on
 * the path, what changed, why it is rated so, the questions it leaves, how it is proven, who it reaches and how it is
 * undone, what to watch, and the way to its code. A step the change review has not told yet says so. A node the
 * reviewer went to off the path is told the same way, with the way back. Drawn twice: once unseen, to measure it.
 */
export function StepBody({ content, unit, rated, graph, ask, actions, canOpenCode, brief }: BodyProps) {
  const node = content.kind === 'node' ? content.node : undefined
  const focus = content.kind === 'step' ? content.step.focus : [content.node.id]
  const level = unit?.level ?? (content.kind === 'step' ? content.step.level : content.node.level)
  // The way a request takes to the changed code it tells, in one line, the whole way in its tooltip.
  const way = focus.map((id) => graph.nodeOf.get(id)?.lifecycle).find((lifecycle) => lifecycle?.role === 'changed' && lifecycle.path)?.path
  return (
    <div className="rv-step-body">
      <div className="rv-step-eyebrow">
        <span>{content.kind === 'step' ? `Step ${content.index + 1} of ${content.total}` : node ? `${KIND[node.kind].label} · ${statusOf(node).text}` : null}</span>
        {level ? <LevelBadge level={level} critical={unit?.critical} /> : null}
      </div>
      <h3 className="rv-step-claim">{unit?.title ?? (content.kind === 'step' ? content.step.title : content.node.title)}</h3>
      {way ? (
        <p className="rv-step-way" title={way}>
          {way}
        </p>
      ) : null}
      {brief ? null : unit ? (
        <UnitParts unit={unit} focus={focus} graph={graph} ask={ask} />
      ) : (
        <Unrated content={content} rated={rated} graph={graph} />
      )}
      {brief ? null : (
        <div className="rv-step-actions">
          {canOpenCode ? (
            <button type="button" className="rv-step-action" onClick={actions.openCode}>
              Open code
              <Kbd>
                <CornerDownLeft />
              </Kbd>
            </button>
          ) : null}
          {content.kind === 'node' ? (
            <button type="button" className="rv-step-action" onClick={actions.back}>
              <ArrowLeft aria-hidden="true" />
              Back to step {content.backTo + 1}
              <Kbd>B</Kbd>
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rv-step-section" aria-label={title}>
      <h4>{title}</h4>
      {children}
    </section>
  )
}

function UnitParts({ unit, focus, graph, ask }: { unit: Unit; focus: readonly string[]; graph: CardGraph; ask: BodyProps['ask'] }) {
  const tests = testsOf(focus, graph.covers, graph.nodeOf)
  const watch = watchWords(unit)
  return (
    <>
      {unit.where ? <p className="rv-step-where">{unit.where}</p> : null}
      {unit.what ? <p className="rv-step-text">{unit.what}</p> : null}
      {unit.why_level.length > 0 ? (
        <Section title={unit.level === 'safe' ? 'Why it is safe' : `Why it is ${unit.level === 'high' ? 'high' : 'mid'} risk`}>
          <ul className="rv-step-list">
            {unit.why_level.map((why) => (
              <li key={why}>{why}</li>
            ))}
          </ul>
        </Section>
      ) : null}
      {unit.questions.length > 0 ? (
        <Section title="Questions for you">
          <ul className="rv-step-list">
            {unit.questions.map((question) => (
              // Keyed by its words, so another step's question never shows this one's "Asked".
              <li key={question.text} className="rv-step-question">
                <span>{question.text}</span>
                {question.why ? <span className="rv-step-quiet">{question.why}</span> : null}
                <AskLink words={questionAsk(unit, question)} ask={ask} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title="Proof">
        <p className="rv-step-fact">{proofWords(unit.facts)}</p>
        {tests ? (
          <p className="rv-step-fact" data-tone={tests.failed > 0 ? 'bad' : undefined}>
            {testsWords(tests)}
            {tests.failing.length > 0 ? ` Failed: ${tests.failing.join('; ')}.` : ''}
          </p>
        ) : null}
      </Section>
      <Section title="Who it reaches, and the way back">
        <p className="rv-step-fact">{exposureWords(unit.facts)}</p>
        <p className="rv-step-fact">{undoWords(unit.facts)}</p>
      </Section>
      {watch.length > 0 ? (
        <Section title="What to watch">
          <ul className="rv-step-list">
            {watch.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Section>
      ) : null}
      {unit.members && unit.members.length > 1 ? (
        <Section title="What it holds">
          <ul className="rv-step-list">
            {unit.members.map((member) => (
              <li key={member.name}>
                <code>{member.name}</code> {member.what}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  )
}

/** A step or a node the change review has not told: its own words, what its tests did, and that no review has rated it. */
function Unrated({ content, rated, graph }: { content: CardContent; rated: boolean; graph: CardGraph }) {
  const nodes = (content.kind === 'step' ? content.step.focus : [content.node.id]).map((id) => graph.nodeOf.get(id)).filter((node): node is ReviewNode => node != null)
  // A count of lines is never all a card says: it says what the graph knows of the code, and where to read the rest.
  const words = content.kind === 'step' ? content.step.text : content.node.summary
  const text = words && !isLineCount(words) ? words : null
  const stats = nodes.map((node) => node.stats).filter((entry) => entry != null)
  const lines = stats.reduce((sum, entry) => ({ additions: sum.additions + entry.additions, deletions: sum.deletions + entry.deletions }), { additions: 0, deletions: 0 })
  const cards = nodes.map((node) => graph.groups[node.id]).filter((group): group is TestGroup => group != null)
  const tests = cards.length === 0 ? testsOf(nodes.map((node) => node.id), graph.covers, graph.nodeOf) : null
  const covered = nodes.filter((node) => node.kind === 'test' && graph.covers[node.id]).map((node) => graph.nodeOf.get(graph.covers[node.id]!)?.title)
  const io = nodes.find((node) => node.io && (node.io.in || node.io.out))?.io
  return (
    <>
      {text && !(cards.length > 0 && content.kind === 'node') ? <p className="rv-step-text">{text}</p> : null}
      {content.kind === 'node' && cards.length > 0 ? (
        <p className="rv-step-text">{testsInWords(cards.flatMap((card) => card.tests).map((id) => graph.nodeOf.get(id)!).filter(Boolean))}</p>
      ) : null}
      {covered.length > 0 ? <p className="rv-step-fact">Covers {covered.join(', ')}.</p> : null}
      {tests ? <p className="rv-step-fact" data-tone={tests.failed > 0 ? 'bad' : undefined}>{testsWords(tests)}</p> : null}
      {io ? (
        <p className="rv-step-fact">
          In: {io.in || 'nothing'}. Out: {io.out || 'nothing said'}.
        </p>
      ) : null}
      {nodes.map((node) => (node.warning ? <p key={node.id} className="rv-step-fact" data-tone="bad">{node.warning}</p> : null))}
      {nodes.map((node) => (node.unwired ? <p key={`${node.id}:alone`} className="rv-step-quiet">Not linked: {node.unwired}</p> : null))}
      {!text && stats.length > 0 ? (
        <p className="rv-step-quiet">
          {lines.additions} {lines.additions === 1 ? 'line' : 'lines'} added and {lines.deletions} removed: the code says what they do.
        </p>
      ) : null}
      {rated ? null : <p className="rv-step-quiet">No change review yet.</p>}
    </>
  )
}
