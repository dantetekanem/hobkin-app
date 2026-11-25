import { floor } from './floor.ts'
import { EVIDENCE_KINDS, LEVELS } from './types.ts'
import type { Finding, Floor, FloorInput, Level, NodeLevel, Question, ReviewNode, RiskEvent, Watch } from './types.ts'

const RANK: Record<Level, number> = { safe: 0, mid: 1, high: 2 }
const DIRECTIONS = ['up', 'down', 'sideways', 'time']
const ASPECTS = ['behaviour', 'performance', 'failure']
const CONFIDENCES = ['low', 'medium', 'high']
const SUGGEST_KINDS = ['add-flag', 'resolve-callers', 'restructure', 'add-test']
const MIN_EVIDENCE = 20

export interface RejectedEvent {
  event: RiskEvent
  reason: string
}

export interface Violation {
  node: string
  text: string
}

/** A node's level before any event: the floor, with its reason. */
export function nodeLevelOf(f: Floor): NodeLevel {
  return { floor: f.level, rule: f.rule, current: f.level, why: [f.why], if: [] }
}

const floorOf = (node: ReviewNode): Floor => {
  const input: FloorInput = {
    ...node.extras,
    effect: node.facts.effect.value,
    proof: node.facts.proof.value,
    exposure: node.facts.exposure.value,
    undo: node.facts.undo.value,
  }
  return floor(input)
}

const oneOf = (list: readonly string[], value: unknown) => typeof value === 'string' && list.includes(value)

/** A test that fails or hangs at head is a result, not an argument: the level it sets holds like a floor. */
const fromFailingTest = (event: RiskEvent) => event.by === 'proof'

/** Why an event is not valid on its own (FOUNDATION 5.2 and the risk-event schema), or null. */
function malformed(event: RiskEvent): string | null {
  if (typeof event.evidence !== 'string' || event.evidence.trim().length < MIN_EVIDENCE) return `evidence is shorter than ${MIN_EVIDENCE} characters`
  if (event.origin !== undefined && !oneOf(['introduced', 'worsened', 'pre-existing', 'unknown'], event.origin)) return 'bad origin'
  if (event.origin === 'pre-existing' && (typeof event.comparison !== 'string' || event.comparison.trim().length < MIN_EVIDENCE)) return 'pre-existing needs base/head comparison evidence'
  if (!oneOf(LEVELS, event.level)) return `bad level: ${String(event.level)}`
  if (!oneOf(DIRECTIONS, event.direction)) return `bad direction: ${String(event.direction)}`
  if (!oneOf(ASPECTS, event.aspect)) return `bad aspect: ${String(event.aspect)}`
  if (event.evidence_kind !== undefined && !oneOf(EVIDENCE_KINDS, event.evidence_kind)) return `bad evidence_kind: ${String(event.evidence_kind)}`
  if (event.confidence !== undefined && !oneOf(CONFIDENCES, event.confidence)) return `bad confidence: ${String(event.confidence)}`
  if (event.suggest !== undefined) {
    if (!oneOf(LEVELS, event.suggest.to) || typeof event.suggest.text !== 'string') return 'bad suggest'
    if (event.suggest.kind !== undefined && !oneOf(SUGGEST_KINDS, event.suggest.kind)) return `bad suggest kind: ${String(event.suggest.kind)}`
  }
  if (event.critical === true && event.level !== 'high') return 'critical is only valid with level high'
  return null
}

export type RiskSource = (path: string, side: 'base' | 'head') => string | null

