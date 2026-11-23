import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ReviewEdge, ReviewNode } from '#shared/review/types.ts'
import { arrange } from '../src/features/review/graph/arrange.ts'
import { pullAssessment, pullReview } from '../src/features/review/sample/pull.ts'
import { createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'
import { createSession } from '../src/features/review/state/session.ts'
import { firstTests, noTestWords, splitCounts, splitTests, testCardOf, testsFor } from '../src/features/review/story/node-tests.ts'
import { proofWords } from '../src/features/review/story/words.ts'

const pull = pullReview('pr:hobkin-sample/storefront/482')
const shape = arrange(pull)
const graph = { edges: pull.edges, groups: shape.groups, nodeOf: new Map([...shape.hidden, ...shape.nodes].map((node) => [node.id, node])) }
const idOf = (title: string) => pull.nodes.find((node) => node.title === title)!.id
const ids = (tests: readonly ReviewNode[]) => tests.map((node) => node.id)
const units = pullAssessment().units!.units

const before = idOf('links a tag at the start of a paragraph')
const removed = idOf('looks each tag up by its handle')

test('the tests of a node are the ones that cover it, wherever they are folded, each once and a failure first', () => {
  // Code: every test wired to it or saying it covers it, in the review's order, and a failed one before the rest. A
  // helper is no test of its own.
  assert.deepEqual(ids(testsFor([idOf('link_user_tags')], graph)), ['u4', 'u5', 'u6', 'u7', 'u8', before, removed])
  assert.deepEqual(ids(testsFor([idOf('fetch_errors')], graph)), ['u14', 'u9', 'u10', 'u11', 'u12', 'u13'])
  // A card of folded tests: its own tests, a test not run kept in its place.
  assert.deepEqual(ids(testsFor(['tests:u3'], graph)), ['u15', 'u16', 'u17', 'u18', 'u19', 'u20', 'u21'])
  // A test is its own test, and a helper's are the tests that use it.
  assert.deepEqual(ids(testsFor(['u5'], graph)), ['u5'])
  assert.deepEqual(ids(testsFor([idOf('stub_monitor')], graph)), ['u14', 'u9', 'u10', 'u11', 'u12', 'u13'])
  // A focus of a node and the card of its tests lists each test once.
  assert.deepEqual(ids(testsFor([idOf('link_user_tags'), 'tests:u1'], graph)), ['u4', 'u5', 'u6', 'u7', 'u8', before, removed])
  // Nothing covers the README.
  assert.deepEqual(testsFor([idOf('README.md')], graph), [])
})

test('the tests of changed code are told apart: there before, added or edited, and removed, each a failure first', () => {
  const split = splitTests(testsFor([idOf('link_user_tags')], graph))
  assert.deepEqual([ids(split.before), ids(split.changed), ids(split.removed)], [[before], ['u4', 'u5', 'u6', 'u7', 'u8'], [removed]])
  // Nothing was there before the new script, and its failed test comes first.
  const script = splitTests(testsFor([idOf('fetch_errors')], graph))
  assert.deepEqual([ids(script.before), ids(script.changed), ids(script.removed)], [[], ['u14', 'u9', 'u10', 'u11', 'u12', 'u13'], []])
  // The card of tests counts them the same way.
  assert.deepEqual(splitCounts(graph.groups['tests:u1']!.tests.map((id) => graph.nodeOf.get(id))), { before: 1, changed: 5, removed: 1 })
  // Folded behind "Show more", each heading keeps one of its tests while there is room, so none says None while it has one.
  assert.deepEqual([...firstTests(split, 4)], [before, 'u4', removed, 'u5'])
})

test('a test that says what it covers is listed by that, and one that does not by its wires', () => {
  const node = (id: string, kind: ReviewNode['kind'], covers?: string[]): ReviewNode => ({ id, kind, title: id, change: 'added', summary: '', anchors: [], position: { x: 0, y: 0 }, ...(kind === 'test' ? { status: 'passed' as const } : {}), ...(covers ? { covers } : {}) })
  const nodes = [node('code', 'code'), node('other', 'code'), node('t1', 'test', ['code']), node('t2', 'test', ['other']), node('t3', 'test')]
  const edges: ReviewEdge[] = [
    { id: 'e2', from: 't2', to: 'code', kind: 'exercises', certainty: 'host' },
    { id: 'e3', from: 't3', to: 'code', kind: 'exercises', certainty: 'host' },
  ]
  const small = { edges, groups: {}, nodeOf: new Map(nodes.map((entry) => [entry.id, entry])) }
  assert.deepEqual(ids(testsFor(['code'], small)), ['t3', 't1'])
  assert.deepEqual(ids(testsFor(['other'], small)), ['t2'])
})

test('the card of tests a frame takes in is the one drawn for the code they cover', () => {
  assert.equal(testCardOf(shape, idOf('link_user_tags')), 'tests:u1')
  assert.equal(testCardOf(shape, idOf('report')), 'tests:u3')
  assert.equal(testCardOf(shape, idOf('README.md')), null)
  // A card folded into a group is not drawn, so it is not framed.
  assert.equal(testCardOf({ ...shape, nodes: shape.nodes.filter((node) => node.id !== 'tests:u1') }, idOf('link_user_tags')), null)
})

test('an acceptance line lists the tests that prove it, and a wire the reviewer removed no longer counts', () => {
  const node = (id: string, kind: ReviewNode['kind']): ReviewNode => ({ id, kind, title: id, change: 'added', summary: '', anchors: [], position: { x: 0, y: 0 }, ...(kind === 'test' ? { status: 'passed' as const } : {}) })
  const nodes = [node('A1', 'criterion'), node('t1', 'test'), node('t2', 'test'), node('code', 'code')]
  const edges: ReviewEdge[] = [
    { id: 'p1', from: 'A1', to: 't1', kind: 'proves', certainty: 'host' },
    { id: 'e1', from: 't1', to: 'code', kind: 'exercises', certainty: 'host' },
    { id: 'e2', from: 't2', to: 'code', kind: 'exercises', certainty: 'model' },
  ]
  const small = { edges, groups: {}, nodeOf: new Map(nodes.map((entry) => [entry.id, entry])) }
  assert.deepEqual(ids(testsFor(['A1'], small)), ['t1'])
  assert.deepEqual(ids(testsFor(['code'], small)), ['t1', 't2'])
  assert.deepEqual(ids(testsFor(['code'], { ...small, edges: edges.filter((edge) => edge.id !== 'e2') })), ['t1'])
})

test('a node no test covers says so plainly, unless its unit names what proves it', () => {
  assert.equal(noTestWords(undefined), 'No test covers this.')
  const readme = units.find((unit) => unit.facts.proof.value === 'not-applicable')!
  assert.equal(noTestWords(readme), 'No test covers this.')
  const none = { facts: { ...readme.facts, proof: { value: 'none' as const, evidence: 'no test reaches these lines' } } }
  assert.equal(noTestWords(none), 'No test covers this.')
  // Tests the review shows no node for still prove it: the unit says which.
  const proven = units.find((unit) => unit.facts.proof.value === 'isolated')!
  assert.equal(noTestWords(proven), proofWords(proven.facts))
})

test('a test opened from the card shows its code where the reviewer is, and the code follows the next move', () => {
  const session = createSession(pull, createReviewMemory(memoryStorage()))
  session.getState().goTo(2)
  const { story, focus, move } = session.getState()
  assert.deepEqual(focus, [idOf('fetch_errors')])

  assert.equal(session.getState().showTest('u14'), true)
  assert.equal(session.getState().code, 'u14', 'the failed test is in the code panel')
  assert.deepEqual([session.getState().story.step, session.getState().focus, session.getState().move.key], [story.step, focus, move.key], 'nothing moved')
  assert.equal(session.getState().showTest('u9'), true)
  assert.equal(session.getState().code, 'u9', 'another test of the same card takes its place')
  assert.equal(session.getState().showTest('nowhere'), false)
  assert.equal(session.getState().code, 'u9')

  session.getState().step(1)
  assert.equal(session.getState().code, session.getState().focus[0], 'the next step shows its own code')
})
