/**
 * What the change review's own walk found (spec 055), laid over the graph review once it is ready: how a test did at
 * the change's commit, an unchanged test it found that the host's scan did not, what a test the change removed
 * covered, where changed code is run from when the host found no way in, and the names the Reviewer gave zones.
 * Where the two walks disagree, the host's nodes are what is drawn and the engine's words are what is said: a test
 * joins only on lines of a file the review holds, so the window can show it, and a way in names only the steps the
 * review has nodes for. Everything in graph.json is read without trust.
 */
import { edgeId, testCovers, testFromBefore, testName, TESTS_FROM_BEFORE, withCovers } from '#shared/review/draft.ts'
import { NODE_SIZE } from '#shared/review/layout.ts'
import { cleanProse, isSafePath } from '#shared/review/prose.ts'
import { PROSE_LIMIT, TITLE_LIMIT, type NodeStatus, type Review, type ReviewEdge, type ReviewFileContents, type ReviewLifecycle, type ReviewNode } from '#shared/review/types.ts'
import { testCaseNear } from '#shared/review/units.ts'
import { withZones } from '#shared/review/zones.ts'
import type { NodeTest, Origin, OriginStep, RemovedTest, RunsFrom } from '../../../packages/change-review/src/types.ts'
import { holdsPlace } from './unit-story.ts'

type EngineOrigin = Pick<Origin, 'kind' | 'label' | 'exact' | 'hops'> & { chain: Pick<OriginStep, 'symbol' | 'path' | 'line'>[] }
type EngineRunsFrom =
  | { found: 'origins'; origins: EngineOrigin[] }
  | { found: 'only-tests' }
  | { found: 'none'; stopped?: Extract<RunsFrom, { found: 'none' }>['stopped']; why: string }
  | { found: 'not-looked'; why: string }
type EngineTest = Pick<NodeTest, 'path' | 'symbol' | 'line' | 'relation' | 'at_head' | 'shows'>

/** A changed part of the engine's graph, as far as the host lays it over the review. */
interface EnginePart {
  symbol: string
  path: string
  lines: [number, number]
  change: 'added' | 'modified' | 'removed' | 'none'
  runsFrom?: EngineRunsFrom
  tests: EngineTest[]
}

export interface EngineFacts {
  parts: EnginePart[]
  /** The Reviewer's own names for zones, by zone id. */
  zoneNames: Map<string, string>
  removed: Pick<RemovedTest, 'path' | 'base_line' | 'names'>[]
}

type Raw = Record<string, unknown>
const record = (value: unknown): Raw | undefined => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : undefined)
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)
const line = (value: unknown): number | undefined => (Number.isInteger(value) && (value as number) > 0 ? (value as number) : undefined)
const oneOf = <Value extends string>(allowed: readonly Value[], value: unknown): Value | undefined => (allowed.includes(value as Value) ? (value as Value) : undefined)

const CHANGES = ['added', 'modified', 'removed', 'none'] as const
const RELATIONS = ['before', 'added', 'edited', 'removed'] as const
const AT_HEAD = ['passed', 'failed', 'timed-out', 'not-run'] as const
const SHOWS = ['proves', 'reaches', 'still-passes', 'mocks'] as const
const STOPS = ['limit', 'time', 'failed'] as const
const ENTRY_KIND = /^[a-z][a-z-]{0,31}$/

function originOf(value: unknown): EngineOrigin[] {
  const origin = record(value)
  const [kind, label] = [text(origin?.kind), text(origin?.label)]
  if (!origin || !kind || !ENTRY_KIND.test(kind) || !label || typeof origin.exact !== 'boolean') return []
  const chain = list(origin.chain).flatMap((item) => {
    const step = record(item)
    const [symbol, path, at] = [text(step?.symbol), text(step?.path), line(step?.line)]
    return symbol && path && isSafePath(path) && at ? [{ symbol, path, line: at }] : []
  })
  return [{ kind, label, exact: origin.exact, hops: Number.isInteger(origin.hops) ? Math.max(0, origin.hops as number) : chain.length, chain }]
}

function runsFromOf(value: unknown): EngineRunsFrom | undefined {
  const said = record(value)
  const why = text(said?.why) ?? ''
  switch (said?.found) {
    case 'origins': {
      const origins = list(said.origins).flatMap(originOf)
      return origins.length ? { found: 'origins', origins } : undefined
    }
    case 'only-tests':
      return { found: 'only-tests' }
    case 'none': {
      const stopped = oneOf(STOPS, said.stopped)
      return { found: 'none', why, ...(stopped ? { stopped } : {}) }
    }
    case 'not-looked':
      return { found: 'not-looked', why }
    default:
      return undefined
  }
}

