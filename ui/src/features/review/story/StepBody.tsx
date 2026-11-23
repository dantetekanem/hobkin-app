import { ArrowLeft, Check, ChevronDown, ChevronRight, ChevronUp, CornerDownLeft, LoaderCircle, Minus, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import { Fragment, useMemo, useState, type ReactNode } from 'react'
import type { Unit } from '#shared/review/assessment.ts'
import type { ReviewNode } from '#shared/review/types.ts'
import { Kbd } from '@/components/ui/kbd.tsx'
import { cn } from '@/lib/utils.ts'
import type { Tone } from '../../proofs/run/run-view.ts'
import { isLineCount } from '../graph/arrange.ts'
import { KIND, LevelBadge, statusOf } from '../graph/kinds.tsx'
import { isChangedCode, originWords, trailOf, type Trail } from '../graph/trail.ts'
import { AskLink } from '../panel/AskLink.tsx'
import { questionAsk } from '../panel/ask.ts'
import { useReduced, useSessionStore } from '../state/context.tsx'
import type { ModelLine } from './node-models.ts'
import { firstTests, NO_TEST, noTestWords, splitTests, TEST_HEADINGS, testsFor, type TestsGraph } from './node-tests.ts'
import type { CardContent } from './StepCard.tsx'
import { useModelLines } from './use-model-checks.ts'
import { isBlindNote, plainSentences, proofWords, reachWords, tldrOf, watchWords } from './words.ts'

/**
 * What the card needs to know of the graph: the review's wires, what each test covers, the cards of folded tests, every
 * node, and the review's own nodes in its order, for the way in.
 */
export interface CardGraph extends TestsGraph {
  covers: Readonly<Record<string, string>>
  nodes: readonly ReviewNode[]
}

export interface CardActions {
  openCode(): void
  back(): void
  /** Shows a test's code in the code panel, and leaves the focus where it is. */
  showTest(id: string): void
  /** Moves the focus to a node, opening its group when it is folded. B comes back. */
  goTo(id: string): void
}

interface BodyProps {
  content: CardContent
  /** The unit the step tells, or the node's, from the change review. */
  unit: Unit | undefined
  /** What to say in place of a rating (`ratingGap`), or null when the change review has units. */
  gap: string | null
  graph: CardGraph
  /** Sends words to hobkin. Null where hobkin is not connected, as in a sample review. */
  ask: ((text: string) => Promise<boolean>) | null
  actions: CardActions
  canOpenCode: boolean
  /** While the code panel is open it explains the unit beside its code, so the card keeps only its name and its tests. */
  brief: boolean
  /** The node whose code the panel shows, or null when it is closed. */
  code: string | null
}

/** The most of a list "Read more" shows: each part is short. */
const MOST = 3
/** The most tests the card lists before the rest wait behind "Show N more". */
const TESTS_SHOWN = 4

/**
 * The step told on its card beside its node (the user, 2026-11-12: "that step must be a TLDR of 1 paragraph, TOP. the
 * rest must be in a 'Read More'"). On top, its level, its title, where changed code is run from, and one short
 * paragraph. Under them, always, the tests of what is in focus (the user, 2026-11-14), so every move shows them in the
 * same place. "Read more", closed at first, holds the rest, each part short: where the unit says it sits, why it is
 * rated so, its questions with a way to ask hobkin, how it is proven, who it reaches, what to watch and what it holds.
 * Open code is always at the bottom. A node the reviewer went to off the path is told the same way, with the way back.
 * Drawn twice: once unseen, to measure it.
 */
export function StepBody({ content, unit, gap, graph, ask, actions, canOpenCode, brief, code }: BodyProps) {
  const [more, setMore] = useState(false)
  const node = content.kind === 'node' ? content.node : undefined
  const focus = content.kind === 'step' ? content.step.focus : [content.node.id]
  const changed = focus.find((id) => isChangedCode(graph.nodeOf.get(id)))
  const trail = useMemo(() => (changed ? trailOf(graph, changed) : null), [changed, graph])
  const level = unit?.level ?? (content.kind === 'step' ? content.step.level : content.node.level)
  const tldr = tldrOf(content.kind === 'step' ? content.step : { text: isLineCount(content.node.summary) ? '' : content.node.summary }, unit)
  const details = unit ? unitDetails(unit, ask) : nodeDetails(content, graph)
  const models = useModelLines(focus)

  return (
    <div className="rv-step-body">
      <div className="rv-step-eyebrow">
        <span>{content.kind === 'step' ? `Step ${content.index + 1} of ${content.total}` : node ? `${KIND[node.kind].label} · ${statusOf(node).text}` : null}</span>
        {level ? <LevelBadge level={level} critical={unit?.critical} /> : null}
      </div>
      <h3 className="rv-step-claim">{content.kind === 'step' ? content.step.title : content.node.title}</h3>
      {trail ? <From trail={trail} nodeOf={graph.nodeOf} onGo={actions.goTo} /> : null}
      {brief ? null : (
        <>
          {tldr ? <p className="rv-step-text">{tldr}</p> : null}
          {gap ? <p className="rv-step-quiet">{gap}</p> : null}
        </>
      )}
      {/* In the same place in the tree with the code open or closed, so its list stays as the reviewer left it. */}
      <Tests focus={focus} graph={graph} unit={unit} models={models} code={code} onShow={actions.showTest} />
      {brief ? null : (
        <>
          {details.length > 0 ? (
            <>
              <button type="button" className="rv-step-more" aria-expanded={more} onClick={() => setMore((open) => !open)}>
                {more ? 'Read less' : 'Read more'}
                {more ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
              </button>
              {more ? <div className="rv-step-details">{details}</div> : null}
            </>
          ) : null}
          <div className="rv-step-actions">
            {canOpenCode ? (
              <button type="button" className="rv-step-action" onClick={actions.openCode}>
                Open code
                <Kbd>
                  <CornerDownLeft />
                </Kbd>
              </button>
            ) : null}
            {content.kind === 'node' && content.backTo != null ? (
              <button type="button" className="rv-step-action" onClick={actions.back}>
                <ArrowLeft aria-hidden="true" />
                Back to step {content.backTo + 1}
                <Kbd>B</Kbd>
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Where changed code is run from (spec 055), always in this place under the title and always two lines tall, so nothing
 * under it moves: the origin with its kind and how many other ways in there are, then each call on the way to the
 * code's own caller, each a press that goes to it (B comes back); or why there is none. A long way shortens its names,
 * each whole in its tooltip.
 */
function From({ trail, nodeOf, onGo }: { trail: Trail; nodeOf: CardGraph['nodeOf']; onGo: (id: string) => void }) {
  const hop = (id: string, at: number) => {
    const origin = at === 0 ? trail.origin : null
    const name = origin?.label ?? nodeOf.get(id)?.title ?? id
    const words = origin ? `${originWords(origin.kind)} ${name}` : name
    const parts = (
      <>
        {origin ? <span className="rv-step-hop-kind">{originWords(origin.kind)}</span> : null}
        {name}
      </>
    )
    // A hop the review has no node for is told, but there is nothing to go to.
    return nodeOf.has(id) ? (
      <button type="button" className="rv-step-hop pressable" title={`${words}. Go to it.`} onClick={() => onGo(id)}>
        {parts}
      </button>
    ) : (
      <span className="rv-step-hop" title={words}>
        {parts}
      </span>
    )
  }
  const [origin, ...calls] = trail.chain
  return (
    <div className="rv-step-from" aria-label="Where it is run from">
      <span className="rv-step-from-label">From</span>
      {trail.why != null ? (
        <span className="rv-step-from-why" title={trail.why}>
          {trail.why}
        </span>
      ) : origin == null ? (
        <span className="rv-step-from-line">
          <span className="rv-step-from-why">
            <span className="rv-step-hop-kind">{originWords(trail.origin!.kind)}</span>
            It starts here.
          </span>
        </span>
      ) : (
        <>
          <span className="rv-step-from-line">
            {hop(origin, 0)}
            {trail.more > 0 ? (
              <span className="rv-step-from-more">
                +{trail.more} more {trail.more === 1 ? 'way' : 'ways'} in
              </span>
            ) : null}
          </span>
          <span className="rv-step-from-line">
            {calls.map((id, at) => (
              <Fragment key={id}>
                <ChevronRight className="rv-step-from-sep" aria-hidden="true" />
                {hop(id, at + 1)}
              </Fragment>
            ))}
          </span>
        </>
      )}
    </div>
  )
}

/**
 * The tests of what is in focus, under three headings always there (spec 055): There before, Added or edited, and
 * Removed, an empty one saying None. Each by name and result, a failed one first, and a press on one shows its code
 * without leaving the node. Past four, the rest wait behind "Show N more", each heading keeping one of its own while
 * there is room. A model in focus says what TLC said of it at the reviewed head, under them. When the change review
 * names what proves it and no test of the review covers it, the card says that.
 */
function Tests({ focus, graph, unit, models, code, onShow }: { focus: readonly string[]; graph: TestsGraph; unit: Unit | undefined; models: readonly ModelLine[]; code: string | null; onShow: (id: string) => void }) {
  const [all, setAll] = useState(false)
  const tests = testsFor(focus, graph)
  const split = splitTests(tests)
  // One test behind a button would take the room of its own row: the list folds only when it hides two or more.
  const folds = tests.length > TESTS_SHOWN + 1
  const shown = folds && !all ? firstTests(split, TESTS_SHOWN) : null
  const proven = tests.length === 0 && models.length === 0 ? noTestWords(unit) : NO_TEST
  return (
    <section className="rv-step-tests" aria-label="Tests">
      <h4 className="rv-step-section-title">Tests</h4>
      {TEST_HEADINGS.map(([key, words]) => {
        const listed = split[key]
        const rows = shown ? listed.filter((test) => shown.has(test.id)) : listed
        return (
          <div key={key} className="rv-step-tests-group" aria-label={words}>
            <h5 className="rv-step-tests-heading">
              <span>{words}</span>
              <span className="rv-step-tests-count">{listed.length === 0 ? 'None' : listed.length}</span>
            </h5>
            {rows.length > 0 ? (
              <ul className="rv-step-tests-rows">
                {rows.map((test) => {
                  const result = statusOf(test)
                  return (
                    <li key={test.id}>
                      <button type="button" className="rv-tests-row" data-current={code === test.id} title={test.summary} onClick={() => onShow(test.id)}>
                        <result.icon className="rv-tests-icon" data-tone={result.tone} aria-hidden="true" />
                        <span className="rv-tests-name">{test.title}</span>
                        <span className="rv-tests-result" data-tone={result.tone}>
                          {result.text}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
        )
      })}
      {proven !== NO_TEST ? <p className="rv-step-quiet">{proven}</p> : null}
      {folds ? (
        <button type="button" className="rv-step-more" aria-expanded={all} onClick={() => setAll((open) => !open)}>
          {all ? 'Show fewer' : `Show ${tests.length - TESTS_SHOWN} more`}
          {all ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </button>
      ) : null}
      {models.length > 0 ? (
        <ul className="rv-step-tests-rows" aria-label="Model checks">
          {models.map((model) => (
            <li key={model.spec}>
              <ModelRow model={model} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

const MODEL_ICON: Readonly<Record<Tone, LucideIcon>> = { ok: Check, bad: X, warn: TriangleAlert, live: LoaderCircle, quiet: Minus }

/**
 * One model's check on one line, which keeps its height as the check runs and ends. With a run, a press opens it beside
 * the review (spec 053), and closing it there gives the keyboard back here.
 */
function ModelRow({ model }: { model: ModelLine }) {
  const store = useSessionStore()
  const reduced = useReduced()
  const Icon = MODEL_ICON[model.tone]
  const parts = (
    <>
      <Icon className={cn('rv-tests-icon', model.tone === 'live' && !reduced && 'animate-spin')} data-tone={model.tone} aria-hidden="true" />
      <span className="rv-tests-name">{model.text}</span>
      <span className="rv-tests-result">{model.run ? 'Open run' : ''}</span>
    </>
  )
  if (!model.run) {
    return (
      <div className="rv-tests-row" data-model="" title={`${model.text}. hobkin has no check of this model at the reviewed commit.`}>
        {parts}
      </div>
    )
  }
  const run = model.run
  const from = `card:${model.spec}`
  return (
    <button type="button" className="rv-tests-row" data-model="" data-proof-from={from} title={`${model.text}. hobkin ran this check itself. Opens it beside the review.`} onClick={() => store.getState().openProof(run, from)}>
      {parts}
    </button>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rv-step-section" aria-label={title}>
      <h4>{title}</h4>
      {children}
    </section>
  )
}

/** One line of words, the whole of them in its tooltip. */
const Line = ({ text, className = 'rv-step-line' }: { text: string; className?: string }) => (
  <p className={className} title={text}>
    {text}
  </p>
)

/** What "Read more" holds for a step the change review told, each part short. The way in is on the card already. */
function unitDetails(unit: Unit, ask: BodyProps['ask']): ReactNode[] {
  const where = plainSentences(unit.where).join(' ')
  const why = unit.why_level.map((reason) => plainSentences(reason).join(' ')).filter(Boolean).slice(0, MOST)
  const questions = unit.questions.filter((question) => !isBlindNote(question))
  const blind = unit.questions.filter(isBlindNote)
  const watch = watchWords(unit).slice(0, MOST)
  return [
    where ? (
      <p key="where" className="rv-step-where">
        {where}
      </p>
    ) : null,
    why.length > 0 ? (
      <Section key="why" title={unit.level === 'safe' ? 'Why it is safe' : `Why it is ${unit.level === 'high' ? 'high' : 'mid'} risk`}>
        <ul className="rv-step-list">
          {why.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </Section>
    ) : null,
    questions.length > 0 ? (
      <Section key="questions" title="Questions for you">
        <ul className="rv-step-list">
          {questions.map((question) => (
            // Keyed by its words, so another step's question never shows this one's "Asked".
            <li key={question.text} className="rv-step-question">
              <span>{question.text}</span>
              <AskLink words={questionAsk(unit, question)} ask={ask} />
            </li>
          ))}
        </ul>
      </Section>
    ) : null,
    ...blind.map((note) => <Line key={note.text} text={`Blind check: ${note.text}`} className="rv-step-line rv-step-quiet" />),
    <Section key="proof" title="Proof">
      <p className="rv-step-fact">{proofWords(unit.facts)}</p>
      <p className="rv-step-fact">{reachWords(unit.facts)}</p>
    </Section>,
    watch.length > 0 ? (
      <Section key="watch" title="What to watch">
        <ul className="rv-step-list">
          {watch.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Section>
    ) : null,
    unit.members && unit.members.length > 1 ? (
      <Section key="members" title="What it holds">
        <ul className="rv-step-list">
          {unit.members.slice(0, MOST + 2).map((member) => (
            <li key={member.name}>
              <code>{member.name}</code> {member.what}
            </li>
          ))}
        </ul>
      </Section>
    ) : null,
  ].filter((part) => part != null)
}

/**
 * What "Read more" holds for a step or a node the change review has not told: what the graph knows of its nodes. Its
 * tests and its way in are on the card already.
 */
function nodeDetails(content: CardContent, graph: CardGraph): ReactNode[] {
  const nodes = (content.kind === 'step' ? content.step.focus : [content.node.id]).map((id) => graph.nodeOf.get(id)).filter((node): node is ReviewNode => node != null)
  const covered = nodes.filter((node) => node.kind === 'test' && graph.covers[node.id]).map((node) => graph.nodeOf.get(graph.covers[node.id]!)?.title)
  const io = nodes.find((node) => node.io && (node.io.in || node.io.out))?.io
  return [
    covered.length > 0 ? <p key="covers" className="rv-step-fact">Covers {covered.join(', ')}.</p> : null,
    io ? (
      <p key="io" className="rv-step-fact">
        In: {io.in || 'nothing'}. Out: {io.out || 'nothing said'}.
      </p>
    ) : null,
    ...nodes.map((node) => (node.warning ? <p key={`${node.id}:warning`} className="rv-step-fact" data-tone="bad">{node.warning}</p> : null)),
    ...nodes.map((node) => (node.unwired ? <Line key={`${node.id}:alone`} text={`Not linked: ${node.unwired}`} className="rv-step-line rv-step-quiet" /> : null)),
  ].filter((part) => part != null)
}
