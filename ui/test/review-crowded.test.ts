import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Review, ReviewNode } from '#shared/review/types.ts'
import { FOCUS_BUDGET, isFoldGroup, OPEN_ROOM } from '../src/features/review/graph/focus.ts'
import { escapeReview } from '../src/features/review/entry.ts'
import { pressKey } from '../src/features/review/keys.ts'
import { largeReview } from '../src/features/review/sample/large.ts'
import { createReviewMemory } from '../src/features/review/state/memory.ts'
import { createSession } from '../src/features/review/state/session.ts'

/**
 * A change with far more cards than the budget: the 200-file sample with 35 more acceptance lines, and 45 of its safe
 * functions rated as needing the reviewer.
 */
function crowded(): Review {
  const base = largeReview().review
  const promoted = new Set(base.nodes.filter((node) => node.kind === 'code' && node.attention?.tier === 'safe').slice(0, 45).map((node) => node.id))
  const lines: ReviewNode[] = Array.from({ length: 35 }, (_, index) => ({
    id: `A${index + 7}`,
    kind: 'criterion',
    title: `A${index + 7}`,
    change: 'added',
    summary: `Acceptance line ${index + 7}.`,
    status: 'proven',
    anchors: [],
    position: { x: 0, y: 0 },
  }))
  const nodes = base.nodes.map((node) => (promoted.has(node.id) ? { ...node, attention: { ...node.attention!, tier: 'needs-you' as const } } : node))
  return { ...base, id: 'crowded', nodes: [...nodes, ...lines] }
}
const review = crowded()
const open = () => createSession(review, createReviewMemory())
const keys = { panelKey: () => false, toggleSteps: () => {}, verdict: () => {}, proofKey: () => {} }
const needsYou = review.nodes.filter((node) => node.attention?.tier === 'needs-you').sort((a, b) => a.attention!.rank - b.attention!.rank).map((node) => node.id)
const drawn = (session: ReturnType<typeof open>, id: string) => session.getState().view.nodes.some((node) => node.id === id)

test('a change with more cards than the budget folds the rest, and keeps room for any group to open', () => {
  const session = open()
  const { view } = session.getState()
  assert.ok(needsYou.length > FOCUS_BUDGET.cards / 2)
  assert.ok(view.nodes.length <= FOCUS_BUDGET.cards)
  const more = view.plan.order.filter((id) => view.plan.groups[id]!.kind === 'more')
  assert.ok(more.length >= 2, 'what does not fit folds into groups for what it is')
  for (const id of view.plan.order) {
    session.getState().openGroup(id)
    const { plan, nodes } = session.getState().view
    const members = plan.groups[id]!.members.length
    assert.equal(plan.shown[id]!.length, Math.min(members, OPEN_ROOM), `${plan.groups[id]!.label} draws its members`)
    assert.ok(nodes.length <= FOCUS_BUDGET.cards)
    session.getState().closeGroup(id)
  }
})

test('every node of a change with more cards than the budget can be reached, and is then drawn and focused', () => {
  const session = open()
  const lines = review.nodes.filter((node) => node.kind === 'criterion').map((node) => node.id)
  for (const id of [...needsYou, ...lines]) {
    session.getState().reach(id)
    assert.ok(drawn(session, id), `${id} is drawn`)
    assert.deepEqual(session.getState().focus, [id])
    assert.ok(session.getState().view.nodes.length <= FOCUS_BUDGET.cards)
  }
})

test('U walks every node that needs the reviewer in turn, the folded ones too, and never stops on a group card', () => {
  const session = open()
  const visited: string[] = []
  for (let press = 0; press < needsYou.length; press += 1) {
    pressKey(session.getState(), { key: 'u', shift: false, alt: false }, keys)
    const [focused] = session.getState().focus
    assert.equal(session.getState().focus.length, 1)
    assert.equal(isFoldGroup(focused!), false)
    visited.push(focused!)
  }
  assert.deepEqual(visited, needsYou)
})

test('U from a group card goes to the first node that needs the reviewer, the group\'s own members not passed over', () => {
  const session = open()
  const { plan } = session.getState().view
  const more = plan.order.find((id) => plan.groups[id]!.kind === 'more' && plan.groups[id]!.standing === 'needs-you')!
  // Every node that needs the reviewer and is drawn is seen: what is left is in the group.
  for (const id of needsYou) if (!plan.groupOf[id]) session.getState().toggleSeen(id)
  session.getState().focusOn(more)
  pressKey(session.getState(), { key: 'u', shift: false, alt: false }, keys)
  assert.deepEqual(session.getState().focus, [plan.groups[more]!.members[0]])
})

test('one Escape closes every group open, those the outline, U or a kept place opened by themselves too, and the next leaves the review', () => {
  const session = open()
  const { plan } = session.getState().view
  const groups = ['Docs', 'Locale files', 'Moved or renamed'].map((label) => plan.groups[plan.order.find((id) => plan.groups[id]!.label === label)!]!)
  for (const group of groups) session.getState().reach(group.members.at(-1)!)
  // What needs the reviewer and is drawn is seen, so U goes into the group of those that did not fit.
  for (const id of needsYou) if (!plan.groupOf[id]) session.getState().toggleSeen(id)
  for (let press = 0; press < 5; press += 1) pressKey(session.getState(), { key: 'u', shift: false, alt: false }, keys)
  assert.equal(session.getState().view.plan.open.length, 4, 'the outline and U opened four groups by themselves')
  const before = session.getState().focus

  let left = 0
  escapeReview(session.getState(), () => (left += 1))
  assert.equal(left, 0)
  assert.deepEqual(session.getState().view.plan.open, [], 'one press closes them all')
  assert.equal(session.getState().view.nodes.length <= FOCUS_BUDGET.cards, true)
  // The reviewer was on a node a group opened to: they are on its card now.
  assert.deepEqual(session.getState().focus, [session.getState().view.foldOf[before[0]!]])
  escapeReview(session.getState(), () => (left += 1))
  assert.equal(left, 1, 'the next press leaves the review')
})
