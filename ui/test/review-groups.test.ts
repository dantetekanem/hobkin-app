import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { nodeRect } from '#shared/review/layout.ts'
import type { Review, ReviewNode } from '#shared/review/types.ts'
import { arrange } from '../src/features/review/graph/arrange.ts'
import { FOCUS_BUDGET, foldArranged, planFocus, type FocusState } from '../src/features/review/graph/focus.ts'
import { focusLevels } from '../src/features/review/graph/levels.ts'
import { largeReview } from '../src/features/review/sample/large.ts'
import { pullReview } from '../src/features/review/sample/pull.ts'
import { escapeReview } from '../src/features/review/entry.ts'
import { pressKey } from '../src/features/review/keys.ts'
import { createReviewMemory } from '../src/features/review/state/memory.ts'
import { createSession } from '../src/features/review/state/session.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const large = largeReview().review
const pull = pullReview('pr:hobkin-sample/storefront/482')

function focusOn(review: Review, state?: FocusState) {
  const arranged = arrange(review)
  const nodeOf = new Map(review.nodes.map((node) => [node.id, node]))
  const plan = planFocus({ nodes: arranged.nodes, groups: arranged.groups, nodeOf, covers: arranged.covers, zones: arranged.zones }, state)
  return { arranged, plan, folded: foldArranged(arranged, plan) }
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

test('Focus draws every node that needs the reviewer and every one worth a look, and folds the safe ones by kind and by zone', () => {
  const { arranged, plan } = focusOn(large)
  assert.equal(plan.active, true)
  const wanted = large.nodes.filter((node) => node.attention && node.attention.tier !== 'safe')
  assert.equal(wanted.filter((node) => node.attention!.tier === 'needs-you').length, 7)
  for (const node of wanted) assert.ok(plan.cards.includes(cardOf(arranged, node.id)), `${node.title} is a card`)

  const labels = plan.order.map((id) => plan.groups[id]!.label)
  const kinds = ['Generated files', 'Lockfiles', 'Locale files', 'Moved or renamed', 'Formatting only', 'Docs']
  for (const label of kinds) assert.ok(labels.includes(label), label)
  // Every member of a group is safe, and no safe node is drawn alone while its group has others.
  for (const group of Object.values(plan.groups)) {
    assert.ok(group.members.length > 1)
    for (const id of group.members) assert.equal(plan.standing[id], 'safe')
    for (const id of group.members) assert.equal(plan.cards.includes(id), false, `${id} is folded`)
  }
  // With every card of tests beside its subject the budget is tight, so the smallest zones of safe code fold as one,
  // before any card gives way.
  assert.equal(labels.filter((label) => /^Safe code in \d+ zones$/.test(label)).length, 1)
  // Every group stands in one zone, and every group of safe code in one zone holds only that zone's code and says it.
  const roomy = focusOn(withoutTests(large))
  const zoneOf = (id: string) => roomy.arranged.nodes.find((node) => node.id === id)!.zone
  const byZone = Object.values(roomy.plan.groups).filter((group) => group.kind === 'code')
  assert.ok(byZone.length > 1)
  for (const group of byZone) {
    const zone = roomy.arranged.zones.find((each) => each.id === group.zone)!
    assert.equal(group.label, `Safe code in ${zone.label}`)
    for (const id of group.members) assert.equal(zoneOf(id), zone.id, `${id} is in ${zone.label}`)
  }
  for (const group of Object.values(focusOn(large).plan.groups)) assert.ok(group.zone != null, `${group.label} stands in a zone`)
})

/** A review without its tests and the wires that leave them. */
function withoutTests(review: Review): Review {
  const tests = new Set(review.nodes.filter((node) => node.kind === 'test').map((node) => node.id))
  return { ...review, nodes: review.nodes.filter((node) => !tests.has(node.id)), edges: review.edges.filter((edge) => !tests.has(edge.from) && !tests.has(edge.to)) }
}

test('unchanged code on the way in never folds with safe code: it keeps a standing of its own, and the routes stay where requests enter', () => {
  const { plan, folded } = focusOn(pull)
  assert.equal(plan.active, true, 'the sample is rated as the host rates a review')
  const around = pull.nodes.filter((node) => node.kind === 'context')
  for (const node of around) {
    assert.equal(node.attention?.tier, 'safe', `the host rates ${node.title} safe`)
    assert.equal(plan.standing[node.id], 'context')
    assert.ok(plan.cards.includes(node.id), `${node.title} is a card`)
  }
  assert.deepEqual(plan.order.map((id) => plan.groups[id]!.label).filter((label) => /config|controllers|helpers|models/.test(label)), [])
  // The layout still reads the way a request goes: the routes' zone first, then each call on its way.
  const x = (title: string) => folded.nodes.find((node) => node.title === title)!.position.x
  assert.equal(x('GET /posts/:id'), Math.min(...folded.nodes.filter((node) => node.kind !== 'criterion').map((node) => node.position.x)))
  for (const [left, right] of [['GET /posts/:id', 'PostsController#show'], ['PostsController#show', 'render_body'], ['render_body', 'link_user_tags']]) assert.ok(x(left!) < x(right!), `${left} before ${right}`)
  // The large sample's routes are cards too.
  const routes = large.nodes.filter((node) => node.kind === 'context')
  assert.ok(routes.length > 0 && routes.every((node) => focusOn(large).plan.cards.includes(node.id)))
})

/** The sample pull request with forty more routes that reach render_body, more cards than the budget has room for. */
function crowdedWayIn(): Review {
  const routes: ReviewNode[] = Array.from({ length: 40 }, (_, index) => ({
    id: `r${index + 1}`,
    kind: 'context',
    title: `GET /extra/${index + 1}`,
    subtitle: 'config/routes.rb',
    change: 'unchanged',
    summary: 'Another way to a post.',
    lifecycle: { role: 'caller', hops: 2 },
    entry: { kind: 'route', exact: true, route: { verbs: ['GET'], path: `/extra/${index + 1}` } },
    attention: { tier: 'safe', rank: 100 + index, reasons: [] },
    bucket: 'code',
    anchors: [],
    position: { x: 0, y: 0 },
  }))
  const u1 = pull.nodes.find((node) => node.title === 'link_user_tags')!
  // The host names the last of them as link_user_tags's way in.
  const nodes = pull.nodes.map((node) => (node.id === u1.id ? { ...node, lifecycle: { role: 'changed' as const, hops: 2, origin: { kind: 'route', label: 'GET /extra/40', exact: true, chain: ['r40', 'c1'] } } } : node))
  return {
    ...pull,
    nodes: [...nodes, ...routes],
    edges: [...pull.edges, ...routes.map((route) => ({ id: `called-by:c1>${route.id}`, from: 'c1', to: route.id, kind: 'called-by' as const, certainty: 'host' as const }))],
  }
}

test('past the budget the way in folds into "More of the way in", which keeps where a request enters and its life cycle', () => {
  const { plan, folded } = focusOn(crowdedWayIn())
  assert.ok(folded.nodes.length <= FOCUS_BUDGET.cards)
  const way = groupNamed(plan, 'More of the way in')
  assert.equal(way.standing, 'context')
  assert.ok(way.members.length > 0 && way.members.every((id) => id.startsWith('r')), 'only the way in folds into it')
  assert.ok(plan.cards.includes('c1') && plan.cards.includes('c5'), 'the way in the review lists first stays drawn')

  // Its card is unchanged code where a request enters, and it stands in the zone of the routes it holds.
  const card = folded.nodes.find((node) => node.id === way.id)!
  assert.deepEqual([card.kind, card.change, card.entry?.kind, card.lifecycle?.role], ['context', 'unchanged', 'route', 'caller'])
  assert.equal(card.zone, folded.nodes.find((node) => node.title === 'GET /posts/:id')!.zone)
})

test('a zone the reviewer folds is one card, its way in on a card of its own that keeps where a request enters, each part with its tests', () => {
  const helpers = arrange(pull).zones.find((zone) => zone.label === 'Helpers · Posts')!
  const { plan, folded } = focusOn(pull, { opened: [], pinned: [], zones: [helpers.id] })
  const parts = plan.groups[`fold:zone:${helpers.id}`]!
  const way = plan.groups[`fold:zone:${helpers.id}:way`]!
  assert.deepEqual([parts.kind, parts.zone, parts.label], ['zone', helpers.id, 'Helpers · Posts'])
  assert.ok(parts.members.includes('u1') && parts.members.includes('tests:u1'), 'link_user_tags takes its card of tests with it')
  assert.deepEqual(way.members, ['c1'], 'render_body is on the way in, so it never folds with the change')
  assert.equal(way.standing, 'context')
  assert.equal(way.label, 'Helpers · Posts, on the way in')
  const card = folded.nodes.find((node) => node.id === way.id)!
  assert.deepEqual([card.kind, card.change, card.lifecycle?.role], ['context', 'unchanged', 'caller'])
  for (const id of ['u1', 'c1', 'tests:u1']) assert.equal(plan.cards.includes(id), false, `${id} folds`)
  // The zone's region holds its cards, and no other zone's region overlaps it.
  assert.equal(folded.nodes.filter((node) => node.zone === helpers.id).length, 2)

  // A zone of tests folds only with the code it covers, so folding it alone folds nothing.
  const tests = arrange(pull).zones.find((zone) => zone.tests)!
  assert.deepEqual(focusOn(pull, { opened: [], pinned: [], zones: [tests.id] }).plan.order, focusOn(pull).plan.order)
  // Opening it again puts the graph back as it was.
  assert.deepEqual(focusOn(pull, { opened: [], pinned: [] }).folded.nodes.map((node) => [node.id, node.position]), focusOn(pull).folded.nodes.map((node) => [node.id, node.position]))
})

test('a review the host did not rate folds only the zones the reviewer folds, and the budget holds with every zone folded', () => {
  const zones = arrange(sample).zones
  const one = zones.find((zone) => !zone.tests && zone.members.length > 1)!
  const { plan, folded } = focusOn(sample, { opened: [], pinned: [], zones: [one.id] })
  assert.equal(plan.active, false, 'it still says nothing of attention')
  assert.deepEqual(plan.order.map((id) => plan.groups[id]!.kind), plan.order.map(() => 'zone'))
  assert.ok(folded.nodes.length < arrange(sample).nodes.length)
  for (const review of [large, crowdedLarge()]) {
    const all = arrange(review).zones.filter((zone) => !zone.tests).map((zone) => zone.id)
    const { folded: closed } = focusOn(review, { opened: [], pinned: [], zones: all })
    assert.ok(closed.nodes.length <= FOCUS_BUDGET.cards && closed.edges.length <= FOCUS_BUDGET.wires)
    assert.ok(Object.values(closed.plan.groups).filter((group) => group.kind === 'zone').length >= all.length)
  }
})

test('a way in folded into "More of the way in" lights its card, and the wire from it, when the step is on the code it leads to', () => {
  const { folded } = focusOn(crowdedWayIn())
  const way = groupNamed(folded.plan, 'More of the way in')
  assert.equal(folded.foldOf.r40, way.id, "the host's way in to link_user_tags is folded")
  const levels = focusLevels(folded, ['u1'])
  assert.equal(levels.nodes[way.id], 'neighbor')
  const wire = folded.edges.find((edge) => edge.from === way.id && edge.to === 'c1')!
  assert.equal(levels.wires[wire.id], 'near')
})

/** The large sample with more cards than the budget: 45 of its safe functions rated as needing the reviewer. */
function crowdedLarge(): Review {
  const promoted = new Set(large.nodes.filter((node) => node.kind === 'code' && node.attention?.tier === 'safe').slice(0, 45).map((node) => node.id))
  return { ...large, id: 'crowded', nodes: large.nodes.map((node) => (promoted.has(node.id) ? { ...node, attention: { ...node.attention!, tier: 'needs-you' as const } } : node)) }
}

test("a card of tests folds only with its subject: drawn while its subject is, and in its subject's group when it folds", () => {
  for (const review of [large, crowdedLarge()]) {
    const { arranged, plan } = focusOn(review)
    assert.equal(plan.order.some((id) => plan.groups[id]!.label === 'Tests that pass'), false, 'no one card for the tests that pass')
    const cards = arranged.nodes.filter((node) => node.kind === 'test')
    assert.ok(cards.length > 10)
    for (const { id } of cards) {
      const group = arranged.groups[id]
      const subject = group ? (group.subject ?? arranged.covers[group.tests[0]!]!) : arranged.covers[id]!
      if (plan.cards.includes(subject)) assert.ok(plan.cards.includes(id), `${review.id}: ${id} is drawn with ${subject}`)
      if (plan.groupOf[id]) assert.equal(plan.groupOf[id], plan.groupOf[subject], `${review.id}: ${id} folds with ${subject}`)
    }
    // A group opened draws a subject with its tests after it.
    for (const groupId of plan.order) {
      const members = plan.groups[groupId]!.members
      for (const [at, id] of members.entries()) {
        const group = arranged.groups[id]
        if (!group) continue
        const subject = group.subject ?? arranged.covers[group.tests[0]!]!
        assert.ok(members.indexOf(subject) < at, `${groupId}: ${id} comes after ${subject}`)
      }
    }
  }
  // The budget still holds with every card of tests beside its subject: past it, a subject and its tests fold together.
  const { folded } = focusOn(crowdedLarge())
  assert.ok(folded.nodes.length <= FOCUS_BUDGET.cards && folded.edges.length <= FOCUS_BUDGET.wires)
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
  const docs = groupNamed(closed, 'Docs')
  const both = focusOn(large, { opened: [generated.id, docs.id], pinned: [] }).plan
  assert.deepEqual(both.shown[docs.id], docs.members)
  assert.equal(both.shown[generated.id]!.length, room - docs.members.length)
  // A node reached from the outline is drawn before the rest of its group.
  const last = generated.members.at(-1)!
  const reached = focusOn(large, { opened: [generated.id], pinned: [last] }).plan
  assert.equal(reached.shown[generated.id]![0], last)
})

test('the budget: the 200-file review never draws more than 60 cards and 120 wires, closed, with each group open, or with all of them', () => {
  const { plan } = focusOn(large)
  const states: FocusState[] = [
    { opened: [], pinned: [] },
    ...plan.order.map((id) => ({ opened: [id], pinned: [] })),
    { opened: plan.order, pinned: [] },
  ]
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

const overlap = (a: ReviewNode, b: ReviewNode) => {
  const [one, two] = [nodeRect(a.kind, a.position), nodeRect(b.kind, b.position)]
  return one.x < two.x + two.width && two.x < one.x + one.width && one.y < two.y + two.height && two.y < one.y + one.height
}

test('an open group opens in place: its members follow its card down and to the right, nothing overlaps, and closing it puts the graph back', () => {
  const { plan, folded: closed } = focusOn(large)
  const at = (view: typeof closed, id: string) => view.nodes.find((node) => node.id === id)!.position
  const states = [...plan.order.map((id) => ({ opened: [id], pinned: [] })), { opened: plan.order, pinned: [] }]
  for (const state of states) {
    const { folded } = focusOn(large, state)
    for (let first = 0; first < folded.nodes.length; first += 1) {
      for (let second = first + 1; second < folded.nodes.length; second += 1) {
        const [one, two] = [folded.nodes[first]!, folded.nodes[second]!]
        assert.equal(overlap(one, two), false, `${one.id} and ${two.id} with ${state.opened.join(', ')} open`)
      }
    }
  }
  const docs = groupNamed(plan, 'Docs')
  const { folded: open } = focusOn(large, { opened: [docs.id], pinned: [] })
  const card = at(open, docs.id)
  assert.deepEqual(card, at(closed, docs.id), 'the group card stays where it stood')
  for (const id of docs.members) {
    const member = at(open, id)
    assert.ok(member.x >= card.x && member.y >= card.y, `${id} follows its card`)
  }
  // Members read down each column, then on to the next.
  const columns = docs.members.map((id) => at(open, id).x)
  assert.deepEqual(columns, [...columns].sort((a, b) => a - b))
  assert.deepEqual(focusOn(large).folded.nodes.map((node) => [node.id, node.position]), closed.nodes.map((node) => [node.id, node.position]))
})

const keys = { panelKey: () => false, toggleSteps: () => {}, verdict: () => {}, proofKey: () => {} }
const press = (session: ReturnType<typeof createSession>, key: string, shift = false) => pressKey(session.getState(), { key, shift, alt: false }, keys)

test('Enter on a group card opens it in place, its members focused with it, and Escape closes it, back on its card', () => {
  const session = createSession(large, createReviewMemory())
  const generated = groupNamed(session.getState().view.plan, 'Generated files')
  session.getState().focusOn(generated.id)
  assert.deepEqual(session.getState().focus, [generated.id])

  press(session, 'Enter')
  const open = session.getState()
  assert.equal(open.code, null, 'a group has no code of its own: Enter opens it')
  assert.deepEqual(open.view.plan.open, [generated.id])
  const shown = open.view.plan.shown[generated.id]!
  assert.ok(shown.length > 0)
  for (const id of shown) assert.ok(open.view.nodes.some((node) => node.id === id), `${id} is a card`)
  assert.deepEqual(open.focus, [generated.id, ...shown], 'the group and its members are framed together')
  assert.ok(open.view.nodes.length <= FOCUS_BUDGET.cards)

  let left = false
  escapeReview(session.getState(), () => (left = true))
  const closed = session.getState()
  assert.equal(left, false, 'Escape closes the group before it closes the review')
  assert.deepEqual(closed.view.plan.open, [])
  assert.deepEqual(closed.focus, [generated.id])
  for (const id of shown) assert.equal(closed.view.nodes.some((node) => node.id === id), false)
  escapeReview(session.getState(), () => (left = true))
  assert.equal(left, true, 'with no group open, Escape leaves the review')

  // A group closed while the reviewer is elsewhere leaves them where they are.
  const again = createSession(large, createReviewMemory())
  again.getState().openGroup(generated.id)
  again.getState().goTo(2)
  const step = again.getState().focus
  escapeReview(again.getState(), () => (left = false))
  assert.deepEqual(again.getState().view.plan.open, [])
  assert.deepEqual(again.getState().focus, step)
})

test('a node folded into a group is reached: its group opens, it is drawn first in it, and it is focused', () => {
  const session = createSession(large, createReviewMemory())
  const generated = groupNamed(session.getState().view.plan, 'Generated files')
  const last = generated.members.at(-1)!
  assert.equal(session.getState().view.nodes.some((node) => node.id === last), false)
  session.getState().reach(last)
  const reached = session.getState()
  assert.ok(reached.view.nodes.some((node) => node.id === last))
  assert.equal(reached.view.plan.shown[generated.id]![0], last)
  assert.deepEqual(reached.focus, [last])
  // A node of a card of tests that folded is reached on its card.
  const tests = Object.values(reached.view.plan.groups).find((group) => group.members.some((id) => reached.view.groups[id]))!
  const card = tests.members.find((id) => reached.view.groups[id])!
  const test = reached.view.groups[card]!.tests[0]!
  session.getState().reach(test)
  assert.deepEqual(session.getState().focus, [card])
})

test("a zone's heading folds it into one card and opens it again; Enter on its card opens it, on its first node", () => {
  const session = createSession(pull, createReviewMemory())
  const helpers = session.getState().view.zones.find((zone) => zone.label === 'Helpers · Posts')!
  const card = `fold:zone:${helpers.id}`
  session.getState().focusOn('u1')
  assert.equal(session.getState().toggleZone(helpers.id), true)
  assert.ok(session.getState().view.nodes.some((node) => node.id === card))
  assert.deepEqual(session.getState().focus, [card], 'the reviewer on what folded is on its card')

  assert.equal(press(session, 'Enter'), true)
  assert.equal(session.getState().view.nodes.some((node) => node.id === card), false, 'Enter on the card opens the zone')
  assert.deepEqual(session.getState().focus, [helpers.members[0]])

  // A zone of tests has no fold of its own, and a node in a folded zone is reached by opening it.
  assert.equal(session.getState().toggleZone(session.getState().view.zones.find((zone) => zone.tests)!.id), false)
  session.getState().toggleZone(helpers.id)
  session.getState().reach('c1')
  assert.equal(session.getState().view.nodes.some((node) => node.id === card), false)
  assert.deepEqual(session.getState().focus, ['c1'])
})