function testOf(value: unknown): EngineTest[] {
  const test = record(value)
  const [path, symbol, at, relation] = [text(test?.path), text(test?.symbol), line(test?.line), oneOf(RELATIONS, test?.relation)]
  if (!test || !path || !isSafePath(path) || !relation) return []
  const [atHead, shows] = [oneOf(AT_HEAD, test.at_head), oneOf(SHOWS, test.shows)]
  return [{ path, relation, ...(symbol ? { symbol } : {}), ...(at ? { line: at } : {}), ...(atHead ? { at_head: atHead } : {}), ...(shows ? { shows } : {}) }]
}

/** The facts of graph.json the host lays over a review. A graph written before spec 055 has none of them. */
export function readEngineFacts(graph: unknown): EngineFacts {
  const raw = record(graph)
  const parts = list(raw?.nodes).flatMap((item): EnginePart[] => {
    const node = record(item)
    const [symbol, path, change] = [text(node?.symbol), text(node?.path), oneOf(CHANGES, node?.change)]
    const [start, end] = list(node?.lines).map(line)
    if (!node || node.kind === 'test' || !symbol || !path || !isSafePath(path) || !change || !start || !end || end < start) return []
    const runsFrom = runsFromOf(node.runs_from)
    return [{ symbol, path, lines: [start, end], change, ...(runsFrom ? { runsFrom } : {}), tests: list(node.tests).flatMap(testOf) }]
  })
  const zoneNames = new Map(list(raw?.zones).flatMap((item) => {
    const zone = record(item)
    const [id, told] = [text(zone?.id), text(zone?.told)]
    return id && told ? [[id, told] as const] : []
  }))
  const removed = list(raw?.removed_tests).flatMap((item) => {
    const test = record(item)
    const [path, at] = [text(test?.path), line(test?.base_line)]
    const names = list(test?.names).filter((name): name is string => typeof name === 'string' && name !== '')
    return path && isSafePath(path) && at ? [{ path, base_line: at, names }] : []
  })
  return { parts, zoneNames, removed }
}

const hasFacts = ({ parts, zoneNames, removed }: EngineFacts) => zoneNames.size > 0 || removed.length > 0 || parts.some((part) => part.runsFrom || part.tests.length)

/** A test's result at the change's commit, as the change review gives it. */
function resultOf(test: EngineTest): NodeStatus | undefined {
  if (test.at_head === 'failed') return 'failed'
  if (test.at_head === 'passed') return test.shows === 'proves' ? 'proves-change' : 'passed'
  return undefined
}

const RESULT_WORDS: Partial<Record<NodeStatus, string>> = { passed: "It passes at the change's commit.", failed: "It fails at the change's commit.", 'proves-change': 'It proves the change.' }

/** Where changed code is run from in the engine's words, with the steps the review has nodes for. */
function engineLifecycle(part: EnginePart, node: ReviewNode, stepAt: (step: { path: string; line: number }) => ReviewNode | undefined): ReviewLifecycle | undefined {
  const said = part.runsFrom
  const host = node.lifecycle
  if (said?.found === 'origins') {
    const [nearest, ...others] = said.origins
    const chain = [...new Set(nearest!.chain.flatMap((step) => stepAt(step)?.id ?? []))].filter((id) => id !== node.id)
    return {
      role: 'changed',
      hops: Math.min(9, nearest!.hops),
      path: cleanProse([nearest!.label, ...nearest!.chain.map((step) => step.symbol), part.symbol].join(' → '), PROSE_LIMIT.summary),
      origin: { kind: nearest!.kind, label: cleanProse(nearest!.label, TITLE_LIMIT), exact: nearest!.exact, chain, ...(others.length ? { more: others.length } : {}) },
    }
  }
  if (said?.found === 'only-tests') return { role: 'changed', hops: host?.hops ?? 0, path: 'Only tests call it.', none: 'only-tests' }
  // The engine's word on why there is none counts only where the host did not look itself.
  if (!said || (host && host.none !== 'not-looked')) return undefined
  const path = cleanProse(said.why, PROSE_LIMIT.summary)
  return { role: 'changed', hops: host?.hops ?? 0, ...(path ? { path } : {}), none: noWayReason(said) }
}

/** Why the engine found no way in, in the review's word: a search that failed ran out of what it could do, as one out of time. */
function noWayReason(said: Extract<EngineRunsFrom, { found: 'none' | 'not-looked' }>): NonNullable<ReviewLifecycle['none']> {
  if (said.found === 'not-looked') return 'not-looked'
  if (said.stopped === 'limit') return 'limit'
  return said.stopped ? 'time' : 'no-callers'
}

/**
 * The review with the engine's facts over it. A review prepared before zones keeps none, and gets no covers; any other
 * has its covers and zones found again for what joined, with the Reviewer's names for its zones.
 */
