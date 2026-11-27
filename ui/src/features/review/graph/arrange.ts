/**
 * The graph as the canvas draws it (the user, 2026-11-12): tests never stand in a column, and the graph reads in the
 * order a request goes through it.
 *
 * Tests fold into one card for each subject, the node they cover, with the test helpers they use. More single tests
 * than a few fold by their file. Each node is in a zone (`zones.ts`, spec 055), and the graph is laid out by zone from
 * what is drawn (`layoutZones`): one block for each, in the order a request passes them, so a request still reads from
 * where it enters through the code that leads to the change, the change and what it calls, with each zone of tests left
 * of the code it mirrors. A changed node nothing wires stays in its place among the rest, and its card says so. A story
 * step that focused a folded test focuses its card. Pure, and the same review always comes out the same.
 */
import { layoutZones, zoneDocks, type GraphFlow } from '#shared/review/layout.ts'
import { fileName } from '#shared/review/paths.ts'
import type { NodeStatus, Review, ReviewEdge, ReviewNode, StoryStep } from '#shared/review/types.ts'
import { isUnchanged } from './levels.ts'
import { zonesOf, type GraphZone } from './zones.ts'

/** What the tests of a card did: how many ran (passed, failed or proved the change), failed, and were not run. */
export interface TestCounts {
  ran: number
  failed: number
  notRun: number
  /** Of those that ran, the ones that fail with the change undone: they prove the change itself. */
  proves: number
}

/** A card of tests folded together: the tests of one subject, or of one file, with the helpers they use. */
export interface TestGroup {
  id: string
  /** The node its tests cover, when they share one. */
  subject: string | null
  /** The file its tests are in, when they are folded by their file. */
  file: string | null
  /** Its tests, in the review's order. */
  tests: string[]
  /** The test helpers folded in with them (`ReviewNode.supports`). */
  helpers: string[]
  counts: TestCounts
}

/** A wire as the canvas draws it, with the review's wires it stands for: one, or one for each test of a card. */
export type ArrangedEdge = ReviewEdge & { members: string[] }

/** A step as the canvas tells it: the review's steps it stands for, more than one when they land on the same card. */
export type ViewStep = StoryStep & { steps: string[] }

export interface Arranged {
  /** The nodes drawn: cards in place of the tests they hold, each in its place on the canvas. */
  nodes: ReviewNode[]
  edges: ArrangedEdge[]
  /**
   * The story, with each focus and each ride on the cards that hold what it pointed at. Steps that land on the same card
   * of tests are one step (the user, 2026-11-12: "4 steps here are the same node, this is dumb").
   */
  story: ViewStep[]
  /** Each step of the review, by its id, to its place in that story: hobkin and the notes name the review's steps. */
  stepOf: Record<string, number>
  /** The nodes folded into cards, kept for their code and their notes. */
  hidden: ReviewNode[]
  groups: Record<string, TestGroup>
  /** Each folded node, by its id, to the card that holds it. */
  groupOf: Record<string, string>
  /** Each test, by its id, to the node it covers: the changed code its wire leads to first. */
  covers: Record<string, string>
  /** The zones the graph draws, in the order a request passes them. Each drawn node's `zone` is the id of one. */
  zones: GraphZone[]
  /** Each drawn node and each node of the review, by its id, to the id of its zone. */
  zoneOf: Record<string, string>
  /** The code zone each zone of tests stands with, as the whole graph has it, kept when its nodes fold (`zoneDocks`). */
  docks: Record<string, string>
  /** Which way the graph reads: left to right, or top to bottom (spec 006). */
  flow: GraphFlow
}

const PREFIX = 'tests:'
/** True for the id of a card of folded tests. */
export const isTestGroup = (id: string): boolean => id.startsWith(PREFIX)
/** More single tests than this, and the ones that share a file fold together too. */
export const SINGLES = 4

/** The sentence a node gets when nothing better was said of it: a count of its lines. It is never a card's main text. */
const LINE_COUNT = /^(?:(?:New|Removed) in this change\. )?(?:[\d,]+ lines? (?:added|removed)(?: and [\d,]+ lines? removed)?|No lines changed)\.$/
export const isLineCount = (summary: string): boolean => LINE_COUNT.test(summary.trim())