/** A model claim is not a measured failure. Require a checkable path through both revisions. */
function unsupported(event: RiskEvent, node: ReviewNode, source?: RiskSource): string | null {
  if (event.by !== 'model' || event.origin === 'pre-existing') return null
  if (event.level !== 'high') return null
  const grounding = event.grounding
  if (!['introduced', 'worsened'].includes(event.origin ?? '') || !event.comparison?.trim()) return 'a model regression needs base/head attribution; head-only impact is unknown'
  if (!grounding || !['code-path', 'regression-test'].includes(grounding.kind) || !grounding.trigger?.trim()) return 'a model regression needs a reachable trigger and source witnesses, not conjecture or model-only evidence'
  const trace = grounding.trace ?? []
  if (!trace.some((site) => site.side === 'base' && site.role === 'change') || !trace.some((site) => site.side === 'head' && site.role === 'change') || !trace.some((site) => site.side === 'head' && site.role === 'consumer')) return 'a model regression needs source witnesses for the consumer and the change at base and head'
  if (!trace.some((site) => site.role === 'change' && site.path === node.path)) return 'source witnesses do not identify this changed part'
  for (const site of trace) {
    const lines = source?.(site.path, site.side)?.split('\n')
    if (!lines || !site.quote.trim() || !lines.slice(site.line - 1, site.line - 1 + site.quote.split('\n').length).join('\n').includes(site.quote.trim())) return `source witness does not match ${site.side}:${site.path}:${site.line}`
  }
  const consumers = trace.filter((site) => site.role === 'consumer' && site.side === 'head')
  const bound = consumers.some((witness) =>
    node.callSites?.some((site) => site.resolution === 'exact' && site.path === witness.path && site.line === witness.line && (!site.text || witness.quote.includes(site.text.trim())))
    || (witness.path === node.path && witness.line >= node.lines[0] && witness.line <= node.lines[1] && node.runs_from?.found === 'origins' && node.runs_from.origins.some((origin) => origin.exact && origin.hops === 0)))
  if (!bound) return 'source witnesses need an exact consumer binding; name-only or unresolved sites do not establish reachability'
  return null
}

/** Adds a value to a list unless an equal one is there. */
function addOnce<T>(list: T[], item: T, key: (item: T) => string) {
  if (!list.some((have) => key(have) === key(item))) list.push(item)
}

const findingKey = (f: Finding) => `${f.rule}|${f.text}|${(f.lines ?? []).join(',')}|${f.by}`
const questionKey = (q: Question) => `${q.text}|${q.why}`

function mergeWatch(into: Watch | null, from: Watch | undefined): Watch | null {
  if (!from) return into
  const watch: Watch = into ?? { signals: [], gaps: [] }
  for (const signal of from.signals ?? []) addOnce(watch.signals, signal, (s) => `${s.kind}|${s.name}|${s.at}`)
  for (const gap of from.gaps ?? []) addOnce(watch.gaps, gap, (g) => g)
  if (from.undo) watch.undo = from.undo
  return watch
}

/**
 * Applies the risk events to the nodes. Every node starts again from its floor, so applying the same events twice, or
 * to a graph that already has them, gives the same graph (FOUNDATION 14). Model raises need source witnesses. A lowering needs an
 * evidence kind, nothing lowers a node below its floor while that floor is rule 5 or 6 (no test showed it, or direct
 * tests alone: that mid never becomes safe on an argument), nothing lowers a break that search or a test run found
 * (rule 1): an argument is not a search result or a test run. Events that break a rule are returned in `rejected` with the reason and change
 * nothing.
 */
