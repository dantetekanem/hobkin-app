/**
 * The tests a card beside a node lists (the user, 2026-11-14: the tests must follow the navigation, never only show
 * when the reviewer goes to them by hand). Whatever is in focus, by a step, an arrow or a click, its card names the tests
 * that cover it and how each went, told apart as there before the change, added or edited by it, and removed by it
 * (spec 055), and says plainly when none does. Pure.
 */
import type { Unit } from '#shared/review/assessment.ts'
import type { ReviewEdge, ReviewNode } from '#shared/review/types.ts'
import type { TestGroup } from '../graph/arrange.ts'
import { proofWords } from './words.ts'

/** What the rule reads of the graph: the review's own wires as the reviewer left them, the cards of tests, every node. */
export interface TestsGraph {
  /** The review's wires, without the proposed ones the reviewer removed. */
  edges: readonly ReviewEdge[]
  groups: Readonly<Record<string, TestGroup>>
  nodeOf: ReadonlyMap<string, ReviewNode>
}

const isHelper = (node: ReviewNode | undefined) => node?.kind === 'test' && (node.supports?.length ?? 0) > 0
const isTest = (node: ReviewNode | undefined): boolean => node?.kind === 'test' && !isHelper(node)

/**
 * The tests of one node: a card's own, a test itself, a helper's users, an acceptance line's proof, or code's coverage.
 * A test that says what it covers (`covers`) is taken at its word; one that does not, by its wires.
 */
function testIds(id: string, graph: TestsGraph): string[] {
  const group = graph.groups[id]
  if (group) return group.tests
  const node = graph.nodeOf.get(id)
  if (isHelper(node)) return node!.supports!
  if (isTest(node)) return [id]
  if (node?.kind === 'criterion') return graph.edges.filter((edge) => edge.kind === 'proves' && edge.from === id).map((edge) => edge.to)
  const wired = graph.edges.filter((edge) => edge.kind === 'exercises' && edge.to === id).map((edge) => edge.from)
  const said = [...graph.nodeOf.values()].filter((test) => isTest(test) && test.covers?.includes(id)).map((test) => test.id)
  return [...new Set([...wired, ...said])].filter((test) => graph.nodeOf.get(test)?.covers?.includes(id) ?? true)
}

/**
 * The tests of what is in focus, each once: in the order of the focus and of the review's wires, with a failed test
 * first, since that is the one a reviewer must not miss. Empty when no test covers any of it.
 */
export function testsFor(focus: readonly string[], graph: TestsGraph): ReviewNode[] {
  const tests = [...new Set(focus.flatMap((id) => testIds(id, graph)))].map((id) => graph.nodeOf.get(id)).filter((node): node is ReviewNode => isTest(node))
  return [...tests.filter((test) => test.status === 'failed'), ...tests.filter((test) => test.status !== 'failed')]
}

/** A node's tests by how they stand to the change: there before it, added or edited by it, and removed by it. */
export interface SplitTests {
  before: ReviewNode[]
  changed: ReviewNode[]
  removed: ReviewNode[]
}

/** The headings the tests are listed under, in their order, always all three so none moves. */
export const TEST_HEADINGS: readonly (readonly [keyof SplitTests, string])[] = [
  ['before', 'There before'],
  ['changed', 'Added or edited'],
  ['removed', 'Removed'],
]

const placeOf = (test: Pick<ReviewNode, 'change'>): keyof SplitTests => (test.change === 'unchanged' ? 'before' : test.change === 'deleted' ? 'removed' : 'changed')

/** The tests split by how they stand to the change, each kept in its order, so a failed one stays first. */
export function splitTests(tests: readonly ReviewNode[]): SplitTests {
  const split: SplitTests = { before: [], changed: [], removed: [] }
  for (const test of tests) split[placeOf(test)].push(test)
  return split
}

/** How many of a card's tests stand each way to the change. */
export function splitCounts(tests: readonly (Pick<ReviewNode, 'change'> | undefined)[]): Record<keyof SplitTests, number> {
  const counts = { before: 0, changed: 0, removed: 0 }
  for (const test of tests) if (test) counts[placeOf(test)] += 1
  return counts
}

/** The tests shown while the list is folded: a test of each heading in turn, so a heading that has one shows it. */
export function firstTests(split: SplitTests, most: number): Set<string> {
  const shown = new Set<string>()
  const lists = TEST_HEADINGS.map(([key]) => split[key])
  const longest = Math.max(...lists.map((list) => list.length))
  for (let round = 0; round < longest; round += 1) {
    for (const list of lists) {
      const test = list[round]
      if (test && shown.size < most) shown.add(test.id)
    }
  }
  return shown
}

/** Enough of the graph as drawn to find the card of a node's tests. */
export interface DrawnTests {
  nodes: readonly { id: string }[]
  /** Each test, by its id, to the node it covers. */
  covers: Readonly<Record<string, string>>
  /** Each folded test, by its id, to its card. */
  groupOf: Readonly<Record<string, string>>
}

/** The card drawn for the tests that cover a node: their card, or a test drawn alone. Null when none is drawn. */
export function testCardOf(graph: DrawnTests, id: string): string | null {
  const drawn = new Set(graph.nodes.map((node) => node.id))
  for (const [test, subject] of Object.entries(graph.covers)) {
    const card = graph.groupOf[test] ?? test
    if (subject === id && drawn.has(card)) return card
  }
  return null
}

/** Proof that comes from tests: a unit proven so by tests the review has no node for still names them. */
const BY_TESTS: ReadonlySet<Unit['facts']['proof']['value']> = new Set(['lifecycle-observed', 'lifecycle', 'isolated', 'mocked'])

/** What a card says when no test covers what it is about. */
export const NO_TEST = 'No test covers this.'

/** What a card says when no test of the review covers what it is about: that plainly, or what its unit says proves it. */
export function noTestWords(unit: Pick<Unit, 'facts'> | undefined): string {
  return unit && BY_TESTS.has(unit.facts.proof.value) ? proofWords(unit.facts) : NO_TEST
}