const unique = <Value>(values: readonly Value[]) => [...new Set(values)]
/** The values by their key, in the order each key first appears. */
function groupBy<Value>(values: readonly Value[], keyOf: (value: Value) => string): Map<string, Value[]> {
  const groups = new Map<string, Value[]>()
  for (const value of values) groups.set(keyOf(value), [...(groups.get(keyOf(value)) ?? []), value])
  return groups
}
const isHelper = (node: ReviewNode) => node.kind === 'test' && (node.supports?.length ?? 0) > 0

/**
 * What a test covers: the changed code it says it covers first (`covers`), else that its wires lead to first, else
 * whatever they lead to first. A test the change removed says it and has no wire.
 */
function subjectOf(test: ReviewNode, edges: readonly ReviewEdge[], nodeOf: ReadonlyMap<string, ReviewNode>): string | null {
  const said = (test.covers ?? []).filter((id) => nodeOf.has(id) && nodeOf.get(id)!.kind !== 'test')
  const reached = said.length > 0 ? said : edges.filter((edge) => edge.from === test.id && edge.kind === 'exercises' && nodeOf.get(edge.to)?.kind !== 'test').map((edge) => edge.to)
  return reached.find((id) => !isUnchanged(nodeOf.get(id))) ?? reached[0] ?? null
}

function countsOf(tests: readonly ReviewNode[]): TestCounts {
  const counts: TestCounts = { ran: 0, failed: 0, notRun: 0, proves: 0 }
  for (const { status } of tests) {
    if (status === 'passed' || status === 'failed' || status === 'proves-change') counts.ran += 1
    else counts.notRun += 1
    if (status === 'failed') counts.failed += 1
    if (status === 'proves-change') counts.proves += 1
  }
  return counts
}

/** A card says what its worst test says: a failure first, then nothing run, then a proof of the change. */
function groupStatus(counts: TestCounts): NodeStatus {
  if (counts.failed > 0) return 'failed'
  if (counts.ran === 0) return 'not-run'
  return counts.proves > 0 ? 'proves-change' : 'passed'
}

/** The tests that fold, and into which cards. */
function foldTests(nodes: readonly ReviewNode[], edges: readonly ReviewEdge[], nodeOf: ReadonlyMap<string, ReviewNode>) {
  const helpers = nodes.filter(isHelper)
  const tests = nodes.filter((node) => node.kind === 'test' && !isHelper(node))
  const covers: Record<string, string> = {}
  for (const test of tests) {
    const subject = subjectOf(test, edges, nodeOf)
    if (subject) covers[test.id] = subject
  }

  const groups: Omit<TestGroup, 'counts'>[] = []
  const grouped = new Set<string>()
  const add = (group: Omit<TestGroup, 'counts'>) => {
    groups.push(group)
    for (const id of group.tests) grouped.add(id)
  }
  const bySubject = groupBy(tests.filter((test) => covers[test.id]), (test) => covers[test.id]!)
  for (const [subject, members] of bySubject) if (members.length > 1) add({ id: `${PREFIX}${subject}`, subject, file: null, tests: members.map((test) => test.id), helpers: [] })
  const singles = tests.filter((test) => !grouped.has(test.id))
  if (singles.length > SINGLES) {
    for (const [file, members] of groupBy(singles, (test) => test.subtitle ?? '')) {
      if (members.length > 1) add({ id: `${PREFIX}file:${file}`, subject: null, file: file || null, tests: members.map((test) => test.id), helpers: [] })
    }
  }
  // A helper joins the card of the tests it serves. When none of them is on a card, it makes one with them.
  for (const helper of helpers) {
    const served = (helper.supports ?? []).filter((id) => tests.some((test) => test.id === id))
    const card = groups.find((group) => served.some((id) => group.tests.includes(id)))
    if (card) card.helpers.push(helper.id)
    else if (served.length > 0) add({ id: `${PREFIX}${covers[served[0]!] ?? helper.id}`, subject: covers[served[0]!] ?? null, file: null, tests: served, helpers: [helper.id] })
  }
  return { groups, covers }
}

