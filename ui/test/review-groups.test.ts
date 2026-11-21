import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Review } from '#shared/review/types.ts'
import { arrange } from '../src/features/review/graph/arrange.ts'
import { FOCUS_BUDGET, foldArranged, planFocus, type FocusState } from '../src/features/review/graph/focus.ts'
import { largeReview } from '../src/features/review/sample/large.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const large = largeReview().review
const nowhere = () => ({})

function focusOn(review: Review, state?: FocusState) {
  const arranged = arrange(review)
  const nodeOf = new Map(review.nodes.map((node) => [node.id, node]))
  const plan = planFocus({ nodes: arranged.nodes, groups: arranged.groups, nodeOf }, state)
  return { arranged, plan, folded: foldArranged(arranged, plan, nowhere) }
}
/** Where a node of the review is drawn: itself, or the card of tests that holds it. */
const cardOf = (arranged: ReturnType<typeof arrange>, id: string) => arranged.groupOf[id] ?? id
const groupNamed = (plan: ReturnType<typeof planFocus>, label: string) => Object.values(plan.groups).find((group) => group.label === label)!

test('the large sample is a change of 200 files and over 10,000 changed lines', () => {
  assert.equal(large.files.length, 200)
  assert.ok(large.change.additions + large.change.deletions >= 10_000)
  assert.equal(largeReview().review, large, 'built once, then kept')
})

test('a review whose nodes say nothing about attention folds nothing, and draws as it did', () => {
  const { arranged, plan, folded } = focusOn(sample)
  assert.equal(plan.active, false)
  assert.deepEqual(plan.cards, arranged.nodes.map((node) => node.id))
  assert.deepEqual(plan.groups, {})
  assert.equal(folded.nodes, arranged.nodes, 'the same nodes, in the same places')
  assert.equal(folded.edges, arranged.edges)
})

test('Focus draws every node that needs the reviewer and every one worth a look, and folds the safe ones by kind and by folder', () => {
  const { arranged, plan } = focusOn(large)
  assert.equal(plan.active, true)
  const wanted = large.nodes.filter((node) => node.attention && node.attention.tier !== 'safe')
  assert.equal(wanted.filter((node) => node.attention!.tier === 'needs-you').length, 7)
  for (const node of wanted) assert.ok(plan.cards.includes(cardOf(arranged, node.id)), `${node.title} is a card`)

  const labels = plan.order.map((id) => plan.groups[id]!.label)
  for (const label of ['Generated files', 'Lockfiles', 'Locale files', 'Moved or renamed', 'Formatting only', 'Docs', 'Tests that pass', 'Safe code in app/models']) assert.ok(labels.includes(label), label)
  // Every member of a group is safe, and no safe node is drawn alone while its group has others.
  for (const group of Object.values(plan.groups)) {
    assert.ok(group.members.length > 1)
    for (const id of group.members) assert.equal(plan.standing[id], 'safe')
    for (const id of group.members) assert.equal(plan.cards.includes(id), false, `${id} is folded`)
  }
  // Safe code folds by its top folder.
  for (const id of groupNamed(plan, 'Safe code in app/models').members) assert.match(arranged.nodes.find((node) => node.id === id)!.subtitle!, /^app\/models\//)
})

test('a group knows its members, how many files, its lines and why it is safe', () => {
  const { arranged, plan } = focusOn(large)
  const generated = groupNamed(plan, 'Generated files')
  const members = generated.members.map((id) => arranged.nodes.find((node) => node.id === id)!)
  assert.equal(members.length, 50)
  assert.equal(generated.files, 50)
  assert.equal(generated.additions, members.reduce((sum, node) => sum + node.stats!.additions, 0))
  assert.equal(generated.deletions, members.reduce((sum, node) => sum + node.stats!.deletions, 0))
  assert.match(generated.why, /^[A-Z].+\.$/)
  // Most wanted first: the host's rank orders the members.
  const ranks = members.map((node) => node.attention!.rank)
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b))
})

test('opening a group draws its members while the budget lasts; past it they stay folded, and a reached one is drawn first', () => {
  const closed = focusOn(large).plan
  const room = FOCUS_BUDGET.cards - closed.cards.length
  const generated = groupNamed(closed, 'Generated files')
  assert.ok(generated.members.length > room, 'the sample has more generated files than the budget leaves room for')

  const open = focusOn(large, { opened: [generated.id], pinned: [] }).plan
  assert.deepEqual(open.shown[generated.id], generated.members.slice(0, room))
  assert.equal(open.cards.length, FOCUS_BUDGET.cards)
  assert.equal(open.cards.includes(generated.members.at(-1)!), false, 'the last one stays in the outline only')

  // The last group opened takes the budget first.
  const models = groupNamed(closed, 'Safe code in app/models')
  const both = focusOn(large, { opened: [generated.id, models.id], pinned: [] }).plan
  assert.deepEqual(both.shown[models.id], models.members)
  assert.equal(both.shown[generated.id]!.length, room - models.members.length)
  // A node reached from the outline is drawn before the rest of its group.
  const last = generated.members.at(-1)!
  const reached = focusOn(large, { opened: [generated.id], pinned: [last] }).plan
  assert.equal(reached.shown[generated.id]![0], last)
})

test('the budget: the 200-file review never draws more than 60 cards and 120 wires, closed, with each group open, or with all of them', () => {
  const { plan } = focusOn(large)
  const states: FocusState[] = [{ opened: [], pinned: [] }, ...plan.order.map((id) => ({ opened: [id], pinned: [] })), { opened: plan.order, pinned: [] }]
  const needsYou = large.nodes.filter((node) => node.attention?.tier === 'needs-you')
  for (const state of states) {
    const { arranged, folded } = focusOn(large, state)
    assert.ok(folded.nodes.length <= FOCUS_BUDGET.cards, `${folded.nodes.length} cards with ${state.opened.join(', ') || 'nothing'} open`)
    assert.ok(folded.edges.length <= FOCUS_BUDGET.wires, `${folded.edges.length} wires with ${state.opened.join(', ') || 'nothing'} open`)
    for (const node of needsYou) assert.ok(folded.nodes.some((drawn) => drawn.id === cardOf(arranged, node.id)), `${node.title} is drawn`)
    // Every wire joins two nodes that are drawn.
    const drawn = new Set(folded.nodes.map((node) => node.id))
    for (const edge of folded.edges) assert.ok(drawn.has(edge.from) && drawn.has(edge.to), edge.id)
  }
  // Unfolded, the same review would draw far more.
  assert.ok(arrange(large).nodes.length > 3 * FOCUS_BUDGET.cards)
})

test('a folded node is drawn as its group: its wires go to the group card, and a step about it focuses the card', () => {
  const { plan, folded } = focusOn(large)
  const generated = groupNamed(plan, 'Generated files')
  assert.ok(folded.edges.some((edge) => edge.to === generated.id && edge.kind === 'imports'), 'what the services import lands on the group')
  for (const id of generated.members) assert.equal(folded.foldOf[id], generated.id)
  assert.ok(folded.hidden.some((node) => node.id === generated.members[0]), 'a folded node is kept for its code and its notes')
  for (const step of folded.story) for (const id of step.focus) assert.ok(folded.nodes.some((node) => node.id === id), `${step.id} focuses ${id}, which is drawn`)
})
