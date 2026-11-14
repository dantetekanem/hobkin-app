/**
 * The tests a card beside a node lists (the user, 2026-11-14: the tests must follow the navigation, never only show
 * when the reviewer goes to them by hand). Whatever is in focus, by a step, an arrow or a click, its card names the tests
 * that cover it and how each went, and says plainly when none does. Pure.
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

/** The tests of one node: a card's own, a test itself, a helper's users, an acceptance line's proof, or code's coverage. */
function testIds(id: string, graph: TestsGraph): string[] {
  const group = graph.groups[id]
  if (group) return group.tests
  const node = graph.nodeOf.get(id)
  if (isHelper(node)) return node!.supports!
  if (isTest(node)) return [id]
  if (node?.kind === 'criterion') return graph.edges.filter((edge) => edge.kind === 'proves' && edge.from === id).map((edge) => edge.to)
  return graph.edges.filter((edge) => edge.kind === 'exercises' && edge.to === id).map((edge) => edge.from)
}

/**
 * The tests of what is in focus, each once: in the order of the focus and of the review's wires, with a failed test
 * first, since that is the one a reviewer must not miss. Empty when no test covers any of it.
 */
export function testsFor(focus: readonly string[], graph: TestsGraph): ReviewNode[] {
  const tests = [...new Set(focus.flatMap((id) => testIds(id, graph)))].map((id) => graph.nodeOf.get(id)).filter((node): node is ReviewNode => isTest(node))
  return [...tests.filter((test) => test.status === 'failed'), ...tests.filter((test) => test.status !== 'failed')]
}

/** Proof that comes from tests: a unit proven so by tests the review has no node for still names them. */
const BY_TESTS: ReadonlySet<Unit['facts']['proof']['value']> = new Set(['lifecycle-observed', 'lifecycle', 'isolated', 'mocked'])

/** What a card says when no test of the review covers what it is about: that plainly, or what its unit says proves it. */
export function noTestWords(unit: Pick<Unit, 'facts'> | undefined): string {
  return unit && BY_TESTS.has(unit.facts.proof.value) ? proofWords(unit.facts) : 'No test covers this.'
}