function cardOf(group: TestGroup, nodeOf: ReadonlyMap<string, ReviewNode>): ReviewNode {
  const tests = group.tests.map((id) => nodeOf.get(id)!)
  const members = [...tests, ...group.helpers.map((id) => nodeOf.get(id)!)]
  const files = unique(members.map((member) => member.subtitle).filter((path): path is string => Boolean(path)))
  const changes = unique(members.map((member) => member.change))
  const named = group.subject ? `for ${nodeOf.get(group.subject)?.title ?? group.subject}` : `in ${fileName(group.file ?? files[0] ?? '')}`
  return {
    id: group.id,
    kind: 'test',
    title: `${tests.length} ${tests.length === 1 ? 'test' : 'tests'} ${named}`,
    ...(files[0] ? { subtitle: files[0] } : {}),
    change: changes.length === 1 ? changes[0]! : 'modified',
    stats: members.reduce((sum, member) => ({ additions: sum.additions + (member.stats?.additions ?? 0), deletions: sum.deletions + (member.stats?.deletions ?? 0) }), { additions: 0, deletions: 0 }),
    summary: group.subject ? `Covers ${nodeOf.get(group.subject)?.title ?? group.subject}.` : `Tests in ${group.file ?? files[0] ?? 'this change'}.`,
    status: groupStatus(group.counts),
    anchors: members.flatMap((member) => member.anchors),
    position: { x: 0, y: 0 },
  }
}

