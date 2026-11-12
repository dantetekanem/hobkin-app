/**
 * The graph as the canvas draws it (the user, 2026-11-12): tests never stand in a column, nothing unwired sits in the
 * flow, and the request's life cycle reads left to right.
 *
 * Tests fold into one card for each subject, the node they cover, with the test helpers they use. More single tests
 * than a few fold by their file. The flow is laid out from what is left (`layoutGraph`): the cards on the left, then the
 * code, then its callers out to where a request enters, and the nodes nothing wires apart under it, in a block of their
 * own. A story step that focused a folded test focuses its card. Pure, and the same review always comes out the same.
 */
import { layoutGraph, type Rect } from '#shared/review/layout.ts'
import { fileName } from '#shared/review/paths.ts'
import type { NodeStatus, Review, ReviewEdge, ReviewNode, StoryStep } from '#shared/review/types.ts'
import { isUnchanged } from './levels.ts'

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

export interface Arranged {
  /** The nodes drawn: cards in place of the tests they hold, each in its place on the canvas. */
  nodes: ReviewNode[]
  edges: ArrangedEdge[]
  /** The story, with each focus and each ride on the cards that hold what it pointed at. */
  story: StoryStep[]
  /** The nodes folded into cards, kept for their code and their notes. */
  hidden: ReviewNode[]
  groups: Record<string, TestGroup>
  /** Each folded node, by its id, to the card that holds it. */
  groupOf: Record<string, string>
  /** Each test, by its id, to the node it covers: the changed code its wire leads to first. */
  covers: Record<string, string>
  /** The nodes nothing wires, set apart under the flow, and the box around them for their label. */
  apart: { ids: string[]; box: Rect } | null
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

/** What a test covers: the changed code its wires lead to first, else whatever they lead to first. */
function subjectOf(test: string, edges: readonly ReviewEdge[], nodeOf: ReadonlyMap<string, ReviewNode>): string | null {
  const reached = edges.filter((edge) => edge.from === test && edge.kind === 'exercises' && nodeOf.get(edge.to)?.kind !== 'test').map((edge) => edge.to)
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
    const subject = subjectOf(test.id, edges, nodeOf)
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

export function arrange(review: Pick<Review, 'nodes' | 'edges' | 'story'>): Arranged {
  const nodeOf = new Map(review.nodes.map((node) => [node.id, node]))
  const { groups: folded, covers } = foldTests(review.nodes, review.edges, nodeOf)
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
  const { edges, wireOf } = joinWires(review.edges, end)
  const { positions, apart } = layoutGraph(drawn, edges)

  return {
    nodes: drawn.map((node) => ({ ...node, position: positions[node.id] ?? node.position })),
    edges,
    story: review.story.map((step) => {
      const focus = unique(step.focus.map(end))
      const travel = step.travel ? wireOf.get(step.travel) : undefined
      const { travel: _travel, ...rest } = step
      return { ...rest, focus, ...(travel ? { travel } : {}) }
    }),
    hidden: review.nodes.filter((node) => groupOf[node.id]),
    groups,
    groupOf,
    covers,
    apart,
  }
}