export function withEngineFacts(review: Review, facts: EngineFacts, files: readonly ReviewFileContents[] = []): Review {
  if (!hasFacts(facts)) return review
  const holds = holdsPlace(review)
  let nodes = review.nodes.map((node) => ({ ...node }))
  const edges: ReviewEdge[] = [...review.edges]
  const wired = new Set(edges.map((edge) => `${edge.from}>${edge.to}`))
  const wire = (from: string, to: string) => {
    if (wired.has(`${from}>${to}`)) return
    wired.add(`${from}>${to}`)
    edges.push({ id: edgeId('exercises', from, to), from, to, kind: 'exercises', certainty: 'host' })
  }
  const codeOf = (place: Pick<EnginePart, 'path' | 'lines' | 'change'>) => nodes.filter((node) => node.kind === 'code' && holds(node, place))
  const holdsLine = (node: ReviewNode, path: string, at: number, side: 'added' | 'deleted') => node.subtitle === path && node.anchors.some((anchor) => anchor.side === side && anchor.startLine <= at && at <= anchor.endLine)
  /** The review's own node of a test the engine names: by its name, else by a line of it. */
  const shownTest = (test: EngineTest) => {
    const inFile = nodes.filter((node) => node.kind === 'test' && node.subtitle === test.path)
    const title = test.symbol ? cleanProse(testName(test.symbol), TITLE_LIMIT) : undefined
    return inFile.find((node) => node.title === title) ?? inFile.find((node) => test.line != null && holdsLine(node, test.path, test.line, 'added'))
  }
  const results = new Map<string, NodeStatus>()

  // Each test the engine says covers a changed part: the host's own, else an unchanged one the review can show.
  for (const part of facts.parts) {
    const code = codeOf(part)
    for (const test of code.length ? part.tests : []) {
      if (test.relation === 'removed') continue
      const node = shownTest(test) ?? (test.relation === 'before' ? joinBefore(test, code) : undefined)
      if (!node) continue
      for (const target of code) wire(node.id, target.id)
      const result = resultOf(test)
      if (result && node.status === 'not-run') results.set(node.id, result)
    }
  }

  // What a removed test covered, by the names it used.
  for (const gone of facts.removed) {
    const node = nodes.find((entry) => entry.kind === 'test' && holdsLine(entry, gone.path, gone.base_line, 'deleted'))
    if (!node) continue
    const byPart = facts.parts.filter((part) => gone.names.includes(part.symbol)).flatMap(codeOf)
    const targets = byPart.length ? byPart : nodes.filter((entry) => entry.kind === 'code' && gone.names.includes(entry.title))
    for (const target of targets) wire(node.id, target.id)
  }

  // Where changed code is run from, where the host found no way in.
  for (const part of facts.parts) {
    for (const node of part.runsFrom ? codeOf(part) : []) {
      if (node.lifecycle?.origin) continue
      const said = engineLifecycle(part, node, (step) => nodes.find((entry) => entry.kind !== 'test' && holdsLine(entry, step.path, step.line, 'added')))
      if (said) node.lifecycle = said
    }
  }

  for (const node of nodes) {
    const result = results.get(node.id)
    if (!result) continue
    node.status = result
    node.summary = cleanProse(`${testCovers(nodes, edges, node).said} ${RESULT_WORDS[result]}`, PROSE_LIMIT.summary)
  }
  if (review.zones === undefined) return { ...review, nodes, edges }
  const zoned = withZones(withCovers(nodes, edges), edges)
  const zones = zoned.zones.map((zone) => {
    const name = facts.zoneNames.get(zone.id)
    return name ? { ...zone, label: cleanProse(name, PROSE_LIMIT.title) || zone.label } : zone
  })
  return { ...review, nodes: zoned.nodes, edges, zones }

  /**
   * An unchanged test the host's scan did not find, on lines of a file the review holds unchanged, within the few a
   * changed part and a review take. It goes below every other node until the window lays the graph out.
   */
  function joinBefore(test: EngineTest, code: readonly ReviewNode[]): ReviewNode | undefined {
    const file = review.files.find((entry) => entry.path === test.path)
    const text = files.find((entry) => entry.fileId === file?.id)?.head
    if (!file || file.status !== 'unchanged' || text == null || !test.symbol) return undefined
    const before = nodes.filter((node) => node.kind === 'test' && node.change === 'unchanged')
    const coveringBefore = (id: string) => before.filter((node) => wired.has(`${node.id}>${id}`)).length
    if (before.length >= TESTS_FROM_BEFORE.review || code.every((target) => coveringBefore(target.id) >= TESTS_FROM_BEFORE.perDefinition)) return undefined
    const span = testCaseNear(text, test.symbol, test.line ?? 1)
    if (!span) return undefined
    let id = before.length + 1
    while (nodes.some((node) => node.id === `b${id}`)) id += 1
    const bottom = Math.max(0, ...nodes.map((node) => node.position.y + NODE_SIZE[node.kind].height))
    const joined = nodes.length - review.nodes.length
    const node = {
      ...testFromBefore(`b${id}`, { path: test.path, symbol: test.symbol }, text, { fileId: file.id, ...span }, 'not-run'),
      summary: 'This test did not change. The change review found it covers this code.',
      position: { x: joined * (NODE_SIZE.test.width + 40), y: bottom + 80 },
    }
    nodes = [...nodes, node]
    return node
  }
}