const RESULT_WORDS: readonly [string, (status: NodeStatus | undefined) => boolean][] = [
  ['Passed', (status) => status === 'passed'],
  ['Failed', (status) => status === 'failed'],
  ['Proves the change', (status) => status === 'proves-change'],
  ['Not run', (status) => status !== 'passed' && status !== 'failed' && status !== 'proves-change'],
]
const listed = (names: readonly string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

/** A card's tests by name, by their result: "Passed: a and b. Failed: c." */
export function testsInWords(tests: readonly Pick<ReviewNode, 'title' | 'status'>[]): string {
  return RESULT_WORDS.flatMap(([words, has]) => {
    const names = tests.filter((test) => has(test.status)).map((test) => test.title)
    return names.length > 0 ? [`${words}: ${listed(names)}.`] : []
  }).join(' ')
}

/**
 * The story on the cards: each step points at the cards that hold its tests, and a step that lands on the same cards
 * as a step before it joins that step, next to it or not, since that card was shown already. A step that names a card
 * is told as the card: its tests by name and result, never a count of lines. Steps the model wrote about the same code
 * stay apart. Only cards of tests fold steps together.
 */
function foldStory(story: readonly StoryStep[], end: (id: string) => string, wireOf: ReadonlyMap<string, string>, titleOf: (id: string) => string, testsOf: (id: string) => ReviewNode[]) {
  const steps: ViewStep[] = []
  const stepOf: Record<string, number> = {}
  const shown = new Map<string, number>()
  const RANK = { safe: 0, mid: 1, high: 2 } as const
  for (const step of story) {
    const focus = unique(step.focus.map(end))
    const cards = focus.filter(isTestGroup)
    const key = cards.length > 0 ? [...focus].sort().join(' ') : null
    const earlier = key ? shown.get(key) : undefined
    if (earlier != null) {
      const joined = steps[earlier]!
      joined.steps.push(step.id)
      joined.criteria = unique([...joined.criteria, ...step.criteria])
      if (step.level && (!joined.level || RANK[step.level] > RANK[joined.level])) joined.level = step.level
      stepOf[step.id] = earlier
      continue
    }
    const travel = step.travel ? wireOf.get(step.travel) : undefined
    const { travel: _travel, ...rest } = step
    stepOf[step.id] = steps.length
    if (key) shown.set(key, steps.length)
    steps.push({ ...rest, focus, ...(travel ? { travel } : {}), steps: [step.id] })
  }
  // A step told as its card: by the card's name, and by its tests and their results.
  for (const step of steps) {
    const cards = step.focus.filter(isTestGroup)
    if (cards.length === 0 || (step.steps.length === 1 && !isLineCount(step.text))) continue
    step.title = listed(step.focus.map(titleOf))
    step.text = testsInWords(cards.flatMap(testsOf))
  }
  return { steps, stepOf }
}

/** The wires drawn: each test's wires leave from its card, and the wires that then join the same two nodes become one. */
function joinWires(edges: readonly ReviewEdge[], end: (id: string) => string): { edges: ArrangedEdge[]; wireOf: Map<string, string> } {
  const joined = new Map<string, ArrangedEdge>()
  const wireOf = new Map<string, string>()
  for (const edge of edges) {
    const [from, to] = [end(edge.from), end(edge.to)]
    if (from === to) continue
    const moved = from !== edge.from || to !== edge.to
    const key = moved ? `${edge.kind}:${from}>${to}` : edge.id
    const known = joined.get(key)
    wireOf.set(edge.id, key)
    if (!known) {
      joined.set(key, { ...edge, id: key, from, to, members: [edge.id] })
      continue
    }
    known.members.push(edge.id)
    // One wire the host found makes the card's wire the host's, and words that differ say nothing about all of them.
    if (edge.certainty === 'host') known.certainty = 'host'
    if (known.label !== edge.label) delete known.label
  }
  return { edges: [...joined.values()], wireOf }
}

/**
 * A wire as a request goes along it. The review says a caller the change did not touch "is called by" the code on its
 * left; on the canvas the caller stands before that code, so its wire runs from the caller and says it calls it.
 */
const requestWise = (edge: ReviewEdge): ReviewEdge => (edge.kind === 'called-by' ? { ...edge, kind: 'calls', from: edge.to, to: edge.from } : edge)

export function arrange(review: Pick<Review, 'nodes' | 'edges' | 'story'> & Partial<Pick<Review, 'zones'>>, flow: GraphFlow = 'left-to-right'): Arranged {
  const nodeOf = new Map(review.nodes.map((node) => [node.id, node]))
  const wires = review.edges.map(requestWise)
  const { groups: folded, covers } = foldTests(review.nodes, wires, nodeOf)
  const groups: Record<string, TestGroup> = {}
  const groupOf: Record<string, string> = {}
  for (const group of folded) {
    groups[group.id] = { ...group, counts: countsOf(group.tests.map((id) => nodeOf.get(id)!)) }
    for (const id of [...group.tests, ...group.helpers]) groupOf[id] = group.id
  }
  const end = (id: string) => groupOf[id] ?? id

  // Each card stands where its first test stood, so the order of the review is kept.
  const drawn: ReviewNode[] = []
  for (const node of review.nodes) {
    const card = groupOf[node.id]
    if (!card) drawn.push(node)
    else if (groups[card]!.tests[0] === node.id || (groups[card]!.tests.length === 0 && groups[card]!.helpers[0] === node.id)) drawn.push(cardOf(groups[card]!, nodeOf))
  }
  const { edges, wireOf } = joinWires(wires, end)
  const holds = (id: string) => (groups[id] ? [...groups[id]!.tests, ...groups[id]!.helpers] : [id])
  const { zones, zoneOf } = zonesOf(review, drawn.map((node) => ({ id: node.id, of: holds(node.id) })), covers)
  const zoned = drawn.map((node) => ({ ...node, zone: zoneOf[node.id]! }))
  const docks = zoneDocks(zoned, edges, zones)
  const positions = layoutZones(zoned, edges, zones, [], docks, flow)
  const drawnOf = new Map(drawn.map((node) => [node.id, node]))
  const { steps: story, stepOf } = foldStory(review.story, end, wireOf, (id) => drawnOf.get(id)?.title ?? id, (id) => (groups[id]?.tests ?? []).map((test) => nodeOf.get(test)!))

  return {
    nodes: zoned.map((node) => ({ ...node, position: positions[node.id] ?? node.position })),
    edges,
    story,
    stepOf,
    hidden: review.nodes.filter((node) => groupOf[node.id]),
    groups,
    groupOf,
    covers,
    zones,
    zoneOf,
    docks,
    flow,
  }
}