export function applyRiskEvents(nodes: readonly ReviewNode[], events: readonly RiskEvent[], source?: RiskSource): { nodes: ReviewNode[]; rejected: RejectedEvent[] } {
  const rejected: RejectedEvent[] = []
  const next = new Map<string, ReviewNode>()
  const floors = new Map<string, Floor>()
  /** The level a failing or hanging test set on a node: later events can raise it, never lower it. */
  const held = new Map<string, Level>()

  for (const node of nodes) {
    const f = floorOf(node)
    const copy = structuredClone(node)
    copy.level = nodeLevelOf(f)
    copy.critical = f.critical
    if (f.finding) addOnce(copy.findings, f.finding, findingKey)
    next.set(node.id, copy)
    floors.set(node.id, f)
  }

  for (const event of events) {
    const node = next.get(event.node)
    const f = floors.get(event.node)
    if (!node || !node.level || !f) {
      rejected.push({ event, reason: `unknown node: ${String(event.node)}` })
      continue
    }
    const bad = malformed(event) ?? unsupported(event, node, source)
    if (bad) {
      rejected.push({ event, reason: bad })
      continue
    }
    if (event.origin === 'pre-existing') {
      addOnce(node.findings, {
        rule: 'pre-existing',
        text: `Pre-existing; nonblocking: ${event.evidence} ${event.comparison}`,
        ...(event.lines ? { lines: event.lines } : {}),
        by: event.by ?? 'model',
      }, findingKey)
      continue
    }
    if (event.grounding?.kind === 'hypothesis' || event.grounding?.kind === 'model-only') {
      addOnce(node.findings, { rule: event.grounding.kind, text: `Unverified; not a demonstrated regression: ${event.evidence}`, by: event.by ?? 'model' }, findingKey)
      continue
    }
    const level = node.level
    const lowering = RANK[event.level] < RANK[level.current]
    if (lowering) {
      if (!event.evidence_kind) {
        rejected.push({ event, reason: 'lowering a level needs an evidence_kind' })
        continue
      }
      if (f.rule === 1) {
        rejected.push({ event, reason: 'floor rule 1 is a break that search or a test run found: only a new result lowers it' })
        continue
      }
      // Rule 5 is no test showing it and rule 6 is direct tests alone: neither becomes safe on an argument. Both are
      // mid at the floor, so a node can come back to mid after a raise.
      if ((f.rule === 5 || f.rule === 6) && RANK[event.level] < RANK[f.level]) {
        const missing = f.rule === 5 ? 'no test showing the change' : 'proof by direct tests alone'
        rejected.push({ event, reason: `floor rule ${f.rule} is ${missing}: only a test that runs lowers it` })
        continue
      }
      const hold = held.get(event.node)
      if (hold && RANK[event.level] < RANK[hold]) {
        rejected.push({ event, reason: `a test that fails or hangs at head, or a source-grounded regression, set this node to ${hold}: only a new result lowers it` })
        continue
      }
    }

    if (RANK[event.level] !== RANK[level.current]) level.current = event.level

    const heldLevel = held.get(event.node) ?? 'safe'
    if ((fromFailingTest(event) || (event.by === 'model' && event.level === 'high')) && RANK[event.level] > RANK[heldLevel]) held.set(event.node, event.level)

    if (level.current !== 'high') node.critical = false
    else if (event.critical === true) node.critical = true
    if (event.confidence) node.confidence = event.confidence

    addOnce(level.why, event.evidence, (w) => w)
    const finding: Finding = {
      rule: event.grounding?.kind === 'coverage-gap' ? 'coverage-gap' : event.rule ?? 'risk-event',
      text: event.evidence,
      ...(event.lines ? { lines: event.lines } : {}),
      by: event.by ?? 'model',
    }
    addOnce(node.findings, finding, findingKey)
    for (const question of event.questions ?? []) addOnce(node.questions, question, questionKey)
    node.watch = mergeWatch(node.watch, event.watch)
    if (event.suggest) addOnce(level.if, { text: event.suggest.text, level: event.suggest.to }, (s) => `${s.text}|${s.level}`)
  }

  return { nodes: nodes.map((n) => next.get(n.id) as ReviewNode), rejected }
}

/** Rules every graph must keep (FOUNDATION 14): critical implies high; safe needs a test that ran, unless rule 2 made it safe. */
export function checkInvariants(nodes: readonly ReviewNode[]): Violation[] {
  const found: Violation[] = []
  for (const node of nodes) {
    const current = node.level?.current
    if (node.critical && current !== 'high') {
      found.push({ node: node.id, text: `critical on a ${current ?? 'missing'} node: critical implies high` })
    }

    const proof = node.facts.proof.value
    const noRunningTest = proof === 'none' || proof === 'mocked' || proof === 'isolated' || proof === 'unknown'
    if (current === 'safe' && noRunningTest && node.level?.rule !== 2) {
      found.push({ node: node.id, text: `safe with proof ${proof}: safe needs a life cycle test that ran` })
    }
  }
  return found
}
